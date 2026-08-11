import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerDb } from "@openokr/test-support/db";
import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrate.ts";

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
  await wb.admin.query(`create database ${scratchDb}`);
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
