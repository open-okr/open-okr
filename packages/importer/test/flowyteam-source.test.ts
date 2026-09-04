/**
 * The read-only session, against a real MySQL (P6-T02).
 *
 * The acceptance criterion is that the connector provably cannot write to the
 * source, and "provably" is the load-bearing word: this file asks a real MySQL
 * to perform a real insert through the connector and reads the server's own
 * refusal. Everything else here follows from that, and the same test proves the
 * database is genuinely writable by an administrator, so a passing run cannot be
 * a database that refuses everybody.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertRead,
  openReadOnlySession,
  openSource,
  parseUrl,
  READ_ONLY_ERROR,
  type Source,
  SourceError,
} from "../src/flowyteam/source.ts";
import {
  available,
  type SeededSource,
  SKIP_REASON,
  seedSource,
} from "./support/flowyteam-source.ts";

const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam source tests. ${SKIP_REASON}`);
}

describe.skipIf(!runnable)(
  "the read-only session, against a real MySQL",
  () => {
    let seeded: SeededSource;
    let source: Source;

    beforeAll(async () => {
      seeded = await seedSource("source");
      source = await openSource({ url: seeded.url });
    });

    afterAll(async () => {
      await source?.close();
      await seeded?.drop();
    });

    it("reads what is there", async () => {
      const rows = await source.query<{ n: number }>(
        "select count(*) as n from objectives",
      );
      expect(Number(rows[0]?.n)).toBe(3);
    });

    it("acceptance: the server itself refuses a write through this session", async () => {
      // The session on its own, with the allow list out of the way, because what
      // is under test here is MySQL's refusal and not this repository's guard.
      // `openSource` is this plus `assertRead`, so proving the session proves the
      // half the acceptance criterion is about.
      const { connection } = await openReadOnlySession({ url: seeded.url });
      try {
        const refused = await connection
          .query("insert into companies (id) values (998)")
          .then(() => null)
          .catch((error: unknown) => error);

        expect(
          refused,
          "MySQL accepted a write on a read-only session",
        ).not.toBe(null);
        expect((refused as { code?: string }).code).toBe(READ_ONLY_ERROR);

        // And it is the session, not the table: the server says so itself.
        const [state] = (await connection.query(
          "select @@session.transaction_read_only as ro",
        )) as [{ ro: number }[], unknown];
        expect(Number(state[0]?.ro)).toBe(1);
      } finally {
        await connection.end();
      }
    });

    it("and the database is writable by somebody who is not this session", async () => {
      // Otherwise the test above would pass against a database that refuses
      // everybody, which proves nothing about the session.
      await seeded.run(
        "insert into companies (id, company_name) values (99, 'X')",
      );
      const rows = await source.query<{ n: number }>(
        "select count(*) as n from companies where id = 99",
      );
      expect(Number(rows[0]?.n)).toBe(1);
    });

    it("refuses a lock, which a read-only transaction would have allowed", async () => {
      // The second layer earning its place: `LOCK TABLES` is not a write and
      // MySQL would have run it.
      await expect(source.query("lock tables objectives read")).rejects.toThrow(
        SourceError,
      );
    });
  },
);

describe("the statements this importer will send", () => {
  it("allows the reads it needs", () => {
    for (const sql of [
      "select 1",
      "SELECT id FROM objectives",
      "show tables",
      "describe objectives",
      "explain select 1",
      "with x as (select 1) select * from x",
      "(select 1)",
    ]) {
      expect(() => assertRead(sql)).not.toThrow();
    }
  });

  it("refuses everything else by name", () => {
    for (const sql of [
      "insert into companies (id) values (1)",
      "update companies set id = 1",
      "delete from companies",
      "drop table companies",
      "lock tables objectives read",
      "flush tables with read lock",
      "replace into companies (id) values (1)",
      "load data infile 'x' into table companies",
    ]) {
      expect(() => assertRead(sql), sql).toThrow(SourceError);
    }
  });

  it("refuses a second statement hiding behind a read", () => {
    expect(() => assertRead("select 1; drop table companies")).toThrow(
      /one statement at a time/,
    );
    // A trailing semicolon is not a second statement.
    expect(() => assertRead("select 1;")).not.toThrow();
  });
});

describe("the source address", () => {
  it("needs a mysql:// address that names a database", () => {
    expect(() => parseUrl("postgres://x@y/z")).toThrow(/mysql:\/\//);
    expect(() => parseUrl("mysql://root@localhost:3306")).toThrow(
      /name the database/,
    );
    expect(() => parseUrl("not a url")).toThrow(/MySQL address/);
  });

  it("defaults the port and keeps the password out of what it prints", () => {
    const address = parseUrl("mysql://root:hunter2@db.example:/flowyteam");
    expect(address.port).toBe(3306);
    expect(address.password).toBe("hunter2");
    expect(address.describe).toBe("root@db.example/flowyteam");
    expect(address.describe).not.toContain("hunter2");
  });
});
