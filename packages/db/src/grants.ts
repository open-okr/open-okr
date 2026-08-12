/**
 * The application role's table privileges (TECHNICAL-PLAN §8.2).
 *
 * This exists because "the audit table has no update or delete grants" is a
 * security property, and a security property stated in two places is a
 * security property nobody has. It was previously spelled out in the test
 * harness only, where a blanket `grant ... on all tables` would have silently
 * re-opened whatever a migration closed. One function now, called by the
 * harness and by the first-run wizard (P1-T09), so production and the tests
 * cannot disagree about what the application role may do.
 */
import type { SqlRunner } from "./roles.ts";

/**
 * Tables the application may read and append to, but never change or remove.
 *
 * The database also refuses these through a trigger, which covers the owner
 * and a superuser as well. Grants are the first of the two, not the only one.
 */
export const APPEND_ONLY_TABLES: readonly string[] = [
  "audit_events",
  "instance_audit_events",
];

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export interface GrantOptions {
  readonly appRole: string;
}

/**
 * Applies the privilege model. Idempotent, and safe to re-run after new
 * migrations: it re-states the grants for every table that exists now and
 * leaves default privileges in place for tables a later migration adds.
 */
export async function grantAppPrivileges(
  client: SqlRunner,
  options: GrantOptions,
): Promise<void> {
  const { appRole } = options;
  if (!ROLE_NAME.test(appRole)) {
    throw new Error(`Invalid role name: ${JSON.stringify(appRole)}`);
  }

  await client.query(`grant usage on schema public to ${appRole}`);
  await client.query(
    `grant select, insert, update, delete on all tables in schema public to ${appRole}`,
  );
  // Tables created by a later migration inherit the general grant. The
  // append-only exception is re-applied by calling this function again, which
  // is what the migration step does.
  await client.query(
    `alter default privileges in schema public grant select, insert, update, delete on tables to ${appRole}`,
  );

  // Now take back what the append-only tables must never hand out. This runs
  // after the blanket grant on purpose: stating the exception last is what
  // makes it survive.
  for (const table of APPEND_ONLY_TABLES) {
    if (!ROLE_NAME.test(table)) {
      throw new Error(`Invalid table name: ${JSON.stringify(table)}`);
    }
    const exists = await client.query(
      "select 1 from pg_tables where schemaname = 'public' and tablename = $1",
      [table],
    );
    if (exists.rows.length === 0) {
      continue;
    }
    await client.query(`revoke update, delete on ${table} from ${appRole}`);
  }
}
