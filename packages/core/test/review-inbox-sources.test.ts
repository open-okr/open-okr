import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The four obligation sources S-02 declared and never filled (P6-G02).
 *
 * `PENDING_SOURCES` named blockers, commitments, sessions and agent proposals,
 * with the tasks that would fill each: P3-T09, P4-T07, P4-T04 and P4-T05. All
 * four had been done for weeks when the gap audit of 7 September 2026 read that
 * array, so a member owning an overdue blocker was told nothing, and neither
 * was one with an agent proposal waiting on their decision. This is the suite
 * that stops that recurring.
 *
 * **Rows for three of the four are inserted directly.** A blocker needs a
 * running session, four stages of it, and a key result; a commitment needs the
 * same session plus a stage gate; a proposal needs an agent run. Each of those
 * write paths has its own suite (P4-T07c, P4-T08, P2-T17) and none of them is
 * what this file is about, which is whether the read finds the row and whether
 * access decides who sees it. The session source uses its real action, because
 * `sessions.create` needs nothing else.
 */

const OWNER = "sources-owner";
const OTHER = "sources-other";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let ownerId: string;
let otherId: string;
let goalId: string;
let keyResultId: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const inbox = async (userId = OWNER) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...context(userId) },
    "review.inbox",
    {},
  );
};

const kinds = (owed: Awaited<ReturnType<typeof inbox>>) =>
  owed.obligations.map((row) => row.kind);

/** An open blocker owned by `memberId`, due `days` ago. */
async function makeBlocker(
  memberId: string,
  days: number,
  escalatedTo?: string,
): Promise<string> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ id: string }>(
    `insert into blockers
       (id, workspace_id, key_result_id, goal_id, type, description,
        owner_id, next_action, opened_at, due_at, escalated_to_id, source)
     values (gen_random_uuid(), $1, $2, $3, 'dependency', 'Waiting on legal',
             $4, 'Chase the review', now() - make_interval(days => $5 + 1),
             now() - make_interval(days => $5), $6, 'session')
     returning id`,
    [workspaceId, keyResultId, goalId, memberId, days, escalatedTo ?? null],
  );
  return rows[0]?.id as string;
}

/** An open commitment owned by `memberId`, for the week starting `weekStart`. */
async function makeCommitment(
  memberId: string,
  weekStart: string,
): Promise<string> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ id: string }>(
    `insert into commitments
       (id, workspace_id, space_id, week_start, text, owner_id)
     values (gen_random_uuid(), $1, $2, $3, 'Ship the onboarding rewrite', $4)
     returning id`,
    [workspaceId, spaceId, weekStart, memberId],
  );
  return rows[0]?.id as string;
}

