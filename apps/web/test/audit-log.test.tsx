import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TranslationsProvider } from "@openokr/ui";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { AuditRow } from "../app/admin/audit/actions.ts";
import type { LogState } from "../app/admin/audit/audit-log.tsx";

/**
 * The audit trail can be read on the screen, not only verified and exported
 * (completeness review L-19, screen S-36).
 *
 * The read behind the table, `audit.list`, is proved against a real database
 * in `packages/core` (`audit-admin.test.ts`): newest first, the four filters,
 * the cursor, the payload left out, and the refusal below `full`. What is
 * checked here is the screen: every state the table can be in, what one row
 * says about who acted and how, and that the list and the export share one
 * filter form.
 */

vi.mock("../app/admin/audit/actions.ts", () => ({
  browseAudit: vi.fn(),
  exportAudit: vi.fn(),
  verifyChain: vi.fn(),
}));

const { AuditLog } = await import("../app/admin/audit/audit-log.tsx");
const { AuditPanel } = await import("../app/admin/audit/audit-panel.tsx");

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const source = (path: string) => readFileSync(at(path), "utf8");

const MEMBERS = [
  { id: "00000000-0000-4000-8000-00000000000a", name: "Priya Raman" },
  { id: "00000000-0000-4000-8000-00000000000b", name: "OKR Coach" },
];

const row = (overrides: Partial<AuditRow>): AuditRow => ({
  id: "00000000-0000-4000-8000-000000000001",
  seq: 7,
  at: "2026-09-30T12:34:56.000Z",
  actorKind: "human",
  actorMemberId: MEMBERS[0]?.id ?? null,
  actorOperatorUserId: null,
  channel: null,
  action: "people.suspend",
  targetType: "workspace_member",
  targetId: "00000000-0000-4000-8000-0000000000ff",
  chained: true,
  ...overrides,
});

const ready = (rows: readonly AuditRow[], more = false): LogState => ({
  rows,
  more,
  busy: null,
  failure: null,
});

const inEnglish = (node: ReactNode) =>
  renderToStaticMarkup(
    <TranslationsProvider locale="en">{node}</TranslationsProvider>,
  );

const log = (
  state: LogState,
  options: { timeZone?: string; filtered?: boolean } = {},
) =>
  inEnglish(
    <AuditLog
      state={state}
      members={MEMBERS}
      timeZone={options.timeZone ?? "UTC"}
      filtered={options.filtered ?? false}
      onOlder={() => undefined}
      onRetry={() => undefined}
    />,
  );

describe("a page of rows", () => {
  test("is a table with a caption and a header for every column", () => {
    const html = log(ready([row({})]));
    expect(html).toContain('<table data-testid="audit-log"');
    expect(html).toContain(
      '<caption class="sr-only">The audit trail, newest first</caption>',
    );
    for (const header of ["When (UTC)", "Who", "Action", "Target", "Chain"]) {
      expect(html).toContain(`<th scope="col" class="py-1`);
      expect(html).toContain(`>${header}</th>`);
    }
    expect(html.match(/<th scope="col"/g)).toHaveLength(5);
  });

  test("says when, in the reader's own zone, which the header names", () => {
    const utc = log(ready([row({})]));
    expect(utc).toContain(
      '<time dateTime="2026-09-30T12:34:56.000Z">2026-09-30 12:34:56</time>',
    );

    const kl = log(ready([row({})]), { timeZone: "Asia/Kuala_Lumpur" });
    expect(kl).toContain(">When (Asia/Kuala_Lumpur)</th>");
    expect(kl).toContain(">2026-09-30 20:34:56</time>");
  });

  test("names who acted, and how, without the payload", () => {
    const html = log(
      ready([
        row({ id: "00000000-0000-4000-8000-000000000001" }),
        row({
          id: "00000000-0000-4000-8000-000000000002",
          actorKind: "agent",
          actorMemberId: MEMBERS[1]?.id ?? null,
          channel: "slack",
        }),
        row({
          id: "00000000-0000-4000-8000-000000000003",
          actorKind: "system",
          actorMemberId: null,
        }),
        row({
          id: "00000000-0000-4000-8000-000000000004",
          actorKind: "operator",
          actorMemberId: null,
          actorOperatorUserId: "operator-user",
          channel: "api",
        }),
        row({
          id: "00000000-0000-4000-8000-000000000005",
          actorMemberId: "00000000-0000-4000-8000-0000000000ee",
          channel: "mcp",
        }),
      ]),
    );

    expect(html).toContain("Priya Raman");
    expect(html).toContain("OKR Coach");
    expect(html).toContain(">Agent</span>");
    expect(html).toContain(">via Slack</span>");
    // A system principal's rows read as the instance acting, as the feed's do.
    expect(html).toContain(">OpenOKR</span>");
    expect(html).toContain(">System</span>");
    expect(html).toContain(">A cloud operator</span>");
    expect(html).toContain(">via the API</span>");
    // A member the directory no longer lists still acted.
    expect(html).toContain(">A former member</span>");
    expect(html).toContain(">via an external agent</span>");
    expect(html).toContain("people.suspend");
    expect(html).toContain("workspace_member");
  });

  test("says which rows have a position in the chain and which are waiting", () => {
    const html = log(
      ready([
        row({ id: "00000000-0000-4000-8000-000000000001", seq: 7 }),
        row({
          id: "00000000-0000-4000-8000-000000000002",
          seq: null,
          chained: false,
        }),
      ]),
    );
    expect(html).toContain("Position 7");
    expect(html).toContain("Waiting for a position");
  });

  test("offers older rows only when there are some", () => {
    expect(log(ready([row({})], true))).toContain("Show older rows");
    expect(log(ready([row({})], false))).not.toContain("Show older rows");
  });
});

