import { randomUUID } from "node:crypto";
import { grantAppPrivileges } from "@openokr/db";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { PgBossJobQueue } from "../src/drivers/jobs/pg-boss.ts";

/**
 * The scheduler runs as the restricted application role (completeness review
 * H-01, H-02).
 *
 * The end-to-end servers have always connected as the application role, and
 * every one of them logged "scheduler: could not start: permission denied for
 * database": pg-boss asked for `CREATE SCHEMA IF NOT EXISTS`, which Postgres
 * checks against CREATE on the database before it looks for the schema. So
 * no browser test had ever run with a live scheduler, and the Compose install
 * only worked because it ran as a superuser.
 *
 * Each case clones its own database from the migrated template. The shared
 * worker database is no good here: another suite starts pg-boss in it as the
 * superuser, and the objects that leaves behind are exactly what these cases
 * are about.
 */

const created: string[] = [];

const superuserClient = async (database: string): Promise<pg.Client> => {
  const client = new pg.Client(
    connectionOptions(database, testDbEnv.superuser),
  );
  await client.connect();
  return client;
};

const freshDatabase = async (): Promise<string> => {
  const name = `openokr_test_jobs_role_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = await superuserClient("postgres");
  try {
    await admin.query(
      `create database ${name} template ${testDbEnv.templateDatabase} owner ${testDbEnv.ownerRole}`,
    );
  } finally {
    await admin.end();
  }
  created.push(name);
  return name;
};

const urlFor = (database: string, role: string): string =>
  `postgres://${role}:${testDbEnv.password}` +
  `@${testDbEnv.host}:${testDbEnv.port}/${database}`;

const runOneJob = async (queue: PgBossJobQueue): Promise<unknown[]> => {
  const handled: unknown[] = [];
  await queue.work<{ n: number }>("restricted.role", async (payload) => {
    handled.push(payload);
  });
  await queue.enqueue("restricted.role", { n: 1 });
  const started = Date.now();
  while (handled.length === 0) {
    if (Date.now() - started > 20_000) {
      throw new Error("Timed out waiting for the job.");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return handled;
};

const ownersIn = async (database: string): Promise<string[]> => {
  const client = await superuserClient(database);
  try {
    const { rows } = await client.query<{ owner: string }>(
      `select distinct pg_get_userbyid(c.relowner) as owner
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'pgboss' and c.relkind in ('r', 'p')`,
    );
    return rows.map((row) => row.owner).sort();
  } finally {
    await client.end();
  }
};

afterAll(async () => {
  const admin = await superuserClient("postgres");
  try {
    for (const name of created) {
      await admin.query(`drop database if exists ${name} with (force)`);
    }
  } finally {
    await admin.end();
  }
});

describe("the job queue under the restricted application role", () => {
  it("is refused when it asks to create the schema, which is the defect", async () => {
    const database = await freshDatabase();
    const queue = new PgBossJobQueue({
      connectionString: urlFor(database, testDbEnv.appRole),
    });
    await expect(queue.start()).rejects.toThrow(/permission denied/);
    await queue.stop().catch(() => undefined);
  });

  it("installs into the schema migration 0099 created, and owns what it installs", async () => {
    const database = await freshDatabase();
    const queue = new PgBossJobQueue({
      connectionString: urlFor(database, testDbEnv.appRole),
      createSchema: false,
    });
    try {
      await queue.start();
      expect(await runOneJob(queue)).toEqual([{ n: 1 }]);
    } finally {
      await queue.stop();
    }
    expect(await ownersIn(database)).toEqual([testDbEnv.appRole]);
  });

  it("takes over an installation a superuser made, which is the upgrade", async () => {
    const database = await freshDatabase();

    // What an instance that ran as the Postgres image's superuser has.
    const before = new PgBossJobQueue({
      connectionString: urlFor(database, testDbEnv.superuser),
    });
    await before.start();
    await before.stop();
    expect(await ownersIn(database)).toEqual([testDbEnv.superuser]);

    // What the migrator does on the next boot, as the admin connection.
    const admin = await superuserClient(database);
    try {
      await grantAppPrivileges(admin, { appRole: testDbEnv.appRole });
    } finally {
      await admin.end();
    }
    expect(await ownersIn(database)).toEqual([testDbEnv.appRole]);

    const after = new PgBossJobQueue({
      connectionString: urlFor(database, testDbEnv.appRole),
      createSchema: false,
    });
    try {
      await after.start();
      expect(await runOneJob(after)).toEqual([{ n: 1 }]);
    } finally {
      await after.stop();
    }
  });
});