/** A pending agent proposal against `subjectId`, or against nothing. */
async function makeProposal(subject?: {
  type: string;
  id: string;
}): Promise<string> {
  const wb = await workerDb();
  const run = await wb.admin.query<{ id: string }>(
    `insert into agents (id, workspace_id, member_id, kind, name, enabled)
     select gen_random_uuid(), $1, id, 'custom', 'Test agent', true
       from workspace_members where id = $2
     returning id`,
    [workspaceId, ownerId],
  );
  const runRow = await wb.admin.query<{ id: string }>(
    `insert into agent_runs (id, workspace_id, agent_id, status, trigger)
     values (gen_random_uuid(), $1, $2, 'completed', 'manual')
     returning id`,
    [workspaceId, run.rows[0]?.id],
  );
  const { rows } = await wb.admin.query<{ id: string }>(
    `insert into proposed_changes
       (id, workspace_id, run_id, action, payload, subject_type, subject_id, status)
     values (gen_random_uuid(), $1, $2, 'goals.update', '{}'::jsonb, $3, $4, 'pending')
     returning id`,
    [
      workspaceId,
      runRow.rows[0]?.id,
      subject?.type ?? null,
      subject?.id ?? null,
    ],
  );
  return rows[0]?.id as string;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email)
     values ($1, $2, $3), ($4, $5, $6)`,
    [
      OWNER,
      "Owner",
      "sources-owner@example.com",
      OTHER,
      "Other",
      "sources-other@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;

  const current = await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  );
  cycleId = current?.id as string;

  const members = await wb.admin.query<{ id: string; user_id: string | null }>(
    "select id, user_id from workspace_members where workspace_id = $1",
    [workspaceId],
  );
  ownerId = members.rows.find((row) => row.user_id === OWNER)?.id as string;

  const extra = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Other', 'active')
     returning id`,
    [workspaceId, OTHER],
  );
  otherId = extra.rows[0]?.id as string;

  const spaces = await wb.admin.query<{ id: string }>(
    "select id from spaces where workspace_id = $1 limit 1",
    [workspaceId],
  );
  spaceId = spaces.rows[0]?.id as string;

  const goal = await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      title: "Make onboarding the reason people stay",
      cycleId,
      level: "company",
      ownerKind: "workspace",
      championId: ownerId,
      reviewerId: otherId,
      weight: 1,
    },
  );
  goalId = goal.id;
  const kr = await callAction(
    { pool: wb.appPool, ...context() },
    "goals.addKeyResult",
    {
      goalId,
      title: "Raise activation from 40 to 100",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 40,
      targetValue: 100,
      weight: 1,
    },
  );
  keyResultId = kr.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a blocker obligation", () => {
  it("reaches the member who owns it, grouped by its own clock", async () => {
    await makeBlocker(ownerId, 3);
    const owed = await inbox(OWNER);
    const blocker = owed.obligations.find((row) => row.kind === "blocker");
    expect(blocker).toBeDefined();
    expect(blocker?.group).toBe("overdue");
    expect(blocker?.daysPastDue).toBe(3);
    expect(blocker?.meta).toContain("Owner");
    expect(blocker?.actionLabel).toBe("Open the blocker");
  });

  it("reaches the member it was escalated to, and says so", async () => {
    // An escalation is precisely an obligation moving to somebody else. A
    // coordinator who is never told is the failure this screen exists to
    // prevent, and the ladder in METHOD.md §11 assumes they are.
    await makeBlocker(ownerId, 2, otherId);
    const theirs = await inbox(OTHER);
    const blocker = theirs.obligations.find((row) => row.kind === "blocker");
    expect(blocker).toBeDefined();
    expect(blocker?.meta).toContain("Escalated to you");
  });

  it("disappears when it is resolved", async () => {
    const wb = await workerDb();
    const id = await makeBlocker(ownerId, 1);
    await wb.admin.query(
      "update blockers set resolved_at = now() where id = $1",
      [id],
    );
    expect(kinds(await inbox(OWNER))).not.toContain("blocker");
  });

  it("belongs to its owner, not to everybody who can see the goal", async () => {
    await makeBlocker(ownerId, 1);
    expect(kinds(await inbox(OTHER))).not.toContain("blocker");
  });
});

describe("a commitment obligation", () => {
  it("is due at the end of the week it was set in", async () => {
    // `week_start` plus six days. A commitment set on Monday is not overdue on
    // Tuesday, which is the whole point of committing for a week.
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ start: string }>(
      "select ((now() at time zone 'UTC')::date - 10)::text as start",
    );
    await makeCommitment(ownerId, rows[0]?.start as string);

    const owed = await inbox(OWNER);
    const commitment = owed.obligations.find(
      (row) => row.kind === "commitment",
    );
    expect(commitment).toBeDefined();
    expect(commitment?.group).toBe("overdue");
    // Ten days ago plus six is four days past.
    expect(commitment?.daysPastDue).toBe(4);
    expect(commitment?.title).toContain("onboarding rewrite");
  });

  it("disappears when the session closes it", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ start: string }>(
      "select ((now() at time zone 'UTC')::date - 3)::text as start",
    );
    const id = await makeCommitment(ownerId, rows[0]?.start as string);
    await wb.admin.query(
      "update commitments set closed_at = now(), delivered = true where id = $1",
      [id],
    );
    expect(kinds(await inbox(OWNER))).not.toContain("commitment");
  });

  it("belongs to its owner", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ start: string }>(
      "select (now() at time zone 'UTC')::date::text as start",
    );
    await makeCommitment(ownerId, rows[0]?.start as string);
    expect(kinds(await inbox(OTHER))).not.toContain("commitment");
  });
});

