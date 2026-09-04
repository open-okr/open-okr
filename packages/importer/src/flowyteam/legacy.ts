/**
 * The legacy identifier map (TECHNICAL-PLAN §7.1 step 4, §7.2, P6-T02).
 *
 * **One place that decides what a FlowyTeam row is called in the target.** The
 * mappers in P6-T03 and P6-T04 write rows into eight different target tables
 * from twenty-odd source tables, and every one of them needs the same answer to
 * the same question: given this source row, what `legacy_id` does the target
 * row carry, so that running the import again finds it instead of creating a
 * second one. Spreading that answer across the mappers is how two of them come
 * to disagree and one entity imports twice.
 *
 * **The identifier is qualified by its source table, not bare.** FlowyTeam's
 * ids are per-table auto-increments, so objective 41 and indicator 41 are both
 * "41". The target's unique index is on `(workspace_id, legacy_type,
 * legacy_id)` and `goals` holds imported objectives while `kpis` holds imported
 * indicators, so a bare id would in fact be unique per table. It is qualified
 * anyway, for two reasons: `goals` holds both objectives and, at P6-T03, any
 * other source of a goal, and a report that says `objectives:41` is one a
 * person can look up in the source without being told which table to look in.
 *
 * **The company is not in the key, and that is deliberate.** A workspace holds
 * one company for good, which `guardCompany` enforces, so adding the company to
 * every identifier would say the same thing on every row and make each one
 * longer. The company is recorded once, on the run.
 */

/** Where an imported row came from. The value `import_runs.source` carries. */
export const LEGACY_TYPE = "flowyteam" as const;

/**
 * Source table to the target table its rows become.
 *
 * The mapping itself is TECHNICAL-PLAN §7.2's and this is the subset that
 * carries a legacy key: a source table whose rows become columns on something
 * else, or a pivot the target models as a binding, has no row of its own to
 * identify and is not here.
 */
export const LEGACY_TABLES = {
  teams: "spaces",
  users: "workspace_members",
  performance_cycles: "cycles",
  objectives: "goals",
  key_results: "key_results",
  key_result_records: "key_result_values",
  objective_checkins: "check_ins",
  indicator_types: "kpi_categories",
  indicators: "kpis",
  indicator_records: "kpi_records",
  task_boards: "initiatives",
  tasks: "tasks",
  sub_tasks: "checklist_items",
  task_comments: "comments",
  task_files: "attachments",
} as const;

export type SourceTable = keyof typeof LEGACY_TABLES;

/**
 * The `legacy_id` a row from this source table carries in the target.
 *
 * A source id of zero, an empty string or anything else falsy is refused rather
 * than turned into `"objectives:"`. FlowyTeam auto-increments start at one, so a
 * zero here means a column was read that does not hold what the caller thought.
 */
export function legacyIdFor(table: SourceTable, id: number | string): string {
  const text = String(id).trim();
  if (text === "" || text === "0") {
    throw new Error(
      `A ${table} row has no usable id ("${id}"), so it cannot be given a legacy identifier.`,
    );
  }
  return `${table}:${text}`;
}

/** The whole key, as every create action in the registry takes it. */
export function legacyKeyFor(
  table: SourceTable,
  id: number | string,
): { type: typeof LEGACY_TYPE; id: string } {
  return { type: LEGACY_TYPE, id: legacyIdFor(table, id) };
}

/**
 * The source table and id back out of a legacy identifier.
 *
 * The report names rows by their legacy identifier and somebody reading it has
 * to be able to go and look at the source row. Round-tripping is also what the
 * test asserts, because a format nothing parses is a format that can drift.
 */
export function parseLegacyId(
  legacyId: string,
): { table: string; id: string } | null {
  const at = legacyId.indexOf(":");
  if (at <= 0 || at === legacyId.length - 1) {
    return null;
  }
  return {
    table: legacyId.slice(0, at),
    id: legacyId.slice(at + 1),
  };
}
