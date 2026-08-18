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

  const project = (process.env.OPENOKR_DB_PROJECT ?? "default").replace(
    /\W/g,
    "_",
  );
  const poolId = process.env.VITEST_POOL_ID ?? String(process.pid);
  const databaseName = `openokr_test_${project}_w${poolId}`;

  await withSuperuser("postgres", async (client) => {
    // Serialise cloning: concurrent CREATE DATABASE from one template fails.
    await client.query("select pg_advisory_lock($1)", [TEMPLATE_LOCK_KEY]);
    try {
      await client.query(
        `drop database if exists ${databaseName} with (force)`,
      );
      await client.query(
        `create database ${databaseName} template ${testDbEnv.templateDatabase} owner ${testDbEnv.ownerRole}`,
      );
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
