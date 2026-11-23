/**
 * Every SQL statement the FlowyTeam importer sends, by name
 * (docs/design/flowyteam-connect.md §2.1).
 *
 * The importer asks for a statement by name and never writes SQL. That lets the
 * same reads later go to FlowyTeam over HTTP, which runs only SQL it ships
 * itself. `contract/flowyteam-queries.json` is generated from this file, so a
 * changed statement shows up in a diff and the two sides can compare versions.
 *
 * Rules, enforced by `packages/core/test/flowyteam-queries.test.ts`:
 * - The company is the literal `:company`, never a positional value.
 * - Other values are positional `?`. A list is one `?` taking an array.
 * - Every variant of a dynamic statement is its own entry.
 */
import { createHash } from "node:crypto";

export type FlowyteamQueryScope =
  /** Reads one company's rows, through `company_id = :company`. */
  | "company"
  /** Reads the structure of the database, no company data. */
  | "schema"
  /** An existence check by id across the whole source, selecting `id` only. */
  | "reference"
  /** Never offered over HTTP: it reads across companies. */
  | "mysql-only";

export interface FlowyteamQuery {
  readonly sql: string;
  readonly scope: FlowyteamQueryScope;
}

/**
 * Tables the importer does not read, counted for the report. A table with no
 * `company_id` of its own names the parent that ties a row to a company.
 */
export const FLOWYTEAM_UNREAD_TABLES = [
  { table: "employee_teams", through: { column: "team_id", parent: "teams" } },
  { table: "performance_settings" },
  { table: "objective_accesses" },
  { table: "objective_discussions" },
  { table: "keyresult_discussions" },
  {
    table: "keyresult_indicator",
    through: { column: "key_result_id", parent: "key_results" },
  },
  { table: "checkins" },
  { table: "key_result_files" },
  { table: "indicator_calculates" },
  { table: "task_boards" },
  { table: "task_category" },
  { table: "project_time_logs" },
  { table: "performance_records" },
  { table: "reward_settings" },
  { table: "scores" },
] as const;

export type FlowyteamUnreadTable =
  (typeof FLOWYTEAM_UNREAD_TABLES)[number]["table"];
type ThroughTable = Extract<
  (typeof FLOWYTEAM_UNREAD_TABLES)[number],
  { through: unknown }
>["table"];

/** The tables a dry run counts, in the order the summary reads best. */
export const FLOWYTEAM_SUMMARY_TABLES = [
  "teams",
  "employee_details",
  "performance_cycles",
  "objectives",
  "key_results",
  "indicators",
  "tasks",
] as const;

export type FlowyteamSummaryTable = (typeof FLOWYTEAM_SUMMARY_TABLES)[number];

