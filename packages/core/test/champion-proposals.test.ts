import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The proposal path, and the recovery proposal (P4-T05c-a).
 *
 * The task's test plan is four sentences, and each is a test below: a KPI
 * unhealthy for the §11 delay produces exactly one pending proposal with the
 * provider off, nothing commits until a human applies it, applying it launches
 * the recovery through the normal Operation with its audit row, and the nudge
 * names the proposal it carries.
 *
 * **There is no AI in this file, on purpose.** The recovery draft is METHOD.md
 * §6.5's template, a pure function golden-master tested at P3-T14, so the
 * proposal exists with the provider off and this is what proves it. The drafted
 * language is P4-T05c-b's, behind a credential.
 *
 * `goals.publishDraftedCheckIn` is tested here too, because it is the apply
 * path the drafted check-in will land on and it is answerable now: the agent
 * holds `view` and cannot open a draft, so the action a proposal names has to
 * open one and publish it as the applying human, in one Operation.
 */

const OWNER = "proposal-owner";
const SECOND = "proposal-second";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let ownerMemberId: string;
let secondMemberId: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

/** Every pending proposal, with what it would do. */
const proposals = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    action: string;
    payload: Record<string, unknown>;
    status: string;
    ai_generated: boolean;
    subject_type: string | null;
    subject_id: string | null;
    decided_by_member_id: string | null;
  }>(
    `select id, action, payload, status, ai_generated, subject_type, subject_id,
            decided_by_member_id
       from proposed_changes
      where workspace_id = $1
      order by created_at`,
    [workspaceId],
  );
  return rows;
};

/** The nudges delivered, with the proposal each one carries. */
const sentNudges = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    rule_key: string;
    subject_id: string;
    recipient_member_id: string;
    proposal_id: string | null;
  }>(
    `select rule_key, subject_id, recipient_member_id, proposal_id
       from nudges
      where workspace_id = $1 and sent_at is not null
      order by rule_key`,
    [workspaceId],
  );
  return rows;
};

/**
 * A KPI recorded below its watch boundary for `periods` consecutive months.
 *
 * §6.5's proposal waits for consecutive unhealthy periods, so one bad month
 * never produces an unsolicited OKR. Recording real periods rather than
 * setting a column is what makes this a test of that rule.
 */
const unhealthyKpiFor = async (periods: number) => {
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

  // A leading driver under it, so §6.5's drafter has a key result to propose
  // rather than only its placeholder.
  await callAction({ pool: wb.appPool, ...context() }, "kpis.create", {
    title: "Mobile activation rate",
    ownerKind: "member",
    memberId: ownerMemberId,
    frequency: "monthly",
    direction: "higher_better",
    indicatorType: "leading",
    tier: "input",
    aggregate: "sum",
    parentKpiId: kpi.id,
  });

  for (let month = 0; month < periods; month++) {
    await callAction({ pool: wb.appPool, ...context() }, "kpis.record", {
      kpiId: kpi.id,
      on: `2026-0${month + 1}-15`,
      targetValue: 100,
      // 60 of 100 is below the 70 watch boundary: unhealthy.
      actualValue: 60,
    });
  }
  return kpi.id;
};

