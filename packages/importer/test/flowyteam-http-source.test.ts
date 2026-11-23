/**
 * The FlowyTeam export over HTTP (flowyteam-connect §4.3, card C4).
 *
 * The HTTP source has one job: hand the engine exactly what the MySQL source
 * hands it, so a preview in the browser says what `pnpm import:flowyteam`
 * says. These tests run both against the same seeded database, the HTTP one
 * through a stub of FlowyTeam's export API with a page of two rows, so every
 * list read crosses pages.
 */
import {
  coerceExportValue,
  createHttpFlowyteamFiles,
  createHttpFlowyteamSource,
  FlowyteamExportError,
} from "@openokr/adapters";
import {
  FLOWYTEAM_QUERIES,
  type FlowyteamQueryName,
  fetchedFileReader,
  flowyteamQueryCatalogue,
  isFound,
  provisionWorkspaceForUser,
  runFlowyteamEngine,
  type Source,
} from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openSource } from "../src/flowyteam/source.ts";
import {
  type ExportStub,
  startExportStub,
} from "./support/flowyteam-export-stub.ts";
import {
  available,
  SEEDED,
  type SeededSource,
  SKIP_REASON,
  seedSource,
} from "./support/flowyteam-source.ts";

const OWNER = "55555555-5555-4555-8555-555555555555";
const TOKEN = "export-token-first";
const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam HTTP source tests. ${SKIP_REASON}`);
}

const version = flowyteamQueryCatalogue().version;

describe("coercing an export value to what mysql2 returns", () => {
  it.each([
    [7, "LONGLONG", "7"],
    ["7", "LONGLONG", "7"],
    ["12", "LONG", 12],
    [3, "TINY", 3],
    ["1.5", "DOUBLE", 1.5],
    [2.25, "NEWDECIMAL", "2.25"],
    ["2.25", "NEWDECIMAL", "2.25"],
    ['{"a":1}', "JSON", { a: 1 }],
    ["2026-01-12", "DATE", "2026-01-12"],
    ["2026-01-12 09:00:00", "TIMESTAMP", "2026-01-12 09:00:00"],
    ["text", "VAR_STRING", "text"],
    [null, "LONG", null],
    [5, null, 5],
  ])("%j as %s is %j", (value, type, expected) => {
    expect(coerceExportValue(value, type)).toEqual(expected);
  });
});

describe.skipIf(!runnable)("the HTTP source against the seeded source", () => {
  let seeded: SeededSource;
  let mysqlSource: Source;
  let stub: ExportStub;
  let pool: Pool;
  let workspaceId: string;

  const httpSource = (token = TOKEN): Source =>
    createHttpFlowyteamSource({
      baseUrl: stub.baseUrl,
      accessToken: token,
      version,
      allowPrivate: true,
      backoffMs: 0,
    }) as Source;

  beforeAll(async () => {
    seeded = await seedSource("http");
    mysqlSource = await openSource({ url: seeded.url });
    stub = await startExportStub(seeded.database, { pageSize: 2 });
    stub.tokens.set(TOKEN, { companyId: SEEDED.first.id });
  });

  beforeEach(async () => {
    const wb = await workerDb();
    pool = wb.appPool;
    await wb.truncateAllTables();
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      [OWNER, "Import Owner", "http-owner@example.com"],
    );
    workspaceId = (
      await provisionWorkspaceForUser(wb.appPool, {
        id: OWNER,
        name: "Import Owner",
      })
    ).workspaceId;
    stub.version = version;
    stub.failNext = null;
    stub.requests.length = 0;
    const token = stub.tokens.get(TOKEN);
    if (token) token.revoked = false;
  });

  afterAll(async () => {
    await stub?.close();
    await mysqlSource?.close();
    await seeded?.drop();
    const wb = await workerDb();
    await wb.close();
  });

  it("reads every offered statement exactly as the MySQL source does", async () => {
    const http = httpSource();
    let compared = 0;
    for (const [name, query] of Object.entries(FLOWYTEAM_QUERIES)) {
      if (query.scope === "mysql-only") continue;
      // Only statements whose values are all the schema name, which FlowyTeam
      // fills itself; the rest take ids the engine reads first.
      const marks = query.sql.split("?").slice(0, -1);
      if (!marks.every((before) => /table_schema\s*=\s*$/i.test(before))) {
        continue;
      }
      const values = marks.map(() => seeded.database);
      const key = name as FlowyteamQueryName;
      const viaMysql = await mysqlSource
        .read(key, values, SEEDED.first.id)
        .catch(() => null);
      if (viaMysql === null) {
        // A table the seed leaves out, which the engine never asks for.
        continue;
      }
      const viaHttp = await http.read(key, values, SEEDED.first.id);
      expect(viaHttp, name).toEqual(
        query.scope === "reference"
          ? viaMysql.map((row) => ({ id: (row as { id: unknown }).id }))
          : viaMysql,
      );
      compared += 1;
    }
    expect(compared).toBeGreaterThan(30);
  });

  it("follows the cursor across pages and keeps the order", async () => {
    const rows = await httpSource().read<{ id: number }>(
      "okrs.objectives",
      [],
      SEEDED.first.id,
    );
    const ids = rows.map((row) => row.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids.length).toBeGreaterThan(4);
    const pages = stub.requests.filter((r) => r.name === "okrs.objectives");
    expect(pages.length).toBe(Math.ceil(ids.length / 2));
    expect(pages[0]?.cursor).toBeNull();
    expect(pages[1]?.cursor).toEqual(expect.any(String));
  });

  it("asks again after a 503 and gives up after three retries", async () => {
    stub.failNext = { status: 503, times: 3 };
    const rows = await httpSource().read("companies.byId", [], 7);
    expect(rows).toHaveLength(1);
    expect(stub.requests).toHaveLength(4);

    stub.failNext = { status: 429, times: 4 };
    await expect(
      httpSource().read("companies.byId", [], 7),
    ).rejects.toMatchObject({ failure: "unreachable" });
  });

  it("previews over HTTP exactly what the command line's dry run reports (AC 3)", async () => {
    const viaMysql = await runFlowyteamEngine({
      pool,
      workspaceId,
      userId: OWNER,
      companyId: SEEDED.first.id,
      source: mysqlSource,
    });
    const viaHttp = await runFlowyteamEngine({
      pool,
      workspaceId,
      userId: OWNER,
      companyId: SEEDED.first.id,
      source: httpSource(),
    });
    const { connectedTo: _a, database: _b, ...mysqlReport } = viaMysql.report;
    const { connectedTo: _c, database: _d, ...httpReport } = viaHttp.report;
    expect(httpReport).toEqual(mysqlReport);
  });

  it("writes nothing the second time over HTTP (AC 5)", async () => {
    const first = await runFlowyteamEngine({
      pool,
      workspaceId,
      userId: OWNER,
      companyId: SEEDED.first.id,
      source: httpSource(),
      write: true,
      acceptBroaderVisibility: true,
    });
    expect(first.report.written).toBeGreaterThan(0);
    const second = await runFlowyteamEngine({
      pool,
      workspaceId,
      userId: OWNER,
      companyId: SEEDED.first.id,
      source: httpSource(),
      write: true,
      acceptBroaderVisibility: true,
    });
    expect(second.report.written).toBe(0);
  });

  it("stops before writing on a catalogue version mismatch (AC 6)", async () => {
    stub.version = "f".repeat(64);
    const error = await runFlowyteamEngine({
      pool,
      workspaceId,
      userId: OWNER,
      companyId: SEEDED.first.id,
      source: httpSource(),
      write: true,
      acceptBroaderVisibility: true,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FlowyteamExportError);
    expect(error).toMatchObject({
      failure: "version_mismatch",
      expected: "f".repeat(64),
      got: version,
    });
    const wb = await workerDb();
    const runs = await wb.admin.query("select 1 from import_runs");
    const goals = await wb.admin.query("select 1 from goals");
    expect(runs.rowCount).toBe(0);
    expect(goals.rowCount).toBe(0);
  });

  it("says the access is gone when FlowyTeam revoked the token (AC 8)", async () => {
    const token = stub.tokens.get(TOKEN);
    if (token) token.revoked = true;
    await expect(
      httpSource().read("companies.byId", [], 7),
    ).rejects.toMatchObject({ failure: "unauthorised", status: 401 });
  });

  it("copies a file through the endpoint and reports one over the limit by name", async () => {
    stub.files.set(41, Buffer.from("hello"));
    stub.files.set(42, Buffer.alloc(2 * 1024 * 1024, 1));
    const reader = fetchedFileReader(
      createHttpFlowyteamFiles({
        baseUrl: stub.baseUrl,
        accessToken: TOKEN,
        maxBytes: 1024 * 1024,
        allowPrivate: true,
      }),
    );
    const small = await reader.find({
      id: 41,
      taskId: 1,
      filename: "notes.txt",
      hashname: "abc.txt",
    });
    expect(isFound(small) && small.bytes.toString()).toBe("hello");
    expect(isFound(small) && small.contentType).toBe("text/plain");
    const large = await reader.find({
      id: 42,
      taskId: 1,
      filename: "big.pdf",
      hashname: "def.pdf",
    });
    expect(isFound(large)).toBe(false);
    expect(!isFound(large) && large.reason).toMatch(/larger than the 1 MB/);
    const gone = await reader.find({
      id: 43,
      taskId: 1,
      filename: "gone.pdf",
      hashname: "x.pdf",
    });
    expect(!isFound(gone) && gone.reason).toMatch(/not stored on FlowyTeam/);
  });
});
