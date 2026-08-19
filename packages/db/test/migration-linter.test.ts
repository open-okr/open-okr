import { describe, expect, it } from "vitest";
import { lintMigrationSql } from "../src/migration-lint.ts";

/**
 * The migration linter is the build-time guarantee behind two hard rules:
 * every business table carries `workspace_id` with a row-level security
 * policy in the same migration file, and soft delete is the repository-wide
 * default. Escapes are explicit markers with a written reason, so a reviewer
 * sees every exception in the diff.
 */

const GOOD = `
create table goals (
  id uuid primary key,
  workspace_id uuid not null,
  title text not null,
  deleted_at timestamptz
);
alter table goals enable row level security;
alter table goals force row level security;
create policy tenant_isolation on goals
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
`;

describe("lintMigrationSql", () => {
  it("accepts a business table with tenant key, policy, force and soft delete", () => {
    expect(lintMigrationSql("0001_goals.sql", GOOD)).toEqual([]);
  });

  it("fails a table created without any row-level security policy", () => {
    const sql = GOOD.replace(/create policy[\s\S]*?;/, "");
    const problems = lintMigrationSql("0001_goals.sql", sql);
    expect(problems.some((p) => p.includes("policy"))).toBe(true);
  });

  it("fails a table without a workspace_id column", () => {
    const sql = GOOD.replace("workspace_id uuid not null,", "");
    const problems = lintMigrationSql("0001_goals.sql", sql);
    expect(problems.some((p) => p.includes("workspace_id"))).toBe(true);
  });

  it("fails a table that enables but does not force row-level security", () => {
    const sql = GOOD.replace("alter table goals force row level security;", "");
    const problems = lintMigrationSql("0001_goals.sql", sql);
    expect(problems.some((p) => p.includes("force"))).toBe(true);
  });

  it("fails a table without deleted_at unless marked hard-delete", () => {
    const sql = GOOD.replace("deleted_at timestamptz", "closed_at timestamptz");
    expect(
      lintMigrationSql("0001_goals.sql", sql).some((p) =>
        p.includes("deleted_at"),
      ),
    ).toBe(true);

    const marked = sql.replace(
      "create table goals",
      "-- openokr:hard-delete: append-only audit data is erased by retention jobs, not users\ncreate table goals",
    );
    expect(
      lintMigrationSql("0001_goals.sql", marked).some((p) =>
        p.includes("deleted_at"),
      ),
    ).toBe(false);
  });

  it("lets an explicitly marked infrastructure table skip the tenant rules", () => {
    const sql = `
-- openokr:not-tenant-scoped: pg-boss job bookkeeping, no user data
create table job_state (
  id bigint primary key,
  payload jsonb
);
`;
    expect(lintMigrationSql("0002_jobs.sql", sql)).toEqual([]);
  });

  it("requires a reason after every escape marker", () => {
    const sql = `
-- openokr:not-tenant-scoped:
create table job_state (id bigint primary key);
`;
    const problems = lintMigrationSql("0002_jobs.sql", sql);
    expect(problems.some((p) => p.includes("reason"))).toBe(true);
  });

  describe("the tenant root", () => {
    // `workspaces` is the one table that cannot carry a workspace_id, because
    // it is what every other workspace_id points at. Marking it as
    // infrastructure would excuse it from the policy checks too, which is the
    // last thing that should happen to the table the whole floor rests on.
    const ROOT = `
-- openokr:tenant-root: the tenant root itself; every other workspace_id points here
create table workspaces (
  id uuid primary key,
  name text not null,
  deleted_at timestamptz
);
alter table workspaces enable row level security;
alter table workspaces force row level security;
create policy tenant_isolation on workspaces
  using (id = nullif(current_setting('app.workspace_id', true), '')::uuid);
`;

    it("accepts a tenant root with no workspace_id but a full policy", () => {
      expect(lintMigrationSql("0005_workspaces.sql", ROOT)).toEqual([]);
    });

    it("still requires the policy on a tenant root", () => {
      const sql = ROOT.replace(/create policy[\s\S]*?;/, "");
      expect(
        lintMigrationSql("0005_workspaces.sql", sql).some((p) =>
          p.includes("policy"),
        ),
      ).toBe(true);
    });

    it("still requires force on a tenant root", () => {
      const sql = ROOT.replace(
        "alter table workspaces force row level security;",
        "",
      );
      expect(
        lintMigrationSql("0005_workspaces.sql", sql).some((p) =>
          p.includes("force"),
        ),
      ).toBe(true);
    });

    it("still requires soft delete on a tenant root", () => {
      const sql = ROOT.replace(
        "deleted_at timestamptz",
        "closed_at timestamptz",
      );
      expect(
        lintMigrationSql("0005_workspaces.sql", sql).some((p) =>
          p.includes("deleted_at"),
        ),
      ).toBe(true);
    });

    it("requires a reason on the tenant-root marker too", () => {
      const sql = ROOT.replace(
        "-- openokr:tenant-root: the tenant root itself; every other workspace_id points here",
        "-- openokr:tenant-root:",
      );
      expect(
        lintMigrationSql("0005_workspaces.sql", sql).some((p) =>
          p.includes("reason"),
        ),
      ).toBe(true);
    });
  });

  describe("instance scope", () => {
    // A second table that cannot carry a workspace_id, for the opposite
    // reason to the tenant root: it sits above every workspace rather than
    // beneath them. Calling it infrastructure would waive its policy checks,
    // and this is the table holding the instance's encrypted credentials.
    const INSTANCE = `
-- openokr:instance-scope: instance configuration, above every workspace
-- openokr:hard-delete: removing a row restores the registry default
create table system_settings (
  key text primary key,
  value jsonb not null default 'null'::jsonb
);
alter table system_settings enable row level security;
alter table system_settings force row level security;
create policy instance_settings_read on system_settings for select using (true);
`;

    it("accepts an instance table with no workspace_id but a full policy", () => {
      expect(lintMigrationSql("0007_system_settings.sql", INSTANCE)).toEqual(
        [],
      );
    });

    it("still requires the policy on an instance table", () => {
      const sql = INSTANCE.replace(/create policy[\s\S]*?;/, "");
      expect(
        lintMigrationSql("0007_system_settings.sql", sql).some((p) =>
          p.includes("policy"),
        ),
      ).toBe(true);
    });

    it("still requires force on an instance table", () => {
      const sql = INSTANCE.replace(
        "alter table system_settings force row level security;",
        "",
      );
      expect(
        lintMigrationSql("0007_system_settings.sql", sql).some((p) =>
          p.includes("force"),
        ),
      ).toBe(true);
    });

    it("still requires a soft-delete column or a hard-delete reason", () => {
      const sql = INSTANCE.replace(
        "-- openokr:hard-delete: removing a row restores the registry default",
        "",
      );
      expect(
        lintMigrationSql("0007_system_settings.sql", sql).some((p) =>
          p.includes("deleted_at"),
        ),
      ).toBe(true);
    });

    it("requires a reason on the instance-scope marker too", () => {
      const sql = INSTANCE.replace(
        "-- openokr:instance-scope: instance configuration, above every workspace",
        "-- openokr:instance-scope:",
      );
      expect(
        lintMigrationSql("0007_system_settings.sql", sql).some((p) =>
          p.includes("reason"),
        ),
      ).toBe(true);
    });
  });

  it("checks every table in a multi-table migration independently", () => {
    const sql = `${GOOD}\ncreate table bare (id uuid primary key);`;
    const problems = lintMigrationSql("0003_both.sql", sql);
    expect(problems.some((p) => p.includes("bare"))).toBe(true);
    expect(problems.some((p) => p.includes("goals"))).toBe(false);
  });

  /**
   * Four ways the linter could pass a migration it should refuse. Each one is
   * a gate that reports success while checking nothing, which is the failure
   * shape Phase 1 met four times in its own tooling.
   */
  describe("holes a Phase 2 migration could walk through", () => {
    it("does not accept a policy on a similarly named table", () => {
      // `invitations` satisfying `invitation` is not hypothetical: Phase 2
      // adds several near-identical singular and plural table names.
      const sql = `
create table invitation (
  id uuid primary key,
  workspace_id uuid not null,
  deleted_at timestamptz
);
alter table invitation enable row level security;
alter table invitation force row level security;
create table invitations (
  id uuid primary key,
  workspace_id uuid not null,
  deleted_at timestamptz
);
alter table invitations enable row level security;
alter table invitations force row level security;
create policy tenant_isolation on invitations
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
`;
      const problems = lintMigrationSql("0002_invites.sql", sql);
      expect(
        problems.some(
          (p) => p.includes("table invitation:") && p.includes("no row-level"),
        ),
      ).toBe(true);
    });

    it("refuses a policy that reads using (true) on a workspace table", () => {
      // Permissive policies combine with OR, so one `using (true)` defeats
      // the tenant policy sitting beside it. That is precisely the shape 0008
      // had to repair on workspace_members.
      const sql = `${GOOD}
create policy everyone_reads on goals for select using (true);
`;
      const problems = lintMigrationSql("0003_open.sql", sql);
      expect(problems.some((p) => p.includes("using (true)"))).toBe(true);
    });

    it("still allows using (true) on an instance-scope table", () => {
      // system_settings reads are deliberately instance-wide; its writes are
      // what the admin check guards. The marker is the stated reason.
      const sql = `
-- openokr:instance-scope: settings sit above every workspace
-- openokr:hard-delete: a setting is replaced, never tombstoned
create table system_settings (
  key text primary key,
  value jsonb not null
);
alter table system_settings enable row level security;
alter table system_settings force row level security;
create policy settings_read on system_settings for select using (true);
create policy settings_write on system_settings
  for all
  using (nullif(current_setting('app.instance_admin', true), '') = 'on');
`;
      expect(lintMigrationSql("0004_settings.sql", sql)).toEqual([]);
    });

    it("does not read a marker written without its colon", () => {
      // "-- openokr:hard-delete is deliberately absent" is a sentence about a
      // marker, not a marker. Reading it as one would waive the check the
      // sentence exists to say is in force.
      const sql = `
-- openokr:hard-delete is deliberately absent, because rows here are kept
create table notes (
  id uuid primary key,
  workspace_id uuid not null
);
alter table notes enable row level security;
alter table notes force row level security;
create policy tenant_isolation on notes
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
`;
      const problems = lintMigrationSql("0005_notes.sql", sql);
      expect(problems.some((p) => p.includes("deleted_at"))).toBe(true);
    });
  });

  it("accepts the shipped fixture migration used by the isolation suite", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const fixture = await readFile(
      join(
        import.meta.dirname,
        "../../test-support/fixtures/db/migrations/0001_tenant_probes.sql",
      ),
      "utf8",
    );
    expect(lintMigrationSql("0001_tenant_probes.sql", fixture)).toEqual([]);
  });
});

describe("characters a WIN1252 database cannot store", () => {
  it("refuses a decorative rule made of box drawing, naming the character", () => {
    const problems = lintMigrationSql(
      "0032_comments.sql",
      `-- ── Comments ──\n${GOOD}`,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("U+2500");
    expect(problems[0]).toContain("x4");
    expect(problems[0]).toContain("WIN1252");
  });

  it("allows the section sign and the em dash, which WIN1252 carries", () => {
    // Every migration in this repository opens with a section reference, and
    // several use an em dash. Neither is the problem, so neither is refused.
    expect(
      lintMigrationSql("0001_goals.sql", `-- § 4.2 — goals\n${GOOD}`),
    ).toEqual([]);
  });
});
