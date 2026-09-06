import type { AgentDrafter } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Drafting inside a proposal (P4-T05c-b).
 *
 * The task's test plan is four sentences and each is a test below: with the
 * provider off no language is generated and every trigger still fires; with a
 * drafter a check-in overdue produces a drafted proposal; a run that reaches
 * its cost cap halts before spending; and output that fails its schema twice
 * fails cleanly rather than proposing nonsense.
 *
 * **The drafter here is a stand-in, and that is the point rather than a
 * shortcut.** `AgentDrafter` is an interface `packages/core` declares and a host
 * supplies, so a suite can hand it a function and prove every branch, including
 * the ones a real model reaches only occasionally: refusing, throwing, and
 * running out of budget. The live provider is exercised separately and recorded
 * on the task row; what belongs here is the behaviour around it.
 */

const OWNER = "drafting-owner";
const SECOND = "drafting-second";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let ownerMemberId: string;
let secondMemberId: string;

const context = (drafter?: AgentDrafter) => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
  ...(drafter ? { drafter } : {}),
});

/** A drafter that always answers, and counts what it was asked. */
const workingDrafter = () => {
  const calls: string[] = [];
  let spent = 0;
  const drafter: AgentDrafter = {
    async draftCheckIn(input) {
      calls.push(`checkIn:${input.goalTitle}`);
      spent += 0.01;
      return {
        status: "caution",
        confidence: 0.55,
        narrative: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: `Pipeline moved, the vendor slipped, ${input.daysOverdue} days late.`,
                },
              ],
            },
          ],
        },
      };
    },
    async refineRecoveryTitle(input) {
      calls.push(`title:${input.kpiTitle}`);
      spent += 0.01;
      return `Restore ${input.kpiTitle} to its corridor`;
    },
    async reviewAlignment() {
      return null;
    },
    spentUsd: () => spent,
  };
  return { drafter, calls };
};

const proposals = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    action: string;
    payload: Record<string, unknown>;
    ai_generated: boolean;
    status: string;
  }>(
    `select action, payload, ai_generated, status
       from proposed_changes where workspace_id = $1 order by created_at`,
    [workspaceId],
  );
  return rows;
};

const runs = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ cost: string; status: string }>(
    `select r.cost, r.status from agent_runs r
       join agents a on a.id = r.agent_id
      where r.workspace_id = $1 and a.kind = 'champion' order by r.created_at`,
    [workspaceId],
  );
  return rows;
};

/** A goal whose check-in is `daysAgo` days overdue, with one key result. */
const overdueGoal = async (daysAgo: number) => {
  const wb = await workerDb();
  const goal = (await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      title: "Become the preferred platform for mid-market teams",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: secondMemberId,
      weight: 1,
    },
  )) as { id: string };
  await callAction({ pool: wb.appPool, ...context() }, "goals.addKeyResult", {
    goalId: goal.id,
    title: "Monthly active teams",
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 100,
    targetValue: 300,
    unit: "teams",
    weight: 1,
  });
  await wb.admin.query(
    `update goals set next_check_in_at = now() - ($2 || ' days')::interval
      where id = $1`,
    [goal.id, String(daysAgo)],
  );
  return goal.id;
};

