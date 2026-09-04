/**
 * A source id into a target id (TECHNICAL-PLAN §7.1 step 4, P6-T03a).
 *
 * **One resolver, built once and cached for the run.** An objective names a
 * champion, a reviewer, a cycle and a space, and a company has thousands of
 * them. Looking each one up as it comes would be four queries per objective
 * against a table whose answer never changes during a run, and it would leave
 * four places that each decide what to do when the answer is missing.
 *
 * **Missing is an answer, not an exception.** A source row can name an employee
 * who was deleted, a team that belongs to another company, or a cycle the
 * `--only` selection did not import. Every one of those is a row for the report
 * and a decision for the caller, so this returns undefined and the mapper says
 * what it means in that domain's own words.
 */
import { findExisting, type LegacyTableName } from "@openokr/core";
import type { Pool } from "pg";
import { LEGACY_TYPE, legacyIdFor, type SourceTable } from "../legacy.ts";

/** Which target table each source table's rows were written into. */
const TARGET_TABLE: Partial<Record<SourceTable, LegacyTableName>> = {
  users: "workspaceMembers",
  teams: "spaces",
  performance_cycles: "cycles",
  objectives: "goals",
  key_results: "keyResults",
  indicator_types: "kpiCategories",
  indicators: "kpis",
  projects: "initiatives",
  tasks: "tasks",
  sub_tasks: "checklistItems",
};

export interface Resolver {
  /** The target id for a source row, or undefined when nothing carries its key. */
  resolve(table: SourceTable, id: number | string): Promise<string | undefined>;
  /** Remembers a row this run just wrote, so the next lookup does not query. */
  remember(table: SourceTable, id: number | string, targetId: string): void;
  /**
   * Remembers a row a dry run *would* write (P6-T03b).
   *
   * Without this a dry run is useless past the first domain: an objective
   * names a champion, and in a dry run that member was never written, so every
   * objective would preview as "the champion did not import" and the preview
   * would predict a failure a real run does not have.
   *
   * The id it remembers is a sentinel that no row carries. Nothing writes in a
   * dry run, so it never reaches the database; if it ever did, it is not a
   * uuid and the write would be refused rather than corrupt something.
   */
  plan(table: SourceTable, id: number | string): void;
}

/** What a dry run resolves to. Deliberately not a uuid. */
const PLANNED = "planned-by-a-dry-run";

export function resolverFor(options: {
  readonly pool: Pool;
  readonly workspaceId: string;
}): Resolver {
  const cache = new Map<string, string | undefined>();

  return {
    async resolve(table, id) {
      const target = TARGET_TABLE[table];
      if (!target) {
        throw new Error(
          `Nothing imported from ${table} carries a legacy key, so a ${table} id cannot be resolved.`,
        );
      }
      const key = legacyIdFor(table, id);
      // A miss is cached too. A source that names a deleted employee on four
      // hundred objectives would otherwise ask four hundred times and get the
      // same nothing.
      if (cache.has(key)) {
        return cache.get(key);
      }
      const found = await findExisting(
        options.pool,
        options.workspaceId,
        target,
        { type: LEGACY_TYPE, id: key },
      );
      cache.set(key, found);
      return found;
    },
    remember(table, id, targetId) {
      cache.set(legacyIdFor(table, id), targetId);
    },
    plan(table, id) {
      cache.set(legacyIdFor(table, id), PLANNED);
    },
  };
}
