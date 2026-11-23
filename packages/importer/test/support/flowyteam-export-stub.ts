/**
 * A stand-in for FlowyTeam's export API (flowyteam-connect F5, F6), backed by
 * the seeded test MySQL, for the HTTP source's tests.
 *
 * It answers the way FlowyTeam's `OkrGoalExportController` and
 * `QueryRunner` do: the catalogue version checked first (409 with `expected`
 * and `got`), an unknown name 404, a `mysql-only` entry 403, `:company` bound
 * from the token, a `table_schema = ?` value replaced by its own database
 * name, `limit ? offset ?` appended to a statement with no `limit`, one row
 * more than a page to tell whether another exists, and a base64 cursor.
 *
 * **Values arrive as PHP's PDO would send them**, not as the importer's mysql2
 * session reads them: a BIGINT as a number, a JSON column as text, dates as
 * text, decimals as text. The column types use PDO's `native_type` names. So
 * the HTTP source's coercion is what makes the two agree, which is what the
 * parity test is for.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { flowyteamQueryCatalogue } from "@openokr/core";
import { testMysqlEnv } from "@openokr/test-support/db-env";
// openokr:allow-vendor-sdk: the test harness for the one pre-approved importer
// dependency, standing in for FlowyTeam's own database connection.
import mysql from "mysql2/promise";

interface StubToken {
  readonly companyId: number;
  revoked?: boolean;
}

export interface ExportStub {
  readonly baseUrl: string;
  readonly tokens: Map<string, StubToken>;
  /** The version FlowyTeam claims; the catalogue's own unless a test changes it. */
  version: string;
  /** Answers the next n query requests with this status instead. */
  failNext: { status: number; times: number } | null;
  /** Every query request, in order. */
  readonly requests: { name: string; cursor: string | null }[];
  readonly files: Map<number, Buffer>;
  close(): Promise<void>;
}

/** mysql2's type numbers by name, which are PDO's `native_type` names too. */
const TYPE_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(mysql.Types as unknown as Record<string, number>).map(
    ([name, id]) => [id, name],
  ),
);

export async function startExportStub(
  database: string,
  options: { readonly pageSize?: number } = {},
): Promise<ExportStub> {
  const pageSize = options.pageSize ?? 2000;
  const catalogue = flowyteamQueryCatalogue();
  const entries = new Map(catalogue.entries.map((e) => [e.name, e]));
  const connection = await mysql.createConnection({
    host: testMysqlEnv.host,
    port: testMysqlEnv.port,
    user: testMysqlEnv.user,
    password: testMysqlEnv.password,
    database,
    // What PDO hands json_encode: dates and decimals as text, integers as
    // numbers, JSON as its text.
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    jsonStrings: true,
  });

  const stub: ExportStub = {
    baseUrl: "",
    tokens: new Map(),
    version: catalogue.version,
    failNext: null,
    requests: [],
    files: new Map(),
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await connection.end();
    },
  };

  const answer = (
    res: import("node:http").ServerResponse,
    status: number,
    body: unknown,
  ) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        const bearer = /^Bearer (.+)$/.exec(
          req.headers.authorization ?? "",
        )?.[1];
        const token = bearer ? stub.tokens.get(bearer) : undefined;
        if (!token || token.revoked) {
          answer(res, 401, {
            error: "invalid_token",
            message: "The token is unknown, revoked, or not an export token.",
          });
          return;
        }
        const fileMatch = /^\/api\/export\/v1\/files\/(\d+)$/.exec(
          req.url ?? "",
        );
        if (req.method === "GET" && fileMatch) {
          const bytes = stub.files.get(Number(fileMatch[1]));
          if (!bytes) {
            answer(res, 404, { error: "file_not_stored", message: "" });
            return;
          }
          res.writeHead(200, {
            "content-type": "application/octet-stream",
            "content-length": String(bytes.byteLength),
          });
          res.end(bytes);
          return;
        }
        if (req.method !== "POST" || req.url !== "/api/export/v1/query") {
          answer(res, 404, { error: "not_found" });
          return;
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          version: string;
          name: string;
          values: unknown[];
          cursor: string | null;
        };
        stub.requests.push({ name: body.name, cursor: body.cursor });
        if (stub.failNext && stub.failNext.times > 0) {
          stub.failNext.times -= 1;
          answer(res, stub.failNext.status, { error: "busy" });
          return;
        }
        if (body.version !== stub.version) {
          answer(res, 409, {
            error: "version_mismatch",
            message: "FlowyTeam runs another catalogue version.",
            expected: stub.version,
            got: body.version,
          });
          return;
        }
        const entry = entries.get(body.name);
        if (!entry) {
          answer(res, 404, { error: "unknown_query" });
          return;
        }
        if (entry.scope === "mysql-only") {
          answer(res, 403, { error: "mysql_only" });
          return;
        }
        // `:company` from the token, a schema value from this side.
        const pieces = entry.sql
          .replaceAll(":company", String(token.companyId))
          .split("?");
        const values: unknown[] = [];
        for (let i = 0; i < pieces.length - 1; i += 1) {
          values.push(
            /table_schema\s*=\s*$/i.test(pieces[i] ?? "")
              ? database
              : body.values[i],
          );
        }
        let sql = pieces.join("?");
        const offset = body.cursor
          ? (
              JSON.parse(
                Buffer.from(body.cursor, "base64url").toString("utf8"),
              ) as { o: number }
            ).o
          : 0;
        const paged = !/\blimit\b/i.test(sql);
        if (paged) {
          sql += " limit ? offset ?";
          values.push(pageSize + 1, offset);
        }
        const [rawRows, fields] = await connection.query(sql, values);
        let rows = rawRows as Record<string, unknown>[];
        let columns = (fields as mysql.FieldPacket[]).map((field) => ({
          name: field.name,
          native_type: TYPE_NAMES.get(field.columnType ?? -1) ?? null,
        }));
        let next: string | null = null;
        if (paged && rows.length > pageSize) {
          rows = rows.slice(0, pageSize);
          next = Buffer.from(JSON.stringify({ o: offset + pageSize })).toString(
            "base64url",
          );
        }
        if (entry.scope === "reference") {
          rows = rows.map((row) => ({ id: row.id }));
          columns = columns.filter((column) => column.name === "id");
        }
        answer(res, 200, {
          version: stub.version,
          rows,
          columns,
          next_cursor: next,
        });
      })().catch((error: unknown) => {
        answer(res, 500, {
          error: "query_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  (stub as { baseUrl: string }).baseUrl = `http://127.0.0.1:${port}`;
  return stub;
}
