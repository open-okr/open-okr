import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerDb } from "@openokr/test-support/db";
import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DataChangeScript, runDataChanges } from "../src/data-change.ts";
import { registeredDataChanges } from "../src/data-changes/registry.ts";
import { requiredDataChanges, runMigrations } from "../src/migrate.ts";

/**
 * The forward-only migration runner. Editing or reordering an applied
 * migration is a hard error, never a silent re-run: shipped history is
 * immutable (EXECUTION-GUIDE §9) and reshaping data belongs to the
 * data-change runner, not to migrations.
 */

let dir: string;
let scratchDb: string;
let client: pg.Client;

const connectScratch = async (): Promise<pg.Client> => {
  const wb = await workerDb();
  const admin = wb.admin.options;
  const scratch = new pg.Client({
    host: admin.host,
    port: admin.port,
    user: admin.user,
    password: admin.password as string,
    database: scratchDb,
  });
  await scratch.connect();
  return scratch;
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "openokr-migrate-"));
  const wb = await workerDb();
  scratchDb = `${wb.databaseName}_migrate`;
  await wb.admin.query(`drop database if exists ${scratchDb} with (force)`);
  // Explicit UTF8, for the same reason as every other scratch database here:
  // a bare `create database` inherits the cluster's encoding, and a Windows
  // cluster is WIN1252. These fixtures are ASCII today, so this is the rule
  // holding rather than a failure being fixed.
  await wb.admin.query(
    `create database ${scratchDb} ` +
      `encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`,
  );
  client = await connectScratch();
});

