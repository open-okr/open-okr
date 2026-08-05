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

const checksum = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

interface MigrationFile {
  readonly name: string;
  readonly path: string;
  readonly content: string;
  readonly checksum: string;
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
      files.push({ name: entry, path, content, checksum: checksum(content) });
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

    for (const [name, recorded] of applied) {
      const file = files.find((candidate) => candidate.name === name);
      if (!file) {
        throw new MigrationError(
          `Applied migration ${name} no longer exists on disk. ` +
            `Shipped migrations are forward-only and must never be deleted.`,
        );
      }
      if (file.checksum !== recorded) {
        throw new MigrationError(
          `Applied migration ${name} was edited after it ran. ` +
            `Shipped migrations are forward-only; add a new migration instead.`,
        );
      }
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
