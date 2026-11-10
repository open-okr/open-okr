/**
 * The forward-only migration runner.
 *
 * Shipped history is immutable (EXECUTION-GUIDE §9): an applied migration
 * that was edited, removed, or overtaken by a new file sorting before it is a
 * hard error, never a silent re-run. Data reshaping belongs to the separate
 * data-change runner (P2-T12), so migrations stay pure schema.
 *
 * **A migration may name a data change it needs first** (plan 0.8.0 C1,
 * docs/design/short-ids.md, "The 0.8.0 step", option A), with a line of its
 * own: `-- openokr:requires-data-change: 0034_short_ids`. Before applying it,
 * the runner asks the data-change ledger, and when that script is not
 * complete it runs it through the data-change runner, batched and resumable
 * as always, then applies the migration. The backfill still runs in its own
 * transactions, so schema and data never share a statement. Without this, a
 * migration that tightens a column refuses on an instance that skipped the
 * backfill, and on Compose the container that would run the backfill is the
 * one that refuses to start.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type DataChangeClient,
  type DataChangeScript,
  runDataChanges,
} from "./data-change.ts";
import { registeredDataChanges } from "./data-changes/registry.ts";

/** A dedicated connection (not a pool): migrations use transaction control. */
export interface MigrationClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface RunMigrationsOptions {
  /** Directories scanned for `*.sql`, merged into one name-ordered stream. */
  readonly dirs: readonly string[];
  /**
   * The data changes a migration may name as needed first. Every registered
   * script when omitted, without the root key: the one script that needs it
   * seals tokens, and no migration names it. A deployment's own migrator
   * passes the registry with its key, so a later migration may.
   */
  readonly dataChanges?: readonly DataChangeScript[];
  /** Where the runner says what it ran first, and how long that took. */
  readonly log?: (line: string) => void;
}

export class MigrationError extends Error {
  override readonly name = "MigrationError";
}

/** Serialises concurrent runners against the same database. */
const MIGRATION_LOCK_KEY = 761_803_2;

/**
 * Line endings, normalised away before hashing.
 *
 * The checksum exists to answer one question: has anybody edited the SQL of a
 * migration that already ran? A carriage return is not an edit. Hashing raw
 * bytes made the answer depend on which platform checked out the repository:
 * a Windows clone with `core.autocrlf` on writes CRLF, a Linux clone writes
 * LF, and the same file hashed differently in each. Adding `.gitattributes` on
 * 2026-08-11 flipped every file in an existing Windows working tree from CRLF
 * to LF and the runner then refused every migration it had itself applied,
 * with "was edited after it ran" against files nobody had touched.
 *
 * The consequence outside this repository is the one that matters: an instance
 * deployed from a Windows checkout records CRLF checksums, and its next upgrade
 * from an image built on Linux would refuse to migrate. Normalising here makes
 * the checksum describe the SQL rather than its encoding, which is what the
 * gate always meant.
 *
 * A trailing newline is normalised too, for the same reason and with the same
 * argument: whether a file ends in a newline is not a change to its SQL.
 */
const normalise = (content: string): string =>
  content.replaceAll("\r\n", "\n").replace(/\n+$/, "");

/** The checksum the runner records, so the shipped-migration gate agrees. */
export const checksum = (content: string): string =>
  createHash("sha256").update(normalise(content)).digest("hex");

/**
 * What the checksum used to be: the raw bytes, unnormalised.
 *
 * Kept so a database whose ledger was written by the old function is still
 * recognised. It is accepted **only** when the file's normalised content is
 * otherwise unchanged, so it can never wave through a real edit: the legacy
 * hash is computed from the file on disk right now, and it matches the recorded
 * value only if the bytes that produced that value are still there modulo line
 * endings. The stored value is then rewritten to the normalised one, so each
 * database heals itself once and never asks again.
 */
const legacyChecksums = (content: string): string[] => {
  const lf = content.replaceAll("\r\n", "\n");
  const crlf = lf.replaceAll("\n", "\r\n");
  return [
    createHash("sha256").update(content).digest("hex"),
    createHash("sha256").update(lf).digest("hex"),
    createHash("sha256").update(crlf).digest("hex"),
  ];
};

interface MigrationFile {
  readonly name: string;
  readonly path: string;
  readonly content: string;
  readonly checksum: string;
  /** Every hash an older runner could have recorded for this same SQL. */
  readonly legacyChecksums: readonly string[];
}

const loadFiles = async (dirs: readonly string[]): Promise<MigrationFile[]> => {
  const files: MigrationFile[] = [];
  for (const dir of dirs) {
    const entries = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [] as string[];
      }
      throw error;
    });
    for (const entry of entries) {
      if (!entry.endsWith(".sql")) {
        continue;
      }
      if (files.some((file) => file.name === entry)) {
        throw new MigrationError(
          `Duplicate migration name across directories: ${entry}`,
        );
      }
      const path = join(dir, entry);
      const content = await readFile(path, "utf8");
      files.push({
        name: entry,
        path,
        content,
        checksum: checksum(content),
        legacyChecksums: legacyChecksums(content),
      });
    }
  }
  return files.sort((a, b) => (a.name < b.name ? -1 : 1));
};

/** The declaration a migration makes, one name per line of its own. */
const REQUIRES_DATA_CHANGE =
  /^[ \t]*--[ \t]*openokr:requires-data-change:[ \t]*(\S+)[ \t]*$/gm;

/**
 * The data changes a migration names as needed before it, in the order
 * written. Only a comment line that is the declaration counts: the same
 * words inside a sentence are prose.
 */
export function requiredDataChanges(sql: string): string[] {
  return [...sql.replaceAll("\r\n", "\n").matchAll(REQUIRES_DATA_CHANGE)].map(
    (match) => match[1] as string,
  );
}

