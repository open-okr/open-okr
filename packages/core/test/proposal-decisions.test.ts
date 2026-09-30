import type { AgentDrafter } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Deciding an agent proposal from the review inbox (completeness review M-08).
 *
 * **What was wrong.** The inbox listed an agent proposal for every member who
 * could edit its subject, and linked the row to `/admin/agents`, which the
 * admin layout refuses to anybody below `full`. Behind the link the only way to
 * apply an agent proposal was `proposals.bulkApply`, which requires `full` on
 * the workspace. So a champion who was not an administrator was told they owed
 * a decision on their own drafted check-in, and nothing they could open or call
 * would let them make it. A KPI owner nudged about a recovery objective had it
 * worse: a KPI has no access context of its own, so the inbox listed that
 * proposal for nobody at all.
 *
 * **The rule now:** a proposal a nudge carried is for that nudge's recipient,
 * and any other is decided by `edit` on its subject. Only a person decides.
 *
 * **Every suite before this one applied as the founder**, who provisioned the
 * workspace and holds `full` on it, which is exactly the one person the defect
 * could not reach. The champion here is an ordinary member, and the drafted
 * check-in is written by the real Champion run with a scripted drafter, so the
 * action and the payload are the ones production writes.
 */

const FOUNDER = "decisions-founder";
const CHAMPION = "decisions-champion";
const TEAMMATE = "decisions-teammate";
const STRANGER = "decisions-stranger";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let championMemberId: string;
let teammateMemberId: string;
let goalId: string;

const context = (userId: string, drafter?: AgentDrafter) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
  ...(drafter ? { drafter } : {}),
});

/** A drafter that always answers, so the Champion always proposes. */
const drafter: AgentDrafter = {
  async draftCheckIn(input) {
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
                text: `Pipeline moved and the vendor slipped, ${input.daysOverdue} days late.`,
              },
            ],
          },
        ],
      },
    };
  },
  async refineRecoveryTitle() {
    return null;
  },
  async reviewAlignment() {
    return null;
  },
  spentUsd: () => 0,
};

const inbox = async (userId: string) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...context(userId) },
    "review.inbox",
    {},
  );
};

const proposalRows = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    action: string;
    status: string;
    decided_by_member_id: string | null;
    result: Record<string, unknown> | null;
  }>(
    `select id, action, status, decided_by_member_id, result
       from proposed_changes where workspace_id = $1 order by created_at`,
    [workspaceId],
  );
  return rows;
};

const checkInRows = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    state: string;
    status: string | null;
    author_member_id: string;
  }>(
    "select state, status, author_member_id from check_ins where subject_id = $1",
    [goalId],
  );
  return rows;
};

/** The Champion's hourly run drafts a check-in for the overdue goal. */
const draftedCheckIn = async (): Promise<string> => {
  const wb = await workerDb();
  await callAction(
    { pool: wb.appPool, ...context(FOUNDER, drafter) },
    "agents.runChampion",
    { cadence: "hourly" },
  );
  const [proposal] = await proposalRows();
  if (!proposal) {
    throw new Error("The Champion proposed nothing.");
  }
  return proposal.id;
};