const runDaily = async () => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "agents.runChampion", {
    cadence: "daily",
  });
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Proposal Owner",
      "proposal-owner@example.com",
      SECOND,
      "Proposal Second",
      "proposal-second@example.com",
    ],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Proposal Owner",
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
     values (gen_random_uuid(), $1, $2, 'Proposal Second', 'active') returning id`,
    [workspaceId, SECOND],
  );
  secondMemberId = second.rows[0]?.id as string;
  await callAction({ pool: wb.appPool, ...context() }, "spaces.addMember", {
    spaceId,
    memberId: secondMemberId,
    role: "member",
  });
  // **Quiet hours off for this workspace, or these tests keep the time of
  // day.** Every member is provisioned with §4.14's 19:00 to 08:00 window, so
  // a suite asserting that a nudge was *delivered* silently passes in the
  // afternoon and fails overnight. Continuous integration found this at 01:39
  // UTC, having been written against local runs in the early afternoon.
  // Suppression has its own suite at P4-T04b; here it is noise that decides
  // the result.
  await wb.admin.query(
    "update workspace_members set quiet_hours = null where workspace_id = $1",
    [workspaceId],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the recovery proposal, with the provider off", () => {
  it("raises exactly one pending proposal for a KPI unhealthy for the §11 delay", async () => {
    const kpiId = await unhealthyKpiFor(2);
    await runDaily();

    const pending = await proposals();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.action).toBe("kpis.launchRecovery");
    expect(pending[0]?.status).toBe("pending");
    expect(pending[0]?.subject_type).toBe("kpi");
    expect(pending[0]?.subject_id).toBe(kpiId);
    // Nothing here was written by a model. The draft is §6.5's template, so
    // the marker says so rather than implying an AI wrote it.
    expect(pending[0]?.ai_generated).toBe(false);
    expect(pending[0]?.payload).toMatchObject({ kpiId, cycleId });
  });

  it("raises nothing after one bad period", async () => {
    // §6.5: one bad month never generates an unsolicited OKR.
    await unhealthyKpiFor(1);
    await runDaily();
    expect(await proposals()).toEqual([]);
  });

  it("does not raise a second proposal on the next run", async () => {
    await unhealthyKpiFor(2);
    await runDaily();
    await runDaily();
    // One pending proposal per subject: a second identical one would make the
    // review queue grow by one a day for a KPI nobody has got to yet.
    expect(await proposals()).toHaveLength(1);
  });

  it("changes nothing about the KPI until a human applies it", async () => {
    const kpiId = await unhealthyKpiFor(2);
    await runDaily();

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      state: string;
      recovery_goal_id: string | null;
    }>("select state, recovery_goal_id from kpis where id = $1", [kpiId]);
    // Propose by default: the agent holds `view` and commits nothing.
    expect(rows[0]?.state).toBe("unhealthy");
    expect(rows[0]?.recovery_goal_id).toBeNull();

    const { rows: goals } = await wb.admin.query<{ count: string }>(
      "select count(*)::text as count from goals where workspace_id = $1",
      [workspaceId],
    );
    expect(goals[0]?.count).toBe("0");
  });

  it("nudges the owner once, naming the proposal it carries", async () => {
    const kpiId = await unhealthyKpiFor(2);
    await runDaily();

    const [proposal] = await proposals();
    const carried = (await sentNudges()).filter(
      (row) => row.rule_key === "kpi.recovery_proposed",
    );
    expect(carried).toHaveLength(1);
    expect(carried[0]?.subject_id).toBe(kpiId);
    expect(carried[0]?.recipient_member_id).toBe(ownerMemberId);
    // The link is what makes "a nudge containing a drafted change" true rather
    // than two rows a reader has to guess belong together.
    expect(carried[0]?.proposal_id).toBe(proposal?.id);
  });

  it("offers the proposal in the owner's own inbox, ready to apply", async () => {
    await unhealthyKpiFor(2);
    await runDaily();
    const [proposal] = await proposals();

    const wb = await workerDb();
    const listed = (await callAction(
      { pool: wb.appPool, ...context() },
      "nudges.list",
      { limit: 50 },
    )) as {
      nudges: {
        ruleKey: string;
        proposal: { id: string; action: string; aiGenerated: boolean } | null;
      }[];
    };

    const carried = listed.nudges.filter(
      (row) => row.ruleKey === "kpi.recovery_proposed",
    );
    expect(carried).toHaveLength(1);
    // The id the inbox shows is the id `proposals.bulkApply` takes, which is
    // what makes "apply in one action" true from the screen rather than only
    // from a test.
    expect(carried[0]?.proposal?.id).toBe(proposal?.id);
    expect(carried[0]?.proposal?.action).toBe("kpis.launchRecovery");
    expect(carried[0]?.proposal?.aiGenerated).toBe(false);

    // Every other nudge carries nothing, and the read says so rather than
    // omitting the field.
    for (const row of listed.nudges) {
      if (row.ruleKey !== "kpi.recovery_proposed") {
        expect(row.proposal).toBeNull();
      }
    }
  });

  it("creates the recovery objective when a human applies it, as that human", async () => {
    const kpiId = await unhealthyKpiFor(2);
    await runDaily();
    const [proposal] = await proposals();

    const wb = await workerDb();
    const result = (await callAction(
      { pool: wb.appPool, ...context() },
      "proposals.bulkApply",
      { ids: [proposal?.id as string] },
    )) as { applied: string[]; failed: { id: string; error: string }[] };
    expect(result.failed).toEqual([]);
    expect(result.applied).toEqual([proposal?.id]);

    const { rows } = await wb.admin.query<{
      state: string;
      recovery_goal_id: string | null;
    }>("select state, recovery_goal_id from kpis where id = $1", [kpiId]);
    expect(rows[0]?.state).toBe("recovering");
    expect(rows[0]?.recovery_goal_id).not.toBeNull();

    // Applied by the member who decided, not by the agent. The audit row is
    // where that has to be legible.
    const decided = await proposals();
    expect(decided[0]?.status).toBe("applied");
    expect(decided[0]?.decided_by_member_id).toBe(ownerMemberId);

    const { rows: audit } = await wb.admin.query<{ action: string }>(
      `select action from audit_events
        where workspace_id = $1 and action = 'kpis.launchRecovery'`,
      [workspaceId],
    );
    expect(audit).toHaveLength(1);
  });

  it("leaves the proposal pending and the KPI untouched when it is dismissed", async () => {
    const kpiId = await unhealthyKpiFor(2);
    await runDaily();
    const [proposal] = await proposals();

    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context() },
      "proposals.bulkDismiss",
      { ids: [proposal?.id as string] },
    );

    const { rows } = await wb.admin.query<{ state: string }>(
      "select state from kpis where id = $1",
      [kpiId],
    );
    expect(rows[0]?.state).toBe("unhealthy");
    expect((await proposals())[0]?.status).toBe("dismissed");
  });
});

describe("goals.publishDraftedCheckIn", () => {
  const goalWithKeyResult = async () => {
    const wb = await workerDb();
    const goal = (await callAction(
      { pool: wb.appPool, ...context() },
      "goals.create",
      {
        title: "Become the default choice for mid-market teams",
        cycleId,
        spaceId,
        level: "team",
        ownerKind: "space",
        championId: ownerMemberId,
        reviewerId: secondMemberId,
        weight: 1,
      },
    )) as { id: string };
    const keyResult = (await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResult",
      {
        goalId: goal.id,
        title: "Monthly active teams",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 100,
        targetValue: 300,
        unit: "teams",
        weight: 1,
      },
    )) as { id: string };
    return { goalId: goal.id, keyResultId: keyResult.id };
  };

  const narrative = {
    type: "doc" as const,
    content: [
      {
        type: "paragraph" as const,
        content: [
          { type: "text" as const, text: "Pipeline grew, the vendor slipped." },
        ],
      },
    ],
  };

  it("opens the draft and publishes it in one call", async () => {
    const wb = await workerDb();
    const { goalId, keyResultId } = await goalWithKeyResult();

    const published = (await callAction(
      { pool: wb.appPool, ...context() },
      "goals.publishDraftedCheckIn",
      {
        goalId,
        status: "on_track",
        confidence: 0.7,
        narrative,
        values: [{ keyResultId, value: 150 }],
      },
    )) as { id: string; goalId: string; valuesWritten: number };

    expect(published.goalId).toBe(goalId);
    expect(published.valuesWritten).toBe(1);

    const { rows } = await wb.admin.query<{
      state: string;
      published_at: string | null;
      reviewer_member_id: string | null;
    }>(
      "select state, published_at, reviewer_member_id from check_ins where id = $1",
      [published.id],
    );
    expect(rows[0]?.state).toBe("published");
    expect(rows[0]?.published_at).not.toBeNull();
    // P3-T08's reviewer of record, stamped at publication like any other
    // check-in. A second publish path that skipped it would leave the review
    // inbox with an obligation it could not attribute.
    expect(rows[0]?.reviewer_member_id).toBe(secondMemberId);
  });

  it("reuses the author's open draft rather than opening a second one", async () => {
    const wb = await workerDb();
    const { goalId } = await goalWithKeyResult();

    const draft = (await callAction(
      { pool: wb.appPool, ...context() },
      "goals.startCheckIn",
      { goalId },
    )) as { id: string };

    const published = (await callAction(
      { pool: wb.appPool, ...context() },
      "goals.publishDraftedCheckIn",
      { goalId, status: "on_track", confidence: 0.7, narrative, values: [] },
    )) as { id: string };

    // The same row: one draft per author per goal, which the unique index
    // enforces anyway. Opening a second would fail rather than duplicate.
    expect(published.id).toBe(draft.id);
    const { rows } = await wb.admin.query<{ count: string }>(
      "select count(*)::text as count from check_ins where subject_id = $1",
      [goalId],
    );
    expect(rows[0]?.count).toBe("1");
  });

  it("refuses a suspended member, exactly as the composer does", async () => {
    const wb = await workerDb();
    const { goalId } = await goalWithKeyResult();

    // **Not "a member with only view".** This repository's write-access floor
    // is `edit` for every active member through P3-T01's `workspace_standard`
    // binding, recorded as a deliberate and reversible decision on the P3-T16
    // row, so an active member who cannot post a check-in does not exist
    // today. A suspended one is the refusal that is real: §4.3's access getter
    // excludes them from every read.
    await wb.admin.query(
      "update workspace_members set status = 'suspended', suspended_at = now() where id = $1",
      [secondMemberId],
    );

    await expect(
      callAction(
        { pool: wb.appPool, ...context(SECOND) },
        "goals.publishDraftedCheckIn",
        { goalId, status: "on_track", confidence: 0.7, narrative, values: [] },
      ),
    ).rejects.toThrow();

    const { rows } = await wb.admin.query<{ count: string }>(
      "select count(*)::text as count from check_ins where subject_id = $1",
      [goalId],
    );
    expect(rows[0]?.count).toBe("0");
  });

  it("refuses the same member the composer refuses, and for the same reason", async () => {
    const wb = await workerDb();
    const { goalId } = await goalWithKeyResult();
    await wb.admin.query(
      "update workspace_members set status = 'suspended', suspended_at = now() where id = $1",
      [secondMemberId],
    );

    // Two paths, one access rule. A second publish path with its own idea of
    // who may write is the drift this asserts against, and it is the reason
    // `publishDraftedCheckIn` calls `requireGoalAccess` rather than trusting
    // that a proposal was vetted when it was raised.
    const composer = await callAction(
      { pool: wb.appPool, ...context(SECOND) },
      "goals.startCheckIn",
      { goalId },
    ).then(
      () => null,
      (error: Error) => error.message,
    );
    const drafted = await callAction(
      { pool: wb.appPool, ...context(SECOND) },
      "goals.publishDraftedCheckIn",
      { goalId, status: "on_track", confidence: 0.7, narrative, values: [] },
    ).then(
      () => null,
      (error: Error) => error.message,
    );
    expect(composer).not.toBeNull();
    expect(drafted).toBe(composer);
  });
});