const STATIC = {
  // Structure
  "schema.tables": q(
    "schema",
    "select table_name as TABLE_NAME from information_schema.tables where table_schema = ?",
  ),
  "schema.indicatorAccessesColumns": q(
    "schema",
    `select column_name as COLUMN_NAME
       from information_schema.columns
      where table_schema = ? and table_name = 'indicator_accesses'`,
  ),
  "schema.latestMigration": q(
    "schema",
    "select migration from migrations order by id desc limit 1",
  ),
  "schema.migrationCount": q("schema", "select count(*) as n from migrations"),
  "unread.columns": q(
    "schema",
    `select table_name as TABLE_NAME, column_name as COLUMN_NAME
       from information_schema.columns
      where table_schema = ? and table_name in (?)`,
  ),

  // Across companies
  "companies.list": q(
    "mysql-only",
    `select id, company_name, company_username, timezone, status
       from companies
      order by id
      limit ?`,
  ),
  "companies.count": q("mysql-only", "select count(*) as n from companies"),
  "companies.byId": q(
    "company",
    `select id, company_name, company_username, timezone, status
       from companies
      where id = :company`,
  ),

  // Existence by id, whatever company owns the row
  "kpis.ownerSpaceExists": q("reference", "select id from teams where id = ?"),
  "kpis.ownerMemberExists": q(
    "reference",
    "select id from employee_details where id = ?",
  ),

  // Organisation
  "organisation.users": q(
    "company",
    `select u.id, u.name, u.email, u.timezone, u.status,
            d.name as title
       from users u
       left join employee_details e
         on e.user_id = u.id and e.company_id = u.company_id and e.deleted_at is null
       left join designations d on d.id = e.designation_id
      where u.company_id = :company
      order by u.id`,
  ),
  "organisation.teams": q(
    "company",
    `select id, team_name, parent_id, leader_id, description
       from teams
      where company_id = :company and deleted_at is null
      order by id`,
  ),
  "organisation.otherDepartments": q(
    "company",
    `select o.user_id, o.team_id
       from other_departments o
       join teams t on t.id = o.team_id
      where t.company_id = :company and t.deleted_at is null
      order by o.id`,
  ),
  "organisation.cycles": q(
    "company",
    `select id, name, cycle_type, type, started_at, finished_at
       from performance_cycles
      where company_id = :company and deleted_at is null
      order by started_at, id`,
  ),
  "organisation.employeeUser": q(
    "company",
    "select user_id from employee_details where id = ? and company_id = :company and deleted_at is null",
  ),
  "organisation.employeeManager": q(
    "company",
    "select reports_to from employee_details where id = ? and company_id = :company and deleted_at is null",
  ),
  "organisation.teamLeader": q(
    "company",
    "select leader_id from teams where id = ? and company_id = :company and deleted_at is null",
  ),

  // Objectives
  "okrs.objectives": q(
    "company",
    `select id, model_id, model_type, leader_model_id, title, description,
            performance_cycle_id, started_at, finished_at, weight,
            result_percentage, objective_parent_id, key_result_parent_id
       from objectives
      where company_id = :company and deleted_at is null
      order by id`,
  ),
  "okrs.keyResults": q(
    "company",
    `select k.id, k.objective_id, k.title, k.description, k.unit_value,
            k.initial_value, k.target_value, k.current_value, k.weight,
            k.leader_model_id
       from key_results k
       join objectives o on o.id = k.objective_id
      where k.company_id = :company and k.deleted_at is null and o.deleted_at is null
      order by k.id`,
  ),
  "okrs.keyResultRecords": q(
    "company",
    `select r.id, r.key_results_id, r.history_value
       from key_result_records r
       join key_results k on k.id = r.key_results_id
      where r.company_id = :company and k.deleted_at is null
      order by r.created_at, r.id`,
  ),

  // Check-ins
  "checkIns.objectiveCheckIns": q(
    "company",
    `select c.id, c.objective_id, c.user_id, c.checkin_id, c.start_date,
            c.end_date, c.confidence, c.remarks, c.created_at
       from objective_checkins c
       join objectives o on o.id = c.objective_id
      where c.company_id = :company and o.deleted_at is null
      order by c.created_at, c.id`,
  ),
  "checkIns.keyResultsByCheckIn": q(
    "company",
    `select key_result_id, current_value, confidence, remarks
           from key_result_checkins
          where company_id = :company and checkin_id = ?`,
  ),
  "checkIns.keyResultsByPeriod": q(
    "company",
    `select k.key_result_id, k.current_value, k.confidence, k.remarks
           from key_result_checkins k
           join key_results r on r.id = k.key_result_id
          where k.company_id = :company and r.objective_id = ?
            and k.start_date = ? and k.end_date = ?`,
  ),
  "checkIns.reviews": q(
    "company",
    `select user_id, created_at from checkin_reviews
      where company_id = :company and checkin_id = ?
      order by created_at limit 1`,
  ),

  // KPIs
  "kpis.categories": q(
    "company",
    `select id, name from indicator_types
      where company_id = :company and deleted_at is null order by id`,
  ),
  "kpis.indicators": q(
    "company",
    `select id, indicator_type_id, title, description, occurance, direction,
            aggregate, unit_value, indicator_parent_id, target_value,
            model_id, model_type
       from indicators
      where company_id = :company and deleted_at is null
      order by id`,
  ),
  "kpis.formulas": q(
    "company",
    `select id, calculated_value from indicators
      where company_id = :company and deleted_at is null and calculated = 1
        and calculated_value is not null and calculated_value <> ''
      order by id`,
  ),
  "kpis.records": q(
    "company",
    `select r.id, r.indicator_id, r.period_key, r.current_value, r.target_value,
            r.remark, i.occurance, i.aggregate
       from indicator_records r
       join indicators i on i.id = r.indicator_id
      where r.company_id = :company and r.deleted_at is null and i.deleted_at is null
      order by r.period_key, r.id`,
  ),
  "kpis.recordPeriods": q(
    "company",
    `select distinct period_key from indicator_records
      where company_id = :company and deleted_at is null
        and indicator_id in (?)
      order by period_key`,
  ),
  "kpis.flaggedAccess": q(
    "company",
    `select distinct i.id
             from indicators i
             join indicator_accesses ia on ia.indicator_id = i.id
            where i.company_id = :company
              and i.deleted_at is null
              and ia.user_id is not null
            limit 1`,
  ),
  "kpiShares.indicatorOwner": q(
    "company",
    "select model_id, model_type from indicators where id = ? and company_id = :company",
  ),

  // Work
  "work.projects": q(
    "company",
    `select id, project_name, project_summary, project_admin, start_date,
            deadline, status
       from projects
      where company_id = :company and deleted_at is null
      order by id`,
  ),
  "work.projectAdminTeams": q(
    "company",
    `select e.department_id
       from employee_details e
      where e.company_id = :company and e.deleted_at is null
        and e.department_id is not null
        and (e.user_id = ? or e.user_id in (
          select pm.user_id from project_members pm where pm.project_id = ?
        ))
      order by case when e.user_id = ? then 0 else 1 end, e.id`,
  ),
  "work.tasks": q(
    "company",
    `select id, heading, description, due_date, user_id, project_id,
            key_results_id, status, board_column_id, dependent_task_id,
            recurring_task_id
       from tasks
      where company_id = :company and deleted_at is null
      order by id`,
  ),
  "work.boardColumns": q(
    "company",
    "select id, slug from taskboard_columns where company_id = :company",
  ),
  "work.subTasks": q(
    "company",
    `select s.id, s.task_id, s.title, s.status
       from sub_tasks s
       join tasks t on t.id = s.task_id
      where t.company_id = :company and t.deleted_at is null
      order by s.id`,
  ),
  "work.taskLinkCounts": q(
    "company",
    `select
       sum(case when dependent_task_id is not null then 1 else 0 end) as dependent,
       sum(case when recurring_task_id is not null then 1 else 0 end) as recurring
       from tasks where company_id = :company and deleted_at is null`,
  ),

  // Collaboration and files
  "collaboration.taskComments": q(
    "company",
    `select c.id, c.comment, c.user_id, c.task_id, c.parent_id,
            c.created_at, c.edited_at
       from task_comments c
       join tasks t on t.id = c.task_id
      where t.company_id = :company and t.deleted_at is null
      order by c.id`,
  ),
  "collaboration.taskAccesses": q(
    "company",
    `select task_id, user_id
       from tasks_accesses
      where company_id = :company
      order by task_id, user_id`,
  ),
  "files.taskFiles": q(
    "company",
    `select id, task_id, user_id, filename, hashname, size,
            google_url, dropbox_link, external_link, external_link_name
       from task_files
      where company_id = :company
      order by id`,
  ),
  "files.inlineImageComments": q(
    "company",
    `select c.id, c.comment
       from task_comments c
       join tasks t on t.id = c.task_id
      where t.company_id = :company and t.deleted_at is null
        and c.comment like '%data:%'
      order by c.id`,
  ),
} as const satisfies Record<string, FlowyteamQuery>;