async function member(userId: string, name: string): Promise<string> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, $3, 'active') returning id`,
    [workspaceId, userId, name],
  );
  return rows[0]?.id as string;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email)
     values ($1, 'Founder', 'decisions-founder@example.com'),
            ($2, 'Champion', 'decisions-champion@example.com'),
            ($3, 'Teammate', 'decisions-teammate@example.com'),
            ($4, 'Stranger', 'decisions-stranger@example.com')`,
    [FOUNDER, CHAMPION, TEAMMATE, STRANGER],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: FOUNDER,
    name: "Founder",
  });
  workspaceId = provisioned.workspaceId;

  const spaces = (await callAction(
    { pool: wb.appPool, ...context(FOUNDER) },
    "spaces.list",
    {},
  )) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const current = (await callAction(
    { pool: wb.appPool, ...context(FOUNDER) },
    "cycles.current",
    { mode: "quarterly" },
  )) as { id: string };
  cycleId = current.id;

  // Two ordinary members of the space, and one member of the workspace who is
  // in no space at all. None of the three administers anything.
  championMemberId = await member(CHAMPION, "Champion");
  teammateMemberId = await member(TEAMMATE, "Teammate");
  await member(STRANGER, "Stranger");
  for (const memberId of [championMemberId, teammateMemberId]) {
    await callAction(
      { pool: wb.appPool, ...context(FOUNDER) },
      "spaces.addMember",
      { spaceId, memberId, role: "member" },
    );
  }

  // The teammate is also the reviewer, so they hold `edit` on the goal twice
  // over and are still not the person who owes its check-in.
  const goal = (await callAction(
    { pool: wb.appPool, ...context(FOUNDER) },
    "goals.create",
    {
      title: "Become the preferred platform for mid-market teams",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: championMemberId,
      reviewerId: teammateMemberId,
      weight: 1,
    },
  )) as { id: string };
  goalId = goal.id;
  await callAction(
    { pool: wb.appPool, ...context(FOUNDER) },
    "goals.addKeyResult",
    {
      goalId,
      title: "Monthly active teams",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 100,
      targetValue: 300,
      unit: "teams",
      weight: 1,
    },
  );
  await wb.admin.query(
    `update goals set next_check_in_at = now() - interval '6 days' where id = $1`,
    [goalId],
  );
  // Quiet hours off, or delivery keeps the time of day: see the note in
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

