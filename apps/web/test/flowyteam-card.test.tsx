// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as core from "@openokr/core";
import { TranslationsProvider, translate } from "@openokr/ui";
import { CATALOGUES } from "@openokr/ui/catalogues";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FLOWYTEAM_REASON_KEYS,
  FLOWYTEAM_SOURCE_KEYS,
  withFlowyteamSource,
} from "../lib/flowyteam-messages.ts";

/**
 * The FlowyTeam card on Import (docs/design/flowyteam-connect.md §4.5, §7 AC
 * 4, 6, 8, 9, card C5).
 *
 * What a database cannot show: that every word the flow refuses with is said
 * from the catalogue, which step the runs put the card on, that the import
 * waits for the tick when the preview named restricted KPIs, and that the
 * invite step sends nothing until the admin presses Send.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const refresh = vi.fn();
const router = { refresh, push: () => undefined };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const previewFlowyteamAction = vi.fn();
const runFlowyteamAction = vi.fn();
const disconnectFlowyteamAction = vi.fn();
const inviteFlowyteamPeopleAction = vi.fn();
vi.mock("../app/admin/imports/flowyteam-actions.ts", () => ({
  previewFlowyteamAction: (only?: string[]) => previewFlowyteamAction(only),
  runFlowyteamAction: (accept: boolean, only?: string[]) =>
    runFlowyteamAction(accept, only),
  disconnectFlowyteamAction: () => disconnectFlowyteamAction(),
  inviteFlowyteamPeopleAction: (ids: string[]) =>
    inviteFlowyteamPeopleAction(ids),
}));

const { FlowyteamCard } = await import(
  "../app/admin/imports/flowyteam-card.tsx"
);
const { flowyteamCardView } = await import(
  "../app/admin/imports/flowyteam-view.ts"
);
type CardProps = Parameters<typeof FlowyteamCard>[0];
type Run = Parameters<typeof flowyteamCardView>[0][number];

const SOURCE = "OKRI.io";

const en = withFlowyteamSource(
  (key: string, values?: Record<string, string | number>) =>
    translate(CATALOGUES.en, key, values),
  SOURCE,
);

class SilentEventSource {
  addEventListener() {}
  close() {}
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const run = (over: Partial<Run>): Run => ({
  id: "run-1",
  source: "flowyteam",
  mode: "dry_run",
  status: "completed",
  via: "export",
  rowsWritten: 0,
  rowsSkipped: 0,
  report: {},
  startedAt: "2026-11-23T09:00:00.000Z",
  finishedAt: "2026-11-23T09:01:00.000Z",
  ...over,
});

const restrictedPreview = run({
  report: {
    reconciliation: [
      {
        domain: "members",
        read: 3,
        created: 3,
        matched: 0,
        combined: 0,
        recomputed: 0,
        skipped: [],
        flags: [],
      },
      {
        domain: "KPI shares",
        read: 1,
        created: 1,
        matched: 0,
        combined: 2,
        recomputed: 1,
        skipped: [{ source: "x", reason: "y" }],
        flags: [
          {
            source: "indicators:7",
            reason: "May become more visible: Gross margin",
          },
        ],
      },
    ],
    notes: ["A note from the engine."],
    unreadTables: [{ table: "time_logs", rows: 12, holds: "Time logs." }],
    notImported: [],
  },
});

function props(over: Partial<CardProps>): CardProps {
  return {
    available: true,
    backgroundWork: true,
    connection: {
      companyName: "PT Contoh",
      state: "connected",
      connectedAt: "2026-11-23T09:00:00.000Z",
    },
    view: flowyteamCardView([]),
    people: [],
    domains: [
      { key: "organisation", requires: [] },
      { key: "kpi-shares", requires: ["kpis"] },
    ],
    outcome: null,
    failureMessage: null,
    sourceName: SOURCE,
    ...over,
  };
}

function render(p: CardProps) {
  act(() =>
    root.render(
      <TranslationsProvider locale="en" catalogue={CATALOGUES.en}>
        <FlowyteamCard {...p} />
      </TranslationsProvider>,
    ),
  );
}

const byTestId = (id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe("the refusal words", () => {
  const core = (path: string) => at(`../../../packages/core/src/${path}`);
  const reasons = new Set<string>();
  for (const source of [
    core("actions/imports-flowyteam.ts"),
    core("imports/flowyteam/connection.ts"),
  ]) {
    for (const match of source.matchAll(/reason: "([a-z_]+)"/g)) {
      reasons.add(match[1] as string);
    }
  }
  for (const table of [
    /FLOWYTEAM_IMPORT_MESSAGES = \{([\s\S]*?)\} as const/,
    /FLOWYTEAM_FAILURE_MESSAGES:[\s\S]*?= \{([\s\S]*?)\};/,
    /FLOWYTEAM_STATE_MESSAGES:[\s\S]*?= \{([\s\S]*?)\};/,
  ]) {
    const body =
      (
        core("actions/imports-flowyteam.ts") +
        core("imports/flowyteam/connection.ts")
      ).match(table)?.[1] ?? "";
    for (const match of body.matchAll(/^\s+([a-z_]+):/gm)) {
      reasons.add(match[1] as string);
    }
  }

  it("lists exactly the catalogue keys that carry a {source} hole", () => {
    const withHole = Object.entries(CATALOGUES.en)
      .filter(([key]) => key.startsWith("admin.imports.flowyteam."))
      .filter(([, value]) => String(value).includes("{source}"))
      .map(([key]) => key)
      .sort();
    expect([...FLOWYTEAM_SOURCE_KEYS].sort()).toEqual(withHole);
  });

  it("finds the domain's reasons", () => {
    // Floored, so a regex that finds nothing fails rather than agreeing.
    expect(reasons.size).toBeGreaterThanOrEqual(18);
  });

  it("gives every reason the domain can refuse with a catalogue key", () => {
    const missing = [...reasons].filter((r) => !FLOWYTEAM_REASON_KEYS.has(r));
    expect(missing).toEqual([]);
  });

  it("names only keys the English catalogue has", () => {
    for (const key of FLOWYTEAM_REASON_KEYS.values()) {
      expect(CATALOGUES.en[key], key).toBeTypeOf("string");
    }
  });
});

describe("the step the runs put the card on", () => {
  it("is choose with no runs, and ignores spreadsheet and command-line runs", () => {
    expect(flowyteamCardView([]).phase.kind).toBe("choose");
    expect(
      flowyteamCardView([
        run({ source: "csv", via: null }),
        run({ via: "mysql", mode: "real" }),
      ]).phase.kind,
    ).toBe("choose");
  });

  it("follows a running preview, then the finished one", () => {
    expect(flowyteamCardView([run({ status: "running" })]).phase.kind).toBe(
      "previewing",
    );
    const view = flowyteamCardView([restrictedPreview]);
    expect(view.phase.kind).toBe("preview");
    if (view.phase.kind === "preview") {
      expect(view.phase.preview.toAdd).toBe(4);
      expect(view.phase.preview.restricted).toHaveLength(1);
      expect(view.phase.preview.combined).toBe(2);
    }
  });

  it("is linked after an import, and back on preview for Import new data", () => {
    const imported = run({
      id: "run-2",
      mode: "real",
      rowsWritten: 9,
      startedAt: "2026-11-23T10:00:00.000Z",
    });
    expect(flowyteamCardView([imported, restrictedPreview]).phase.kind).toBe(
      "linked",
    );
    const again = run({ id: "run-3", startedAt: "2026-11-23T11:00:00.000Z" });
    expect(flowyteamCardView([again, imported]).phase.kind).toBe("preview");
  });

  it("says a failed run's word and keeps the step", () => {
    const failed = run({
      id: "run-4",
      mode: "real",
      status: "failed",
      report: { failure: "version_mismatch" },
    });
    const view = flowyteamCardView([failed, restrictedPreview]);
    expect(view.failure).toBe("version_mismatch");
    expect(view.phase.kind).toBe("preview");
  });
});

describe("the card", () => {
  it("points at the command line when FlowyTeam is turned off", () => {
    render(props({ available: false, connection: null }));
    expect(container.textContent).toContain(
      en("admin.imports.flowyteam.unavailable"),
    );
    expect(container.textContent).toContain("pnpm import:flowyteam");
    expect(byTestId("flowyteam-connect")).toBeNull();
  });

  it("offers Connect as a POST to the connect route", () => {
    render(props({ connection: null }));
    const form = byTestId("flowyteam-connect")?.closest("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe(
      "/admin/imports/flowyteam/connect",
    );
  });

  it("connects with a same-origin fetch and moves the page itself", async () => {
    // `form-action 'self'` forbids a form post redirected to FlowyTeam.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ url: "https://flowyteam.com/oauth/authorize?x=1" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const assign = vi.fn();
    const location = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...location, assign },
    });
    try {
      render(props({ connection: null }));
      await act(async () => {
        byTestId("flowyteam-connect")?.click();
      });
      await act(async () => undefined);
      expect(fetchMock).toHaveBeenCalledWith(
        "/admin/imports/flowyteam/connect",
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          headers: { accept: "application/json" },
        }),
      );
      expect(assign).toHaveBeenCalledWith(
        "https://flowyteam.com/oauth/authorize?x=1",
      );
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: location,
      });
    }
  });

  it("offers Connect again when FlowyTeam revoked the access", () => {
    render(
      props({
        connection: {
          companyName: "PT Contoh",
          state: "revoked",
          connectedAt: "2026-11-23T09:00:00.000Z",
        },
      }),
    );
    expect(byTestId("flowyteam-revoked")).not.toBeNull();
    expect(byTestId("flowyteam-connect")?.textContent).toBe(
      en("admin.imports.flowyteam.connectAgain"),
    );
  });

  it("refuses to preview while background work is off", () => {
    render(props({ backgroundWork: false }));
    expect(byTestId("flowyteam-background-off")).not.toBeNull();
    expect(
      (byTestId("flowyteam-run-preview") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("holds the import until the restricted KPIs are accepted", async () => {
    runFlowyteamAction.mockResolvedValue({ ok: true, value: { runId: "r" } });
    render(props({ view: flowyteamCardView([restrictedPreview]) }));
    const importButton = byTestId("flowyteam-import") as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);
    await act(async () => {
      (byTestId("flowyteam-accept") as HTMLInputElement).click();
    });
    expect(importButton.disabled).toBe(false);
    await act(async () => importButton.click());
    expect(runFlowyteamAction).toHaveBeenCalledWith(true, undefined);
  });

  it("says a refusal in the reader's words", async () => {
    previewFlowyteamAction.mockResolvedValue({
      ok: false,
      reason: "version_mismatch",
      message: en("admin.imports.flowyteam.reason.versionMismatch"),
    });
    render(props({}));
    await act(async () => byTestId("flowyteam-run-preview")?.click());
    expect(byTestId("flowyteam-refusal")?.textContent).toBe(
      "OKRI.io needs an update before this import.",
    );
  });

  it("sends no invitation until Send, and Not now sends none", async () => {
    const imported = run({ mode: "real", rowsWritten: 5 });
    const people = [
      {
        memberId: "m1",
        name: "Rina",
        title: null,
        email: "rina@x.test",
        invited: false,
      },
      {
        memberId: "m2",
        name: "Budi",
        title: "Sales",
        email: "budi@x.test",
        invited: false,
      },
      {
        memberId: "m3",
        name: "Sari",
        title: null,
        email: "sari@x.test",
        invited: true,
      },
    ];
    render(props({ view: flowyteamCardView([imported]), people }));
    expect(byTestId("flowyteam-linked")).not.toBeNull();
    await act(async () => byTestId("flowyteam-open-invite")?.click());
    expect(byTestId("flowyteam-invite")).not.toBeNull();
    await act(async () => byTestId("flowyteam-invite-not-now")?.click());
    expect(byTestId("flowyteam-invite")).toBeNull();
    expect(inviteFlowyteamPeopleAction).not.toHaveBeenCalled();

    inviteFlowyteamPeopleAction.mockResolvedValue({
      ok: true,
      value: { sent: 2, failed: [] },
    });
    await act(async () => byTestId("flowyteam-open-invite")?.click());
    const send = byTestId("flowyteam-invite-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await act(async () =>
      (byTestId("flowyteam-invite-all") as HTMLInputElement).click(),
    );
    expect(send.textContent).toBe("Send 2 invitations");
    await act(async () => send.click());
    expect(inviteFlowyteamPeopleAction).toHaveBeenCalledWith(["m1", "m2"]);
    expect(byTestId("flowyteam-invite-result")?.textContent).toContain(
      en("admin.imports.flowyteam.inviteSent", { count: 2 }),
    );
  });
});

describe("the steps and the connection row", () => {
  it("marks the current step and says each step's state", () => {
    render(props({}));
    const current = container.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain(
      en("admin.imports.flowyteam.step.choose"),
    );
    expect(current?.textContent).toContain(
      en("admin.imports.flowyteam.stepCurrent"),
    );
    expect(byTestId("flowyteam-steps")?.textContent).toContain(
      en("admin.imports.flowyteam.stepCompleted"),
    );
    expect(byTestId("flowyteam-steps")?.textContent).toContain(
      en("admin.imports.flowyteam.stepOfTotal", {
        index: 2,
        total: 5,
        name: en("admin.imports.flowyteam.step.choose"),
      }),
    );
  });

  it("hides the steps in the linked state", () => {
    render(props({ view: flowyteamCardView([run({ mode: "real" })]) }));
    expect(byTestId("flowyteam-linked")).not.toBeNull();
    expect(byTestId("flowyteam-steps")).toBeNull();
  });

  it("says connected once, in the connection row", () => {
    render(
      props({
        outcome: {
          ok: true,
          message: en("admin.imports.flowyteam.reason.connected"),
        },
      }),
    );
    expect(byTestId("flowyteam-outcome")).toBeNull();
    expect(
      container.querySelectorAll('[data-testid="flowyteam-state"]'),
    ).toHaveLength(1);
    expect(byTestId("flowyteam-company")?.textContent).toBe(
      en("admin.imports.flowyteam.connectedTo", { company: "PT Contoh" }),
    );
  });

  it("says a revocation once, with no stale good news", () => {
    render(
      props({
        connection: {
          companyName: "PT Contoh",
          state: "revoked",
          connectedAt: "2026-11-23T09:00:00.000Z",
        },
        outcome: { ok: true, message: "OKRI.io is connected." },
        failureMessage: "OKRI.io did not accept this connection.",
      }),
    );
    expect(byTestId("flowyteam-outcome")).toBeNull();
    expect(byTestId("flowyteam-failure")).toBeNull();
    expect(byTestId("flowyteam-revoked")).not.toBeNull();
  });

  it("still says a refused connect", () => {
    render(
      props({
        connection: null,
        outcome: { ok: false, message: "The request was declined." },
      }),
    );
    expect(byTestId("flowyteam-outcome")?.textContent).toBe(
      "The request was declined.",
    );
  });

  it("names the preview's rows in words", () => {
    render(props({ view: flowyteamCardView([restrictedPreview]) }));
    const counts = byTestId("flowyteam-counts")?.textContent ?? "";
    expect(counts).toContain(en("admin.imports.flowyteam.row.members"));
    expect(counts).toContain(en("admin.imports.flowyteam.row.kpiShares"));
  });
});

describe("counts read as sentences", () => {
  it("says one KPI and one row in the singular", () => {
    render(props({ view: flowyteamCardView([restrictedPreview]) }));
    const restricted = byTestId("flowyteam-restricted")?.textContent ?? "";
    expect(restricted).toContain("1 KPI will be visible to more people");
    expect(restricted).toContain("Show the KPI");
    expect(restricted).toContain("I understand this KPI may become visible");
    expect(restricted).not.toContain("1 KPIs");
  });

  it("says two in the plural", () => {
    expect(en("admin.imports.flowyteam.restrictedTitle", { count: 2 })).toBe(
      "2 KPIs will be visible to more people",
    );
    expect(en("admin.imports.flowyteam.importRows", { count: 1 })).toBe(
      "Import 1 row",
    );
    expect(en("admin.imports.flowyteam.importRows", { count: 2 })).toBe(
      "Import 2 rows",
    );
    expect(en("admin.imports.flowyteam.sendInvitations", { count: 1 })).toBe(
      "Send 1 invitation",
    );
    expect(en("admin.imports.flowyteam.inviteSent", { count: 2 })).toBe(
      "2 invitations sent.",
    );
  });

  it("follows each language's own forms", () => {
    const ar = (key: string, count: number) =>
      translate(CATALOGUES.ar ?? {}, key, { count }, {}, "ar");
    expect(ar("admin.imports.flowyteam.importRows", 1)).toBe("استيراد صف واحد");
    expect(ar("admin.imports.flowyteam.importRows", 3)).toBe("استيراد 3 صفوف");
    const de = (count: number) =>
      translate(
        CATALOGUES.de ?? {},
        "admin.imports.flowyteam.sendInvitations",
        { count },
        {},
        "de",
      );
    expect(de(1)).toBe("1 Einladung senden");
    expect(de(2)).toBe("2 Einladungen senden");
  });
});

describe("the card's source", () => {
  it("draws every button at one size", () => {
    const source = at("../app/admin/imports/flowyteam-card.tsx");
    expect(source).not.toContain('size="sm"');
  });
});

describe("the invite step while the people are read", () => {
  it("says it is loading rather than that nobody came across", async () => {
    // Opened the way the stream opens it, by the end of an import.
    const listeners: Record<string, (event: MessageEvent) => void> = {};
    class DrivenEventSource {
      addEventListener(name: string, handler: (event: MessageEvent) => void) {
        listeners[name] = handler;
      }
      close() {}
    }
    vi.stubGlobal("EventSource", DrivenEventSource);
    // A re-read still on its way.
    refresh.mockImplementation(() => new Promise(() => undefined));
    render(
      props({
        view: flowyteamCardView([run({ mode: "real", status: "running" })]),
        people: [],
      }),
    );
    await act(async () => {
      listeners.finished?.(
        new MessageEvent("finished", {
          data: JSON.stringify({ runId: "run-1", status: "completed" }),
        }),
      );
    });
    expect(byTestId("flowyteam-invite")).not.toBeNull();
    expect(byTestId("flowyteam-invite-loading")?.textContent).toBe(
      en("admin.imports.flowyteam.inviteLoading"),
    );
    expect(container.textContent).not.toContain(
      en("admin.imports.flowyteam.inviteNobody"),
    );
    refresh.mockReset();
  });
});

describe("the live stream", () => {
  const route = at("../app/api/imports/flowyteam/live/route.ts");
  it("is authorised by the card's own read and forwards only what it draws", () => {
    expect(route).toContain('"imports.flowyteamConnection"');
    expect(route).toContain("flowyteamImportChannel(");
    expect(route).toContain("status: 404");
    expect(route).not.toContain("JSON.stringify(event.data)");
  });
});

describe("the preview", () => {
  const { KPI_SHARES_NOTE_ROWS, KPI_SHARES_NOTE_TITLE } = core;

  /** The engine's dry-run block, printed the way the command line prints it. */
  function sharesBlock(counts: Record<string, number>): string {
    return [
      KPI_SHARES_NOTE_TITLE,
      ...KPI_SHARES_NOTE_ROWS.map(
        (row) => `  ${row.label}${" ".repeat(row.pad)}${counts[row.key] ?? 0}`,
      ),
      "  View options: everyone 3",
      "  View frequencies: none",
      "  KPIs that may become more visible: 1 (listed below)",
    ].join("\n");
  }

  const visibleNote =
    'KPIs that may become more visible (1):\n  - KPI "Gross margin" (7): 2 named people, 5 active human members will read it';

  const row = (domain: string, over: Record<string, unknown> = {}) => ({
    domain,
    read: 0,
    created: 0,
    matched: 0,
    combined: 0,
    recomputed: 0,
    skipped: [],
    flags: [],
    ...over,
  });

  it("parses the KPI shares block into numbers and drops both notes", () => {
    const view = flowyteamCardView([
      run({
        report: {
          reconciliation: [row("members", { read: 1, created: 1 })],
          notes: [
            sharesBlock({ rowsRead: 4, writtenAtView: 3, revoked: 1 }),
            visibleNote,
            "Another note.",
          ],
        },
      }),
    ]);
    if (view.phase.kind !== "preview") throw new Error("expected preview");
    expect(view.phase.preview.notes).toEqual(["Another note."]);
    expect(view.phase.preview.kpiShares?.rows).toHaveLength(
      KPI_SHARES_NOTE_ROWS.length,
    );
    expect(
      Object.fromEntries(
        view.phase.preview.kpiShares?.rows.map((r) => [r.key, r.count]) ?? [],
      ),
    ).toMatchObject({ rowsRead: 4, writtenAtView: 3, revoked: 1, raised: 0 });
  });

  it("has no kpiShares when the engine sent no block", () => {
    const view = flowyteamCardView([run({ report: { notes: ["x"] } })]);
    if (view.phase.kind !== "preview") throw new Error("expected preview");
    expect(view.phase.preview.kpiShares).toBeNull();
  });

  it("hides domains with nothing in them and keeps the others", () => {
    render(
      props({
        view: flowyteamCardView([
          run({
            report: {
              reconciliation: [
                row("members", { read: 3, created: 3 }),
                row("spaces"),
                row("tasks", { skipped: [{ source: "a", reason: "b" }] }),
              ],
            },
          }),
        ]),
      }),
    );
    const rows = byTestId("flowyteam-counts")?.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(byTestId("flowyteam-counts")?.textContent).not.toContain("Spaces");
  });

  it("says there is nothing to bring when every row is zero", () => {
    render(
      props({
        view: flowyteamCardView([
          run({ report: { reconciliation: [row("members"), row("spaces")] } }),
        ]),
      }),
    );
    const counts = byTestId("flowyteam-counts");
    expect(counts?.tagName).toBe("P");
    expect(counts?.textContent).toBe(
      en("admin.imports.flowyteam.nothingToBring"),
    );
  });

  it("lists only the KPI share rows above zero, and none when all are zero", () => {
    const withShares = (counts: Record<string, number>) =>
      props({
        view: flowyteamCardView([
          run({
            report: {
              reconciliation: [row("members", { read: 1, created: 1 })],
              notes: [sharesBlock(counts), visibleNote],
            },
          }),
        ]),
      });
    render(withShares({ rowsRead: 4, writtenAtView: 3 }));
    const list = byTestId("flowyteam-kpi-shares");
    expect(list?.textContent).toContain(
      en("admin.imports.flowyteam.kpiShares.title"),
    );
    expect(list?.querySelectorAll("dt")).toHaveLength(2);
    expect(list?.textContent).toContain("Shares read in OKRI.io");
    expect(list?.textContent).not.toContain("Existing share raised");
    expect(container.textContent).not.toContain("indicator_accesses");
    expect(container.textContent).not.toContain("View options");

    render(withShares({}));
    expect(byTestId("flowyteam-kpi-shares")).toBeNull();
  });

  it("says in the invite intro whether anybody has an invitation", async () => {
    const person = (id: string, invited: boolean) => ({
      memberId: id,
      name: id,
      title: null,
      email: `${id}@x.test`,
      invited,
    });
    const open = async (people: ReturnType<typeof person>[]) => {
      render(
        props({
          view: flowyteamCardView([run({ mode: "real", rowsWritten: 5 })]),
          people,
        }),
      );
      await act(async () => byTestId("flowyteam-open-invite")?.click());
      return byTestId("flowyteam-invite")?.querySelector("div")?.textContent;
    };
    const none = await open([person("a", false), person("b", false)]);
    expect(none).toContain(
      en("admin.imports.flowyteam.inviteIntro", { count: 2 }),
    );
    expect(none).toContain("Nobody has been emailed yet.");
    expect(none).not.toContain("Nobody has been emailed. ");

    const some = await open([person("a", true), person("b", false)]);
    expect(some).toContain(
      en("admin.imports.flowyteam.inviteIntro", { count: 2 }),
    );
    expect(some).toContain("1 of them has an invitation.");
    expect(some).not.toContain("Nobody");
  });
});

