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

  // **One column-level exception, and it is not a hole** (P7-T02a).
  //
  // The chain is built behind the write path now, so the chainer fills `seq`,
  // `prev_hash` and `row_hash` on rows that arrived with them null. It needs
  // UPDATE on those three columns and on nothing else: the actor, the action,
  // the target, the payload and the time stay unreachable, so what happened
  // still cannot be changed by any route. Migration 0080's row-level trigger
  // narrows it further, to a row that has no position yet, and refuses a
  // second attempt on the same row. DELETE stays revoked outright.
  //
  // Stated here rather than only in the migration, for the reason this whole
  // file exists: a privilege that lives in one place is a privilege somebody
  // can re-open by accident from the other.
  const auditExists = await client.query(
    "select 1 from pg_tables where schemaname = 'public' and tablename = 'audit_events'",
  );
  if (auditExists.rows.length > 0) {
    await client.query(
      `grant update (seq, prev_hash, row_hash) on audit_events to ${appRole}`,
    );
  }

  await grantJobSchema(client, appRole);
}

/**
 * The job queue's schema (completeness review H-02, migration 0099).
 *
 * pg-boss installs its own tables, functions and enum on first start and
 * creates a partition per queue as it goes, so the role that runs the
 * scheduler has to own what is in the schema. USAGE and CREATE on the schema
 * let the application role install into it without CREATE on the database.
 *
 * **Objects already there are handed over.** An instance that ran as a
 * superuser has a pg-boss installation owned by that superuser, and after the
 * switch the application role could neither write a job nor add a partition.
 * So anything in the schema that the application role does not own is given to
 * it. On a fresh database the schema is empty and nothing moves; on an upgrade
 * the caller is the admin connection, which is allowed to.
 */
async function grantJobSchema(client: SqlRunner, appRole: string) {
  const schema = await client.query(
    "select 1 from pg_namespace where nspname = 'pgboss'",
  );
  if (schema.rows.length === 0) {
    return;
  }

  await client.query(`grant usage, create on schema pgboss to ${appRole}`);

  // `appRole` is validated against ROLE_NAME by the caller, and `format(%I)`
  // quotes it again inside the block.
  await client.query(`
    do $$
    declare
      target constant text := '${appRole}';
      obj record;
    begin
      -- Tables, partitions and views. ALTER TABLE carries a column's own
      -- sequence and every index with it.
      for obj in
        select c.oid::regclass as name
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'pgboss'
           and c.relkind in ('r', 'p', 'v', 'm', 'f')
           and pg_get_userbyid(c.relowner) <> target
      loop
        execute format('alter table %s owner to %I', obj.name, target);
      end loop;

      -- Sequences no column owns. One a column owns has already moved, and
      -- Postgres refuses to move it separately.
      for obj in
        select c.oid::regclass as name
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'pgboss'
           and c.relkind = 'S'
           and pg_get_userbyid(c.relowner) <> target
           and not exists (
             select 1 from pg_depend d
              where d.objid = c.oid and d.deptype in ('a', 'i')
           )
      loop
        execute format('alter sequence %s owner to %I', obj.name, target);
      end loop;

      for obj in
        select p.oid::regprocedure as name
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'pgboss'
           and pg_get_userbyid(p.proowner) <> target
      loop
        execute format('alter routine %s owner to %I', obj.name, target);
      end loop;

      -- Enums and domains. Array types and a table's row type follow their
      -- owner and cannot be moved on their own.
      for obj in
        select t.oid::regtype as name, t.typtype
          from pg_type t
          join pg_namespace n on n.oid = t.typnamespace
         where n.nspname = 'pgboss'
           and t.typtype in ('e', 'd')
           and pg_get_userbyid(t.typowner) <> target
      loop
        if obj.typtype = 'd' then
          execute format('alter domain %s owner to %I', obj.name, target);
        else
          execute format('alter type %s owner to %I', obj.name, target);
        end if;
      end loop;
    end
    $$;
  `);
}