describe("a drafted check-in in the champion's own inbox", () => {
  it("is offered where they can open it, with what it would publish", async () => {
    const id = await draftedCheckIn();
    const owed = await inbox(CHAMPION);
    const row = owed.obligations.find((item) => item.kind === "proposal");

    expect(row).toBeDefined();
    // Never an administrator's screen. The row is decided where it is listed.
    expect(row?.href).toBe(`/review#proposal-${id}`);
    expect(row?.href.startsWith("/admin")).toBe(false);
    expect(row?.title).toBe(
      'Publish the drafted check-in on "Become the preferred platform for mid-market teams"',
    );
    expect(row?.proposal?.id).toBe(id);
    expect(row?.proposal?.action).toBe("goals.publishDraftedCheckIn");
    // A model wrote the words, and the row says so.
    expect(row?.proposal?.aiGenerated).toBe(true);
    // What would be published, readable before anybody decides. The goal's id
    // and the empty values are not shown: neither is anything a person reads.
    expect(row?.proposal?.preview).toEqual([
      { label: "status", value: "caution" },
      { label: "confidence", value: "0.55" },
      {
        label: "narrative",
        value: "Pipeline moved and the vendor slipped, 6 days late.",
      },
    ]);
  });

  it("could not be applied through the queue the old link pointed at", async () => {
    // The cause, kept as a test so nobody points the row back at it: the
    // admin queue is `full` on the workspace, and a champion is not.
    const id = await draftedCheckIn();
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...context(CHAMPION) },
        "proposals.bulkApply",
        { ids: [id] },
      ),
    ).rejects.toThrow();
  });

  it("is applied by the champion, and publishes as them", async () => {
    const id = await draftedCheckIn();
    const wb = await workerDb();
    const applied = (await callAction(
      { pool: wb.appPool, ...context(CHAMPION) },
      "proposals.apply",
      { id },
    )) as { id: string; result: Record<string, unknown> | null };
    expect(applied.id).toBe(id);
    expect(applied.result?.goalId).toBe(goalId);

    const published = await checkInRows();
    expect(published).toHaveLength(1);
    expect(published[0]?.state).toBe("published");
    expect(published[0]?.status).toBe("caution");
    // The champion's check-in, in the champion's name. The agent wrote the
    // words and holds `view`; it published nothing.
    expect(published[0]?.author_member_id).toBe(championMemberId);

    const [decided] = await proposalRows();
    expect(decided?.status).toBe("applied");
    expect(decided?.decided_by_member_id).toBe(championMemberId);
    expect(decided?.result).toMatchObject({ goalId });

    // Two audit rows, one for the decision and one for what it did, both in
    // the champion's name.
    const { rows: audit } = await wb.admin.query<{
      action: string;
      actor_member_id: string | null;
    }>(
      `select action, actor_member_id from audit_events
        where workspace_id = $1
          and action in ('proposals.apply', 'goals.publishDraftedCheckIn')
        order by action`,
      [workspaceId],
    );
    expect(audit).toEqual([
      {
        action: "goals.publishDraftedCheckIn",
        actor_member_id: championMemberId,
      },
      { action: "proposals.apply", actor_member_id: championMemberId },
    ]);
  });

  it("leaves the inbox once it is decided", async () => {
    await draftedCheckIn();
    const [proposal] = await proposalRows();
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(CHAMPION) },
      "proposals.apply",
      { id: proposal?.id as string },
    );
    const owed = await inbox(CHAMPION);
    expect(owed.obligations.some((item) => item.kind === "proposal")).toBe(
      false,
    );
  });

  it("is dismissed by the champion without publishing anything", async () => {
    const id = await draftedCheckIn();
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(CHAMPION) },
      "proposals.dismiss",
      { id },
    );

    expect(await checkInRows()).toEqual([]);
    const [decided] = await proposalRows();
    expect(decided?.status).toBe("dismissed");
    expect(decided?.decided_by_member_id).toBe(championMemberId);
    expect(
      (await inbox(CHAMPION)).obligations.some(
        (item) => item.kind === "proposal",
      ),
    ).toBe(false);
  });

  it("cannot be decided twice", async () => {
    const id = await draftedCheckIn();
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(CHAMPION) },
      "proposals.apply",
      { id },
    );
    await expect(
      callAction(
        { pool: wb.appPool, ...context(CHAMPION) },
        "proposals.apply",
        { id },
      ),
    ).rejects.toThrow(/already been decided/);
    await expect(
      callAction(
        { pool: wb.appPool, ...context(CHAMPION) },
        "proposals.dismiss",
        { id },
      ),
    ).rejects.toThrow(/already been decided/);
    expect(await checkInRows()).toHaveLength(1);
  });
});

describe("a drafted check-in and everybody else", () => {
  it("is not the reviewer's, although the reviewer can edit the goal", async () => {
    // The Champion attached it to the champion's reminder, so it is theirs.
    // METHOD.md §2.5 puts the check-in on the champion, and applying it
    // publishes in the applier's name. The reviewer holds `edit` on the goal
    // twice over, and that does not make the proposal theirs.
    const id = await draftedCheckIn();
    const owed = await inbox(TEAMMATE);
    expect(owed.obligations.some((item) => item.kind === "proposal")).toBe(
      false,
    );

    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...context(TEAMMATE) },
        "proposals.apply",
        { id },
      ),
    ).rejects.toThrow(/No such proposal/);
    await expect(
      callAction(
        { pool: wb.appPool, ...context(TEAMMATE) },
        "proposals.dismiss",
        { id },
      ),
    ).rejects.toThrow(/No such proposal/);
    expect(await checkInRows()).toEqual([]);
    expect((await proposalRows())[0]?.status).toBe("pending");
  });

  it("is not the administrator's either, who still has the queue", async () => {
    // The founder holds `full` and reaches the proposal through
    // `/admin/agents`. It was not addressed to them, so it is not something
    // they owe.
    await draftedCheckIn();
    expect(
      (await inbox(FOUNDER)).obligations.some(
        (item) => item.kind === "proposal",
      ),
    ).toBe(false);
  });

  it("is never decided by an agent, not even the one that drafted it", async () => {
    // Propose-and-approve: a person applies the proposal. An agent that could
    // call this would be approving its own work.
    const id = await draftedCheckIn();
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ member_id: string }>(
      "select member_id from agents where workspace_id = $1 and kind = 'champion'",
      [workspaceId],
    );
    const agent = {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "agent" as const, memberId: rows[0]?.member_id as string },
    };
    await expect(callAction(agent, "proposals.apply", { id })).rejects.toThrow(
      /Only a person/,
    );
    await expect(
      callAction(agent, "proposals.dismiss", { id }),
    ).rejects.toThrow(/Only a person/);
    expect(await checkInRows()).toEqual([]);
    expect((await proposalRows())[0]?.status).toBe("pending");
  });
});

