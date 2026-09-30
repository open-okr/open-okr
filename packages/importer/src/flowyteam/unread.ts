/**
 * The source tables no domain reads, and how many rows each holds for the
 * company being imported (completeness review M-16).
 *
 * **Named, not skipped.** The connector used to check that these tables
 * existed and then read none of them and say nothing, which is the silent drop
 * CLAUDE.md forbids. Whether to import each one is a decision for a person, not
 * a default this code can pick, so until somebody makes it every run counts
 * them and the report names each one that holds rows. `docs/import/README.md`
 * lists them with a proposed home for each.
 *
 * **Counting is not importing.** A count reads one number per table and brings
 * nothing across. It goes through the same read-only source as every mapper,
 * so the allow list in `source.ts` sees every statement.
 *
 * **A count follows the company, even where the table does not.** Two of these
 * tables have no `company_id` on a real instance: a row of `employee_teams`
 * belongs to a company through its team, and a row of `keyresult_indicator`
 * through its key result. Those are counted through the parent. A table that
 * has lost the column a count needs is counted across the whole source and
 * marked so, because a total labelled as the whole source is honest and a
 * silence is not.
 *
 * **The list is checked against the code.** A test reads every `from` and
 * `join` the connector sends and fails when a table here is read somewhere, or
 * when a table a domain is said to want is read nowhere. Start reading one of
 * these and it has to come off this list in the same change.
 */
import type { Source } from "./source.ts";
import { SourceError } from "./source.ts";

export interface UnreadTable {
  readonly table: string;
  /**
   * The parent that ties a row to a company, for a table with no `company_id`
   * of its own. Absent means the table carries `company_id`.
   */
  readonly through?: { readonly column: string; readonly parent: string };
  /** What it holds and why it is not imported, in one plain sentence. */
  readonly holds: string;
}

/**
 * In the order the report names them: the organisation, the company's
 * settings, objectives, check-ins, KPIs, work and the points layer.
 */
export const UNREAD_TABLES: readonly UnreadTable[] = [
  {
    table: "employee_teams",
    through: { column: "team_id", parent: "teams" },
    holds:
      "A second, older list of who belongs to which team; space membership is filled from other_departments only, and whether this list adds anybody has not been decided.",
  },
  {
    table: "performance_settings",
    holds:
      "The company's OKR settings: terminology labels, colour thresholds, limits on objectives and key results, and who may edit what; not read, because the thresholds and limits are METHOD.md's to set and which of the rest to carry is a decision.",
  },
  {
    table: "objective_accesses",
    holds:
      "Who else may see or update each objective; not read yet, because turning these rows into access on the imported goal is an open decision.",
  },
  {
    table: "objective_discussions",
    holds:
      "Comment threads on objectives; not read yet, because only task comments are imported so far.",
  },
  {
    table: "keyresult_discussions",
    holds:
      "Comment threads on key results; not read yet, because only task comments are imported so far.",
  },
  {
    table: "keyresult_indicator",
    through: { column: "key_result_id", parent: "key_results" },
    holds:
      "Which KPIs each key result is linked to; not read yet, because a key result in this product reads one KPI and the source allows several.",
  },
  {
    table: "checkins",
    holds:
      "Each person's check-in session with a mood score and answers to the check-in questions; the objective and key result check-ins inside it import, and the mood and answers are not read because a check-in in this product has no place for either.",
  },
  {
    table: "key_result_files",
    holds:
      "Files attached to key result check-ins; not read yet, because only task files are copied so far.",
  },
  {
    table: "indicator_accesses",
    holds:
      "Who else may see or update each KPI; not read yet, because turning these rows into KPI shares is an open decision.",
  },
  {
    table: "indicator_calculates",
    holds:
      "Which KPIs each calculated KPI is worked out from; not read, because the KPI domain rebuilds the same links from each indicator's own formula.",
  },
  {
    table: "task_boards",
    holds:
      "The named boards tasks were organised on; each task still takes its status from its board column, and the board itself is not read because a board in this product is a view of a space, an initiative or a key result rather than something with a name.",
  },
  {
    table: "task_category",
    holds:
      "The category each task was filed under; not read, because a task in this product has no category or label to put it in.",
  },
  {
    table: "project_time_logs",
    holds:
      "Time logged against projects and tasks; not read, because time tracking is out of scope for this version.",
  },
  {
    table: "performance_records",
    holds:
      "The score FlowyTeam stored for each owner when a cycle closed; not read, because this product works out its own per-owner results when a cycle closes and never takes them from a source.",
  },
  {
    table: "reward_settings",
    holds:
      "How the company turned OKR, KPI and attendance results into points; not read, because the points layer is off by default and whether to build it is an open question.",
  },
  {
    table: "scores",
    holds:
      "The points each person, team or company was awarded; not read, because the points layer is off by default and whether to build it is an open question.",
  },
];

