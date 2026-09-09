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
import { updateOwnProfile } from "../src/actions/people.ts";
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

describe("an ordinary member's own access", () => {
  it("can update their own profile with no explicit grant", async () => {
    const wb = await workerDb();
    const member = await addMember("Ordinary Member");

    const updated = await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", memberId: member },
      },
      "people.updateOwnProfile",
      { timezone: "UTC" },
    );
    expect(updated.id).toBe(member);
  });

  it("is still refused a full-gated action on someone else", async () => {
    const wb = await workerDb();
    const member = await addMember("Ordinary Member");
    const other = await addMember("Someone Else");

    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human", memberId: member },
        },
        "people.updateMember",
        { memberId: other, title: "Analyst" },
      ),
    ).rejects.toThrow();
  });
});

describe("directory includeSuspended (P6-G09)", () => {
  it("excludes a suspended member by default", async () => {
    const wb = await workerDb();
    const member = await addMember("Soon Suspended");
    await grantFullOnWorkspace(member);

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.suspend",
      { memberId: member },
    );

    const rows = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.directory",
      {},
    );
    expect(rows.map((r) => r.id)).not.toContain(member);
  });

  it("includes a suspended member when includeSuspended is true", async () => {
    const wb = await workerDb();
    const member = await addMember("Soon Suspended");
    await grantFullOnWorkspace(member);

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.suspend",
      { memberId: member },
    );

    const rows = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.directory",
      { includeSuspended: true },
    );
    expect(rows.map((r) => r.id)).toContain(member);
    const suspended = rows.find((r) => r.id === member);
    expect(suspended?.status).toBe("suspended");
  });
});

describe("readMember (P6-G09)", () => {
  it("returns full profile for an active member", async () => {
    const wb = await workerDb();
    const profile = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.readMember",
      { memberId: ownerMemberId },
    );
    expect(profile.id).toBe(ownerMemberId);
    expect(profile.name).toBe("People Owner");
    expect(profile).toHaveProperty("bio");
    expect(profile).toHaveProperty("primaryChannel");
    expect(profile).toHaveProperty("avatarBlobId");
  });

  it("returns not_found for a non-existent member", async () => {
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context(OWNER) }, "people.readMember", {
        memberId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("returns a suspended member to an admin caller", async () => {
    const wb = await workerDb();
    const member = await addMember("Suspended for Profile");
    await grantFullOnWorkspace(member);

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.suspend",
      { memberId: member },
    );

    const profile = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.readMember",
      { memberId: member },
    );
    expect(profile.id).toBe(member);
    expect(profile.status).toBe("suspended");
  });

  it("returns not_found for a suspended member when the caller is not admin", async () => {
    const wb = await workerDb();
    const member = await addMember("Suspended Target");
    await grantFullOnWorkspace(member);

    // Create a non-admin user to act as caller.
    const NON_ADMIN_USER = "people-reader";
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      [NON_ADMIN_USER, "Reader", "reader@example.com"],
    );
    const readerMember = await addMember("Reader");
    // Bind the user to the member row so the handler can find the caller.
    await wb.admin.query(
      "update workspace_members set user_id = $1 where id = $2",
      [NON_ADMIN_USER, readerMember],
    );

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.suspend",
      { memberId: member },
    );

    await expect(
      callAction(
        { pool: wb.appPool, ...context(NON_ADMIN_USER) },
        "people.readMember",
        { memberId: member },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("bio is validated as rich text (P2-T11)", () => {
  it("accepts a valid rich text document", () => {
    const result = updateOwnProfile.input.safeParse({
      bio: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Hi" }] },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts null, which clears the bio", () => {
    expect(updateOwnProfile.input.safeParse({ bio: null }).success).toBe(true);
  });

  it("accepts an absent bio — updating only the timezone leaves it untouched", () => {
    expect(updateOwnProfile.input.safeParse({ timezone: "UTC" }).success).toBe(
      true,
    );
  });

  it("rejects a document with a node type outside the allow-list", () => {
    const result = updateOwnProfile.input.safeParse({
      bio: { type: "doc", content: [{ type: "video", attrs: { src: "x" } }] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an arbitrary non-document value", () => {
    expect(
      updateOwnProfile.input.safeParse({ bio: "just a string" }).success,
    ).toBe(false);
  });
});

describe("a member's theme and density (P6-G23)", () => {
  it("starts null, which the provider reads as follow the system", async () => {
    const wb = await workerDb();
    const me = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.readMember",
      { memberId: ownerMemberId },
    );
    // Not "light". A product that picked one for somebody would be overriding
    // a choice they already made in their operating system.
    expect(me.theme).toBeNull();
    expect(me.density).toBeNull();
  });

  it("keeps what the member chose, on the member", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.updateOwnProfile",
      { theme: "dark", density: "compact" },
    );

    const me = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.readMember",
      { memberId: ownerMemberId },
    );
    // Stored per member rather than in a browser, which is the whole point:
    // signing in on a second machine used to put somebody back on the default.
    expect(me.theme).toBe("dark");
    expect(me.density).toBe("compact");
  });

  it("takes one without disturbing the other", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.updateOwnProfile",
      { theme: "dark", density: "compact" },
    );
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.updateOwnProfile",
      { theme: "light" },
    );

    const me = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.readMember",
      { memberId: ownerMemberId },
    );
    expect(me.theme).toBe("light");
    expect(me.density).toBe("compact");
  });

  it("goes back to following the system when set to null", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.updateOwnProfile",
      { theme: "dark" },
    );
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.updateOwnProfile",
      { theme: null },
    );

    const me = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.readMember",
      { memberId: ownerMemberId },
    );
    expect(me.theme).toBeNull();
  });

  it("refuses a theme the design system has no tokens for", async () => {
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...context(OWNER) },
        "people.updateOwnProfile",
        { theme: "solarized" } as never,
      ),
    ).rejects.toThrow();
  });
});

