/**
 * The legacy identity an imported row carries (TECHNICAL-PLAN §7.1 step 4,
 * P6-T01a).
 *
 * **Why a create action takes this at all.** §7.1 asks for deterministic
 * identifiers: an import upserts on `(workspace_id, legacy_type, legacy_id)`
 * so that running the same file twice writes the row once. Every importable
 * table has carried those two columns and a unique partial index since its own
 * migration, and until now nothing could write them, because the only way into
 * a table is a registry action and no action's input mentioned them.
 *
 * The alternative was a second write after the create, and the window between
 * the two is exactly where idempotency breaks: a run that dies in it leaves a
 * row with no legacy key, and the next run creates it again.
 *
 * **The importer still decides create versus update, not this module.** A
 * create with a key something already carries is refused rather than quietly
 * turned into an update: an action named `create` that sometimes updates is
 * worse than a refusal a caller can act on. The importer looks the key up
 * first and calls the update action itself.
 */

import type { WorkspaceTx } from "@openokr/db";
import { and, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { OperationError } from "../operations/errors.ts";

/** Where an imported row came from. The same two values as `import_runs.source`. */
export const LEGACY_SOURCES = ["csv", "flowyteam"] as const;

export const legacyKey = z.object({
  type: z.enum(LEGACY_SOURCES),
  /** The identifier the source system used. A spreadsheet row supplies its own. */
  id: z.string().trim().min(1).max(200),
});

export type LegacyKey = z.infer<typeof legacyKey>;

/** A table that can hold an imported row: it carries the two legacy columns. */
export type LegacyTable = PgTable & {
  id: AnyPgColumn;
  workspaceId: AnyPgColumn;
  legacyType: AnyPgColumn;
  legacyId: AnyPgColumn;
  deletedAt: AnyPgColumn;
};

/** The two columns to write, or nothing at all for a row created in the product. */
export function legacyColumns(
  key: LegacyKey | undefined,
): { legacyType: string; legacyId: string } | Record<string, never> {
  return key ? { legacyType: key.type, legacyId: key.id } : {};
}

/**
 * The live row in this workspace carrying that legacy key, if there is one.
 *
 * Deleted rows are excluded deliberately. A row somebody removed from the
 * product is not a row the next import should silently revive: it comes back as
 * a create, which is what the unique index allows, because the index is partial
 * on `legacy_id is not null` and not on `deleted_at`.
 */
export async function findLegacyRowInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: WorkspaceTx<TSchema>,
  workspaceId: string,
  table: LegacyTable,
  key: LegacyKey,
): Promise<{ readonly id: string } | undefined> {
  const [row] = await tx
    .select({ id: table.id })
    .from(table)
    // Not `activeOnly`: the scope is stated here with the same predicate and a
    // reason above, because this helper takes the table as a parameter and the
    // soft-delete lint reads call sites rather than following one.
    .where(
      and(
        isNull(table.deletedAt),
        eq(table.workspaceId, workspaceId),
        eq(table.legacyType, key.type),
        eq(table.legacyId, key.id),
      ),
    )
    .limit(1);
  return row as { readonly id: string } | undefined;
}

/**
 * Refuses a create whose legacy key is already taken, naming what to do next.
 *
 * The unique index would refuse it too, as a constraint violation the caller
 * reads as a fault. This is the same refusal as a sentence.
 */
export async function assertLegacyKeyFree<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: WorkspaceTx<TSchema>,
  workspaceId: string,
  table: LegacyTable,
  key: LegacyKey | undefined,
  what: string,
): Promise<void> {
  if (!key) {
    return;
  }
  const existing = await findLegacyRowInTx(tx, workspaceId, table, key);
  if (existing) {
    throw new OperationError(
      "forbidden",
      `Another ${what} in this workspace already carries the ${key.type} identifier "${key.id}". Update that one instead.`,
    );
  }
}
