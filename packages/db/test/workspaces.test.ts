import { workerDb } from "@openokr/test-support/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { workspaceMembers, workspaces } from "../src/schema/workspaces.ts";
import { withContext, withUser, withWorkspace } from "../src/tenant.ts";

/**
 * The tenant root and the per-workspace person (TECHNICAL-PLAN §4.1).
 *
 * `workspaces` has no `workspace_id` column, because it is the thing every
 * other table's `workspace_id` points at. Its policy keys on `id` instead, so
 * these tests exist to prove the floor still holds on the one table that
 * cannot follow the usual shape.
 *
 * The second half covers `app.user_id`: a member listing the workspaces they
 * belong to is a question that crosses tenants by definition, and it has to be
 * answerable inside row-level security rather than around it.
 */

const WORKSPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const USER_ONE = "user-one";
const USER_TWO = "user-two";

/** Users are global and have no row-level security, so the harness seeds them. */
const seedUser = async (id: string, email: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [id, id, email],
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await seedUser(USER_ONE, "one@example.com");
  await seedUser(USER_TWO, "two@example.com");

  // Workspace A, with both users as members.
  await withWorkspace(wb.db, WORKSPACE_A, async (tx) => {
    await tx
      .insert(workspaces)
      .values({ id: WORKSPACE_A, name: "Alpha", slug: "alpha" });
    await tx.insert(workspaceMembers).values([
      { workspaceId: WORKSPACE_A, userId: USER_ONE, name: "One" },
      { workspaceId: WORKSPACE_A, userId: USER_TWO, name: "Two" },
    ]);
  });

  // Workspace B, with only the first user.
  await withWorkspace(wb.db, WORKSPACE_B, async (tx) => {
    await tx
      .insert(workspaces)
      .values({ id: WORKSPACE_B, name: "Beta", slug: "beta" });
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: WORKSPACE_B, userId: USER_ONE, name: "One" });
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the workspaces table is itself tenant-scoped", () => {
  it("shows a workspace only under its own setting", async () => {
    const wb = await workerDb();

    const a = await withWorkspace(wb.db, WORKSPACE_A, (tx) =>
      tx.select().from(workspaces),
    );
    expect(a.map((row) => row.slug)).toEqual(["alpha"]);

    const b = await withWorkspace(wb.db, WORKSPACE_B, (tx) =>
      tx.select().from(workspaces),
    );
    expect(b.map((row) => row.slug)).toEqual(["beta"]);
  });

  it("returns nothing with no setting applied, though the rows exist", async () => {
    const wb = await workerDb();

    const all = await wb.admin.query(
      "select count(*)::int as n from workspaces",
    );
    expect(all.rows[0].n).toBe(2);

    const unset = await wb.appPool.query(
      "select count(*)::int as n from workspaces",
    );
    expect(unset.rows[0].n).toBe(0);
  });

  it("refuses a workspace row whose id is not the applied setting", async () => {
    const wb = await workerDb();

    const failure = await withWorkspace(wb.db, WORKSPACE_A, (tx) =>
      tx
        .insert(workspaces)
        .values({ id: WORKSPACE_B, name: "Smuggled", slug: "smuggled" }),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    const raw = await wb.admin.query(
      "select count(*)::int as n from workspaces where slug = 'smuggled'",
    );
    expect(raw.rows[0].n).toBe(0);
  });

  it("cannot rename another workspace", async () => {
    const wb = await workerDb();

    await withWorkspace(wb.db, WORKSPACE_A, async (tx) => {
      const updated = await tx
        .update(workspaces)
        .set({ name: "Defaced" })
        .where(eq(workspaces.id, WORKSPACE_B))
        .returning();
      expect(updated).toEqual([]);
    });

    const intact = await wb.admin.query(
      "select name from workspaces where id = $1",
      [WORKSPACE_B],
    );
    expect(intact.rows[0].name).toBe("Beta");
  });

  it("keeps slugs unique across the instance, which no policy may hide", async () => {
    const wb = await workerDb();

    // Workspace B tries to take workspace A's slug. The policy hides the row
    // from the reader, but the unique index still refuses the write, which is
    // the property a slug in a URL depends on.
    const failure = await withWorkspace(wb.db, WORKSPACE_B, (tx) =>
      tx
        .update(workspaces)
        .set({ slug: "alpha" })
        .where(eq(workspaces.id, WORKSPACE_B)),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
  });
});

describe("workspace_members isolation", () => {
  it("shows each workspace only its own members", async () => {
    const wb = await workerDb();

    const a = await withWorkspace(wb.db, WORKSPACE_A, (tx) =>
      tx.select().from(workspaceMembers),
    );
    expect(a.map((row) => row.userId).sort()).toEqual([USER_ONE, USER_TWO]);

    const b = await withWorkspace(wb.db, WORKSPACE_B, (tx) =>
      tx.select().from(workspaceMembers),
    );
    expect(b.map((row) => row.userId)).toEqual([USER_ONE]);
  });

  it("gives one user two distinct member rows in two workspaces", async () => {
    const wb = await workerDb();

    const rows = await wb.admin.query(
      "select id, workspace_id from workspace_members where user_id = $1 order by workspace_id",
      [USER_ONE],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].id).not.toBe(rows.rows[1].id);
  });

  it("refuses a second membership for the same user in one workspace", async () => {
    const wb = await workerDb();

    const failure = await withWorkspace(wb.db, WORKSPACE_A, (tx) =>
      tx.insert(workspaceMembers).values({
        workspaceId: WORKSPACE_A,
        userId: USER_ONE,
        name: "One again",
      }),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
  });
});

describe("app.user_id: listing my own workspaces", () => {
  it("returns every workspace the user is a member of", async () => {
    const wb = await workerDb();

    const mine = await withUser(wb.db, USER_ONE, (tx) =>
      tx.select().from(workspaces),
    );
    expect(mine.map((row) => row.slug).sort()).toEqual(["alpha", "beta"]);

    const theirs = await withUser(wb.db, USER_TWO, (tx) =>
      tx.select().from(workspaces),
    );
    expect(theirs.map((row) => row.slug)).toEqual(["alpha"]);
  });

  it("returns only that user's own member rows", async () => {
    const wb = await workerDb();

    const mine = await withUser(wb.db, USER_TWO, (tx) =>
      tx.select().from(workspaceMembers),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.workspaceId).toBe(WORKSPACE_A);
  });

  it("gives an unknown user nothing", async () => {
    const wb = await workerDb();

    const none = await withUser(wb.db, "nobody", (tx) =>
      tx.select().from(workspaces),
    );
    expect(none).toEqual([]);
  });

  it("does not let a user read a workspace's other data", async () => {
    const wb = await workerDb();

    // Being a member is enough to see the workspace exists and to see your own
    // membership. It is not enough to read the member list: that needs the
    // workspace setting, which the application only applies for a workspace the
    // request is actually scoped to.
    const others = await withUser(wb.db, USER_ONE, (tx) =>
      tx.select().from(workspaceMembers),
    );
    expect(others).toHaveLength(2);
    expect(others.every((row) => row.userId === USER_ONE)).toBe(true);
  });

  it("hides soft-deleted memberships", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set deleted_at = now() where user_id = $1 and workspace_id = $2",
      [USER_ONE, WORKSPACE_B],
    );

    const mine = await withUser(wb.db, USER_ONE, (tx) =>
      tx.select().from(workspaces),
    );
    expect(mine.map((row) => row.slug)).toEqual(["alpha"]);
  });
});

