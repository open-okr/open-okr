import { workerDb } from "@openokr/test-support/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { workspaceMembers, workspaces } from "../src/schema/workspaces.ts";
import {
  withContext,
  withSystemScan,
  withTrustedEmailDomain,
  withUser,
  withWorkspace,
} from "../src/tenant.ts";

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
  /**
   * The regression this file exists to hold.
   *
   * Both settings applied at once used to return the union: the scoped
   * workspace OR every workspace the user belonged to. The Operation pipeline
   * applies both on every write, so every read inside every operation was
   * wider than the tenant floor. 0008 scopes the cross-workspace policies to
   * transactions that name no workspace.
   *
   * An earlier version of this test asserted the union and called it correct,
   * so the assertion below is the fix, not just a check on it.
   */
  it("does not widen past the workspace when both settings are applied", async () => {
    const wb = await workerDb();

    const rows = await withContext(
      wb.db,
      { workspaceId: WORKSPACE_A, userId: USER_ONE },
      (tx) => tx.select().from(workspaces),
    );
    // Beta is the other workspace this user belongs to. Naming one workspace
    // means one workspace.
    expect(rows.map((row) => row.slug)).toEqual(["alpha"]);
  });

  it("does not widen past the workspace on workspace_members either", async () => {
    const wb = await workerDb();

    const rows = await withContext(
      wb.db,
      { workspaceId: WORKSPACE_A, userId: USER_ONE },
      (tx) => tx.select().from(workspaceMembers),
    );
    // Two members in Alpha, and the same user's Beta membership must not
    // appear. This is the read every operation performs to resolve its actor.
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.workspaceId === WORKSPACE_A)).toBe(true);
  });

  it("still answers the cross-workspace question when no workspace is named", async () => {
    const wb = await workerDb();

    const rows = await withContext(wb.db, { userId: USER_ONE }, (tx) =>
      tx.select().from(workspaces),
    );
    // The switcher and the provisioning membership check both rely on this.
    expect(rows.map((row) => row.slug).sort()).toEqual(["alpha", "beta"]);
  });

  it("hides a soft-deleted membership from the cross-workspace read", async () => {
    const wb = await workerDb();
    await withWorkspace(wb.db, WORKSPACE_B, (tx) =>
      tx
        .update(workspaceMembers)
        .set({ deletedAt: new Date() })
        .where(eq(workspaceMembers.userId, USER_ONE)),
    );

    // 0005 filtered soft-deleted rows in own_workspaces but not in
    // own_memberships, so a removed member kept reading their own row.
    const memberships = await withContext(wb.db, { userId: USER_ONE }, (tx) =>
      tx.select().from(workspaceMembers),
    );
    expect(memberships.map((row) => row.workspaceId)).toEqual([WORKSPACE_A]);
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

/**
 * `app.system_scan`: the scheduler listing every tenant (completeness review
 * H-02, migration 0099).
 *
 * Under the restricted application role the scheduler used to find no
 * workspace at all, so even a scheduler that started ran for nobody. The scan
 * opens exactly one question, which workspaces exist, and nothing else.
 */
describe("app.system_scan: the scheduler listing every workspace", () => {
  it("lists every workspace, which no setting did before", async () => {
    const wb = await workerDb();
    const rows = await withSystemScan(wb.db, (tx) =>
      tx.select({ id: workspaces.id }).from(workspaces),
    );
    expect(rows.map((row) => row.id).sort()).toEqual([
      WORKSPACE_A,
      WORKSPACE_B,
    ]);
  });

  it("opens no other table across tenants", async () => {
    const wb = await workerDb();
    const members = await withSystemScan(wb.db, (tx) =>
      tx.select().from(workspaceMembers),
    );
    expect(members).toEqual([]);
  });

  it("can read the workspaces and change none of them", async () => {
    const wb = await workerDb();
    const renamed = await withSystemScan(wb.db, (tx) =>
      tx
        .update(workspaces)
        .set({ name: "Renamed" })
        .where(eq(workspaces.id, WORKSPACE_A))
        .returning({ id: workspaces.id }),
    );
    expect(renamed).toEqual([]);
  });

  it("does not outlive its transaction", async () => {
    const wb = await workerDb();
    await withSystemScan(wb.db, (tx) => tx.select().from(workspaces));
    const after = await wb.appPool.query(
      "select count(*)::int as n from workspaces",
    );
    expect(after.rows[0].n).toBe(0);
  });
});

/**
 * `app.trusted_email_domain`: a person finding the workspaces that trust their
 * address (completeness review M-34, migration 0104).
 *
 * Nothing could answer "which workspaces trust acme.example" for somebody who
 * belongs to none of them, so trusted-domain joining never happened. The key
 * answers that one question and no other: the rows trusting exactly that
 * domain, read-only, nothing else in the database, and never inside a tenant
 * transaction.
 */
describe("app.trusted_email_domain: the workspaces trusting one domain", () => {
  const trust = async (workspaceId: string, domains: unknown) => {
    const wb = await workerDb();
    await wb.admin.query(
      `update workspaces
          set settings = settings || jsonb_build_object('trustedEmailDomains', $2::jsonb)
        where id = $1`,
      [workspaceId, JSON.stringify(domains)],
    );
  };

  it("admits exactly the workspaces whose list holds the domain", async () => {
    const wb = await workerDb();
    await trust(WORKSPACE_A, ["acme.example", "acme.test"]);
    await trust(WORKSPACE_B, ["other.example"]);

    const rows = await withTrustedEmailDomain(wb.db, "acme.example", (tx) =>
      tx.select({ id: workspaces.id }).from(workspaces),
    );
    expect(rows.map((row) => row.id)).toEqual([WORKSPACE_A]);
  });

  it("admits nothing for a domain no workspace trusts, or for a near miss", async () => {
    const wb = await workerDb();
    await trust(WORKSPACE_A, ["acme.example"]);

    for (const domain of [
      "nobody.example",
      "mail.acme.example",
      "cme.example",
    ]) {
      const rows = await withTrustedEmailDomain(wb.db, domain, (tx) =>
        tx.select({ id: workspaces.id }).from(workspaces),
      );
      expect(rows, domain).toEqual([]);
    }
  });

  it("admits nothing when the setting is not a list", async () => {
    const wb = await workerDb();
    // `?` also matches a bare string and an object's keys, and neither is a
    // list of domains.
    await trust(WORKSPACE_A, "acme.example");
    await trust(WORKSPACE_B, { "acme.example": true });

    const rows = await withTrustedEmailDomain(wb.db, "acme.example", (tx) =>
      tx.select({ id: workspaces.id }).from(workspaces),
    );
    expect(rows).toEqual([]);
  });

  it("admits no deleted workspace", async () => {
    const wb = await workerDb();
    await trust(WORKSPACE_A, ["acme.example"]);
    await wb.admin.query(
      "update workspaces set deleted_at = now() where id = $1",
      [WORKSPACE_A],
    );

    const rows = await withTrustedEmailDomain(wb.db, "acme.example", (tx) =>
      tx.select({ id: workspaces.id }).from(workspaces),
    );
    expect(rows).toEqual([]);
  });

  it("opens no other table across tenants", async () => {
    const wb = await workerDb();
    await trust(WORKSPACE_A, ["acme.example"]);

    const members = await withTrustedEmailDomain(wb.db, "acme.example", (tx) =>
      tx.select().from(workspaceMembers),
    );
    expect(members).toEqual([]);
  });

  it("can read the workspaces it admits and change none of them", async () => {
    const wb = await workerDb();
    await trust(WORKSPACE_A, ["acme.example"]);

    const renamed = await withTrustedEmailDomain(wb.db, "acme.example", (tx) =>
      tx
        .update(workspaces)
        .set({ name: "Renamed" })
        .where(eq(workspaces.id, WORKSPACE_A))
        .returning({ id: workspaces.id }),
    );
    expect(renamed).toEqual([]);
  });

  it("widens nothing inside a tenant transaction", async () => {
    const wb = await workerDb();
    await trust(WORKSPACE_A, ["acme.example"]);

    // Workspace B scoped, with the key set beside it: B's own row and nothing
    // of A's, the rule migration 0008 set for the membership policies.
    const rows = await withContext(
      wb.db,
      { workspaceId: WORKSPACE_B, trustedEmailDomain: "acme.example" },
      (tx) => tx.select({ id: workspaces.id }).from(workspaces),
    );
    expect(rows.map((row) => row.id)).toEqual([WORKSPACE_B]);
  });

  it("does not outlive its transaction", async () => {
    const wb = await workerDb();
    await trust(WORKSPACE_A, ["acme.example"]);
    await withTrustedEmailDomain(wb.db, "acme.example", (tx) =>
      tx.select().from(workspaces),
    );
    const after = await wb.appPool.query(
      "select count(*)::int as n from workspaces",
    );
    expect(after.rows[0].n).toBe(0);
  });

  it("refuses a value that is not a lower-case domain before any query", async () => {
    const wb = await workerDb();
    for (const domain of ["", "Acme.Example", "a@acme.example", "acme"]) {
      await expect(
        withTrustedEmailDomain(wb.db, domain, (tx) =>
          tx.select().from(workspaces),
        ),
        domain,
      ).rejects.toThrow(/Invalid email domain/);
    }
  });
});
