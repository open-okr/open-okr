/**
 * A stand-in for FlowyTeam (docs/design/flowyteam-connect.md §6), small
 * enough to live in the end-to-end suite: the consent page that approves at
 * once, the token and revoke endpoints, and the export endpoint answering the
 * catalogue by name from a few canned rows.
 *
 * **Canned, not backed by MySQL.** The importer's own stub
 * (`packages/importer/test/support/flowyteam-export-stub.ts`) answers from the
 * seeded test MySQL, which the browser suite does not have. This one answers
 * what one small company holds: two people, a KPI shown only to named people
 * (so the preview raises the restricted-KPI warning) and some time logs (so
 * "Not brought across" has a row). Every other statement answers no rows, and
 * the engine imports nothing for it.
 *
 * The instance reaches it at `FLOWYTEAM_STUB_PORT` on 127.0.0.1, which
 * `playwright.config.ts` hands the application server as its FlowyTeam
 * address. A private address is allowed off the managed cloud.
 */
import { createServer, type Server } from "node:http";

const FLOWYTEAM_STUB_PORT = Number(
  process.env.E2E_FLOWYTEAM_PORT ?? 3219,
);
export const STUB_COMPANY = { id: 7701, name: "Northwind Stub Co" };
const TOKEN = "stub-export-token";

/** Every table the engine looks for, so no domain is reported missing. */
const TABLES = [
  "migrations",
  "companies",
  "users",
  "teams",
  "employee_details",
  "performance_cycles",
  "objectives",
  "key_results",
  "designations",
  "other_departments",
  "indicator_types",
  "indicators",
  "indicator_records",
  "indicator_accesses",
  "key_result_records",
  "objective_checkins",
  "key_result_checkins",
  "checkin_reviews",
  "projects",
  "project_members",
  "taskboard_columns",
  "tasks",
  "sub_tasks",
  "tasks_accesses",
  "task_comments",
  "task_files",
  "project_time_logs",
];

export const STUB_PEOPLE = [
  { id: 1, name: "Rina Stub", email: "rina.stub@northwind.example" },
  { id: 2, name: "Budi Stub", email: "budi.stub@northwind.example" },
];

/** The rows one catalogue statement answers with. */
function stubRows(name: string): Record<string, unknown>[] {
  switch (name) {
    case "schema.tables":
      return TABLES.map((table) => ({ TABLE_NAME: table }));
    case "schema.latestMigration":
      return [{ migration: "2024_06_01_000000_stub" }];
    case "schema.migrationCount":
      return [{ n: 1 }];
    case "schema.indicatorAccessesColumns":
      return ["id", "indicator_id", "user_id", "deleted_at", "view_options"].map(
        (column) => ({ COLUMN_NAME: column }),
      );
    case "companies.byId":
      return [
        {
          id: STUB_COMPANY.id,
          company_name: STUB_COMPANY.name,
          company_username: "northwind-stub",
          timezone: "UTC",
          status: "active",
        },
      ];
    case "organisation.users":
      return STUB_PEOPLE.map((person) => ({
        ...person,
        timezone: "UTC",
        status: "active",
        title: null,
      }));
    case "companyCounts.employee_details":
      return [{ n: STUB_PEOPLE.length }];
    case "kpiShares.flaggedLive":
    case "kpiShares.flaggedAll":
      return [{ id: 501, title: "Gross margin per branch", named_people: 2 }];
    case "unread.columns":
      return [
        { TABLE_NAME: "project_time_logs", COLUMN_NAME: "id" },
        { TABLE_NAME: "project_time_logs", COLUMN_NAME: "company_id" },
      ];
    case "unread.project_time_logs.company":
      return [{ n: 12 }];
    default:
      if (name.startsWith("companyCounts.") || name.startsWith("unread.")) {
        return [{ n: 0 }];
      }
      return [];
  }
}

export interface FlowyteamStub {
  readonly baseUrl: string;
  /** Statement names asked for, in order. */
  readonly asked: string[];
  /** Answer every export request with 401, as a token revoked in FlowyTeam. */
  revoked: boolean;
  /** A catalogue version FlowyTeam claims; null accepts whatever is sent. */
  version: string | null;
  close(): Promise<void>;
}

export async function startFlowyteamStub(
  port = FLOWYTEAM_STUB_PORT,
): Promise<FlowyteamStub> {
  const stub: FlowyteamStub = {
    baseUrl: `http://127.0.0.1:${port}`,
    asked: [],
    revoked: false,
    version: null,
    close: async () => undefined,
  };

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", stub.baseUrl);
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      const json = (status: number, value: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };

      if (url.pathname === "/oauth/authorize") {
        // The company admin approves at once.
        const back = new URL(url.searchParams.get("redirect_uri") ?? "/");
        back.searchParams.set("code", "stub-code");
        back.searchParams.set("state", url.searchParams.get("state") ?? "");
        response.writeHead(302, { location: back.toString() });
        response.end();
        return;
      }
      if (url.pathname === "/oauth/token") {
        json(200, {
          access_token: TOKEN,
          token_type: "Bearer",
          scope: "flowyteam:export",
        });
        return;
      }
      if (url.pathname === "/oauth/revoke") {
        json(200, {});
        return;
      }
      if (url.pathname === "/api/export/v1/query") {
        if (
          stub.revoked ||
          request.headers.authorization !== `Bearer ${TOKEN}`
        ) {
          json(401, { error: "invalid_token" });
          return;
        }
        let parsed: { version?: string; name?: string } = {};
        try {
          parsed = JSON.parse(body) as typeof parsed;
        } catch {
          json(400, { error: "bad_request" });
          return;
        }
        if (stub.version !== null && parsed.version !== stub.version) {
          json(409, {
            error: "version_mismatch",
            expected: stub.version,
            got: parsed.version,
          });
          return;
        }
        const name = String(parsed.name ?? "");
        stub.asked.push(name);
        json(200, { rows: stubRows(name), columns: [], next_cursor: null });
        return;
      }
      json(404, { error: "not_found" });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  stub.close = () =>
    new Promise<void>((resolve) => server.close(() => resolve()));
  return stub;
}
