import type { AgentDrafter, SemanticFinding } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * METHOD.md §5.3's semantic review (P4-T06b-b).
 *
 * The task's test plan is three sentences: applying a relink re-parents the
 * goal through the normal Operation with audit, with the provider off none of
 * the four semantic kinds is written, and a dismissed semantic finding stays
 * dismissed. The acceptance criterion is the conflict case, and it is the last
 * describe block.
 *
 * The reviewer is a stand-in for the reason the drafter is: it can be told to
 * point past the end of the list, to name a goal as conflicting with itself,
 * and to fall over, which is how untrusted output actually behaves and not
 * something a real model does on demand.
 */

const OWNER = "semantic-owner";
const SECOND = "semantic-second";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let otherSpaceId: string;
let ownerMemberId: string;
let secondMemberId: string;

const context = (drafter?: AgentDrafter, userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
  ...(drafter ? { drafter } : {}),
});

/** A reviewer that returns exactly what a test tells it to. */
const reviewer = (
  findings: readonly SemanticFinding[] | null,
): AgentDrafter => ({
  async draftCheckIn() {
    return null;
  },
  async refineRecoveryTitle() {
    return null;
  },
  async reviewAlignment() {
    return findings;
  },
  spentUsd: () => 0.004,
});

const findings = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    kind: string;
    source: string;
    state: string;
    severity: string;
    reason: string;
    rule_key: string | null;
    subject_goal_id: string | null;
    target_goal_id: string | null;
  }>(
    `select id, kind, source, state, severity, reason, rule_key,
            subject_goal_id, target_goal_id
       from alignment_findings
      where workspace_id = $1 and deleted_at is null
      order by kind`,
    [workspaceId],
  );
  return rows;
};

const semantic = async () =>
  (await findings()).filter((row) =>
    ["relink", "dependency", "conflict", "gap"].includes(row.kind),
  );

const runCoach = async (drafter?: AgentDrafter) => {
  const wb = await workerDb();
  return (await callAction(
    { pool: wb.appPool, ...context(drafter) },
    "agents.runCoach",
    {},
  )) as { reviewed: number; diverged: number };
};

