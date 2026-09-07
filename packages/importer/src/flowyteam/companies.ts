/**
 * Which company, and only one (TECHNICAL-PLAN §7.2, P6-T02).
 *
 * **One FlowyTeam database holds many companies, and every business table
 * carries `company_id`.** A real instance this connector was written against
 * holds 8257 of them. There is no subdomain and no session switch: the tenant
 * is whichever company the signed-in user belongs to, applied by a global scope
 * in PHP. Nothing in the schema stops a query crossing companies, so the guard
 * has to live here.
 *
 * **`--company` is required and there is no default.** "The only company" is
 * not a thing a source can be trusted to be, and a run that guessed would load
 * somebody else's quarter into a workspace that then looks like it has an OKR
 * practice. A run without it is refused with the count and, when the source is
 * small enough to list, the companies themselves.
 *
 * **A workspace holds one company for good.** A second run against the same
 * workspace with a different company is refused by name, because the two would
 * share spaces, members and cycles and nothing afterwards could tell them
 * apart. The check reads what earlier runs recorded rather than a column added
 * for it: the company is in the run's own report.
 */
import type { Source } from "./source.ts";
import { SourceError } from "./source.ts";

export interface Company {
  readonly id: number;
  readonly name: string;
  readonly username: string | null;
  readonly timezone: string | null;
  readonly status: string | null;
}

/** How many companies get listed in a refusal before it stops being helpful. */
const LISTABLE = 20;

export async function listCompanies(
  source: Source,
  limit = LISTABLE,
): Promise<readonly Company[]> {
  const rows = await source.query<Record<string, unknown>>(
    `select id, company_name, company_username, timezone, status
       from companies
      order by id
      limit ?`,
    [limit],
  );
  return rows.map(toCompany);
}

export async function countCompanies(source: Source): Promise<number> {
  const rows = await source.query<{ n: number }>(
    "select count(*) as n from companies",
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * The one company this run imports, or a refusal that names the alternatives.
 *
 * A missing id and an unknown id are different refusals on purpose. The first
 * means somebody has not chosen yet and wants to see the list; the second means
 * they chose and were wrong, and repeating the whole list at them buries it.
 */
export async function requireCompany(
  source: Source,
  companyId: number | undefined,
): Promise<Company> {
  const total = await countCompanies(source);
  if (companyId === undefined) {
    const listed = await listCompanies(source);
    const lines = listed
      .map((company) => `  ${company.id}  ${company.name}`)
      .join("\n");
    throw new SourceError(
      total <= LISTABLE
        ? `--company is required. ${source.describe} holds ${total} ${total === 1 ? "company" : "companies"}:\n${lines}`
        : `--company is required. ${source.describe} holds ${total} companies, which is too many to list. The first ${LISTABLE} are:\n${lines}`,
    );
  }

  const rows = await source.query<Record<string, unknown>>(
    `select id, company_name, company_username, timezone, status
       from companies
      where id = ?`,
    [companyId],
  );
  const found = rows[0];
  if (!found) {
    throw new SourceError(
      `${source.describe} has no company ${companyId}. It holds ${total}; run without --company to see them.`,
    );
  }
  return toCompany(found);
}

/** What this company holds, per domain, for the summary a dry run prints. */
export interface CompanyCounts {
  readonly [table: string]: number;
}

/**
 * A count per table, for the tables this instance actually has.
 *
 * One statement per table rather than one big union: a missing table would take
 * the whole summary down with it, and the point of the summary is to say what
 * is there. A table that cannot be counted is left out and the report says so
 * through the domain list.
 */
export async function countFor(
  source: Source,
  companyId: number,
  tables: readonly string[],
): Promise<CompanyCounts> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
      // The names come from this file's own constants, never from input. The
      // check is here so that stays true after somebody adds a table.
      throw new SourceError(`"${table}" is not a table name.`);
    }
    const rows = await source.query<{ n: number }>(
      `select count(*) as n from \`${table}\` where company_id = ?`,
      [companyId],
    );
    counts[table] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

/** The tables a dry run counts, in the order the summary reads best. */
export const SUMMARY_TABLES = [
  "teams",
  "employee_details",
  "performance_cycles",
  "objectives",
  "key_results",
  "indicators",
  "tasks",
] as const;

function toCompany(row: Record<string, unknown>): Company {
  return {
    id: Number(row.id),
    name: String(row.company_name ?? "").trim() || `Company ${row.id}`,
    username: text(row.company_username),
    timezone: text(row.timezone),
    status: text(row.status),
  };
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
