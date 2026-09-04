/**
 * Has this row been imported before? (§7.1 step 4, P6-T01a.)
 *
 * **A read, and the importer's own.** Every read a *surface* makes goes through
 * the access-aware getter, which returns what the reader may see. This is not a
 * surface: it is a command-line tool running as an administrator, and its
 * question is whether a row with this legacy identity exists in the workspace
 * at all. Filtering it by what one member happens to reach would make a re-run
 * create a second copy of every row that member cannot see, which is the exact
 * failure idempotency exists to prevent. Row-level security is still the floor:
 * the lookup runs inside `withWorkspace`, so it cannot see another tenant.
 */

import {
  cycles,
  goals,
  initiatives,
  keyResults,
  kpiCategories,
  kpis,
  spaces,
  tasks,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { findLegacyRowInTx, type LegacyKey } from "./legacy.ts";
import type { LegacyTableName } from "./templates/index.ts";

const TABLES = {
  goals,
  keyResults,
  kpis,
  initiatives,
  tasks,
  spaces,
  cycles,
  workspaceMembers,
  kpiCategories,
} as const;

export async function findExisting(
  pool: Pool,
  workspaceId: string,
  table: LegacyTableName,
  key: LegacyKey,
): Promise<string | undefined> {
  const db = drizzle(pool) as NodePgDatabase<Record<string, never>>;
  return withWorkspace(db, workspaceId, async (tx) => {
    const row = await findLegacyRowInTx(tx, workspaceId, TABLES[table], key);
    return row?.id;
  });
}