const makeGoal = async (title: string, space: string) => {
  const wb = await workerDb();
  const goal = (await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      title,
      cycleId,
      spaceId: space,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: secondMemberId,
      weight: 1,
    },
  )) as { id: string };
  return goal.id;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Semantic Owner",
      "semantic-owner@example.com",
      SECOND,
      "Semantic Second",
      "semantic-second@example.com",
    ],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Semantic Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const spaces = (await callAction(
    { pool: wb.appPool, ...context() },
    "spaces.list",
    {},
  )) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const other = (await callAction(
    { pool: wb.appPool, ...context() },
    "spaces.create",
    { name: "Growth" },
  )) as { id: string };
  otherSpaceId = other.id;

  const current = (await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  )) as { id: string };
  cycleId = current.id;

  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Semantic Second', 'active') returning id`,
    [workspaceId, SECOND],
  );
  secondMemberId = second.rows[0]?.id as string;
  for (const space of [spaceId, otherSpaceId]) {
    await callAction({ pool: wb.appPool, ...context() }, "spaces.addMember", {
      spaceId: space,
      memberId: secondMemberId,
      role: "member",
    });
  }
  await wb.admin.query(
    "update workspace_members set quiet_hours = null where workspace_id = $1",
    [workspaceId],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("with no provider", () => {
  it("writes none of the four semantic kinds", async () => {
    await makeGoal("Grow mid-market revenue", spaceId);
    await makeGoal("Grow mid-market revenue again", otherSpaceId);

    const result = await runCoach();
    expect(result.reviewed).toBe(0);
    expect(await semantic()).toEqual([]);
  });

  it("leaves findings it already had rather than retiring them", async () => {
    const a = await makeGoal("Grow mid-market revenue", spaceId);
    const b = await makeGoal("Grow mid-market revenue again", otherSpaceId);
    await runCoach(
      reviewer([
        {
          kind: "conflict",
          subjectIndex: 0,
          targetIndex: 1,
          severity: "high",
          reason: "Both count the same revenue.",
        },
      ]),
    );
    expect(await semantic()).toHaveLength(1);

    // No provider is not the same as "the model read them and found nothing".
    // The first leaves yesterday's findings alone; only the second retires
    // them, and a workspace turning AI off must not watch its findings vanish.
    await runCoach();
    const after = await semantic();
    expect(after).toHaveLength(1);
    expect([after[0]?.subject_goal_id, after[0]?.target_goal_id]).toEqual([
      a,
      b,
    ]);
  });
});

describe("what a model is allowed to say", () => {
  it("drops a finding pointing past the end of the list", async () => {
    await makeGoal("Grow mid-market revenue", spaceId);
    await makeGoal("Reduce churn", otherSpaceId);

    // A model is never shown an identifier, so the worst it can do is point at
    // a goal that is not there. That is dropped rather than resolved.
    const result = await runCoach(
      reviewer([
        {
          kind: "conflict",
          subjectIndex: 0,
          targetIndex: 99,
          severity: "high",
          reason: "Invented.",
        },
        {
          kind: "gap",
          subjectIndex: 42,
          targetIndex: null,
          severity: "low",
          reason: "Also invented.",
        },
      ]),
    );
    expect(result.reviewed).toBe(0);
    expect(await semantic()).toEqual([]);
  });

  it("drops a goal said to conflict with itself", async () => {
    await makeGoal("Grow mid-market revenue", spaceId);
    await makeGoal("Reduce churn", otherSpaceId);
    const result = await runCoach(
      reviewer([
        {
          kind: "conflict",
          subjectIndex: 0,
          targetIndex: 0,
          severity: "high",
          reason: "Itself.",
        },
      ]),
    );
    expect(result.reviewed).toBe(0);
  });

  it("carries on when the reviewer cannot answer", async () => {
    await makeGoal("Grow mid-market revenue", spaceId);
    await makeGoal("Reduce churn", otherSpaceId);
    const result = await runCoach(reviewer(null));
    expect(result.reviewed).toBe(0);
    expect(await semantic()).toEqual([]);
  });

  it("does not review a single goal at all", async () => {
    await makeGoal("Grow mid-market revenue", spaceId);
    const result = await runCoach(
      reviewer([
        {
          kind: "gap",
          subjectIndex: 0,
          targetIndex: null,
          severity: "low",
          reason: "Something.",
        },
      ]),
    );
    // One goal cannot conflict with anything, and reviewing one goal is what
    // the Draft Coach already does inline as somebody types.
    expect(result.reviewed).toBe(0);
  });
});

describe("applying a relink", () => {
  it("re-parents the goal through the normal Operation, with audit", async () => {
    const child = await makeGoal("Grow mid-market revenue", spaceId);
    const parent = await makeGoal("Win the mid-market", spaceId);

    await runCoach(
      reviewer([
        {
          kind: "relink",
          subjectIndex: 0,
          targetIndex: 1,
          severity: "medium",
          reason: "This supports the mid-market objective, not its own.",
        },
      ]),
    );
    const [finding] = await semantic();
    expect(finding?.kind).toBe("relink");

    const wb = await workerDb();
    const applied = (await callAction(
      { pool: wb.appPool, ...context() },
      "alignment.applyFinding",
      { id: finding?.id as string },
    )) as { goalId: string; parentGoalId: string };
    expect(applied).toMatchObject({ goalId: child, parentGoalId: parent });

    const { rows } = await wb.admin.query<{ parent_goal_id: string | null }>(
      "select parent_goal_id from goals where id = $1",
      [child],
    );
    expect(rows[0]?.parent_goal_id).toBe(parent);

    // Through the ordinary update path, so the ordinary audit row exists and
    // the alignment recompute that depends on the tree has run.
    const { rows: audit } = await wb.admin.query<{ action: string }>(
      `select action from audit_events
        where workspace_id = $1 and action in ('goals.update', 'alignment.applyFinding')
        order by action`,
      [workspaceId],
    );
    expect(audit.map((row) => row.action)).toEqual([
      "alignment.applyFinding",
      "goals.update",
    ]);

    expect(
      (await findings()).find((row) => row.id === finding?.id)?.state,
    ).toBe("applied");
  });

  it("refuses a kind whose fix is not mechanical", async () => {
    await makeGoal("Grow mid-market revenue", spaceId);
    await makeGoal("Reduce churn", otherSpaceId);
    await runCoach(
      reviewer([
        {
          kind: "conflict",
          subjectIndex: 0,
          targetIndex: 1,
          severity: "high",
          reason: "Both count the same revenue.",
        },
      ]),
    );
    const [finding] = await semantic();

    const wb = await workerDb();
    // §5.3 offers one-click apply for relink and dependency; a conflict has no
    // fix to apply, only a conversation to have.
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "alignment.applyFinding", {
        id: finding?.id as string,
      }),
    ).rejects.toThrow(/mechanical/i);
  });
});