describe("withContext", () => {
  it("applies both settings at once, which provisioning needs", async () => {
    const wb = await workerDb();

    const rows = await withContext(
      wb.db,
      { workspaceId: WORKSPACE_A, userId: USER_ONE },
      (tx) => tx.select().from(workspaces),
    );
    // The workspace setting alone would show Alpha; the user setting alone
    // would show Alpha and Beta. Policies are permissive, so the union wins.
    expect(rows.map((row) => row.slug).sort()).toEqual(["alpha", "beta"]);
  });

  it("rejects a workspace id that is not a UUID before touching the database", async () => {
    const wb = await workerDb();
    await expect(
      withContext(wb.db, { workspaceId: "not-a-uuid" }, (tx) =>
        tx.select().from(workspaces),
      ),
    ).rejects.toThrow(/workspace id/i);
  });

  it("rejects an empty user id", async () => {
    const wb = await workerDb();
    await expect(
      withUser(wb.db, "", (tx) => tx.select().from(workspaces)),
    ).rejects.toThrow(/user id/i);
  });

  it("keeps both settings transaction-local", async () => {
    const wb = await workerDb();
    await withContext(
      wb.db,
      { workspaceId: WORKSPACE_A, userId: USER_ONE },
      (tx) => tx.select().from(workspaces),
    );

    const after = await wb.appPool.query(
      "select count(*)::int as n from workspaces",
    );
    expect(after.rows[0].n).toBe(0);
  });
});