/**
 * A member's own language (UIUX-PLAN §8, P6-G22a).
 *
 * The catalogue has existed since P2-T10 and the locale has been pinned to
 * `en` in the root layout ever since, so the workspace's `language` setting
 * was read by no renderer and a member had no language at all. These prove the
 * column round-trips and that a locale with no catalogue is refused.
 */
describe("a member's language (P6-G22a)", () => {
  it("starts null, which reads as follow the workspace", async () => {
    const wb = await workerDb();
    const me = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.readMember",
      { memberId: ownerMemberId },
    );
    // Not "en". A member who has never chosen should get whatever their
    // organisation chose, and null is the only value that can say so.
    expect(me.language).toBeNull();
  });

  it("keeps what the member chose, and clears back to the workspace", async () => {
    const wb = await workerDb();
    const read = async () =>
      (
        await callAction(
          { pool: wb.appPool, ...context(OWNER) },
          "people.readMember",
          { memberId: ownerMemberId },
        )
      ).language;

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.updateOwnProfile",
      { language: "ms" },
    );
    expect(await read()).toBe("ms");

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.updateOwnProfile",
      { language: null },
    );
    expect(await read()).toBeNull();
  });

  it("refuses a locale with no catalogue", async () => {
    // `translate()` raises on a missing key by design rather than falling back
    // to something that looks like content, so a locale with no catalogue
    // would take out the first screen that rendered a key.
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, ...context(OWNER) },
        "people.updateOwnProfile",
        { language: "fr" } as never,
      ),
    ).rejects.toThrow();
  });

  it("leaves the theme and the density alone", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.updateOwnProfile",
      { theme: "dark", language: "ms" },
    );
    const me = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "people.readMember",
      { memberId: ownerMemberId },
    );
    expect(me.theme).toBe("dark");
    expect(me.language).toBe("ms");
  });
});
