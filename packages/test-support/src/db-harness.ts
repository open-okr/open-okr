/**
 * The database test harness every later task builds on (TECHNICAL-PLAN §10).
 *
 * Shape:
 *  - A global setup migrates one template database, once, guarded by an
 *    advisory lock and a content hash so concurrent projects and processes
 *    never race or rebuild needlessly.
 *  - Each Vitest worker clones the template into its own database. Cloning is
 *    a file-level copy in Postgres, far faster than re-running migrations.
 *  - Tests run as the application role, which cannot bypass row-level
 *    security. Superuser access stays in the harness for cloning, truncation
 *    and raw verification.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureRoles, grantAppPrivileges, runMigrations } from "@openokr/db";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { connectionOptions, testDbEnv } from "./db-env.ts";

export { connectionOptions, testDbEnv } from "./db-env.ts";

const MIGRATION_DIRS = [
  // Shipped migrations first, then the test fixtures on top.
  join(import.meta.dirname, "../../db/migrations"),
  join(import.meta.dirname, "../fixtures/db/migrations"),
];

/** One lock key for every process that might build the template. */
const TEMPLATE_LOCK_KEY = 761_803_1;

/**
 * The Vitest project's prefix, so `packages/core` and `packages/db` do not
 * share a worker database. Each config sets `OPENOKR_DB_PROJECT` through
 * `test.env`, which reaches the workers; the global setup does not see it,
 * which is why `sweepOrphans` does not use this.
 */
const projectName = (): string =>
  (process.env.OPENOKR_DB_PROJECT ?? "default").replace(/\W/g, "_");