export interface UnreadCount {
  readonly table: string;
  readonly rows: number;
  /**
   * `company` when the count is this company's rows alone, `source` when the
   * table could not be tied to a company and every row in it was counted.
   */
  readonly scope: "company" | "source";
  readonly holds: string;
}

/**
 * Every unread table this instance has that holds rows for the company, with
 * the count. A table that is absent, or present and empty for this company, is
 * left out: there is nothing in it to lose.
 */
export async function countUnread(
  source: Source,
  companyId: number,
): Promise<readonly UnreadCount[]> {
  const columns = await columnsOf(source);
  const found: UnreadCount[] = [];

  for (const entry of UNREAD_TABLES) {
    const own = columns.get(entry.table);
    if (!own) {
      continue;
    }
    const { sql, values, scope } = countStatement(
      entry,
      own,
      columns,
      companyId,
    );
    const rows = await source.query<{ n: number | string }>(sql, values);
    const count = Number(rows[0]?.n ?? 0);
    if (count > 0) {
      found.push({
        table: entry.table,
        rows: count,
        scope,
        holds: entry.holds,
      });
    }
  }
  return found;
}

/**
 * The columns of every unread table and every parent a count goes through, in
 * one read. A table missing from the answer is missing from the instance.
 */
async function columnsOf(
  source: Source,
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const names = [
    ...new Set(
      UNREAD_TABLES.flatMap((entry) =>
        entry.through ? [entry.table, entry.through.parent] : [entry.table],
      ),
    ),
  ];
  const rows = await source.query<{ TABLE_NAME: string; COLUMN_NAME: string }>(
    `select table_name as TABLE_NAME, column_name as COLUMN_NAME
       from information_schema.columns
      where table_schema = ? and table_name in (${names.map(() => "?").join(", ")})`,
    [source.database, ...names],
  );

  const columns = new Map<string, Set<string>>();
  for (const row of rows) {
    const table = String(row.TABLE_NAME).toLowerCase();
    const set = columns.get(table) ?? new Set<string>();
    set.add(String(row.COLUMN_NAME).toLowerCase());
    columns.set(table, set);
  }
  return columns;
}

function countStatement(
  entry: UnreadTable,
  own: ReadonlySet<string>,
  columns: ReadonlyMap<string, ReadonlySet<string>>,
  companyId: number,
): { sql: string; values: readonly unknown[]; scope: UnreadCount["scope"] } {
  const table = quoted(entry.table);
  if (own.has("company_id")) {
    return {
      sql: `select count(*) as n from ${table} where company_id = ?`,
      values: [companyId],
      scope: "company",
    };
  }

  const through = entry.through;
  if (
    through &&
    own.has(through.column) &&
    columns.get(through.parent)?.has("company_id")
  ) {
    return {
      sql: `select count(*) as n from ${table} t join ${quoted(through.parent)} p on p.id = t.${quoted(through.column)} where p.company_id = ?`,
      values: [companyId],
      scope: "company",
    };
  }

  return {
    sql: `select count(*) as n from ${table}`,
    values: [],
    scope: "source",
  };
}

/**
 * A name from this file's own constants, quoted for MySQL.
 *
 * The names never come from input. The check is here so that stays true after
 * somebody adds a table, the same guard `countFor` keeps.
 */
function quoted(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new SourceError(`"${name}" is not a table or column name.`);
  }
  return `\`${name}\``;
}
