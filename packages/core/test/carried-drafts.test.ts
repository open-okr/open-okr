/**
 * Kept and modified objectives pre-fill the next cycle (METHOD.md §8.8,
 * §8.9, P9-T20e-b).
 *
 * §8.9's row: "Every kept or modified objective | Phase 4, a pre-filled draft
 * whose key results start from their last recorded values as baselines."
 *
 * The task's test plan: the pre-filled draft and its baselines; the
 * feed-forward rows. The acceptance: given an objective kept at the close,
 * when the next cycle's drafting opens, then it is a draft whose key results
 * start from their last recorded values.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { carriedKeyResult } from "../src/cycles/carry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "carried-facilitator";
const TITLE = "Become the platform mid-market teams reach for first";

let workspaceId: string;
let fromCycleId: string;
let toCycleId: string;
let spaceId: string;
let memberId: string;
let sessionId: string;
let goalId: string;

const call = async <T>(name: string, input: unknown): Promise<T> => {
  const wb = await workerDb();
  return (await callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: FACILITATOR },
    },
    name as never,
    input as never,
  )) as T;
};

const feedForward = () =>
  call<{ drafts: number; notCarried: string[] }>("cycles.feedForward", {
    fromCycleId,
    toCycleId,
  });

/** The next cycle's objectives, with the key results each starts from. */
const draftsIn = async (cycleId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    title: string;
    carried_from_goal_id: string | null;
    draft_state: string | null;
    champion_id: string;
  }>(
    `select id, title, carried_from_goal_id, draft_state, champion_id
       from goals where cycle_id = $1 and deleted_at is null
      order by created_at`,
    [cycleId],
  );
  const withKeyResults = [];
  for (const row of rows) {
    const { rows: keyResults } = await wb.admin.query<{
      title: string;
      kind: string;
      baseline_value: string;
      target_value: string | null;
      current_value: string;
    }>(
      `select title, kind, baseline_value, target_value, current_value
         from key_results where goal_id = $1 and deleted_at is null
        order by position`,
      [row.id],
    );
    withKeyResults.push({
      ...row,
      keyResults: keyResults.map((keyResult) => ({
        title: keyResult.title,
        kind: keyResult.kind,
        baseline: Number(keyResult.baseline_value),
        target:
          keyResult.target_value === null
            ? null
            : Number(keyResult.target_value),
        current: Number(keyResult.current_value),
      })),
    });
  }
  return withKeyResults;
};

const objectiveWith = async (title: string, championId = memberId) => {
  const goal = await call<{ id: string }>("goals.create", {
    title,
    cycleId: fromCycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId,
  });
  const keyResult = await call<{ id: string }>("goals.addKeyResult", {
    goalId: goal.id,
    title: "Raise weekly active teams from 120 to 300 by 31 March",
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 120,
    targetValue: 300,
    unit: "teams",
  });
  // The quarter moved it to 210, and 210 is where the next one starts.
  await call("goals.recordValue", { id: keyResult.id, value: 210 });
  return goal.id;
};

