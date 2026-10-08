import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A computed score a person may adjust (METHOD.md §3.3, P9-T14a).
 *
 * The score is computed from progress at the close; the review starts from
 * it, may move it with a written reason, and the close keeps both numbers.
 * A workspace may forbid adjusting, and then a grade off the computed number
 * is refused. The bands read 1.0, 0.6 and 0.3, by kind and in the
 * workspace's colours.
 */

const OWNER = "adjust-owner";

let workspaceId: string;
let ownerMemberId: string;
let cycleId: string;
let spaceId: string;

async function call<T>(action: string, input: unknown): Promise<T> {
  return (await callAction(
    {
      pool: (await workerDb()).appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    action as never,
    input as never,
  )) as T;
}

interface Row {
  keyResultId: string;
  computed: number | null;
  band: { key: string; text: string } | null;
}

/** NW-Q1-26's win rate, 40 to 100, standing at 88: 80% of the way. */
async function scenario(kind: "aspirational" | "committed" = "aspirational") {
  const goalId = (
    await call<{ id: string }>("goals.create", {
      title: "Win the mid-market deals we are in",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      kind,
    })
  ).id;
  const keyResultId = (
    await call<{ id: string }>("goals.addKeyResult", {
      goalId,
      title: "Win rate from 40% to 100%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 40,
      targetValue: 100,
    })
  ).id;
  await call("goals.recordValue", { id: keyResultId, value: 88 });
  const sessionId = (
    await call<{ id: string }>("sessions.create", {
      spaceId,
      cycleId,
      kind: "quarterly",
      title: "Q1 review",
      scheduledFor: new Date().toISOString(),
      facilitatorId: ownerMemberId,
    })
  ).id;
  await call("sessions.open", { id: sessionId });
  return { keyResultId, sessionId };
}

async function row(sessionId: string, keyResultId: string): Promise<Row> {
  const status = await call<{
    objectives: { keyResults: Row[] }[];
  }>("sessions.scoringStatus", { sessionId });
  const found = status.objectives
    .flatMap((objective) => objective.keyResults)
    .find((entry) => entry.keyResultId === keyResultId);
  if (!found) {
    throw new Error("Not at the review.");
  }
  return found;
}

async function stored(keyResultId: string) {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    score: string | null;
    score_computed: string | null;
    score_reason: string | null;
  }>(
    "select score, score_computed, score_reason from key_results where id = $1",
    [keyResultId],
  );
  return rows[0];
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Daniel Owner", `${OWNER}@example.com`],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Daniel Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;
  spaceId = (await call<{ id: string }[]>("spaces.list", {}))[0]?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the computed score (NW-Q1-26)", () => {
  it("acceptance: computed 0.8, adjusted to 0.7 with a reason, and the close keeps both with the reason", async () => {
    const { keyResultId, sessionId } = await scenario();
    expect((await row(sessionId, keyResultId)).computed).toBe(0.8);

    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId,
      score: 0.7,
      reason: "Two of the wins were renewals we would have kept anyway",
    });
    await call("sessions.close", { id: sessionId });
    expect(await stored(keyResultId)).toEqual({
      score: "0.70",
      score_computed: "0.8",
      score_reason: "Two of the wins were renewals we would have kept anyway",
    });
  });

  it("keeps no adjustment reason where the room accepted the computed score", async () => {
    const { keyResultId, sessionId } = await scenario();
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId,
      score: 0.8,
      reason: "The number says it",
    });
    await call("sessions.close", { id: sessionId });
    expect(await stored(keyResultId)).toMatchObject({
      score_computed: "0.8",
      score_reason: null,
    });
  });

  it("refuses an adjustment where the workspace does not allow one, and takes the computed number", async () => {
    await call("practice.update", {
      overrides: { "scoring.adjustment": "notAllowed" },
    });
    const { keyResultId, sessionId } = await scenario();
    await expect(
      call("sessions.scoreKeyResult", {
        sessionId,
        keyResultId,
        score: 0.7,
        reason: "Felt lower",
      }),
    ).rejects.toThrow(/does not allow adjusting it/);
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId,
      score: 0.8,
      reason: "The number says it",
    });
  });
});

describe("§3.3's bands, by kind and colours", () => {
  it("reads 0.7 as on target for a stretch, and as a miss for a promise", async () => {
    const stretch = await scenario("aspirational");
    await call("sessions.scoreKeyResult", {
      sessionId: stretch.sessionId,
      keyResultId: stretch.keyResultId,
      score: 0.7,
      reason: "Close",
    });
    expect((await row(stretch.sessionId, stretch.keyResultId)).band).toEqual({
      key: "strong",
      text: "On target. The expected range for a stretch",
    });
    await call("sessions.close", { id: stretch.sessionId });

    const promise = await scenario("committed");
    await call("sessions.scoreKeyResult", {
      sessionId: promise.sessionId,
      keyResultId: promise.keyResultId,
      score: 0.7,
      reason: "Close",
    });
    expect((await row(promise.sessionId, promise.keyResultId)).band).toEqual({
      key: "strong",
      text: "Missed. Explain the miss",
    });
  });

  it("reads 0.65 as partial under Doerr's colours", async () => {
    await call("practice.update", {
      overrides: { "scoring.colours": "doerr" },
    });
    const { keyResultId, sessionId } = await scenario();
    await call("sessions.scoreKeyResult", {
      sessionId,
      keyResultId,
      score: 0.65,
      reason: "Partway",
    });
    expect((await row(sessionId, keyResultId)).band?.key).toBe("partial");
  });
});