describe("a session obligation", () => {
  it("reaches the facilitator of a scheduled session", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "sessions.create", {
      spaceId,
      cycleId,
      kind: "weekly",
      title: "Week 14",
      scheduledFor: new Date().toISOString(),
      facilitatorId: ownerId,
    });

    const owed = await inbox(OWNER);
    const session = owed.obligations.find((row) => row.kind === "session");
    expect(session).toBeDefined();
    expect(session?.title).toContain("weekly");
    expect(session?.meta).toContain("Facilitator");
    expect(session?.href).toMatch(/^\/session\//);
  });

  it("is not owed by a participant who is not facilitating", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "sessions.create", {
      spaceId,
      cycleId,
      kind: "weekly",
      title: "Week 14",
      scheduledFor: new Date().toISOString(),
      facilitatorId: ownerId,
    });
    expect(kinds(await inbox(OTHER))).not.toContain("session");
  });

  it("stops being owed once the session is running", async () => {
    // A running session is already being run. Listing it would tell the
    // facilitator to do the thing they are in the middle of doing.
    const wb = await workerDb();
    const created = await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.create",
      {
        spaceId,
        cycleId,
        kind: "weekly",
        title: "Week 14",
        scheduledFor: new Date().toISOString(),
        facilitatorId: ownerId,
      },
    );
    await wb.admin.query(
      "update okr_sessions set state = 'running' where id = $1",
      [created.id],
    );
    expect(kinds(await inbox(OWNER))).not.toContain("session");
  });
});

describe("an agent proposal obligation", () => {
  it("reaches a member who can edit its subject", async () => {
    await makeProposal({ type: "goal", id: goalId });
    const owed = await inbox(OWNER);
    const proposal = owed.obligations.find((row) => row.kind === "proposal");
    expect(proposal).toBeDefined();
    expect(proposal?.title).toContain("goals update");
    expect(proposal?.actionLabel).toBe("Review the proposal");
  });

  it("disappears once it is applied or dismissed", async () => {
    const wb = await workerDb();
    const id = await makeProposal({ type: "goal", id: goalId });
    await wb.admin.query(
      "update proposed_changes set status = 'dismissed' where id = $1",
      [id],
    );
    expect(kinds(await inbox(OWNER))).not.toContain("proposal");
  });

  it("falls back to workspace administration when it names no subject", async () => {
    // Fail-closed rather than fail-open: a proposal with no subject, or one
    // whose subject type the resolver does not know, is an administrator's to
    // decide. Listing it for everybody would put an agent's proposed change on
    // the screen of a member who cannot apply it.
    await makeProposal();
    const owed = await inbox(OWNER);
    expect(kinds(owed)).toContain("proposal");
  });
});

describe("the whole inbox, with every source", () => {
  it("carries all seven kinds at once, and counts them once each", async () => {
    // The acceptance criterion. Before P6-G02 this member would have been told
    // about two of these five and left to find the rest by looking.
    const wb = await workerDb();
    await makeBlocker(ownerId, 2);
    const { rows } = await wb.admin.query<{ start: string }>(
      "select ((now() at time zone 'UTC')::date - 8)::text as start",
    );
    await makeCommitment(ownerId, rows[0]?.start as string);
    await callAction({ pool: wb.appPool, ...context() }, "sessions.create", {
      spaceId,
      cycleId,
      kind: "weekly",
      title: "Week 14",
      scheduledFor: new Date().toISOString(),
      facilitatorId: ownerId,
    });
    await makeProposal({ type: "goal", id: goalId });

    const owed = await inbox(OWNER);
    const seen = new Set(kinds(owed));
    expect(seen).toContain("blocker");
    expect(seen).toContain("commitment");
    expect(seen).toContain("session");
    expect(seen).toContain("proposal");
    expect(owed.counts.total).toBe(owed.obligations.length);
    expect(new Set(owed.obligations.map((row) => row.id)).size).toBe(
      owed.obligations.length,
    );
    // Nothing is left declared and empty any more.
    expect(owed.pending).toEqual([]);
  });
});