const decide = (id: string, decision: string) =>
  call("sessions.decideObjective", {
    sessionId,
    goalId: id,
    decision,
    why: "The room decided it.",
  });

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Facilitator', $2)`,
    [FACILITATOR, "carried-facilitator@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: FACILITATOR,
    name: "Facilitator",
  });
  workspaceId = provisioned.workspaceId;
  memberId = provisioned.memberId;
  spaceId = (await call<{ id: string }[]>("spaces.list", {}))[0]?.id as string;
  fromCycleId = (
    await call<{ id: string }>("cycles.current", {
      mode: "quarterly",
    })
  ).id;
  const inNextQuarter = new Date(Date.now() + 120 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  toCycleId = (
    await call<{ id: string }>("cycles.create", {
      on: inNextQuarter,
      cadence: "quarterly",
    })
  ).id;

  goalId = await objectiveWith(TITLE);

  sessionId = (
    await call<{ id: string }>("sessions.create", {
      spaceId,
      cycleId: fromCycleId,
      kind: "quarterly",
      title: "Q1 review",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      facilitatorId: memberId,
    })
  ).id;
  await call("sessions.open", { id: sessionId });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a kept objective", () => {
  it("is a draft in the next cycle whose key results start from their last recorded values", async () => {
    await decide(goalId, "keep");
    await call("sessions.close", { id: sessionId });
    const result = await feedForward();

    expect(result.drafts).toBe(1);
    const [draft, ...rest] = await draftsIn(toCycleId);
    expect(rest).toEqual([]);
    expect(draft).toMatchObject({
      title: TITLE,
      carried_from_goal_id: goalId,
      champion_id: memberId,
      // The next cycle has not started, so the draft is part of its plan
      // rather than a draft waiting for a person.
      draft_state: null,
    });
    expect(draft?.keyResults).toEqual([
      {
        title: "Raise weekly active teams from 120 to 300 by 31 March",
        kind: "metric",
        baseline: 210,
        target: 300,
        current: 210,
      },
    ]);
  });

  it("is carried the same way when it was modified", async () => {
    await decide(goalId, "modify");
    await call("sessions.close", { id: sessionId });
    await feedForward();
    expect((await draftsIn(toCycleId)).map((row) => row.title)).toEqual([
      TITLE,
    ]);
  });

  it("is carried once, however often the cycle is fed", async () => {
    await decide(goalId, "keep");
    await call("sessions.close", { id: sessionId });
    await feedForward();
    const second = await feedForward();
    expect(second.drafts).toBe(0);
    expect(await draftsIn(toCycleId)).toHaveLength(1);
  });

  it("stays deleted once somebody deletes the draft", async () => {
    await decide(goalId, "keep");
    await call("sessions.close", { id: sessionId });
    await feedForward();
    const [draft] = await draftsIn(toCycleId);
    await call("goals.delete", { id: draft?.id });

    // Deleting it was a decision about the next cycle, made after the
    // room's, and a re-run that put it back would overrule it.
    const again = await feedForward();
    expect(again.drafts).toBe(0);
    expect(await draftsIn(toCycleId)).toEqual([]);
  });

  it("is carried when it was closed as kept from its own page", async () => {
    await call("goals.close", {
      id: goalId,
      successStatus: "missed",
      closeDecision: "keep",
      retrospectiveBody: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Again." }] },
        ],
      },
    });
    await feedForward();
    expect((await draftsIn(toCycleId)).map((row) => row.title)).toEqual([
      TITLE,
    ]);
  });

  it("is not carried when its owner later closed it as achieved", async () => {
    await decide(goalId, "keep");
    await call("sessions.close", { id: sessionId });
    // The later decision is the decision: it was made knowing the room's.
    await call("goals.close", {
      id: goalId,
      successStatus: "achieved",
      closeDecision: "achieved",
      retrospectiveBody: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Done." }] },
        ],
      },
    });
    await feedForward();
    expect(await draftsIn(toCycleId)).toEqual([]);
  });

  it("is named rather than carried when its champion has left", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ id: string }>(
      `insert into workspace_members (id, workspace_id, name, kind, status)
       values (gen_random_uuid(), $1, 'Lee', 'human', 'active') returning id`,
      [workspaceId],
    );
    const lee = rows[0]?.id as string;
    const leesGoal = await objectiveWith("Make onboarding self-serve", lee);
    await decide(leesGoal, "keep");
    await call("sessions.close", { id: sessionId });
    await call("people.suspend", { memberId: lee });

    const result = await feedForward();
    // §2.5: a draft needs somebody to own it, and the product does not pick
    // a new owner on the room's behalf.
    expect(result.notCarried).toEqual(["Make onboarding self-serve"]);
    expect(await draftsIn(toCycleId)).toEqual([]);
  });
});

describe("the other decisions", () => {
  it.each(["achieved", "defer", "abandon"])(
    "does not pre-fill a draft for %s",
    async (decision) => {
      await decide(goalId, decision);
      await call("sessions.close", { id: sessionId });
      const result = await feedForward();
      expect(result.drafts).toBe(0);
      expect(await draftsIn(toCycleId)).toEqual([]);
    },
  );
});

describe("how each kind of key result starts (§2.10)", () => {
  const base = { baselineValue: 0, targetValue: 1, currentValue: 0 };

  it("starts a metric from its last value, with the same target, and keeps a maintain's band", () => {
    expect(
      carriedKeyResult({
        kind: "metric",
        doneAt: null,
        baselineValue: 120,
        targetValue: 300,
        currentValue: 210,
      }),
    ).toEqual({ kind: "metric", baselineValue: 210, targetValue: 300 });
    expect(
      carriedKeyResult({
        kind: "maintain",
        doneAt: null,
        baselineValue: 98,
        targetValue: 99,
        currentValue: 99.4,
      }),
    ).toEqual({ kind: "maintain", baselineValue: 98, targetValue: 99 });
    // A reading that fell out of the band stays out of it: the band is what
    // was kept, not wherever the number finished.
    expect(
      carriedKeyResult({
        kind: "maintain",
        doneAt: null,
        baselineValue: 99.5,
        targetValue: 99.99,
        currentValue: 98,
      }),
    ).toEqual({ kind: "maintain", baselineValue: 99.5, targetValue: 99.99 });
  });

  it("leaves a done milestone behind and starts an open one again", () => {
    expect(
      carriedKeyResult({
        ...base,
        kind: "milestone",
        doneAt: new Date(),
        currentValue: 1,
      }),
    ).toBeNull();
    expect(
      carriedKeyResult({ ...base, kind: "milestone", doneAt: null }),
    ).toEqual({ kind: "milestone", baselineValue: 0, targetValue: 1 });
  });

  it("turns a recorded baseline into a metric from the number it found, its target to set", () => {
    expect(
      carriedKeyResult({
        kind: "baseline",
        doneAt: new Date(),
        baselineValue: 42,
        targetValue: 1,
        currentValue: 42,
      }),
    ).toEqual({ kind: "metric", baselineValue: 42, targetValue: null });
    expect(
      carriedKeyResult({ ...base, kind: "baseline", doneAt: null }),
    ).toEqual({ kind: "baseline", baselineValue: 0, targetValue: 1 });
  });
});
