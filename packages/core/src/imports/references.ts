/**
 * Text into ids (P6-T01a).
 *
 * A spreadsheet names things the way people do: a space by its name, a person
 * by their email address, an objective by whatever identifier the old system
 * gave it. Every one of those has to become a uuid before an action will take
 * it, and the refusal when it cannot is the most common thing a first import
 * gets wrong, so each one names what it looked for and where.
 *
 * **Three ways to name a row, tried in this order.** Its id in this instance,
 * the identifier an earlier import gave it, then the natural key a person would
 * use. The order matters: a uuid is unambiguous, a legacy key belongs to the
 * file being imported, and a name is the one that can collide.
 *
 * **Every lookup is cached for the run.** A thousand tasks in one space would
 * otherwise be a thousand identical queries. The cache is per run and per
 * workspace and lives no longer, because an import is the one moment the
 * workspace is changing underneath the reader.
 */

import {
  activeOnly,
  cycles,
  goals,
  initiatives,
  keyResults,
  kpis,
  spaces,
  users,
  type WorkspaceTx,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, eq, or, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { findLegacyRowInTx, type LegacyTable } from "./legacy.ts";
import type { References } from "./templates/index.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReferenceHost {
  readonly pool: Pool;
  readonly workspaceId: string;
  /** Where an imported row's legacy identifiers come from. `csv` for this importer. */
  readonly legacyType: "csv" | "flowyteam";
}

/** The resolver a template gets, with the run's cache behind it. */
export function referencesFor(host: ReferenceHost): References {
  const db = drizzle(host.pool);
  const cache = new Map<string, string>();

  const lookup = async (
    kind: string,
    text: string,
    find: (tx: WorkspaceTx) => Promise<string | undefined>,
    describe: string,
  ): Promise<string> => {
    const wanted = text.trim();
    if (wanted === "") {
      throw new Error(`This row needs ${describe} and names none.`);
    }
    const key = `${kind}:${wanted.toLowerCase()}`;
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const found = await withWorkspace(
      db as NodePgDatabase<Record<string, never>>,
      host.workspaceId,
      (tx) => find(tx as WorkspaceTx),
    );
    if (!found) {
      throw new Error(`No ${describe} in this workspace matches "${wanted}".`);
    }
    cache.set(key, found);
    return found;
  };

  /**
   * A row by its id, then by the legacy key an earlier run gave it.
   *
   * The legacy branch is `findLegacyRowInTx` from core rather than a second
   * copy of the same three predicates: the create actions refuse a duplicate
   * key with that function, and a lookup that disagreed with it would find
   * nothing and create a row the action then refuses.
   */
  const byIdOrLegacy =
    (table: LegacyTable, wanted: string) =>
    async (tx: WorkspaceTx): Promise<string | undefined> => {
      if (UUID.test(wanted)) {
        const rows = (await tx
          .select({ id: table.id })
          .from(table)
          .where(
            activeOnly(
              table,
              eq(table.workspaceId, host.workspaceId),
              eq(table.id, wanted),
            ),
          )
          .limit(1)) as { id: string }[];
        return rows[0]?.id;
      }
      const row = await findLegacyRowInTx(tx, host.workspaceId, table, {
        type: host.legacyType,
        id: wanted,
      });
      return row?.id;
    };

  return {
    space: (text) =>
      lookup(
        "space",
        text,
        (tx) =>
          tx
            .select({ id: spaces.id })
            // openokr:allow-raw-read: the importer is not a surface. It runs
            // as an administrator at the command line and has to see every
            // space in the workspace: a name it could not reach would be a
            // row it creates a second copy of on the next run.
            .from(spaces)
            .where(
              activeOnly(
                spaces,
                eq(spaces.workspaceId, host.workspaceId),
                UUID.test(text.trim())
                  ? eq(spaces.id, text.trim())
                  : sql`lower(${spaces.name}) = lower(${text.trim()})`,
              ),
            )
            .limit(1)
            .then((rows) => rows[0]?.id),
        "space",
      ),

    member: (text) =>
      lookup(
        "member",
        text,
        (tx) => {
          const wanted = text.trim();
          if (UUID.test(wanted)) {
            return tx
              .select({ id: workspaceMembers.id })
              .from(workspaceMembers)
              .where(
                activeOnly(
                  workspaceMembers,
                  eq(workspaceMembers.workspaceId, host.workspaceId),
                  eq(workspaceMembers.id, wanted),
                  eq(workspaceMembers.status, "active"),
                ),
              )
              .limit(1)
              .then((rows) => rows[0]?.id);
          }
          // The email address is on the global identity row and the name is on
          // the membership, so both are one join. A placeholder member has no
          // user row at all, which is why the name is a way in too.
          //
          // **And why `placeholder_email` is a third** (P6-T04d). A workspace
          // that has just imported a company is full of placeholders, and the
          // address each of them had in the source is on the membership rather
          // than on a user row that does not exist. A spreadsheet exported
          // from that same source names people by exactly that address, so
          // without this the two importers cannot name the same person and one
          // workspace holding both is unusable. Found by the mixed test: every
          // row of a goals file naming an imported champion was skipped with
          // "no member matches".
          return tx
            .select({ id: workspaceMembers.id })
            .from(workspaceMembers)
            .leftJoin(users, eq(users.id, workspaceMembers.userId))
            .where(
              activeOnly(
                workspaceMembers,
                eq(workspaceMembers.workspaceId, host.workspaceId),
                eq(workspaceMembers.status, "active"),
                or(
                  sql`lower(${users.email}) = lower(${wanted})`,
                  sql`lower(${workspaceMembers.placeholderEmail}) = lower(${wanted})`,
                  sql`lower(${workspaceMembers.name}) = lower(${wanted})`,
                ),
              ),
            )
            .limit(1)
            .then((rows) => rows[0]?.id);
        },
        "member, by email address or name",
      ),

    cycle: (text) =>
      lookup(
        "cycle",
        text,
        (tx) =>
          tx
            .select({ id: cycles.id })
            .from(cycles)
            .where(
              activeOnly(
                cycles,
                eq(cycles.workspaceId, host.workspaceId),
                UUID.test(text.trim())
                  ? eq(cycles.id, text.trim())
                  : sql`lower(${cycles.name}) = lower(${text.trim()})`,
              ),
            )
            .limit(1)
            .then((rows) => rows[0]?.id),
        "cycle",
      ),

    goal: (text) =>
      lookup("goal", text, byIdOrLegacy(goals, text.trim()), "objective"),
    keyResult: (text) =>
      lookup(
        "keyResult",
        text,
        byIdOrLegacy(keyResults, text.trim()),
        "key result",
      ),
    initiative: (text) =>
      lookup(
        "initiative",
        text,
        byIdOrLegacy(initiatives, text.trim()),
        "initiative",
      ),

    kpi: (text) =>
      lookup(
        "kpi",
        text,
        (tx) => {
          const wanted = text.trim();
          return tx
            .select({ id: kpis.id })
            .from(kpis)
            .where(
              activeOnly(
                kpis,
                eq(kpis.workspaceId, host.workspaceId),
                UUID.test(wanted)
                  ? eq(kpis.id, wanted)
                  : or(
                      and(
                        eq(kpis.legacyType, host.legacyType),
                        eq(kpis.legacyId, wanted),
                      ),
                      // The short id is what the KPI grid shows and what a
                      // person copies out of it.
                      sql`lower(${kpis.shortId}) = lower(${wanted})`,
                    ),
              ),
            )
            .limit(1)
            .then((rows) => rows[0]?.id);
        },
        "KPI, by identifier or short id",
      ),
  };
}