describe("the other states", () => {
  test("empty says whether nothing happened or nothing matched", () => {
    expect(log(ready([]))).toContain("Nothing has been recorded yet.");
    expect(log(ready([]), { filtered: true })).toContain(
      "No rows match this filter.",
    );
  });

  test("loading draws a skeleton, then keeps stale rows on screen", () => {
    const first = log({ ...ready([]), busy: "replace" });
    expect(first).toContain('data-testid="audit-log-loading"');
    expect(first).toContain('aria-busy="true"');
    expect(first).not.toContain("Nothing has been recorded yet.");

    const again = log({ ...ready([row({})]), busy: "replace" });
    expect(again).toContain('aria-busy="true"');
    expect(again).toContain("Priya Raman");
    expect(again).toContain('role="status"');
    expect(again).toContain("Loading rows...");
  });

  test("an error says so, with a way to try again", () => {
    const html = log({
      ...ready([]),
      failure: { message: "The end of the range is before its start." },
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain(
      "The rows could not be loaded. The end of the range is before its start.",
    );
    expect(html).toContain("Try again");
    expect(html).not.toContain("Nothing has been recorded yet.");
  });

  test("a refusal says who may read it, and shows nothing else", () => {
    const html = log({ ...ready([row({})]), failure: "denied" });
    expect(html).toContain(
      "Only a workspace administrator can read the audit trail.",
    );
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Priya Raman");
  });
});

describe("the panel", () => {
  const panel = inEnglish(
    <AuditPanel
      members={MEMBERS}
      timeZone="UTC"
      initial={{ rows: [row({})], more: true }}
    />,
  );

  test("draws the first page it was handed, before anybody presses anything", () => {
    expect(panel).toContain('data-testid="audit-row"');
    expect(panel).toContain("Show older rows");
  });

  test("has one filter form, with the list and the file as its two buttons", () => {
    expect(panel.match(/<form/g)).toHaveLength(1);
    expect(panel).toContain('type="submit"');
    expect(panel).toContain("Show matching rows");
    expect(panel).toContain("Export as CSV");
    for (const name of [
      "from",
      "to",
      "action",
      "actorMemberId",
      "targetType",
    ]) {
      expect(panel).toContain(`name="${name}"`);
    }
  });

  test("filters by who from the directory, with anyone first", () => {
    const select = panel.slice(panel.indexOf('<select id="audit-actor"'));
    expect(select.indexOf(">Anyone</option>")).toBeLessThan(
      select.indexOf(">Priya Raman</option>"),
    );
    expect(select).toContain(`value="${MEMBERS[0]?.id}"`);
  });

  test("shows a refusal handed to it by the server", () => {
    const refused = inEnglish(
      <AuditPanel
        members={MEMBERS}
        timeZone="UTC"
        initial={{ denied: true }}
      />,
    );
    expect(refused).toContain('data-testid="audit-log-denied"');
  });
});

describe("the page", () => {
  const page = source("../app/admin/audit/page.tsx");
  const actions = source("../app/admin/audit/actions.ts");

  test("reads the first page through the registry, at full, before drawing", () => {
    expect(actions).toContain('"audit.list"');
    expect(page).toContain("level < ACCESS_LEVELS.full");
    expect(page.indexOf("level < ACCESS_LEVELS.full")).toBeLessThan(
      page.indexOf("browseAudit({})"),
    );
    // Suspended members still acted, and their rows still name them.
    expect(page).toContain(
      'callAction(context, "people.directory", { includeSuspended: true })',
    );
  });

  test("tells a refusal from a failure", () => {
    expect(actions).toMatch(
      /error instanceof OperationError && error\.code === "not_found"[\s\S]*?return \{ denied: true \}/,
    );
  });
});
