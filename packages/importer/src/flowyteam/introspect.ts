/**
 * What this source is, before anything is read from it (TECHNICAL-PLAN §7.1
 * step 1, P6-T02).
 *
 * **Two lists, not one.** A core table is one without which nothing imports:
 * no `objectives` means there is no OKR history here and the run is refused by
 * name. An expected table is one a domain needs, and its absence is a fact
 * about this instance rather than a fault: `flowy_prod`, a real older
 * FlowyTeam, has no `objective_discussions`, and refusing to import a company's
 * whole quarter because a discussion table is missing would be absurd. Absent
 * expected tables are recorded, and the mappers in P6-T03 and P6-T04 read that
 * record rather than each discovering it again.
 *
 * **The version comes from the `migrations` table, not from a guess.**
 * FlowyTeam is Laravel, so the applied migrations are rows with dated names.
 * The newest one is the honest answer to "which version is this", the count
 * tells two instances apart at a glance, and a source with no `migrations`
 * table is not a FlowyTeam instance and says so instead of failing later on a
 * missing column.
 */
import type { Source } from "./source.ts";
import { SourceError } from "./source.ts";

/**
 * Without these there is nothing to import.
 *
 * Deliberately short. Every table here is read by the connector itself or by
 * the first mapper, and a longer list would refuse instances that could have
 * imported most of their history.
 */
export const CORE_TABLES = [
  "migrations",
  "companies",
  "users",
  "teams",
  "employee_details",
  "performance_cycles",
  "objectives",
  "key_results",
] as const;

/**
 * Wanted by a domain, and absent on some real instances.
 *
 * Grouped by the domain that reads them, so the report says "the tasks domain
 * cannot import: sub_tasks is missing" rather than listing table names a reader
 * has to map back to a feature themselves.
 */
export const EXPECTED_TABLES: Readonly<Record<string, readonly string[]>> = {
  organisation: ["designations", "other_departments", "employee_teams"],
  rhythm: ["performance_settings"],
  kpis: [
    "indicator_types",
    "indicators",
    "indicator_records",
    "indicator_calculates",
    "indicator_accesses",
    "keyresult_indicator",
  ],
  okrs: [
    "key_result_records",
    "objective_checkins",
    "key_result_checkins",
    "checkins",
    "checkin_reviews",
    "objective_accesses",
    "objective_discussions",
    "keyresult_discussions",
    "key_result_files",
  ],
  work: [
    "projects",
    "project_members",
    "task_boards",
    "taskboard_columns",
    "task_category",
    "tasks",
    "sub_tasks",
    "tasks_accesses",
    "task_comments",
    "task_files",
  ],
  points: ["reward_settings", "scores", "performance_records"],
};

export interface SourceVersion {
  /** The newest applied migration's name, which is the version in practice. */
  readonly latestMigration: string;
  /** Its date prefix, `YYYY_MM_DD`, or null for a name that has none. */
  readonly appliedOn: string | null;
  readonly migrationCount: number;
}

export interface Introspection {
  readonly database: string;
  readonly tableCount: number;
  readonly version: SourceVersion;
  /** Domains whose tables are all present, and what each is missing. */
  readonly domains: Readonly<Record<string, readonly string[]>>;
  /** Every domain with nothing missing, for the summary line. */
  readonly completeDomains: readonly string[];
}

export async function introspect(source: Source): Promise<Introspection> {
  const rows = await source.query<{ TABLE_NAME: string }>(
    "select table_name as TABLE_NAME from information_schema.tables where table_schema = ?",
    [source.database],
  );
  const present = new Set(
    rows.map((row) => String(row.TABLE_NAME).toLowerCase()),
  );
  if (present.size === 0) {
    throw new SourceError(
      `The database "${source.database}" has no tables. Check the address names the FlowyTeam database and not the server's default.`,
    );
  }

  const missingCore = CORE_TABLES.filter((table) => !present.has(table));
  if (missingCore.length > 0) {
    throw new SourceError(
      `This does not look like a FlowyTeam database: "${source.database}" has ${present.size} tables and none of them ${missingCore.length === 1 ? "is" : "are"} ${missingCore.join(", ")}.`,
    );
  }

  const domains: Record<string, readonly string[]> = {};
  for (const [domain, tables] of Object.entries(EXPECTED_TABLES)) {
    domains[domain] = tables.filter((table) => !present.has(table));
  }

  return {
    database: source.database,
    tableCount: present.size,
    version: await inferVersion(source),
    domains,
    completeDomains: Object.entries(domains)
      .filter(([, missing]) => missing.length === 0)
      .map(([domain]) => domain),
  };
}

/**
 * The version, from the migrations Laravel itself applied.
 *
 * Ordered by `id` rather than by the name, because a migration backported into
 * an older date prefix still ran last, and what this answers is "how far has
 * this instance been migrated", not "which file sorts highest".
 */
export async function inferVersion(source: Source): Promise<SourceVersion> {
  const rows = await source.query<{ migration: string }>(
    "select migration from migrations order by id desc limit 1",
  );
  const latest = rows[0]?.migration;
  if (!latest) {
    throw new SourceError(
      "The migrations table is empty, so there is no way to tell which FlowyTeam version this is.",
    );
  }
  const counted = await source.query<{ n: number }>(
    "select count(*) as n from migrations",
  );
  const date = /^(\d{4}_\d{2}_\d{2})_/.exec(latest);

  return {
    latestMigration: latest,
    appliedOn: date?.[1] ?? null,
    migrationCount: Number(counted[0]?.n ?? 0),
  };
}