/**
 * One-click applicability on the read (plan 0.7.0 A6, design
 * `alignment-engine.md` §9).
 *
 * Here rather than in `alignment.test.ts`, which the design first named,
 * because a relink is only ever written by the Coach's review and this file
 * has the reviewer stand-in that writes one through the real path.
 */
describe("which findings the read says one click applies (A6)", () => {
  const readFindings = async (userId = OWNER, includeDismissed = false) => {
    const wb = await workerDb();
    const read = await callAction(
      { pool: wb.appPool, ...context(undefined, userId) },
      "alignment.read",
      { cycleId, includeDismissed },
    );
    return read.findings;
  };

  it("acceptance: an open relink naming both goals says true and names the target", async () => {
    const child = await makeGoal("Grow mid-market revenue", spaceId);
    const parent = await makeGoal("Win the mid-market", spaceId);
    await runCoach(
      reviewer([
        {
          kind: "relink",
          subjectIndex: 0,
          targetIndex: 1,
          severity: "medium",
          reason: "This supports the mid-market objective, not its own.",
        },
      ]),
    );

    const [relink] = (await readFindings()).filter(
      (finding) => finding.kind === "relink",
    );
    expect(relink).toMatchObject({
      oneClickApplicable: true,
      subjectGoalId: child,
      subjectGoalTitle: "Grow mid-market revenue",
      targetGoalId: parent,
      targetGoalTitle: "Win the mid-market",
    });
  });

  it("acceptance: a relink with no target says false, and applying it anyway is refused", async () => {
    await makeGoal("Grow mid-market revenue", spaceId);
    await makeGoal("Win the mid-market", spaceId);
    await runCoach(
      reviewer([
        {
          kind: "relink",
          subjectIndex: 0,
          targetIndex: null,
          severity: "medium",
          reason:
            "This belongs under something, and the review did not say what.",
        },
      ]),
    );

    const [relink] = (await readFindings()).filter(
      (finding) => finding.kind === "relink",
    );
    expect(relink).toMatchObject({
      oneClickApplicable: false,
      targetGoalId: null,
      targetGoalTitle: null,
    });

    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "alignment.applyFinding", {
        id: relink?.id as string,
      }),
    ).rejects.toThrow(/names only one of them/);
  });

  it("acceptance: a conflict, a gap and a dependency say false, though each names two goals", async () => {
    await makeGoal("Grow mid-market revenue", spaceId);
    await makeGoal("Reduce churn", otherSpaceId);
    await runCoach(
      reviewer(
        (["conflict", "gap", "dependency"] as const).map((kind) => ({
          kind,
          subjectIndex: 0,
          targetIndex: 1,
          severity: "medium" as const,
          reason: `A ${kind} between the two, for the read to report.`,
        })),
      ),
    );

    const read = await readFindings();
    expect(
      read
        .filter((finding) => finding.source === "coach")
        .map((finding) => [finding.kind, finding.oneClickApplicable])
        .sort(),
    ).toEqual([
      ["conflict", false],
      ["dependency", false],
      ["gap", false],
    ]);
  });

  it("acceptance: an applied or a dismissed relink says false", async () => {
    await makeGoal("Grow mid-market revenue", spaceId);
    await makeGoal("Win the mid-market", spaceId);
    await makeGoal("Reduce churn", spaceId);
    await runCoach(
      reviewer([
        {
          kind: "relink",
          subjectIndex: 0,
          targetIndex: 1,
          severity: "medium",
          reason: "This supports the mid-market objective, not its own.",
        },
        {
          kind: "relink",
          subjectIndex: 2,
          targetIndex: 1,
          severity: "low",
          reason: "Churn is how the mid-market is kept, so it belongs there.",
        },
      ]),
    );
    const [first, second] = (await readFindings()).filter(
      (finding) => finding.kind === "relink",
    );

    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context() },
      "alignment.applyFinding",
      { id: first?.id as string },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "alignment.dismissFinding",
      { id: second?.id as string },
    );

    const decided = (await readFindings(OWNER, true)).filter(
      (finding) => finding.kind === "relink",
    );
    expect(
      decided.map((finding) => [finding.state, finding.oneClickApplicable]),
    ).toEqual(
      expect.arrayContaining([
        ["applied", false],
        ["dismissed", false],
      ]),
    );
    expect(decided).toHaveLength(2);
  });

  it("names the target's title only to a reader who can see the target", async () => {
    // A guest, through the invitation a guest actually receives. A guest
    // inherits no workspace-wide view, so they see a goal only through a role
    // on it, which makes them the reader who can open one end of a finding
    // and not the other.
    const wb = await workerDb();
    const guest = "semantic-guest";
    const email = "semantic-guest@partner.example";
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      [guest, "Guest", email],
    );
    const link = (await callAction(
      { pool: wb.appPool, ...context() },
      "invitations.createPersonalLink",
      { email, guestSpaceId: otherSpaceId },
    )) as { token: string };
    const { memberId: guestMemberId } = (await callAction(
      { pool: wb.appPool, ...context(undefined, guest) },
      "invitations.acceptLink",
      { token: link.token },
    )) as { memberId: string };

    // The guest reviews the goal to move, and has no role on its new parent.
    const goal = async (title: string, space: string, reviewerId: string) =>
      (
        (await callAction({ pool: wb.appPool, ...context() }, "goals.create", {
          title,
          cycleId,
          spaceId: space,
          level: "team",
          ownerKind: "space",
          championId: ownerMemberId,
          reviewerId,
          weight: 1,
        })) as { id: string }
      ).id;
    const child = await goal("Grow mid-market revenue", spaceId, guestMemberId);
    const parent = await goal("Win enterprise", otherSpaceId, ownerMemberId);
    await runCoach(
      reviewer([
        {
          kind: "relink",
          subjectIndex: 0,
          targetIndex: 1,
          severity: "medium",
          reason: "This supports the enterprise objective, not its own.",
        },
      ]),
    );

    const [asOwner] = (await readFindings()).filter(
      (finding) => finding.kind === "relink",
    );
    expect(asOwner).toMatchObject({
      subjectGoalId: child,
      targetGoalId: parent,
      targetGoalTitle: "Win enterprise",
    });

    // The finding, and that it has a target, but not what the target is
    // called. Whether one click applies is a fact about the finding; this
    // guest would be refused at the click, on the target's edit check.
    const [asGuest] = (await readFindings(guest)).filter(
      (finding) => finding.kind === "relink",
    );
    expect(asGuest).toMatchObject({
      subjectGoalTitle: "Grow mid-market revenue",
      targetGoalId: parent,
      targetGoalTitle: null,
      oneClickApplicable: true,
    });
  });
});

