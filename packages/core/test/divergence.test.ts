import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The divergence sweep, against a real database (P4-T06b-a).
 *
 * Two of the task's three test-plan lines are answerable here and are the two
 * describe blocks below: a dismissed finding stays dismissed everywhere, and
 * with the provider off the structural and arithmetic findings fire while the
 * semantic ones do not. The third, applying a relink, needs a relink finding,
 * and only the semantic sweep produces one: P4-T06b-b.
 *
 * Every number this exercises comes from a §11 parameter that already existed.
 * The fixtures move a goal's stored health and progress through real actions
 * wherever an action exists, because the point is that a **stored** status
 * disagrees with **stored** data.
 */

const OWNER = "divergence-owner";
const SECOND = "divergence-second";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let ownerMemberId: string;
let secondMemberId: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const findings = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    kind: string;
    source: string;
    severity: string;
    state: string;
    rule_key: string | null;
    subject_goal_id: string | null;
    reason: string;
    deleted_at: string | null;
  }>(
    `select id, kind, source, severity, state, rule_key, subject_goal_id,
            reason, deleted_at
       from alignment_findings
      where workspace_id = $1
      order by kind, created_at`,
    [workspaceId],
  );
  return rows;
};

const divergenceFindings = async () =>
  (await findings()).filter(
    (row) => row.kind === "divergence" && row.deleted_at === null,
  );

const sentNudges = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    rule_key: string;
    subject_id: string;
    recipient_member_id: string;
  }>(
    `select rule_key, subject_id, recipient_member_id
       from nudges
      where workspace_id = $1 and sent_at is not null
      order by rule_key`,
    [workspaceId],
  );
  return rows;
};

const runCoach = async () => {
  const wb = await workerDb();
  return (await callAction(
    { pool: wb.appPool, ...context() },
    "agents.runCoach",
    {},
  )) as { diverged: number; recorded: number; ruleKeys: string[] };
};

/**
 * A goal with one key result, reported at `health` with `progressPct` stored
 * and the key result's confidence set.
 *
 * Health and progress are written directly because the product's own path to
 * them is a published check-in plus a recompute, and this test is about the
 * sweep reading whatever is stored rather than about how it got there. The
 * check-in path is covered by its own suite.
 */
