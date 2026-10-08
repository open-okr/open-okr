import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Filing a new objective under a space (UAT BUG-014).
 *
 * The drafting surface created every objective with no space, so a space's
 * sessions, page and alignment picture never saw one. A new objective can now
 * be filed under a space, which asks the same edit on that space that moving
 * one there asks (goal-move.test.ts).
 */

const OWNER = "filing-owner";
const KOFI = "filing-kofi";

let workspaceId: string;
let ownerMemberId: string;
let kofiMemberId: string;
let cycleId: string;
let support: string;
let success: string;
let engineering: string;

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

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Elena Owner",
      `${OWNER}@example.com`,
      KOFI,
      "Kofi Support",
      `${KOFI}@example.com`,
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Elena Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  cycleId = (
    await call<{ id: string }>("cycles.current", { mode: "quarterly" })
  ).id;
  support = (await call<{ id: string }>("spaces.create", { name: "Support" }))
    .id;
  success = (
    await call<{ id: string }>("spaces.create", { name: "Customer Success" })
  ).id;
  engineering = (
    await call<{ id: string }>("spaces.create", { name: "Engineering" })
  ).id;

  // Kofi is a member with the default role, in Support and nowhere else.
  const kofi = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, role_id)
     values (gen_random_uuid(), $1, $2, 'Kofi Support', 'active',
             (select id from workspace_roles
               where workspace_id = $1 and is_default and deleted_at is null))
     returning id`,
    [workspaceId, KOFI],
  );
  kofiMemberId = kofi.rows[0]?.id as string;
  await call("spaces.addMember", {
    spaceId: support,
    memberId: kofiMemberId,
    role: "member",
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("filing a new objective under a space (UAT BUG-014)", () => {
  it("files the objective under the space, so the space's own reads find it", async () => {
    const goalId = (
      await call<{ id: string }>("goals.create", {
        title: "Every customer question answered the same day",
        cycleId,
        level: "team",
        ownerKind: "space",
        spaceId: support,
      })
    ).id;
    const read = await call<{ spaceId: string; ownerKind: string }>(
      "goals.read",
      { id: goalId },
    );
    expect(read).toMatchObject({ spaceId: support, ownerKind: "space" });
    expect(ownerMemberId).toBeTruthy();
    const listed = await call<{ goals: { id: string }[] }>("goals.list", {
      spaceId: support,
      includeClosed: false,
    });
    expect(listed.goals.map((goal) => goal.id)).toContain(goalId);
  });

  it("asks edit on the space: Kofi files under Support, and not under Customer Success", async () => {
    const own = await callAs<{ id: string }>(KOFI, "goals.create", {
      title: "Same-day answers for every new customer",
      cycleId,
      level: "team",
      ownerKind: "space",
      spaceId: support,
    });
    expect(own.id).toBeTruthy();
    await expect(
      callAs(KOFI, "goals.create", {
        title: "Renewals handled before the date",
        cycleId,
        level: "team",
        ownerKind: "space",
        spaceId: success,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(kofiMemberId).toBeTruthy();
    expect(engineering).toBeTruthy();
  });

  it("refuses a space id that is not a space in this workspace", async () => {
    await expect(
      call("goals.create", {
        title: "Filed nowhere real",
        cycleId,
        level: "team",
        ownerKind: "space",
        spaceId: "01a11b00-0000-7000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