/** KPI shares: one entry per deleted-row and ordering variant the reader sends. */
const sharesAccesses = (deleted: boolean, hasId: boolean): FlowyteamQuery =>
  q(
    "company",
    `select ia.*
       from indicator_accesses ia
       join indicators i on i.id = ia.indicator_id
      where i.company_id = :company
        and i.deleted_at is null
        ${deleted ? "and ia.deleted_at is null" : ""}
      order by ${hasId ? "ia.id" : "ia.indicator_id, ia.user_id"}`,
  );
const sharesFlagged = (deleted: boolean): FlowyteamQuery =>
  q(
    "company",
    `select i.id, i.title, count(distinct ia.user_id) as named_people
       from indicators i
       join indicator_accesses ia on ia.indicator_id = i.id
      where i.company_id = :company
        and i.deleted_at is null
        ${deleted ? "and ia.deleted_at is null" : ""}
        and ia.user_id is not null
      group by i.id, i.title
      order by i.id`,
  );

const SHARES = {
  "kpiShares.accessesLive": sharesAccesses(true, true),
  "kpiShares.accessesLiveNoId": sharesAccesses(true, false),
  "kpiShares.accessesAll": sharesAccesses(false, true),
  "kpiShares.accessesAllNoId": sharesAccesses(false, false),
  "kpiShares.flaggedLive": sharesFlagged(true),
  "kpiShares.flaggedAll": sharesFlagged(false),
} as const satisfies Record<string, FlowyteamQuery>;

