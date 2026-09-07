/**
 * The FlowyTeam source, opened read-only (TECHNICAL-PLAN §7.1 step 1, P6-T02).
 *
 * **Two layers, because they refuse different things.** The server refuses
 * writes: `SET SESSION TRANSACTION READ ONLY` makes every later transaction
 * read-only, and MySQL answers an insert, update, delete or DDL with error 1792
 * whatever the client thinks it is doing. That is the proof the acceptance
 * criterion asks for, and a test attempts a real write to get it.
 *
 * The client refuses the rest. A read-only transaction does not stop
 * `LOCK TABLES`, `FLUSH TABLES WITH READ LOCK` or `ANALYZE`, and §7's rule is
 * "never write to, lock or migrate a source", not "never write". So a statement
 * that is not one of the handful of reads this importer needs never leaves the
 * process. Neither layer is redundant: the first stops a write this code did
 * not intend, the second stops a lock the server would have allowed.
 *
 * **The connection is one, not a pool.** A pool hands out connections that each
 * need the session setting applied, and one forgotten hand-out is a writable
 * session. One connection is applied once, and an import reads sequentially in
 * dependency order anyway.
 */

// openokr:allow-vendor-sdk: the MySQL client is the one pre-approved importer
// dependency (CLAUDE.md, TECHNICAL-PLAN §1). It is here rather than behind a
// port in packages/adapters because it is not a runtime capability the product
// has: nothing but this importer ever opens a FlowyTeam database, and a port
// would be an abstraction over exactly one caller.
import mysql from "mysql2/promise";

/** What the connector hands the introspection and the mappers. */
export interface Source {
  /** One read. Refused before it is sent if it is not a read. */
  query<T = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<T[]>;
  /** The database name the URL selected, for the report. */
  readonly database: string;
  /** The address with any password removed, for the report and the log. */
  readonly describe: string;
  close(): Promise<void>;
}

/** A refusal by the source itself, as opposed to something going wrong. */
export class SourceError extends Error {}

/**
 * The statements this importer sends, and nothing else.
 *
 * Deliberately a list of verbs rather than a list of forbidden ones: a denial
 * list is a promise that nobody will ever invent a new way to write, and MySQL
 * has `REPLACE`, `LOAD DATA`, `HANDLER`, `DO` and a dozen more. An allow list is
 * a promise this code can keep.
 */
const READ_VERBS = ["select", "show", "describe", "desc", "explain", "with"];

/** MySQL's own refusal when a transaction is read-only. */
export const READ_ONLY_ERROR = "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION";

export interface OpenOptions {
  /** A `mysql://user:password@host:port/database` address. */
  readonly url: string;
  /** Seconds. A source that never answers should fail, not hang a migration. */
  readonly connectTimeoutMs?: number;
}

/**
 * The first layer on its own: a connection whose session is read-only.
 *
 * Exported because the two layers are proved separately, and the one the
 * acceptance criterion is about can only be proved by asking a real server to
 * perform a real write. A test opens this, sends an insert, and reads MySQL's
 * own refusal. Nothing in the importer calls it: `openSource` is what an import
 * uses, and it puts the allow list in front.
 */
export async function openReadOnlySession(
  options: OpenOptions,
): Promise<{ connection: mysql.Connection; address: Address }> {
  const address = parseUrl(options.url);

  let connection: mysql.Connection;
  try {
    connection = await mysql.createConnection({
      host: address.hostname,
      port: address.port,
      user: address.user,
      password: address.password,
      database: address.database,
      // A statement per call. Two statements in one string is how a read turns
      // into a write without the allow list above ever seeing the second one.
      multipleStatements: false,
      connectTimeout: options.connectTimeoutMs ?? 10_000,
      // Dates as text. A `DATE` read as a JavaScript Date is read in this
      // process's timezone, and a quarter that starts on the first would import
      // as starting on the last day of the month before.
      dateStrings: true,
      // Big identifiers as text rather than silently losing precision. Every
      // legacy key this importer keeps is a string in the target anyway.
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
  } catch (error) {
    throw new SourceError(
      `Could not open the FlowyTeam source at ${address.describe}: ${messageOf(error)}`,
    );
  }

  // The session setting, before a single statement of the import. Sent through
  // the driver rather than through `query` below, which would refuse it.
  await connection.query("SET SESSION TRANSACTION READ ONLY");
  return { connection, address };
}

export async function openSource(options: OpenOptions): Promise<Source> {
  const { connection, address } = await openReadOnlySession(options);

  return {
    database: address.database,
    describe: address.describe,
    async query<T>(sql: string, values?: readonly unknown[]): Promise<T[]> {
      assertRead(sql);
      const [rows] = await connection.query(sql, values ? [...values] : []);
      return rows as T[];
    },
    async close(): Promise<void> {
      await connection.end();
    },
  };
}

/** Refuses anything that is not one of the reads this importer sends. */
export function assertRead(sql: string): void {
  const first = sql.trim().replace(/^\(+/, "").split(/\s/, 1)[0] ?? "";
  if (!READ_VERBS.includes(first.toLowerCase())) {
    throw new SourceError(
      `The FlowyTeam source is opened read-only and this statement starts with "${first}". An importer reads: ${READ_VERBS.join(", ")}.`,
    );
  }
  if (sql.includes(";") && sql.trim().replace(/;\s*$/, "").includes(";")) {
    // One statement per call. A trailing semicolon is fine; a second statement
    // is the shape that smuggles a write past the verb above.
    throw new SourceError(
      "The FlowyTeam source takes one statement at a time.",
    );
  }
}

export interface Address {
  readonly hostname: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly describe: string;
}

/**
 * The address, or a refusal naming what is wrong with it.
 *
 * The database is required rather than defaulted. A FlowyTeam server holds more
 * than one, and an import that guessed which would be a quarter of the wrong
 * company's history.
 */
export function parseUrl(url: string): Address {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SourceError(
      `--source is a MySQL address, like mysql://user:password@host:3306/flowyteam. It says "${url}".`,
    );
  }
  if (parsed.protocol !== "mysql:") {
    throw new SourceError(
      `--source has to be a mysql:// address. It says "${parsed.protocol}//".`,
    );
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (database === "") {
    throw new SourceError(
      "--source has to name the database, as the path: mysql://user@host:3306/flowyteam.",
    );
  }
  const user = decodeURIComponent(parsed.username);
  return {
    hostname: parsed.hostname,
    port: parsed.port === "" ? 3306 : Number(parsed.port),
    user,
    password: decodeURIComponent(parsed.password),
    database,
    // The password never appears here, because this string goes in the report
    // and the report is written to a file somebody sends to somebody else.
    describe: `${user === "" ? "" : `${user}@`}${parsed.host}/${database}`,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "something went wrong";
}