afterEach(async () => {
  await client.end();
  await rm(dir, { recursive: true, force: true });
  const wb = await workerDb();
  await wb.admin.query(`drop database if exists ${scratchDb} with (force)`);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const write = (name: string, sql: string) => writeFile(join(dir, name), sql);

describe("runMigrations", () => {
  it("applies migrations in name order and records each one", async () => {
    await write("0002_second.sql", "create table two (id int primary key);");
    await write("0001_first.sql", "create table one (id int primary key);");

    const applied = await runMigrations(client, { dirs: [dir] });
    expect(applied).toEqual(["0001_first.sql", "0002_second.sql"]);

    const rows = await client.query(
      "select name from _migrations order by name",
    );
    expect(rows.rows.map((r) => r.name)).toEqual([
      "0001_first.sql",
      "0002_second.sql",
    ]);
  });

  it("is idempotent: a second run applies nothing", async () => {
    await write("0001_first.sql", "create table one (id int primary key);");
    await runMigrations(client, { dirs: [dir] });
    expect(await runMigrations(client, { dirs: [dir] })).toEqual([]);
  });

  it("refuses to run when an applied migration was edited", async () => {
    await write("0001_first.sql", "create table one (id int primary key);");
    await runMigrations(client, { dirs: [dir] });

    await write("0001_first.sql", "create table one (id bigint primary key);");
    await expect(runMigrations(client, { dirs: [dir] })).rejects.toThrow(
      /0001_first\.sql/,
    );
  });

  /**
   * The checksum answers "did anybody edit the SQL", and a carriage return is
   * not an edit. Hashing raw bytes made the answer depend on the platform that
   * checked the repository out, so adding `.gitattributes` on 2026-08-11 turned
   * every already-applied migration in an existing Windows working tree into
   * "was edited after it ran". The same would refuse an upgrade on any instance
   * deployed from a Windows checkout.
   */
  it("accepts a migration whose line endings changed but whose SQL did not", async () => {
    await write("0001_first.sql", "create table one (\r\n  id int\r\n);\r\n");
    await runMigrations(client, { dirs: [dir] });

    await write("0001_first.sql", "create table one (\n  id int\n);\n");
    expect(await runMigrations(client, { dirs: [dir] })).toEqual([]);
  });

  it("heals a ledger row the old runner wrote, once", async () => {
    const crlf = "create table one (\r\n  id int\r\n);\r\n";
    await write("0001_first.sql", crlf);
    await runMigrations(client, { dirs: [dir] });

    // What the pre-normalisation runner would have stored: the raw bytes. The
    // current runner never writes this, so the ledger has to be put back into
    // the old shape to prove it is still recognised.
    const legacy = createHash("sha256").update(crlf).digest("hex");
    await client.query("update _migrations set checksum = $1", [legacy]);

    await write("0001_first.sql", "create table one (\n  id int\n);\n");
    expect(await runMigrations(client, { dirs: [dir] })).toEqual([]);

    const healed = await client.query("select checksum from _migrations");
    expect(healed.rows[0]?.checksum).not.toBe(legacy);
    // Nothing legacy left to fall back on, and it still passes.
    expect(await runMigrations(client, { dirs: [dir] })).toEqual([]);
  });

  it("still refuses a real edit that also changed the line endings", async () => {
    await write("0001_first.sql", "create table one (\r\n  id int\r\n);\r\n");
    await runMigrations(client, { dirs: [dir] });

    await write("0001_first.sql", "create table one (\n  id bigint\n);\n");
    await expect(runMigrations(client, { dirs: [dir] })).rejects.toThrow(
      /was edited after it ran/,
    );
  });

  it("treats a trailing newline as no change either", async () => {
    await write("0001_first.sql", "create table one (id int);");
    await runMigrations(client, { dirs: [dir] });

    await write("0001_first.sql", "create table one (id int);\n");
    expect(await runMigrations(client, { dirs: [dir] })).toEqual([]);
  });

  it("refuses a new migration that sorts before an applied one", async () => {
    await write("0002_second.sql", "create table two (id int primary key);");
    await runMigrations(client, { dirs: [dir] });

    await write(
      "0001_late_arrival.sql",
      "create table late (id int primary key);",
    );
    await expect(runMigrations(client, { dirs: [dir] })).rejects.toThrow(
      /0001_late_arrival\.sql/,
    );
  });

  it("refuses when an applied migration file disappears", async () => {
    await write("0001_first.sql", "create table one (id int primary key);");
    await runMigrations(client, { dirs: [dir] });

    await rm(join(dir, "0001_first.sql"));
    await expect(runMigrations(client, { dirs: [dir] })).rejects.toThrow(
      /0001_first\.sql/,
    );
  });

  it("applies each migration atomically: a failure leaves nothing behind", async () => {
    await write(
      "0001_broken.sql",
      "create table half (id int primary key); create table half (id int primary key);",
    );
    await expect(runMigrations(client, { dirs: [dir] })).rejects.toThrow();

    const tables = await client.query(
      "select 1 from information_schema.tables where table_name = 'half'",
    );
    expect(tables.rowCount).toBe(0);
    const recorded = await client.query("select 1 from _migrations");
    expect(recorded.rowCount).toBe(0);
  });

  it("reads migrations from several directories as one ordered stream", async () => {
    const other = await mkdtemp(join(tmpdir(), "openokr-migrate-b-"));
    try {
      await write("0001_first.sql", "create table one (id int primary key);");
      await writeFile(
        join(other, "0002_second.sql"),
        "create table two (id int primary key);",
      );
      const applied = await runMigrations(client, { dirs: [dir, other] });
      expect(applied).toEqual(["0001_first.sql", "0002_second.sql"]);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});

/**
 * A migration that needs a backfill first (docs/design/short-ids.md, "The
 * 0.8.0 step", option A). The migration names the data change; the runner
 * runs it through the data-change runner, in its own batches, and only then
 * applies the migration. So schema and data still never share a statement,
 * and an instance that skipped the backfill is not stranded.
 */
describe("a migration that declares a data change it needs", () => {
  /** Fills `t.filled` two rows a batch, counting each batch it runs. */
  function fillScript(calls: { n: number }, fail = false): DataChangeScript {
    return {
      name: "0001_fill",
      summary: "Fills t.filled.",
      expects: [{ table: "t", column: "filled", dataType: "text" }],
      async runBatch(tx) {
        calls.n += 1;
        if (fail) {
          throw new Error("the batch broke");
        }
        const { rows } = await tx.query(
          `update t set filled = 'yes'
            where id in (select id from t where filled is null order by id limit 2)
            returning id`,
        );
        return { done: rows.length < 2, rowsChanged: rows.length };
      },
    };
  }

  const NEEDS_FILL =
    "-- Makes the column not null.\n" +
    "-- openokr:requires-data-change: 0001_fill\n" +
    "alter table t alter column filled set not null;\n";

  beforeEach(async () => {
    await write(
      "0001_table.sql",
      "create table t (id int primary key, filled text);\n" +
        "insert into t (id) select generate_series(1, 5);",
    );
  });

  it("reads the declaration, and only a line that is one", () => {
    expect(requiredDataChanges(NEEDS_FILL)).toEqual(["0001_fill"]);
    expect(
      requiredDataChanges(
        "-- openokr:requires-data-change: 0001_a\n" +
          "--   openokr:requires-data-change:   0002_b  \n" +
          "-- It says openokr:requires-data-change: 0003_c in prose.\n" +
          "select 1;",
      ),
    ).toEqual(["0001_a", "0002_b"]);
    expect(requiredDataChanges("select 1;")).toEqual([]);
  });

  it("runs the data change first, in its own batches, then applies the migration", async () => {
    await write("0002_not_null.sql", NEEDS_FILL);
    const calls = { n: 0 };
    const lines: string[] = [];

    const applied = await runMigrations(client, {
      dirs: [dir],
      dataChanges: [fillScript(calls)],
      log: (line) => lines.push(line),
    });

    expect(applied).toEqual(["0001_table.sql", "0002_not_null.sql"]);
    // Five rows, two a batch: three batches, each its own transaction.
    expect(calls.n).toBe(3);
    const empty = await client.query("select 1 from t where filled is null");
    expect(empty.rowCount).toBe(0);
    const ledger = await client.query(
      "select completed_at from _data_changes where name = '0001_fill'",
    );
    expect(ledger.rows[0]?.completed_at).not.toBeNull();
    // The start log names what held it, and how long that took.
    expect(lines.join("\n")).toMatch(
      /0002_not_null\.sql needs data change 0001_fill/,
    );
    expect(lines.join("\n")).toMatch(
      /0001_fill finished: 3 batch\(es\), 5 row\(s\) changed, in \d/,
    );
  });

  it("skips a data change the ledger records as complete, and says nothing", async () => {
    const calls = { n: 0 };
    await runMigrations(client, { dirs: [dir] });
    await runDataChanges(client, { scripts: [fillScript(calls)] });
    expect(calls.n).toBe(3);

    await write("0002_not_null.sql", NEEDS_FILL);
    const lines: string[] = [];
    const applied = await runMigrations(client, {
      dirs: [dir],
      dataChanges: [fillScript(calls)],
      log: (line) => lines.push(line),
    });

    expect(applied).toEqual(["0002_not_null.sql"]);
    expect(calls.n).toBe(3);
    expect(lines).toEqual([]);
  });

  it("refuses, before applying anything, a migration naming a data change the release does not carry", async () => {
    await write("0002_not_null.sql", NEEDS_FILL);
    await expect(
      runMigrations(client, { dirs: [dir], dataChanges: [] }),
    ).rejects.toThrow(
      /0002_not_null\.sql needs data change 0001_fill, which this release does not carry/,
    );

    // A fault in the release, so not even the migrations before it move.
    const recorded = await client.query("select name from _migrations");
    expect(recorded.rows).toEqual([]);
  });

  it("applies nothing of the migration when its data change fails, and keeps the data change's progress", async () => {
    await write("0002_not_null.sql", NEEDS_FILL);
    await expect(
      runMigrations(client, {
        dirs: [dir],
        dataChanges: [fillScript({ n: 0 }, true)],
      }),
    ).rejects.toThrow(
      /0002_not_null\.sql needs data change 0001_fill, which failed/,
    );

    const recorded = await client.query("select name from _migrations");
    expect(recorded.rows.map((row) => row.name)).toEqual(["0001_table.sql"]);
    const nullable = await client.query(
      "select is_nullable from information_schema.columns where table_name = 't' and column_name = 'filled'",
    );
    expect(nullable.rows[0]?.is_nullable).toBe("YES");

    // Starting again resumes and finishes, as the message says it will.
    const applied = await runMigrations(client, {
      dirs: [dir],
      dataChanges: [fillScript({ n: 0 })],
    });
    expect(applied).toEqual(["0002_not_null.sql"]);
  });

  it("names only data changes this release registers, in the migrations it ships", () => {
    const migrations = join(import.meta.dirname, "../migrations");
    const registered = new Set(
      registeredDataChanges(undefined).map((script) => script.name),
    );
    const declared = new Map<string, string[]>();
    for (const name of readdirSync(migrations).filter((file) =>
      file.endsWith(".sql"),
    )) {
      const needs = requiredDataChanges(
        readFileSync(join(migrations, name), "utf8"),
      );
      if (needs.length > 0) {
        declared.set(name, needs);
      }
      for (const need of needs) {
        expect(registered.has(need), `${name} needs ${need}`).toBe(true);
      }
    }
    // 0.8.0's not-null waits for 0.7.0's backfill (plan 0.8.0 C1).
    expect(declared.get("0165_short_ids_not_null.sql")).toEqual([
      "0034_short_ids",
    ]);
  });
});