const goalReporting = async (options: {
  readonly title: string;
  readonly health: string;
  readonly progressPct: number;
  readonly confidence: number | null;
  readonly withKeyResult?: boolean;
}) => {
  const wb = await workerDb();
  const goal = (await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      title: options.title,
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: secondMemberId,
      weight: 1,
    },
  )) as { id: string };

  if (options.withKeyResult !== false) {
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
    await wb.admin.query(
      "update key_results set confidence = $2 where id = $1",
      [keyResult.id, options.confidence],
    );
  }

  await wb.admin.query(
    "update goals set health = $2, progress_pct = $3 where id = $1",
    [goal.id, options.health, String(options.progressPct)],
  );
  return goal.id;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Divergence Owner",
      "divergence-owner@example.com",
      SECOND,
      "Divergence Second",
      "divergence-second@example.com",
    ],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Divergence Owner",
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
     values (gen_random_uuid(), $1, $2, 'Divergence Second', 'active') returning id`,
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

describe("the sweep, with no provider configured", () => {
  it("raises a finding when on track meets red progress, and nudges its champion", async () => {
    // 20% is below §11's 50% fail boundary, so the signal is red.
    const goalId = await goalReporting({
      title: "Become the preferred platform for teams",
      health: "on_track",
      progressPct: 20,
      confidence: 0.8,
    });

    const result = await runCoach();
    expect(result.diverged).toBe(1);

    const raised = await divergenceFindings();
    expect(raised).toHaveLength(1);
    expect(raised[0]?.subject_goal_id).toBe(goalId);
    expect(raised[0]?.source).toBe("coach");
    expect(raised[0]?.severity).toBe("high");
    expect(raised[0]?.state).toBe("open");
    // Every message cites a rule the method package defines, and this is it.
    expect(raised[0]?.rule_key).toBe("quality.divergence");
    // One specific sentence, as §5.3 requires of every finding.
    expect(raised[0]?.reason.length).toBeGreaterThan(20);

    const nudged = (await sentNudges()).filter(
      (row) => row.rule_key === "quality.divergence",
    );
    expect(nudged).toHaveLength(1);
    expect(nudged[0]?.subject_id).toBe(goalId);
    expect(nudged[0]?.recipient_member_id).toBe(ownerMemberId);
  });

  it("raises one finding per goal even when both cases fire", async () => {
    // On track, red progress, and confidence below the low band: both of
    // §6.1's cases are true. Two rows about one disagreement would need two
    // dismissals for one decision.
    await goalReporting({
      title: "Become the preferred platform for teams",
      health: "on_track",
      progressPct: 20,
      confidence: 0.2,
    });

    const result = await runCoach();
    expect(result.diverged).toBe(1);
    expect(await divergenceFindings()).toHaveLength(1);
  });

  it("says nothing when the status and the data agree", async () => {
    await goalReporting({
      title: "Become the preferred platform for teams",
      health: "on_track",
      progressPct: 90,
      confidence: 0.8,
    });
    const result = await runCoach();
    expect(result.diverged).toBe(0);
    expect(await divergenceFindings()).toEqual([]);
  });

  it("says nothing about a champion who is already reporting trouble", async () => {
    await goalReporting({
      title: "Become the preferred platform for teams",
      health: "caution",
      progressPct: 20,
      confidence: 0.3,
    });
    // Red progress beside a cautious status is agreement. Telling somebody
    // their caution is wrong is how a product teaches people to report green.
    expect((await runCoach()).diverged).toBe(0);
  });

  it("says nothing about a goal with no key results", async () => {
    await goalReporting({
      title: "Become the preferred platform for teams",
      health: "on_track",
      progressPct: 0,
      confidence: null,
      withKeyResult: false,
    });
    // A progress figure with nothing under it is not evidence of anything.
    expect((await runCoach()).diverged).toBe(0);
  });

  it("writes no semantic finding at all", async () => {
    await goalReporting({
      title: "Become the preferred platform for teams",
      health: "on_track",
      progressPct: 20,
      confidence: 0.2,
    });
    await runCoach();

    // §5.3's four types are the semantic review's and need a provider. With
    // none configured they must be absent rather than guessed at.
    const kinds = new Set((await findings()).map((row) => row.kind));
    for (const semantic of ["relink", "conflict", "gap"]) {
      expect(kinds.has(semantic)).toBe(false);
    }
  });

  it("refreshes the finding rather than duplicating it on a second run", async () => {
    await goalReporting({
      title: "Become the preferred platform for teams",
      health: "on_track",
      progressPct: 20,
      confidence: 0.8,
    });
    await runCoach();
    const first = await divergenceFindings();

    await runCoach();
    const second = await divergenceFindings();
    expect(second).toHaveLength(1);
    // The same row, upserted by identity, not a second one a day.
    expect(second[0]?.id).toBe(first[0]?.id);
  });

  it("clears the finding once the data catches up with the status", async () => {
    const goalId = await goalReporting({
      title: "Become the preferred platform for teams",
      health: "on_track",
      progressPct: 20,
      confidence: 0.8,
    });
    await runCoach();
    expect(await divergenceFindings()).toHaveLength(1);

    // Progress moves into the green band, so the status is now true. The first
    // draft of this test flipped `health` to `off_track` instead, which cleared
    // case 1 and immediately tripped case 2, because a cautious status beside
    // high confidence is its own divergence. The code was right and the fixture
    // was wrong, which is worth leaving written down.
    const wb = await workerDb();
    await wb.admin.query("update goals set progress_pct = '90' where id = $1", [
      goalId,
    ]);
    await runCoach();
    // Soft-deleted rather than closed, so "open findings" stays one predicate.
    expect(await divergenceFindings()).toEqual([]);
  });

  it("gives a returning condition a fresh open row rather than reviving the old one", async () => {
    const goalId = await goalReporting({
      title: "Become the preferred platform for teams",
      health: "on_track",
      progressPct: 20,
      confidence: 0.8,
    });
    await runCoach();
    const [first] = await divergenceFindings();

    const wb = await workerDb();
    await wb.admin.query("update goals set progress_pct = '90' where id = $1", [
      goalId,
    ]);
    await runCoach();
    await wb.admin.query("update goals set progress_pct = '20' where id = $1", [
      goalId,
    ]);
    await runCoach();

    const again = await divergenceFindings();
    expect(again).toHaveLength(1);
    // A different row, and open. A facilitator dismissed the finding they saw,
    // not every finding this rule will ever raise, so a condition that cleared
    // and came back is a new thing to look at.
    expect(again[0]?.id).not.toBe(first?.id);
    expect(again[0]?.state).toBe("open");
  });
});

describe("a dismissal survives", () => {
  it("stays dismissed on the next sweep, and stops nudging", async () => {
    await goalReporting({
      title: "Become the preferred platform for teams",
      health: "on_track",
      progressPct: 20,
      confidence: 0.8,
    });
    await runCoach();
    const [raised] = await divergenceFindings();

    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context() },
      "alignment.dismissFinding",
      { id: raised?.id as string },
    );
    await wb.admin.query("delete from nudges where workspace_id = $1", [
      workspaceId,
    ]);

    await runCoach();

    const after = await divergenceFindings();
    expect(after).toHaveLength(1);
    // The same row, and still dismissed. The state is the facilitator's, not
    // the sweep's, and a recompute that reopened it would make dismissing
    // pointless.
    expect(after[0]?.id).toBe(raised?.id);
    expect(after[0]?.state).toBe("dismissed");

    // And no message about it. Nudging on a dismissed finding is how a
    // dismissal stops meaning anything.
    expect(
      (await sentNudges()).filter(
        (row) => row.rule_key === "quality.divergence",
      ),
    ).toEqual([]);
  });

  it("leaves the structural findings alone when it sweeps", async () => {
    // The engine's rows and the Coach's live in one table. Reconciling by
    // scope rather than by (scope, source, kind) would delete the other's work
    // on every run, which is the collision the split document names.
    await goalReporting({
      title: "Become the preferred platform for teams",
      health: "on_track",
      progressPct: 20,
      confidence: 0.8,
    });
    const before = (await findings()).filter(
      (row) => row.source === "engine" && row.deleted_at === null,
    );
    expect(before.length).toBeGreaterThan(0);

    await runCoach();

    const after = (await findings()).filter(
      (row) => row.source === "engine" && row.deleted_at === null,
    );
    expect(after.map((row) => row.id).sort()).toEqual(
      before.map((row) => row.id).sort(),
    );
  });
});
