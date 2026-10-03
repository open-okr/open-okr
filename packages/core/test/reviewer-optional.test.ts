import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { goalRolesFor } from "../src/nudges/service.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The reviewer becomes optional (P9-T04, METHOD.md §2.5, REQUIREMENTS §3.3).
 *
 * Optional by default: a goal may name a reviewer or not, and one without a
 * reviewer owes no acknowledgement. "Off" keeps every existing reviewer on its
 * goal and asks none of them to acknowledge. "Required" refuses a goal without
 * one, and refuses taking one off, from every caller, through the policy.
 */

const OWNER = "reviewer-owner";

let workspaceId: string;
let ownerMemberId: string;
let cycleId: string;

const call = async <T>(action: string, input: unknown): Promise<T> => {
  const wb = await workerDb();
  return (await callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    action as never,
    input as never,
  )) as T;
};

const richText = (text: string) =>
  ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  }) as never;

/** A second person, to review what the owner champions. */
async function addReviewer(): Promise<string> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, name, kind, status)
     values (gen_random_uuid(), $1, 'Second Member', 'human', 'active')
     returning id`,
    [workspaceId],
  );
  return rows[0]?.id as string;
}

async function createGoal(reviewerId: string | null): Promise<string> {
  const goal = await call<{ id: string }>("goals.create", {
    title: "Make onboarding the reason customers stay",
    cycleId,
    level: "team",
    ownerKind: "workspace",
    championId: ownerMemberId,
    ...(reviewerId === null ? {} : { reviewerId }),
  });
  return goal.id;
}

async function publishCheckIn(goalId: string): Promise<string> {
  const draft = await call<{ id: string }>("goals.startCheckIn", { goalId });
  await call("goals.publishCheckIn", {
    id: draft.id,
    status: "on_track",
    confidence: 0.6,
    narrative: richText("Activation is moving."),
  });
  return draft.id;
}

async function reviewerOfRecord(checkInId: string): Promise<string | null> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ reviewer_member_id: string | null }>(
    "select reviewer_member_id from check_ins where id = $1",
    [checkInId],
  );
  return rows[0]?.reviewer_member_id ?? null;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Reviewer Owner", "reviewer-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Reviewer Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  const current = await call<{ id: string }>("cycles.current", {
    mode: "quarterly",
  });
  cycleId = current.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("optional, the default", () => {
  it("creates a goal with no reviewer, which reads as none", async () => {
    const goalId = await createGoal(null);
    const read = await call<{ reviewer: unknown }>("goals.read", {
      id: goalId,
    });
    expect(read.reviewer).toBeNull();
  });

  it("owes no acknowledgement for a check-in on a goal with no reviewer", async () => {
    const goalId = await createGoal(null);
    const checkInId = await publishCheckIn(goalId);
    expect(await reviewerOfRecord(checkInId)).toBeNull();
  });

  it("still makes a named reviewer the reviewer of record", async () => {
    const reviewer = await addReviewer();
    const goalId = await createGoal(reviewer);
    const checkInId = await publishCheckIn(goalId);
    expect(await reviewerOfRecord(checkInId)).toBe(reviewer);
  });

  it("takes a reviewer off, and the pending acknowledgement with them", async () => {
    const reviewer = await addReviewer();
    const goalId = await createGoal(reviewer);
    const checkInId = await publishCheckIn(goalId);
    await call("goals.reassignRole", {
      id: goalId,
      role: "reviewer",
      memberId: null,
    });
    const read = await call<{ reviewer: unknown }>("goals.read", {
      id: goalId,
    });
    expect(read.reviewer).toBeNull();
    expect(await reviewerOfRecord(checkInId)).toBeNull();
  });

  it("never takes the champion off", async () => {
    const goalId = await createGoal(null);
    await expect(
      call("goals.reassignRole", {
        id: goalId,
        role: "champion",
        memberId: null,
      }),
    ).rejects.toThrow();
  });
});

describe("off", () => {
  it("keeps the reviewer on the goal and asks nothing of them", async () => {
    const reviewer = await addReviewer();
    const goalId = await createGoal(reviewer);
    await call("practice.update", { overrides: { reviewer: "off" } });

    const checkInId = await publishCheckIn(goalId);
    expect(await reviewerOfRecord(checkInId)).toBeNull();
    const read = await call<{ reviewer: { id: string } | null }>("goals.read", {
      id: goalId,
    });
    expect(read.reviewer?.id).toBe(reviewer);
  });
});

describe("the escalation ladders", () => {
  it("name no reviewer where reviewers are off", async () => {
    const reviewer = await addReviewer();
    const goalId = await createGoal(reviewer);
    const wb = await workerDb();
    const rolesNow = () =>
      withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
        goalRolesFor(tx, workspaceId, goalId),
      );
    expect((await rolesNow()).reviewerId).toBe(reviewer);
    await call("practice.update", { overrides: { reviewer: "off" } });
    expect((await rolesNow()).reviewerId).toBeNull();
  });
});

describe("required", () => {
  it("refuses a goal with no reviewer from the API, with the reason, and takes one with", async () => {
    await call("practice.update", { overrides: { reviewer: "required" } });
    await expect(createGoal(null)).rejects.toThrow(
      /asks every objective to name a reviewer/,
    );
    const reviewer = await addReviewer();
    await expect(createGoal(reviewer)).resolves.toBeTruthy();
  });

  it("refuses taking a reviewer off", async () => {
    const reviewer = await addReviewer();
    const goalId = await createGoal(reviewer);
    await call("practice.update", { overrides: { reviewer: "required" } });
    await expect(
      call("goals.reassignRole", {
        id: goalId,
        role: "reviewer",
        memberId: null,
      }),
    ).rejects.toThrow(/asks every objective to name a reviewer/);
  });
});