describe("a recovery proposal in the KPI owner's inbox", () => {
  it("is decided by the owner, who administers nothing", async () => {
    // The same defect for the Champion's other proposal. The recovery
    // objective is proposed to the KPI's owner by nudge, and the inbox either
    // listed it for nobody (a KPI has no access context of its own) or, with
    // only the fallback fixed, for the administrators the nudge never named.
    const wb = await workerDb();
    const kpi = (await callAction(
      { pool: wb.appPool, ...context(FOUNDER) },
      "kpis.create",
      {
        title: "Net revenue retention",
        ownerKind: "member",
        memberId: championMemberId,
        frequency: "monthly",
        direction: "higher_better",
        indicatorType: "lagging",
        tier: "output",
        aggregate: "sum",
      },
    )) as { id: string };
    // Two months below the watch boundary, which is §6.5's delay.
    for (const on of ["2026-01-15", "2026-02-15"]) {
      await callAction(
        { pool: wb.appPool, ...context(FOUNDER) },
        "kpis.record",
        { kpiId: kpi.id, on, targetValue: 100, actualValue: 60 },
      );
    }
    await callAction(
      { pool: wb.appPool, ...context(FOUNDER) },
      "agents.runChampion",
      { cadence: "daily" },
    );
    const proposal = (await proposalRows()).find(
      (row) => row.action === "kpis.launchRecovery",
    );
    expect(proposal).toBeDefined();
    const id = proposal?.id as string;

    const row = (await inbox(CHAMPION)).obligations.find(
      (item) => item.proposal?.id === id,
    );
    expect(row?.title).toBe(
      'Launch a recovery objective for "Net revenue retention"',
    );
    expect(row?.href).toBe(`/review#proposal-${id}`);
    expect(
      (await inbox(FOUNDER)).obligations.some(
        (item) => item.proposal?.id === id,
      ),
    ).toBe(false);

    const applied = (await callAction(
      { pool: wb.appPool, ...context(CHAMPION) },
      "proposals.apply",
      { id },
    )) as { result: Record<string, unknown> | null };
    const { rows } = await wb.admin.query<{ recovery_goal_id: string | null }>(
      "select recovery_goal_id from kpis where id = $1",
      [kpi.id],
    );
    expect(rows[0]?.recovery_goal_id).toBe(applied.result?.goalId);
    expect(
      (await proposalRows()).find((item) => item.id === id)
        ?.decided_by_member_id,
    ).toBe(championMemberId);
  });
});

