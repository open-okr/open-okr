import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Drafts that wait for a person (METHOD.md §2.9, P9-T13-b-b).
 *
 * Where "New objectives mid-cycle start as" is a draft setting, an objective
 * added mid-cycle starts as a draft with no check-in due. Its owner publishes
 * it, and it goes live, or waits for its reviewer's approval where the
 * workspace asks for that. Who may is the policy's to say, citing the
 * setting.
 */

const OWNER = "draft-wait-owner";
const TEAMMATE = "draft-wait-reviewer";

let workspaceId: string;
let ownerMemberId: string;
let teammateMemberId: string;
let cycleId: string;
let spaceId: string;

async function callAs<T>(
  userId: string,
  action: string,
  input: unknown,
): Promise<T> {
  return (await callAction(
    {
      pool: (await workerDb()).appPool,
      workspaceId,
      actor: { kind: "human" as const, userId },
    },
    action as never,
    input as never,
  )) as T;
}

const call = <T>(action: string, input: unknown) =>
  callAs<T>(OWNER, action, input);

/** The quarter, `daysAgo` days in and published, as NW-Q3 finds it. */
async function cycleStarted(daysAgo: number) {
  const wb = await workerDb();
  await wb.admin.query(
    `update cycles
        set starts_on = current_date - $2::int,
            ends_on = current_date + 30,
            published_at = now()
      where id = $1`,
    [cycleId, daysAgo],
  );
}

interface Draft {
  missing: string[];
  failing: string[];
}

interface TreeKeyResult {
  id: string;
  targetValue: number | null;
  progressPct: number;
  draft: Draft | null;
}

interface TreeGoal {
  id: string;
  draft: Draft | null;
  keyResults: TreeKeyResult[];
}