const runHourly = async (drafter?: AgentDrafter) => {
  const wb = await workerDb();
  return (await callAction(
    { pool: wb.appPool, ...context(drafter) },
    "agents.runChampion",
    { cadence: "hourly" },
  )) as { recorded: number; proposed: number; ruleKeys: string[] };
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Drafting Owner",
      "drafting-owner@example.com",
      SECOND,
      "Drafting Second",
      "drafting-second@example.com",
    ],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Drafting Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const spaces = (await callAction(
    { pool: wb.appPool, ...context() },
    "spaces.list",
    {},
  )) as { id: string }[];
  spaceId = spaces[0]?.id as string;

  const current = (await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  )) as { id: string };
  cycleId = current.id;

  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Drafting Second', 'active') returning id`,
    [workspaceId, SECOND],
  );
  secondMemberId = second.rows[0]?.id as string;
  await callAction({ pool: wb.appPool, ...context() }, "spaces.addMember", {
    spaceId,
    memberId: secondMemberId,
    role: "member",
  });

  // Quiet hours off, or these assertions keep the time of day: see the note in
  // `champion-cadences.test.ts`.
  await wb.admin.query(
    "update workspace_members set quiet_hours = null where workspace_id = $1",
    [workspaceId],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("with no provider at all", () => {
  it("still fires every trigger and drafts nothing", async () => {
    await overdueGoal(6);
    const result = await runHourly();

    // The whole rhythm, unchanged. This is what "deterministic first" means
    // when it is a line of code rather than a principle.
    expect(result.recorded).toBeGreaterThan(0);
    expect(result.ruleKeys.some((key) => key.startsWith("checkin."))).toBe(
      true,
    );
    expect(result.proposed).toBe(0);
    expect(await proposals()).toEqual([]);
  });

  it("spends nothing, and the run says so", async () => {
    await overdueGoal(6);
    await runHourly();
    expect(Number((await runs())[0]?.cost)).toBe(0);
  });
});

describe("with a drafter", () => {
  it("proposes a drafted check-in the champion can publish in one action", async () => {
    const goalId = await overdueGoal(6);
    const { drafter, calls } = workingDrafter();
    const result = await runHourly(drafter);

    expect(result.proposed).toBe(1);
    const [proposal] = await proposals();
    // The action a human applies is the one that opens the draft and publishes
    // it as them, which is the whole reason P4-T05c-a added it.
    expect(proposal?.action).toBe("goals.publishDraftedCheckIn");
    expect(proposal?.status).toBe("pending");
    // A model wrote these words, and the queue says so.
    expect(proposal?.ai_generated).toBe(true);
    expect(proposal?.payload).toMatchObject({
      goalId,
      status: "caution",
      confidence: 0.55,
    });
    // **No values.** A model may write a narrative and read a status; it may
    // not invent the numbers. Whoever applies it fills those in the composer.
    expect(proposal?.payload.values).toEqual([]);
    expect(calls).toEqual([
      "checkIn:Become the preferred platform for mid-market teams",
    ]);
  });

  it("drafts once for a goal however many people the ladder reaches", async () => {
    // Six days overdue brings in the reviewer beside the champion. They are
    // looking at one check-in, and only the champion can publish it.
    await overdueGoal(6);
    const { drafter, calls } = workingDrafter();
    const result = await runHourly(drafter);

    expect(calls).toHaveLength(1);
    expect(result.recorded).toBeGreaterThan(1);
    expect(await proposals()).toHaveLength(1);
  });

  it("records what the run spent", async () => {
    await overdueGoal(6);
    const { drafter } = workingDrafter();
    await runHourly(drafter);
    expect(Number((await runs())[0]?.cost)).toBeCloseTo(0.01);
  });

  it("carries on with no draft when the model refuses", async () => {
    await overdueGoal(6);
    const refusing: AgentDrafter = {
      async draftCheckIn() {
        return null;
      },
      async refineRecoveryTitle() {
        return null;
      },
      async reviewAlignment() {
        return null;
      },
      spentUsd: () => 0,
    };

    const result = await runHourly(refusing);
    // The nudge still goes out. A model with nothing to say is not a reason to
    // stop chasing a check-in.
    expect(result.recorded).toBeGreaterThan(0);
    expect(result.proposed).toBe(0);
  });

  it("carries on when the model throws, rather than failing the run", async () => {
    await overdueGoal(6);
    const throwing: AgentDrafter = {
      async draftCheckIn() {
        throw new Error("the model's output did not match, twice");
      },
      async refineRecoveryTitle() {
        throw new Error("same");
      },
      async reviewAlignment() {
        return null;
      },
      spentUsd: () => 0.02,
    };

    // Schema failure after one repair attempt arrives here as a throw. The
    // rhythm is the part that has to work, so the run completes and the
    // proposal is simply absent rather than nonsense.
    const result = await runHourly(throwing);
    expect(result.recorded).toBeGreaterThan(0);
    expect(result.proposed).toBe(0);
    expect((await runs())[0]?.status).toBe("completed");
    // Still charged: the calls were made even though nothing usable came back.
    expect(Number((await runs())[0]?.cost)).toBeCloseTo(0.02);
  });

  it("halts before spending when the workspace forbids it", async () => {
    await overdueGoal(6);
    const wb = await workerDb();
    await wb.admin.query(
      `update workspaces
          set settings = settings || '{"agentRunCostCapUsd": 0}'::jsonb
        where id = $1`,
      [workspaceId],
    );

    const { drafter, calls } = workingDrafter();
    const result = (await callAction(
      { pool: wb.appPool, ...context(drafter) },
      "agents.runChampion",
      { cadence: "hourly" },
    )) as { status: string; recorded: number };

    // Cancelled rather than failed: a limit the workspace chose is not an
    // error. And nothing was asked of the model, which is the point of
    // checking the cap before the work rather than after it.
    expect(result.status).toBe("cancelled");
    expect(result.recorded).toBe(0);
    expect(calls).toEqual([]);
  });

  it("leaves the deterministic recovery proposal alone when it cannot title it", async () => {
    // Nothing to draft a check-in for here; the point is that a drafter which
    // declines a title still leaves §6.5's template proposal intact.
    const declining: AgentDrafter = {
      async draftCheckIn() {
        return null;
      },
      async refineRecoveryTitle() {
        return null;
      },
      async reviewAlignment() {
        return null;
      },
      spentUsd: () => 0,
    };
    const wb = await workerDb();
    const kpi = (await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.create",
      {
        title: "Operating margin",
        ownerKind: "member",
        memberId: ownerMemberId,
        frequency: "monthly",
        direction: "higher_better",
        indicatorType: "lagging",
        tier: "output",
        aggregate: "sum",
      },
    )) as { id: string };
    for (const month of [1, 2]) {
      await callAction({ pool: wb.appPool, ...context() }, "kpis.record", {
        kpiId: kpi.id,
        on: `2026-0${month}-15`,
        targetValue: 100,
        actualValue: 60,
      });
    }

    await callAction(
      { pool: wb.appPool, ...context(declining) },
      "agents.runChampion",
      { cadence: "daily" },
    );

    const [proposal] = await proposals();
    expect(proposal?.action).toBe("kpis.launchRecovery");
    // Not AI-generated: the ids are §6.5's and no model chose any words.
    expect(proposal?.ai_generated).toBe(false);
    expect(proposal?.payload.objectiveTitle).toBeUndefined();
  });

  it("carries a refined title into the recovery proposal when it has one", async () => {
    const wb = await workerDb();
    const kpi = (await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.create",
      {
        title: "Operating margin",
        ownerKind: "member",
        memberId: ownerMemberId,
        frequency: "monthly",
        direction: "higher_better",
        indicatorType: "lagging",
        tier: "output",
        aggregate: "sum",
      },
    )) as { id: string };
    for (const month of [1, 2]) {
      await callAction({ pool: wb.appPool, ...context() }, "kpis.record", {
        kpiId: kpi.id,
        on: `2026-0${month}-15`,
        targetValue: 100,
        actualValue: 60,
      });
    }

    const { drafter } = workingDrafter();
    await callAction(
      { pool: wb.appPool, ...context(drafter) },
      "agents.runChampion",
      { cadence: "daily" },
    );

    const [proposal] = await proposals();
    expect(proposal?.action).toBe("kpis.launchRecovery");
    expect(proposal?.ai_generated).toBe(true);
    expect(proposal?.payload.objectiveTitle).toBe(
      "Restore Operating margin to its corridor",
    );
  });

  it("applies a drafted check-in as the member who applied it", async () => {
    const goalId = await overdueGoal(6);
    const { drafter } = workingDrafter();
    await runHourly(drafter);
    const [proposal] = await proposals();

    const wb = await workerDb();
    const { rows: ids } = await wb.admin.query<{ id: string }>(
      "select id from proposed_changes where workspace_id = $1",
      [workspaceId],
    );
    const applied = (await callAction(
      { pool: wb.appPool, ...context() },
      "proposals.bulkApply",
      { ids: [ids[0]?.id as string] },
    )) as { applied: string[]; failed: { error: string }[] };

    expect(applied.failed).toEqual([]);
    expect(proposal?.action).toBe("goals.publishDraftedCheckIn");

    const { rows } = await wb.admin.query<{
      state: string;
      author_member_id: string;
    }>("select state, author_member_id from check_ins where subject_id = $1", [
      goalId,
    ]);
    expect(rows[0]?.state).toBe("published");
    // The applying human authored it, not the agent. The agent holds `view`
    // and never wrote anything.
    expect(rows[0]?.author_member_id).toBe(ownerMemberId);
  });
});