describe("choosing the kinds of data (C6)", () => {
  const FOUR = [
    { key: "organisation", requires: [] },
    { key: "objectives", requires: ["organisation"] },
    { key: "kpis", requires: ["organisation"] },
    { key: "kpi-shares", requires: ["kpis"] },
  ];
  const box = (key: string) =>
    byTestId(`flowyteam-domain-${key}`) as HTMLInputElement;
  const click = (key: string) => act(async () => box(key).click());
  const ticked = () => FOUR.filter((d) => box(d.key).checked).map((d) => d.key);

  it("starts with everything ticked and enabled, and sends no list for all of it", async () => {
    previewFlowyteamAction.mockResolvedValue({
      ok: true,
      value: { runId: "r" },
    });
    render(props({ domains: FOUR }));
    expect(ticked()).toHaveLength(4);
    expect(FOUR.every((d) => !box(d.key).disabled)).toBe(true);
    await act(async () => byTestId("flowyteam-run-preview")?.click());
    expect(previewFlowyteamAction).toHaveBeenCalledWith(undefined);
  });

  it("unticking a domain also unticks what needs it, and ticking brings back what it needs", async () => {
    render(props({ domains: FOUR }));
    await click("kpis");
    expect(ticked()).toEqual(["organisation", "objectives"]);
    await click("organisation");
    expect(ticked()).toEqual([]);
    await click("kpi-shares");
    expect(ticked()).toEqual(["organisation", "kpis", "kpi-shares"]);
  });

  it("passes the ticked keys as only", async () => {
    previewFlowyteamAction.mockResolvedValue({
      ok: true,
      value: { runId: "r" },
    });
    render(props({ domains: FOUR }));
    await click("kpis");
    await act(async () => byTestId("flowyteam-run-preview")?.click());
    expect(previewFlowyteamAction).toHaveBeenCalledWith([
      "organisation",
      "objectives",
    ]);
  });

  it("disables Run preview with a hint when nothing is ticked", async () => {
    render(props({ domains: FOUR }));
    await click("organisation");
    expect(ticked()).toEqual([]);
    expect(
      (byTestId("flowyteam-run-preview") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(byTestId("flowyteam-none-ticked")?.textContent).toBe(
      en("admin.imports.flowyteam.nothingTicked"),
    );
  });

  const partialPreview = (selected: string[], over: Partial<Run> = {}) =>
    run({
      report: { reconciliation: [], notes: [], selected },
      ...over,
    });

  it("says what a partial preview brings, and imports exactly that", async () => {
    runFlowyteamAction.mockResolvedValue({ ok: true, value: { runId: "r" } });
    render(
      props({
        domains: FOUR,
        view: flowyteamCardView([
          partialPreview(["organisation", "objectives"]),
        ]),
      }),
    );
    expect(byTestId("flowyteam-bringing")?.textContent).toBe(
      en("admin.imports.flowyteam.bringingAcross", {
        domains: `${en("admin.imports.flowyteam.domain.organisation")}, ${en("admin.imports.flowyteam.domain.objectives")}`,
      }),
    );
    await act(async () => byTestId("flowyteam-import")?.click());
    expect(runFlowyteamAction).toHaveBeenCalledWith(false, [
      "organisation",
      "objectives",
    ]);
  });

  it("says nothing extra when the preview covered everything", () => {
    render(
      props({
        domains: FOUR,
        view: flowyteamCardView([partialPreview(FOUR.map((d) => d.key))]),
      }),
    );
    expect(byTestId("flowyteam-bringing")).toBeNull();
  });

  it("Import new data repeats the last import's choice, and nothing when it was everything", async () => {
    previewFlowyteamAction.mockResolvedValue({
      ok: true,
      value: { runId: "r" },
    });
    const imported = (selected: string[]) =>
      run({
        id: "run-2",
        mode: "real",
        rowsWritten: 9,
        startedAt: "2026-11-23T10:00:00.000Z",
        report: { selected },
      });
    render(
      props({
        domains: FOUR,
        view: flowyteamCardView([imported(["organisation", "kpis"])]),
      }),
    );
    await act(async () => byTestId("flowyteam-import-new")?.click());
    expect(previewFlowyteamAction).toHaveBeenLastCalledWith([
      "organisation",
      "kpis",
    ]);
    act(() => root.unmount());
    root = createRoot(container);
    render(
      props({
        domains: FOUR,
        view: flowyteamCardView([imported(FOUR.map((d) => d.key))]),
      }),
    );
    await act(async () => byTestId("flowyteam-import-new")?.click());
    expect(previewFlowyteamAction).toHaveBeenLastCalledWith(undefined);
  });
});
