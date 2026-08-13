/**
 * The forward-only migration runner.
 *
 * Shipped history is immutable (EXECUTION-GUIDE §9): an applied migration
 * that was edited, removed, or overtaken by a new file sorting before it is a
 * hard error, never a silent re-run. Data reshaping belongs to the separate
 * data-change runner (P2-T12), so migrations stay pure schema.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

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

const checksum = (content: string): string =>
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

/**
 * Applies every pending migration in name order, each in its own
 * transaction, and records it in `_migrations`. Returns the applied names.
 */
export async function runMigrations(
  client: MigrationClient,
  options: RunMigrationsOptions,
): Promise<string[]> {
  const files = await loadFiles(options.dirs);

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

    const appliedNow: string[] = [];
    for (const file of pending) {
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
        throw new MigrationError(
          `Migration ${file.name} failed. Nothing was applied.`,
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