describe("any other agent proposal", () => {
  /**
   * A pending proposal about the goal, as a custom agent would raise it: from
   * a run, with no nudge carrying it. Renames the goal unless told otherwise.
   */
  const renameProposal = async (
    action = "goals.update",
    payload: Record<string, unknown> = {
      id: goalId,
      title: "Be the platform mid-market teams choose first",
    },
  ): Promise<string> => {
    const wb = await workerDb();
    const { rows: runs } = await wb.admin.query<{ id: string }>(
      `insert into agent_runs (id, workspace_id, agent_id, status, trigger)
       select gen_random_uuid(), $1, id, 'completed', 'manual'
         from agents where workspace_id = $1 and kind = 'champion'
       returning id`,
      [workspaceId],
    );
    const { rows } = await wb.admin.query<{ id: string }>(
      `insert into proposed_changes
         (id, workspace_id, run_id, action, payload, subject_type, subject_id, status)
       values (gen_random_uuid(), $1, $2, $3, $4::jsonb, 'goal', $5, 'pending')
       returning id`,
      [workspaceId, runs[0]?.id, action, JSON.stringify(payload), goalId],
    );
    return rows[0]?.id as string;
  };

  it("is decided by a member who can edit its subject, without administration", async () => {
    const id = await renameProposal();
    const owed = await inbox(TEAMMATE);
    const row = owed.obligations.find((item) => item.kind === "proposal");
    expect(row?.href).toBe(`/review#proposal-${id}`);
    expect(row?.proposal?.preview).toEqual([
      {
        label: "title",
        value: "Be the platform mid-market teams choose first",
      },
    ]);

    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(TEAMMATE) },
      "proposals.apply",
      { id },
    );
    const { rows } = await wb.admin.query<{ title: string }>(
      "select title from goals where id = $1",
      [goalId],
    );
    expect(rows[0]?.title).toBe(
      "Be the platform mid-market teams choose first",
    );
    expect((await proposalRows())[0]?.decided_by_member_id).toBe(
      teammateMemberId,
    );
  });

  it("is neither listed for nor decidable by a member who can only see it", async () => {
    // The stranger is in the workspace and in no space, so the goal is
    // readable to them and nothing more. Not-found rather than forbidden, the
    // same answer the access getter gives for anything a member may not touch.
    const id = await renameProposal();
    expect(
      (await inbox(STRANGER)).obligations.some(
        (item) => item.kind === "proposal",
      ),
    ).toBe(false);
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...context(STRANGER) },
        "proposals.apply",
        { id },
      ),
    ).rejects.toThrow(/No such proposal/);
    expect((await proposalRows())[0]?.status).toBe("pending");
  });

  it("cannot apply a decision on another proposal, and can be dismissed", async () => {
    // An agent that proposes "apply that proposal" is asking a person to
    // clear its queue for it, and the decision it names would wait on the row
    // lock this one holds.
    const target = await renameProposal();
    const id = await renameProposal("proposals.bulkApply", { ids: [target] });
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...context(TEAMMATE) },
        "proposals.apply",
        { id },
      ),
    ).rejects.toThrow(/cannot decide another proposal/);
    await callAction(
      { pool: wb.appPool, ...context(TEAMMATE) },
      "proposals.dismiss",
      { id },
    );
    const statuses = new Map(
      (await proposalRows()).map((row) => [row.id, row.status]),
    );
    expect(statuses.get(id)).toBe("dismissed");
    expect(statuses.get(target)).toBe("pending");
  });

  it("does not reach a copilot proposal, which belongs to its own conversation", async () => {
    const wb = await workerDb();
    const { rows: threads } = await wb.admin.query<{ id: string }>(
      `insert into ai_threads (id, workspace_id, member_id, title)
       values (gen_random_uuid(), $1, $2, 'Rename it') returning id`,
      [workspaceId, championMemberId],
    );
    const { rows } = await wb.admin.query<{ id: string }>(
      `insert into proposed_changes
         (id, workspace_id, thread_id, action, payload, subject_type, subject_id, status, ai_generated)
       values (gen_random_uuid(), $1, $2, 'goals.update', $3::jsonb, 'goal', $4, 'pending', true)
       returning id`,
      [
        workspaceId,
        threads[0]?.id,
        JSON.stringify({ id: goalId, title: "Something else" }),
        goalId,
      ],
    );
    await expect(
      callAction(
        { pool: wb.appPool, ...context(CHAMPION) },
        "proposals.apply",
        { id: rows[0]?.id as string },
      ),
    ).rejects.toThrow(/No such proposal/);
  });
});
