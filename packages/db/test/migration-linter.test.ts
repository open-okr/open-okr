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

  it("checks every table in a multi-table migration independently", () => {
    const sql = `${GOOD}\ncreate table bare (id uuid primary key);`;
    const problems = lintMigrationSql("0003_both.sql", sql);
    expect(problems.some((p) => p.includes("bare"))).toBe(true);
    expect(problems.some((p) => p.includes("goals"))).toBe(false);
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