/** Whether the data-change ledger records this script as complete. */
async function dataChangeComplete(
  client: MigrationClient,
  name: string,
): Promise<boolean> {
  const { rows } = await client.query(
    "select to_regclass('_data_changes')::text as found",
  );
  if (!rows[0]?.found) {
    return false;
  }
  const ledger = await client.query(
    "select 1 from _data_changes where name = $1 and completed_at is not null",
    [name],
  );
  return ledger.rows.length > 0;
}

/**
 * Runs, through the data-change runner, each data change `file` names that
 * the ledger does not record as complete. Its batches commit on their own, so
 * a failure keeps their progress and the next start resumes it.
 */
async function runRequiredDataChanges(
  client: MigrationClient,
  file: MigrationFile,
  scripts: ReadonlyMap<string, DataChangeScript>,
  log: (line: string) => void,
): Promise<void> {
  for (const name of requiredDataChanges(file.content)) {
    if (await dataChangeComplete(client, name)) {
      continue;
    }
    // Present: `runMigrations` refused every missing name before anything ran.
    const script = scripts.get(name) as DataChangeScript;
    log(
      `${file.name} needs data change ${name} first, which has not run here. ` +
        `Running it now: ${script.summary}`,
    );
    const started = Date.now();
    try {
      const [outcome] = await runDataChanges(
        // The two runners declare the same `query` with different generics;
        // a pg client satisfies both.
        client as unknown as DataChangeClient,
        { scripts: [script] },
      );
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      log(
        `${name} finished: ${outcome?.batches ?? 0} batch(es), ` +
          `${outcome?.rowsChanged ?? 0} row(s) changed, in ${seconds}s.`,
      );
    } catch (error) {
      const reason =
        error instanceof Error
          ? ` ${error.message}${error.cause instanceof Error ? ` ${error.cause.message}` : ""}`
          : "";
      throw new MigrationError(
        `Migration ${file.name} needs data change ${name}, which failed. ` +
          `Nothing of ${file.name} was applied. The data change keeps the ` +
          `batches it finished, and the next start resumes it.${reason}`,
        { cause: error },
      );
    }
  }
}

/**
 * Applies every pending migration in name order, each in its own
 * transaction, and records it in `_migrations`. Returns the applied names.
 */
export async function runMigrations(
  client: MigrationClient,
  options: RunMigrationsOptions,
): Promise<string[]> {
  const files = await loadFiles(options.dirs);
  const scripts = new Map(
    (options.dataChanges ?? registeredDataChanges(undefined)).map((script) => [
      script.name,
      script,
    ]),
  );
  const log = options.log ?? (() => {});

  await client.query(`
    create table if not exists _migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);

  await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
  try {
    const { rows } = await client.query(
      "select name, checksum from _migrations order by name",
    );
    const applied = new Map(
      rows.map((row) => [row.name as string, row.checksum as string]),
    );

    /** Ledger rows written by the pre-normalisation runner, healed below. */
    const stale: string[] = [];

    for (const [name, recorded] of applied) {
      const file = files.find((candidate) => candidate.name === name);
      if (!file) {
        throw new MigrationError(
          `Applied migration ${name} no longer exists on disk. ` +
            `Shipped migrations are forward-only and must never be deleted.`,
        );
      }
      if (file.checksum === recorded) {
        continue;
      }
      if (file.legacyChecksums.includes(recorded)) {
        stale.push(name);
        continue;
      }
      throw new MigrationError(
        `Applied migration ${name} was edited after it ran. ` +
          `Shipped migrations are forward-only; add a new migration instead.`,
      );
    }

    // Rewritten before anything pending runs, so a failure part way through the
    // pending set still leaves the ledger consistent with the files on disk.
    // One statement per row rather than one for all of them: the count is the
    // number of migrations a project has, and this happens once per database.
    for (const name of stale) {
      const file = files.find((candidate) => candidate.name === name);
      await client.query(
        "update _migrations set checksum = $2 where name = $1",
        [name, (file as MigrationFile).checksum],
      );
    }

    const lastApplied = [...applied.keys()].sort().at(-1);
    const pending = files.filter((file) => !applied.has(file.name));
    const outOfOrder = pending.find(
      (file) => lastApplied !== undefined && file.name < lastApplied,
    );
    if (outOfOrder) {
      throw new MigrationError(
        `New migration ${outOfOrder.name} sorts before already applied ` +
          `${lastApplied}. Rename it so history stays forward-only.`,
      );
    }

    // A name the release does not carry is a fault in the release, so it is
    // refused before anything moves rather than half way through.
    for (const file of pending) {
      for (const name of requiredDataChanges(file.content)) {
        if (!scripts.has(name)) {
          throw new MigrationError(
            `Migration ${file.name} needs data change ${name}, which this ` +
              `release does not carry. Nothing was applied.`,
          );
        }
      }
    }

    const appliedNow: string[] = [];
    for (const file of pending) {
      await runRequiredDataChanges(client, file, scripts, log);
      await client.query("begin");
      try {
        await client.query(file.content);
        await client.query(
          "insert into _migrations (name, checksum) values ($1, $2)",
          [file.name, file.checksum],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        // The database's own sentence in the message, not only in the cause:
        // a migration that refuses on purpose (0144's guard) says what to do,
        // and an operator reads the first line of a failed boot.
        const reason = error instanceof Error ? ` ${error.message}` : "";
        throw new MigrationError(
          `Migration ${file.name} failed. Nothing was applied.${reason}`,
          {
            cause: error,
          },
        );
      }
      appliedNow.push(file.name);
    }
    return appliedNow;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
  }
}