describe("the acceptance criterion: a conflict across two spaces", () => {
  it("raises one finding for both champions, and one dismissal clears it", async () => {
    const a = await makeGoal("Grow mid-market revenue", spaceId);
    const b = await makeGoal("Grow enterprise revenue", otherSpaceId);

    await runCoach(
      reviewer([
        {
          kind: "conflict",
          subjectIndex: 0,
          targetIndex: 1,
          severity: "high",
          reason:
            "Both are measured on the same revenue line, so the same money counts twice.",
        },
      ]),
    );

    const [conflict] = await semantic();
    expect(conflict?.kind).toBe("conflict");
    expect(conflict?.source).toBe("coach");
    // One row naming both goals, which is what makes "dismissing it on one
    // side dismisses it everywhere" true by construction rather than by
    // bookkeeping.
    expect(conflict?.subject_goal_id).toBe(a);
    expect(conflict?.target_goal_id).toBe(b);
    // §6.4's key, the one trigger in the catalogue that needs a provider.
    expect(conflict?.rule_key).toBe("quality.conflict");
    expect(conflict?.reason.length).toBeGreaterThan(20);

    // The other champion dismisses it, from the target end.
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(undefined, SECOND) },
      "alignment.dismissFinding",
      { id: conflict?.id as string },
    );

    const after = (await findings()).find((row) => row.id === conflict?.id);
    expect(after?.state).toBe("dismissed");

    // And it survives the next sweep, still finding the same conflict.
    await runCoach(
      reviewer([
        {
          kind: "conflict",
          subjectIndex: 0,
          targetIndex: 1,
          severity: "high",
          reason:
            "Both are measured on the same revenue line, so the same money counts twice.",
        },
      ]),
    );
    const survived = (await findings()).find((row) => row.id === conflict?.id);
    expect(survived?.state).toBe("dismissed");
    expect(await semantic()).toHaveLength(1);
  });
});
