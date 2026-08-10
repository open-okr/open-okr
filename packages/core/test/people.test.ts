import { type WorkspaceTx, withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import {
  resolveMemberAccessLevel,
  resolveSubjectContext,
} from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The people lifecycle (P2-T03 test plan, TECHNICAL-PLAN §4.1, screen S-33).
 *
 * The manager chain rejects a cycle; suspend removes every access a
 * suspension-blind read would otherwise grant, and restore returns it;
 * converting to guest leaves no stale binding; erasure anonymises the row
 * while an activity it authored still names it; and removing the workspace's
 * last full-access holder is refused everywhere that would leave it with
 * none.
 */

const OWNER = "people-owner";

let workspaceId: string;
let ownerMemberId: string;

async function withReadTx<T>(fn: (tx: WorkspaceTx) => Promise<T>): Promise<T> {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, fn);
}

async function addMember(name: string): Promise<string> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'human', 'active')
     returning id`,
    [workspaceId, name],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("insert into workspace_members returned no row");
  }
  return row.id;
}

/** Gives a member a `full` binding on the workspace's own context. */
async function grantFullOnWorkspace(memberId: string): Promise<void> {
  const wb = await workerDb();
  await runOperation(
    { pool: wb.appPool },
    {
      action: "test.grant-full",
      workspaceId,
      actor: { kind: "human", userId: OWNER },
      async execute({ tx }) {
        const context = await resolveSubjectContext(
          tx,
          "workspace",
          workspaceId,
          workspaceId,
        );
        const groupId = await ensureMemberGroup(tx, { workspaceId, memberId });
        await bindGroup(tx, {
          workspaceId,
          groupId,
          contextId: (context as { contextId: string }).contextId,
          level: ACCESS_LEVELS.full,
        });
        return {
          result: undefined,
          activity: {
            kind: "test.grant-full",
            subjectType: "workspace_member",
            subjectId: memberId,
          },
          audit: { action: "test.grant-full", targetType: "workspace_member" },
        };
      },
    },
  );
}

const context = (actorUserId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId: actorUserId },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "People Owner", "people-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "People Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the manager chain", () => {
  it("rejects a cycle", async () => {
    const wb = await workerDb();
    const a = await addMember("A");
    const b = await addMember("B");

    // B reports to A: fine.
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.updateMember",
      { memberId: b, managerId: a },
    );

    // A reporting to B would close the loop.
    await expect(
      callAction(
        { pool: wb.appPool, ...context(OWNER) },
        "people.updateMember",
        { memberId: a, managerId: b },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses making someone their own manager", async () => {
    const wb = await workerDb();
    const a = await addMember("A");
    await expect(
      callAction(
        { pool: wb.appPool, ...context(OWNER) },
        "people.updateMember",
        { memberId: a, managerId: a },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("suspend and restore", () => {
  it("suspend removes every access a binding would otherwise grant, and restore returns it", async () => {
    const wb = await workerDb();
    const member = await addMember("Member");
    await grantFullOnWorkspace(member);

    const context1 = await withReadTx((tx) =>
      resolveSubjectContext(tx, "workspace", workspaceId, workspaceId),
    );
    const before = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: member,
        contextId: (context1 as { contextId: string }).contextId,
      }),
    );
    expect(before).toBe(ACCESS_LEVELS.full);

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.suspend",
      {
        memberId: member,
      },
    );

    const duringSuspension = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: member,
        contextId: (context1 as { contextId: string }).contextId,
      }),
    );
    expect(duringSuspension).toBe(0);

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.restore",
      {
        memberId: member,
      },
    );

    const afterRestore = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: member,
        contextId: (context1 as { contextId: string }).contextId,
      }),
    );
    expect(afterRestore).toBe(ACCESS_LEVELS.full);
  });
});

describe("converting to guest", () => {
  it("leaves no stale binding", async () => {
    const wb = await workerDb();
    const member = await addMember("Member");
    await grantFullOnWorkspace(member);

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.convertToGuest",
      { memberId: member },
    );

    const rows = await wb.admin.query(
      "select kind from workspace_members where id = $1",
      [member],
    );
    expect(rows.rows[0].kind).toBe("guest");

    const context1 = await withReadTx((tx) =>
      resolveSubjectContext(tx, "workspace", workspaceId, workspaceId),
    );
    const level = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: member,
        contextId: (context1 as { contextId: string }).contextId,
      }),
    );
    expect(level).toBe(0);
  });
});

describe("erasure", () => {
  it("anonymises the row while an activity it authored still names it, and exports the prior profile", async () => {
    const wb = await workerDb();
    const member = await addMember("Erasable Member");
    await grantFullOnWorkspace(member);

    // The member does something, so an activity exists with them as actor.
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.updateMember",
      { memberId: member, title: "Analyst" },
    );
    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", memberId: member },
      },
      "people.updateOwnProfile",
      { timezone: "UTC" },
    );

    const activityBefore = await wb.admin.query(
      "select count(*)::int as n from activities where actor_member_id = $1",
      [member],
    );
    expect(activityBefore.rows[0].n).toBeGreaterThan(0);

    const outcome = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.erase",
      { memberId: member },
    );

    expect(outcome.export.priorProfile.title).toBe("Analyst");

    const row = await wb.admin.query(
      "select name, title, bio, user_id, status from workspace_members where id = $1",
      [member],
    );
    expect(row.rows[0].name).toBe("Erased member");
    expect(row.rows[0].title).toBeNull();
    expect(row.rows[0].bio).toBeNull();
    expect(row.rows[0].user_id).toBeNull();
    expect(row.rows[0].status).toBe("suspended");

    // Authorship intact: the activity still points at the same member id.
    const activityAfter = await wb.admin.query(
      "select count(*)::int as n from activities where actor_member_id = $1",
      [member],
    );
    expect(activityAfter.rows[0].n).toBe(activityBefore.rows[0].n);
  });
});

describe("the last-owner invariant", () => {
  it("refuses to suspend the only member with full access", async () => {
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context(OWNER) }, "people.suspend", {
        memberId: ownerMemberId,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses to convert the only member with full access to a guest", async () => {
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...context(OWNER) },
        "people.convertToGuest",
        { memberId: ownerMemberId },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses to erase the only member with full access", async () => {
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context(OWNER) }, "people.erase", {
        memberId: ownerMemberId,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("allows suspending a member once someone else also holds full access", async () => {
    const wb = await workerDb();
    const second = await addMember("Second Owner");
    await grantFullOnWorkspace(second);

    await expect(
      callAction({ pool: wb.appPool, ...context(OWNER) }, "people.suspend", {
        memberId: ownerMemberId,
      }),
    ).resolves.toMatchObject({ status: "suspended" });
  });
});

describe("the directory, org chart and possible managers", () => {
  it("lists active members in the directory", async () => {
    const wb = await workerDb();
    await addMember("Directory Member");

    const rows = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.directory",
      {},
    );
    expect(rows.map((r) => r.name)).toContain("Directory Member");
  });

  it("builds the org chart from the manager chain", async () => {
    const wb = await workerDb();
    const a = await addMember("Manager A");
    const b = await addMember("Report B");
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.updateMember",
      { memberId: b, managerId: a },
    );

    const tree = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.orgChart",
      {},
    );
    const managerNode = tree
      .flatMap((root) => [root, ...(root.children as typeof tree)])
      .find((node) => (node as { id: string }).id === a);
    expect(managerNode).toBeDefined();
  });

  it("excludes a member's own reports from their possible managers", async () => {
    const wb = await workerDb();
    const a = await addMember("Manager A");
    const b = await addMember("Report B");
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.updateMember",
      { memberId: b, managerId: a },
    );

    const candidates = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.possibleManagers",
      { memberId: a },
    );
    expect(candidates.map((c) => c.id)).not.toContain(b);
    expect(candidates.map((c) => c.id)).not.toContain(a);
  });
});
