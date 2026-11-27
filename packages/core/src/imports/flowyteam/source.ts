/**
 * What the FlowyTeam engine reads from (flowyteam-connect design, Q2).
 *
 * Declared here rather than beside the MySQL client so the engine can run in
 * the web application and the scheduler without `mysql2` in their graph. The
 * command line's MySQL source (`packages/importer/src/flowyteam/source.ts`)
 * implements it today; an HTTP source will implement it next (card C4). Either
 * way the engine sends only names from the catalogue in `queries.ts`, never SQL.
 */
import type { FlowyteamQueryName } from "./queries.ts";

/** What the connector hands the introspection and the mappers. */
export interface Source {
  /**
   * One named read from the catalogue. `values` fill the positional `?`, and
   * `company` fills `:company`, which an entry that has one refuses to run
   * without.
   */
  read<T = Record<string, unknown>>(
    name: FlowyteamQueryName,
    values?: readonly unknown[],
    company?: number | string,
  ): Promise<T[]>;
  /** The database name the URL selected, for the report. */
  readonly database: string;
  /** The address with any password removed, for the report and the log. */
  readonly describe: string;
  /**
   * False when the source cannot read across companies: FlowyTeam's export,
   * where a token holds one company and the `mysql-only` entries are refused.
   * Absent means true, which is the MySQL source.
   */
  readonly acrossCompanies?: boolean;
  close(): Promise<void>;
}

/** A refusal by the source itself, as opposed to something going wrong. */
export class SourceError extends Error {}