async function treeGoal(goalId: string, userId = OWNER): Promise<TreeGoal> {
  const tree = await callAs<{ goals: TreeGoal[] }>(userId, "goals.tree", {
    cycleId,
    scope: "all",
  });
  const goal = tree.goals.find((entry) => entry.id === goalId);
  if (!goal) {
    throw new Error("The goal is not in the tree.");
  }
  return goal;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Yuki Owner",
      `${OWNER}@example.com`,
      TEAMMATE,
      "Amara Teammate",
      `${TEAMMATE}@example.com`,
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Yuki Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;
  spaceId = (await call<{ id: string }>("spaces.create", { name: "Growth" }))
    .id;

  const teammate = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, role_id)
     values (gen_random_uuid(), $1, $2, 'Amara Teammate', 'active',
             (select id from workspace_roles
               where workspace_id = $1 and is_default and deleted_at is null))
     returning id`,
    [workspaceId, TEAMMATE],
  );
  teammateMemberId = teammate.rows[0]?.id as string;
  await call("spaces.addMember", {
    spaceId,
    memberId: teammateMemberId,
    role: "member",
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

interface WaitingGoal {
  id: string;
  draftState: "draft" | "awaiting_approval" | null;
  nextCheckInOn: string | null;
}

async function waiting(goalId: string): Promise<WaitingGoal> {
  return (await treeGoal(goalId)) as unknown as WaitingGoal;
}

async function startsAs(value: "live" | "ownerDraft" | "reviewerApproval") {
  await call("practice.update", {
    overrides: { "writing.midCycleAs": value },
  });
}

/** G1, with Amara as its reviewer. */
async function reviewedObjective(reviewerId: string | null = teammateMemberId) {
  return (
    await call<{ id: string }>("goals.create", {
      title: "Make self-serve a second engine of growth",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      ...(reviewerId ? { reviewerId } : {}),
    })
  ).id;
}

async function activityKinds(goalId: string) {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ kind: string; payload: unknown }>(
    "select kind, payload from activities where subject_id = $1 order by at",
    [goalId],
  );
  return rows;
}

describe("published by its owner", () => {
  it("starts as a draft that owes no check-in, and goes live when its owner publishes it", async () => {
    await cycleStarted(35);
    await startsAs("ownerDraft");
    const goalId = await reviewedObjective();
    expect(await waiting(goalId)).toMatchObject({
      draftState: "draft",
      nextCheckInOn: null,
    });

    await expect(
      callAs(TEAMMATE, "goals.publishDraft", { id: goalId }),
    ).rejects.toThrow(/Only its champion can publish it/);

    const published = await call<{ awaitingApproval: boolean }>(
      "goals.publishDraft",
      { id: goalId },
    );
    expect(published.awaitingApproval).toBe(false);
    const live = await waiting(goalId);
    expect(live.draftState).toBeNull();
    expect(live.nextCheckInOn).not.toBeNull();
    expect(await activityKinds(goalId)).toContainEqual(
      expect.objectContaining({
        kind: "goal.draft_published",
        payload: expect.objectContaining({ awaitingApproval: false }),
      }),
    );
  });

  it("is not a draft while it is the plan, whatever the setting", async () => {
    await cycleStarted(10);
    await startsAs("ownerDraft");
    expect((await waiting(await reviewedObjective())).draftState).toBeNull();
  });

  it("is not a draft under Live, which leaves it to its checks", async () => {
    await cycleStarted(35);
    expect((await waiting(await reviewedObjective())).draftState).toBeNull();
  });

  it("refuses to publish a draft that was stopped before it went live", async () => {
    await cycleStarted(35);
    await startsAs("ownerDraft");
    const goalId = await reviewedObjective();
    await call("goals.stop", {
      id: goalId,
      reason: "The team folded into Sales",
    });
    await expect(call("goals.publishDraft", { id: goalId })).rejects.toThrow(
      /is closed, so its draft cannot go live/,
    );
  });

  it("refuses to publish what is not a draft", async () => {
    await cycleStarted(35);
    const goalId = await reviewedObjective();
    await expect(call("goals.publishDraft", { id: goalId })).rejects.toThrow(
      /not a draft/,
    );
  });
});

describe("approved by its reviewer", () => {
  it("acceptance: published by its owner it awaits approval, and approved by its reviewer it is live", async () => {
    await cycleStarted(35);
    await startsAs("reviewerApproval");
    const goalId = await reviewedObjective();

    await expect(call("goals.approveDraft", { id: goalId })).rejects.toThrow(
      /has not published this draft/,
    );
    const published = await call<{ awaitingApproval: boolean }>(
      "goals.publishDraft",
      { id: goalId },
    );
    expect(published.awaitingApproval).toBe(true);
    expect(await waiting(goalId)).toMatchObject({
      draftState: "awaiting_approval",
      nextCheckInOn: null,
    });

    // Its owner is not its reviewer.
    await expect(call("goals.approveDraft", { id: goalId })).rejects.toThrow(
      /Only its reviewer can approve it/,
    );
    await callAs(TEAMMATE, "goals.approveDraft", { id: goalId });
    const live = await waiting(goalId);
    expect(live.draftState).toBeNull();
    expect(live.nextCheckInOn).not.toBeNull();
    expect((await activityKinds(goalId)).map((row) => row.kind)).toEqual(
      expect.arrayContaining(["goal.draft_published", "goal.draft_approved"]),
    );
  });

  it("defaults a required reviewer to the writer's manager, not the writer", async () => {
    await call("practice.update", { overrides: { reviewer: "required" } });
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set manager_id = $1 where id = $2",
      [teammateMemberId, ownerMemberId],
    );
    const goalId = (
      await call<{ id: string }>("goals.create", {
        title: "Make self-serve a second engine of growth",
        cycleId,
        spaceId,
        level: "team",
        ownerKind: "space",
      })
    ).id;
    const read = await call<{ reviewer: { id: string } | null }>("goals.read", {
      id: goalId,
    });
    expect(read.reviewer?.id).toBe(teammateMemberId);
  });

  it("asks for a reviewer before its owner can publish it", async () => {
    await cycleStarted(35);
    await startsAs("reviewerApproval");
    const goalId = await reviewedObjective(null);
    await expect(call("goals.publishDraft", { id: goalId })).rejects.toThrow(
      /Name a reviewer, then publish it/,
    );
  });
});
