/**
 * The repository-wide soft-delete scope (TECHNICAL-PLAN §3).
 *
 * Every read of a soft-deletable table states its scope: `activeOnly` is the
 * default and filters `deleted_at IS NULL`; `includeDeleted` is the explicit
 * opt-in that sees everything. Both take the table so the call site names
 * what it is scoping and the lint in `soft-delete-lint.ts` can verify it.
 */
import { and, isNull, type SQL, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

/** A table that participates in soft delete: it carries `deleted_at`. */
export type SoftDeletable = PgTable & { deletedAt: AnyPgColumn };

/**
 * The default scope: live rows only, with optional extra conditions folded
 * into one WHERE.
 */
export function activeOnly(
  table: SoftDeletable,
  ...conditions: (SQL | undefined)[]
): SQL {
  // `and` never returns undefined here: it always has the isNull condition.
  return and(isNull(table.deletedAt), ...conditions) as SQL;
}

/**
 * The explicit opt-in: deleted rows included. The table argument is what
 * makes the opt-in visible and lintable at the call site.
 */
export function includeDeleted(
  table: SoftDeletable,
  ...conditions: (SQL | undefined)[]
): SQL {
  // The table itself is not part of the condition; `true` keeps the shape
  // composable when no extra conditions are given.
  void table;
  return and(sql`true`, ...conditions) as SQL;
}

/** The `update` surface shared by a drizzle database and its transactions. */
type UpdateExecutor = Pick<NodePgDatabase, "update">;

/**
 * Soft-deletes the live rows matching `where` by stamping `deleted_at`.
 * Rows already deleted are left untouched, so the stamp records the first
 * deletion, not the latest attempt.
 */
export async function softDeleteRows(
  executor: UpdateExecutor,
  table: SoftDeletable,
  where: SQL,
): Promise<void> {
  await executor
    .update(table)
    .set({ deletedAt: sql`now()` })
    .where(and(isNull(table.deletedAt), where));
}