function q(scope: FlowyteamQueryScope, sql: string): FlowyteamQuery {
  return { sql, scope };
}

/** Table names come from the constant lists above, so the quoting is safe. */
const tick = (name: string): string => `\`${name}\``;

function perTable<T extends string, S extends string>(
  tables: readonly T[],
  suffix: S,
  build: (table: T) => FlowyteamQuery,
): Record<`${T}${S}`, FlowyteamQuery> {
  return Object.fromEntries(
    tables.map((table) => [`${table}${suffix}`, build(table)]),
  ) as Record<`${T}${S}`, FlowyteamQuery>;
}

const unreadTables = FLOWYTEAM_UNREAD_TABLES.map((entry) => entry.table);
const throughEntries = FLOWYTEAM_UNREAD_TABLES.flatMap((entry) =>
  "through" in entry ? [entry] : [],
);

function prefixed<P extends string, T extends string>(
  prefix: P,
  record: Record<T, FlowyteamQuery>,
): Record<`${P}${T}`, FlowyteamQuery> {
  return Object.fromEntries(
    Object.entries<FlowyteamQuery>(record).map(([key, value]) => [
      `${prefix}${key}`,
      value,
    ]),
  ) as Record<`${P}${T}`, FlowyteamQuery>;
}

const COUNTS = {
  ...prefixed(
    "companyCounts.",
    perTable(FLOWYTEAM_SUMMARY_TABLES, "", (table) =>
      q(
        "company",
        `select count(*) as n from ${tick(table)} where company_id = :company`,
      ),
    ),
  ),
  ...prefixed(
    "unread.",
    perTable(unreadTables, ".company", (table) =>
      q(
        "company",
        `select count(*) as n from ${tick(table)} where company_id = :company`,
      ),
    ),
  ),
  ...prefixed(
    "unread.",
    perTable(
      throughEntries.map((entry) => entry.table) as ThroughTable[],
      ".through",
      (table) => {
        const entry = throughEntries.find((e) => e.table === table);
        if (!entry) {
          throw new Error(`${table} has no parent.`);
        }
        return q(
          "company",
          `select count(*) as n from ${tick(table)} t join ${tick(entry.through.parent)} p on p.id = t.${tick(entry.through.column)} where p.company_id = :company`,
        );
      },
    ),
  ),
  ...prefixed(
    "unread.",
    perTable(unreadTables, ".all", (table) =>
      q("mysql-only", `select count(*) as n from ${tick(table)}`),
    ),
  ),
};

export const FLOWYTEAM_QUERIES = {
  ...STATIC,
  ...SHARES,
  ...COUNTS,
} as const;

export type FlowyteamQueryName = keyof typeof FLOWYTEAM_QUERIES;

export interface FlowyteamQueryEntry extends FlowyteamQuery {
  readonly name: string;
}

export interface FlowyteamQueryCatalogue {
  /** SHA-256 hex of the canonical JSON of the sorted entries. */
  readonly version: string;
  readonly entries: readonly FlowyteamQueryEntry[];
}

/** The catalogue as data, sorted by name so the version does not depend on order. */
export function flowyteamQueryCatalogue(
  queries: Readonly<Record<string, FlowyteamQuery>> = FLOWYTEAM_QUERIES,
): FlowyteamQueryCatalogue {
  const entries = Object.entries(queries)
    .map(([name, query]) => ({ name, sql: query.sql, scope: query.scope }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const version = createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex");
  return { version, entries };
}