/** True when no process with this id is running any more. */
const processIsGone = (pid: number): boolean => {
  try {
    // Signal 0 asks the question without sending anything.
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

/**
 * Drop the worker databases left behind by processes that are gone.
 *
 * Worker databases carry the owning process id in their name, so a run that is
 * killed, or that simply ends, leaves one per fork. This runs in the global
 * setup before any worker starts, so the steady state is one run's worth.
 *
 * **The pid in the name is what makes this safe.** An earlier version asked
 * `pg_stat_activity` whether anything was connected and dropped what was not.
 * That is a guess twice over: an idle connection left by a killed run makes a
 * dead database look alive, and a database can gain a connection between the
 * question and the answer. Asking the operating system whether the owning
 * process still exists is an exact answer, and a database whose owner is gone
 * cannot acquire a new one.
 *
 * **Not scoped by project, and deliberately.** The first version built the
 * pattern from `OPENOKR_DB_PROJECT`, which each Vitest config sets through
 * `test.env`. That reaches the workers and not the global setup, so the prefix
 * here resolved to `default` and the sweep dropped exactly one database per
 * run while sixty piled up behind it. Cross-project safety does not need the
 * prefix anyway: the pid does it, and it does it for every project at once.
 *
 * `with (force)` is correct *here* and was the defect elsewhere: the only
 * connections left on a dead process's database are its own orphans, and a
 * plain `drop database` waits for them indefinitely. One of those blocked for
 * over two minutes on the development machine, which is why this cannot be a
 * bare drop in a setup path.
 */
const WORKER_DATABASE = /^openokr_test_.+_w\d+(?:_p(\d+))?$/;

const sweepOrphans = async (client: pg.Client): Promise<void> => {
  const { rows } = await client.query<{ datname: string }>(
    // `_` is a single-character wildcard in LIKE, so this over-matches
    // slightly. That is fine and deliberate: the regex below is the precise
    // gate, and an escaped pattern here was silently matching nothing at all.
    "select datname from pg_database where datname like 'openokr%test%'",
  );

  for (const { datname } of rows) {
    // Only worker databases. The template and the PgBouncer spike database are
    // named without a `_w<slot>` segment and are not swept.
    const match = WORKER_DATABASE.exec(datname);
    if (!match) {
      continue;
    }
    // A name with no `_p` segment predates this scheme, so nothing running now
    // owns it either.
    const owner = match[1];
    if (owner && !processIsGone(Number(owner))) {
      continue;
    }
    // Bounded, so a database that somehow does hold a live connection costs
    // the setup a few seconds rather than the whole run.
    await client.query("set statement_timeout = 10000");
    await client
      .query(`drop database if exists ${datname} with (force)`)
      .catch(() => {
        // Left for the next run. A setup step must not fail the suite over
        // housekeeping.
      });
    await client.query("set statement_timeout = 0");
  }
};

const withSuperuser = async <T>(
  database: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> => {
  const client = new pg.Client(
    connectionOptions(database, testDbEnv.superuser),
  );
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach the test database at ${testDbEnv.host}:${testDbEnv.port}. ` +
        `Start it with: pnpm db:up`,
      { cause: error },
    );
  }
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

/** Hash of everything that shapes the template, so edits force a rebuild. */
const templateFingerprint = async (): Promise<string> => {
  const hash = createHash("sha256");
  for (const dir of MIGRATION_DIRS) {
    const files = (await readdir(dir).catch(() => [] as string[]))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      hash.update(file);
      hash.update(await readFile(join(dir, file), "utf8"));
    }
  }
  hash.update(
    JSON.stringify({
      owner: testDbEnv.ownerRole,
      app: testDbEnv.appRole,
      v: 1,
    }),
  );
  return hash.digest("hex");
};

const currentFingerprint = async (
  client: pg.Client,
): Promise<string | undefined> => {
  const result = await client.query<{ description: string | null }>(
    `select sd.description
       from pg_shdescription sd
       join pg_database d on d.oid = sd.objoid
      where d.datname = $1`,
    [testDbEnv.templateDatabase],
  );
  return result.rows[0]?.description ?? undefined;
};

/**
 * Builds (or reuses) the migrated template database. Vitest global setup:
 * referenced from each database-using project's `vitest.config.ts`.
 */
export default async function setupTemplateDatabase(): Promise<void> {
  const fingerprint = await templateFingerprint();

  await withSuperuser("postgres", async (client) => {
    await client.query("select pg_advisory_lock($1)", [TEMPLATE_LOCK_KEY]);
    try {
      await sweepOrphans(client);
      await ensureRoles(client, {
        ownerRole: testDbEnv.ownerRole,
        appRole: testDbEnv.appRole,
        password: testDbEnv.password,
      });

      if ((await currentFingerprint(client)) === fingerprint) {
        return;
      }

      await client.query(
        `drop database if exists ${testDbEnv.templateDatabase} with (force)`,
      );
      // Explicit UTF8: `template1`'s own encoding is whatever the cluster
      // happened to initialise with, which on at least one real Windows
      // Postgres install is WIN1252, not UTF8 — found when a CJK-content
      // test failed to insert against a real database for the first time.
      // `template0` carries no locale-specific data, so it accepts an
      // encoding different from its own without Postgres refusing the copy.
      await client.query(
        `create database ${testDbEnv.templateDatabase} owner ${testDbEnv.ownerRole} ` +
          `encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`,
      );

      // Migrations run as the owner role, exactly as production will, so an
      // accidental superuser-only assumption in a migration fails here.
      const owner = new pg.Client(
        connectionOptions(testDbEnv.templateDatabase, testDbEnv.ownerRole),
      );
      await owner.connect();
      try {
        await runMigrations(owner, { dirs: MIGRATION_DIRS });
        // The application role reads and writes data; it never owns tables and
        // never gets DDL. The privilege model lives in packages/db so the
        // tests and the first-run wizard grant exactly the same thing,
        // including the append-only exception on the audit table.
        await grantAppPrivileges(owner, { appRole: testDbEnv.appRole });
      } finally {
        await owner.end();
      }

      await client.query(
        `comment on database ${testDbEnv.templateDatabase} is '${fingerprint}'`,
      );

      // The fixed-name database the PgBouncer leak-demonstration test uses.
      // Same explicit UTF8 as the template above, and for the same reason: a
      // bare `create database` inherits the cluster's own encoding, so on a
      // Windows install this one came out WIN1252 while the template was UTF8.
      // The encoding is part of the existence check rather than assumed, so a
      // database left behind by an older run is rebuilt instead of reused.
      const existing = await client.query<{ encoding: string }>(
        "select pg_encoding_to_char(encoding) as encoding " +
          "from pg_database where datname = $1",
        [testDbEnv.spikeLeakDatabase],
      );
      if (existing.rows[0]?.encoding !== "UTF8") {
        await client.query(
          `drop database if exists ${testDbEnv.spikeLeakDatabase} with (force)`,
        );
        await client.query(
          `create database ${testDbEnv.spikeLeakDatabase} ` +
            `encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`,
        );
      }
    } finally {
      await client.query("select pg_advisory_unlock($1)", [TEMPLATE_LOCK_KEY]);
    }
  });
}

export interface WorkerDb {
  /** This worker's database name. */
  readonly databaseName: string;
  /** Superuser pool, for truncation and raw verification only. */
  readonly admin: pg.Pool;
  /** Application-role pool, direct to Postgres. What tests should use. */
  readonly appPool: pg.Pool;
  /** Drizzle over `appPool`. */
  readonly db: NodePgDatabase;
  /** Application-role pool routed through PgBouncer in transaction mode. */
  readonly pooledAppPool: pg.Pool;
  /** Drizzle over `pooledAppPool`, for the pooling spike suite. */
  readonly pooledDb: NodePgDatabase;
  /** Empties every table except migration bookkeeping. For end-to-end runs. */
  truncateAllTables(): Promise<void>;
  close(): Promise<void>;
}

let worker: WorkerDb | undefined;

/**
 * The calling worker's own clone of the template database, created on first
 * use. `OPENOKR_DB_PROJECT` (set per Vitest project) keeps names unique when
 * several projects run in one Vitest process pool.
 */
export const workerDb = async (): Promise<WorkerDb> => {
  if (worker) {
    return worker;
  }

  const project = projectName();
  // **The process id, not just the Vitest pool slot.**
  //
  // Vitest reuses slot numbers. It starts the replacement fork for slot N while
  // the outgoing one is still closing its pools, so a name built from the slot
  // alone meant the new fork ran `drop database ... with (force)` on the
  // database the old fork was still reading. `with (force)` terminates every
  // connection to it, so the outgoing fork's tests died with Postgres `57P01`,
  // or with `database ... does not exist` if they arrived a moment later. Two
  // full `packages/core` runs failed that way, 111 tests and then 123, with no
  // assertion failures among them, and a different set of files each time.
  //
  // The pid makes the name unique to one process, so nothing can drop a
  // database somebody else is using. The cost is a database per fork rather
  // than per slot, and `sweepOrphans` below is what stops them accumulating.
  const poolId = process.env.VITEST_POOL_ID ?? "0";
  const databaseName = `openokr_test_${project}_w${poolId}_p${process.pid}`;

  await withSuperuser("postgres", async (client) => {
    // Serialise cloning: concurrent CREATE DATABASE from one template fails.
    await client.query("select pg_advisory_lock($1)", [TEMPLATE_LOCK_KEY]);
    try {
      // **Created only when absent, and never dropped first.** Dropping was
      // the whole defect. Absent is the normal case, and present means this
      // same process already built it for an earlier test file: `close()`
      // clears the cached handle when a file ends, so the next file in the
      // same fork arrives here again. The name belongs to this process, so an
      // existing one is ours and safe to reuse; every suite truncates in its
      // own `beforeEach`, which is what isolates one file from the next.
      const { rows } = await client.query<{ one: number }>(
        "select 1 as one from pg_database where datname = $1",
        [databaseName],
      );
      if (rows.length === 0) {
        await client.query(
          `create database ${databaseName} template ${testDbEnv.templateDatabase} owner ${testDbEnv.ownerRole}`,
        );
      }
    } finally {
      await client.query("select pg_advisory_unlock($1)", [TEMPLATE_LOCK_KEY]);
    }
  });

  const admin = new pg.Pool({
    ...connectionOptions(databaseName, testDbEnv.superuser),
    max: 2,
  });
  const appPool = new pg.Pool({
    ...connectionOptions(databaseName, testDbEnv.appRole),
    max: 5,
  });
  const pooledAppPool = new pg.Pool({
    ...connectionOptions(
      databaseName,
      testDbEnv.appRole,
      testDbEnv.pgbouncerPort,
    ),
    max: 10,
  });

  worker = {
    databaseName,
    admin,
    appPool,
    db: drizzle(appPool),
    pooledAppPool,
    pooledDb: drizzle(pooledAppPool),
    async truncateAllTables() {
      const tables = await admin.query<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'`,
      );
      if (tables.rows.length === 0) {
        return;
      }
      const names = tables.rows.map((row) => `"${row.tablename}"`).join(", ");
      await admin.query(`truncate table ${names} restart identity cascade`);
    },
    async close() {
      await Promise.all([admin.end(), appPool.end(), pooledAppPool.end()]);
      worker = undefined;
    },
  };
  return worker;
};

/** Vitest setup-file hook: closes this worker's pools when its suite ends. */
export const closeWorkerDb = async (): Promise<void> => {
  await worker?.close();
};
