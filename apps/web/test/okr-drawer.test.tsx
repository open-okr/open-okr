// @vitest-environment jsdom
import { canonThresholds, defaultPractice } from "@openokr/method";
import {
  QueryClient,
  QueryClientProvider,
  ToastProvider,
  TranslationsProvider,
} from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { OkrDetail } from "../lib/okr-tree/actions.ts";
import type { OkrTree } from "../lib/okr-tree/cache.ts";

/**
 * The OKR drawer (P9-T08a, docs/design/p9-t00-okr-writing.md §6).
 *
 * **The real list and drawer, rendered together in jsdom**, with the server
 * actions stubbed, because the claims here are about the two agreeing: a
 * value typed in the drawer is the same write the row sends and the row moves
 * with it, the drawer opens on whatever the address names, Escape in a field
 * belongs to the field, and the history and alignment read what the server
 * returns. What the reads return is proved in `packages/core`; the drawer
 * moving a row in a real browser, and a link opening it, in
 * `e2e/s13d-okr-drawer.spec.ts`.
 */

const runOkrMutation = vi.fn();
const readOkrDetail = vi.fn();
const readOkrTree = vi.fn();
vi.mock("../lib/okr-tree/actions.ts", () => ({
  readOkrDetail: (...args: unknown[]) => readOkrDetail(...args),
  readOkrTree: (...args: unknown[]) => readOkrTree(...args),
  runOkrMutation: (...args: unknown[]) => runOkrMutation(...args),
}));
vi.mock("../app/goals/editor-actions.ts", () => ({
  addKeyResult: vi.fn(),
  addObjective: vi.fn(),
}));
// The address is the page's own: the drawer reads it as Next would hand it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

class Quiet {
  onmessage = null;
  postMessage() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

const { OkrTable } = await import("../app/goals/okr-table.tsx");

const MEI = { id: "00000000-0000-7000-8000-000000000002", name: "Mei" };
const PRIYA = { id: "00000000-0000-7000-8000-000000000001", name: "Priya" };
const KR = "Activation from 30% to 45%";

type TreeKeyResult = OkrTree["goals"][number]["keyResults"][number];

const keyResult = (overrides: Partial<TreeKeyResult> = {}): TreeKeyResult => ({
  id: "k",
  goalId: "g",
  title: KR,
  unit: "%",
  kind: "metric",
  doneAt: null,
  addedMidCycleAt: null,
  draft: null,
  direction: "increase",
  indicatorType: "lagging",
  baselineValue: 30,
  targetValue: 45,
  currentValue: 33,
  dueOn: "2027-03-31",
  owner: MEI,
  weight: 1,
  kpiId: null,
  progressPct: 20,
  confidence: 0.6,
  qualityFlags: [],
  position: 0,
  ...overrides,
});

const goal = (
  id: string,
  title: string,
  keyResults: OkrTree["goals"][number]["keyResults"],
  parentGoalId: string | null = null,
): OkrTree["goals"][number] => ({
  id,
  title,
  cycleId: "c",
  level: "team",
  kind: "aspirational",
  addedMidCycleAt: null,
  draft: null,
  draftState: null,
  spaceId: null,
  champion: PRIYA,
  reviewer: null,
  parentGoalId,
  parentKeyResultId: null,
  weight: 1,
  contributionStatement: null,
  progressPct: 20,
  health: "on_track",
  closedAt: null,
  nextCheckInOn: "2027-01-11",
  daysPastDue: null,
  position: 0,
  quality: { score: null, flags: [] },
  keyResults,
});

const tree = (
  keyResults = [keyResult()],
  kind: "committed" | "aspirational" = "aspirational",
): OkrTree => ({
  cycle: {
    id: "c",
    name: "Q1",
    mode: "quarterly",
    startsOn: "2027-01-01",
    endsOn: "2027-03-31",
    midCycle: false,
  },
  viewerId: "00000000-0000-4000-8000-000000000001",
  goals: [
    {
      ...goal("g", "Make onboarding the reason teams stay", keyResults, "p"),
      kind,
    },
    goal("p", "Grow the business on the teams we keep", []),
  ],
  context: [],
  dependencies: [],
});

const detail = (): OkrDetail => ({
  relations: {
    parent: {
      id: "p",
      title: "Grow the business on the teams we keep",
      level: "company",
    },
    children: [],
    dependencies: [
      {
        id: "d",
        goalId: "elsewhere",
        title: "Ship the new billing page",
        note: "Pricing waits on it",
      },
    ],
    register: [],
  },
  checkIns: [
    {
      id: "ci",
      author: "Priya",
      on: "2027-01-11",
      status: "caution",
      confidence: 0.5,
      narrative: "Activation stalled while the guide was rewritten.",
    },
  ],
  keyResults: {
    k: {
      values: [{ id: "v", value: 33, at: "2027-01-11T09:00:00.000Z" }],
      targets: [
        {
          from: 50,
          to: 45,
          eased: true,
          reason: "The partner channel closed in week three",
          midCycle: true,
          changedAt: "2027-01-12T09:00:00.000Z",
          changedBy: "Priya",
        },
      ],
    },
  },
});

let root: Root;
let container: HTMLDivElement;

async function render(options: {
  address: string;
  canEdit?: boolean;
  keyResults?: OkrTree["goals"][number]["keyResults"];
  kind?: "committed" | "aspirational";
}) {
  window.history.replaceState(null, "", `/goals${options.address}`);
  // A read again returns what the server holds, which is what was drawn.
  readOkrTree.mockResolvedValue(tree(options.keyResults, options.kind));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TranslationsProvider locale="en">
          <ToastProvider>
            <OkrTable
              initialTree={tree(options.keyResults, options.kind)}
              initialAt={Date.now()}
              scope="all"
              filters={{ includeClosed: false }}
              cycleId="c"
              level="team"
              canEdit={options.canEdit ?? true}
              canAdminister={options.canEdit ?? true}
              progressMax={100}
              members={[PRIYA, MEI]}
              refusal={null}
              coach={{
                thresholds: canonThresholds(),
                practice: defaultPractice(),
              }}
              empty={<p>Nothing matches</p>}
            />
          </ToastProvider>
        </TranslationsProvider>
      </QueryClientProvider>,
    );
  });
  // The drawer's read resolves on the next turn.
  await act(async () => new Promise((done) => setTimeout(done)));
}

const drawer = () =>
  document.querySelector<HTMLElement>('[data-testid="okr-drawer"]');
const inDrawer = (label: string) =>
  drawer()?.querySelector<HTMLInputElement>(`[aria-label="${label}"]`) ?? null;
const inList = (label: string) =>
  container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    input.focus();
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Leaves a field, then lets the cache tell React, which it does on a timer. */
async function leave(input: HTMLInputElement) {
  await act(async () => input.blur());
  await act(async () => new Promise((done) => setTimeout(done)));
}

async function press(target: Element, key: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("BroadcastChannel", Quiet);
  vi.stubGlobal("EventSource", Quiet);
  runOkrMutation.mockReset();
  runOkrMutation.mockResolvedValue({ ok: true, goal: null });
  readOkrDetail.mockReset();
  readOkrDetail.mockResolvedValue(detail());
  readOkrTree.mockReset();
  readOkrTree.mockResolvedValue(tree());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("opening", () => {
  test("opens on the objective the address names, with every field of its key results", async () => {
    await render({ address: "?okr=g" });
    expect(drawer()?.textContent).toContain(
      "Make onboarding the reason teams stay",
    );
    for (const label of [
      `Title of ${KR}`,
      `Current value for ${KR}`,
      `Target for ${KR}`,
      `Baseline for ${KR}`,
      `Unit for ${KR}`,
      `Weight of ${KR}`,
    ]) {
      expect(inDrawer(label), label).not.toBeNull();
    }
    // The details are the cache's, so opening them reads nothing more.
    expect(readOkrDetail).not.toHaveBeenCalled();
  });

  test("is closed when the address names no objective", async () => {
    await render({ address: "" });
    expect(drawer()).toBeNull();
  });

  test("says so when the address names an objective it cannot find", async () => {
    await render({ address: "?okr=somebody-elses" });
    expect(
      drawer()?.querySelector('[data-testid="okr-drawer-missing"]'),
    ).not.toBeNull();
  });

  test("a row's open control puts the objective in the address", async () => {
    await render({ address: "" });
    const open = [
      ...container.querySelectorAll<HTMLAnchorElement>("a[href]"),
    ].find((link) => link.textContent === "Open this key result");
    // Still a link to the page, for a new tab; a plain click is the drawer.
    expect(open?.getAttribute("href")).toBe("/goals/g#kr-k");
    await act(async () => open?.click());
    const params = new URLSearchParams(window.location.search);
    expect(params.get("okr")).toBe("g");
    expect(params.get("kr")).toBe("k");
  });
});

describe("one cache for the row and the drawer", () => {
  test("a value typed in the drawer is the row's own write, and the row moves with it", async () => {
    // Held on its way, so what the row shows is the cache's change alone.
    runOkrMutation.mockReturnValueOnce(new Promise(() => undefined));
    await render({ address: "?okr=g" });
    const field = inDrawer(`Current value for ${KR}`) as HTMLInputElement;
    await type(field, "40");
    await leave(field);
    expect(runOkrMutation).toHaveBeenCalledWith({
      kind: "recordValue",
      id: "k",
      value: 40,
    });
    expect(inList(`Current value for ${KR}`)?.value).toBe("40");
  });

  test("an eased target asks why inside the drawer, and sends the reason with it", async () => {
    await render({ address: "?okr=g" });
    const target = inDrawer(`Target for ${KR}`) as HTMLInputElement;
    await type(target, "40");
    await leave(target);
    expect(runOkrMutation).not.toHaveBeenCalled();
    const reason = drawer()?.querySelector(
      '[data-testid="target-reason"] input',
    ) as HTMLInputElement;
    expect(reason).not.toBeNull();
    await type(reason, "The partner channel closed in week three");
    await press(reason, "Enter");
    expect(runOkrMutation).toHaveBeenCalledWith({
      kind: "changeTarget",
      id: "k",
      targetValue: 40,
      reason: "The partner channel closed in week three",
    });
  });

  test("a refused change is said in the drawer, with Retry", async () => {
    runOkrMutation.mockResolvedValueOnce({
      ok: false,
      error: "This workspace refuses that.",
    });
    await render({ address: "?okr=g" });
    const weight = inDrawer(`Weight of ${KR}`) as HTMLInputElement;
    await type(weight, "2");
    await leave(weight);
    expect(drawer()?.textContent).toContain(
      "Not saved: This workspace refuses that.",
    );
  });
});

describe("Escape", () => {
  test("in a field puts the field back and keeps the drawer open", async () => {
    await render({ address: "?okr=g" });
    const target = inDrawer(`Target for ${KR}`) as HTMLInputElement;
    await type(target, "90");
    await press(target, "Escape");
    expect(target.value).toBe("45");
    expect(new URLSearchParams(window.location.search).get("okr")).toBe("g");
  });

  test("anywhere else closes it, and the address forgets it", async () => {
    await render({ address: "?okr=g&tab=history" });
    const tab = drawer()?.querySelector<HTMLElement>('[role="tab"]');
    await act(async () => tab?.focus());
    await press(tab as HTMLElement, "Escape");
    const params = new URLSearchParams(window.location.search);
    expect(params.get("okr")).toBeNull();
    expect(params.get("tab")).toBeNull();
  });
});

describe("the history and the alignment", () => {
  test("the history lists the check-ins, the target changes with their reason, and the values", async () => {
    await render({ address: "?okr=g&tab=history" });
    expect(readOkrDetail).toHaveBeenCalledWith({
      goalId: "g",
      keyResultIds: ["k"],
    });
    const text = drawer()?.textContent ?? "";
    expect(text).toContain("Activation stalled while the guide was rewritten.");
    expect(text).toContain(
      "Priya eased the target from 50 % to 45 % on 2027-01-12",
    );
    expect(text).toContain("The partner channel closed in week three");
    expect(
      drawer()?.querySelector('[data-testid="value-entry"]')?.textContent,
    ).toContain("33 %");
  });

  test("the alignment opens a parent on screen in the drawer, and links one that is not", async () => {
    await render({ address: "?okr=g&tab=alignment" });
    const parent = [...(drawer()?.querySelectorAll("button") ?? [])].find(
      (button) =>
        button.textContent === "Grow the business on the teams we keep",
    );
    expect(parent).toBeDefined();
    const dependency = drawer()?.querySelector<HTMLAnchorElement>(
      'a[href="/goals/elsewhere"]',
    );
    expect(dependency?.textContent).toBe("Ship the new billing page");

    await act(async () => parent?.click());
    const params = new URLSearchParams(window.location.search);
    expect(params.get("okr")).toBe("p");
    expect(params.get("tab")).toBe("alignment");
  });

  test("a read that fails says so, with Retry", async () => {
    readOkrDetail.mockRejectedValue(new Error("down"));
    await render({ address: "?okr=g&tab=history" });
    expect(drawer()?.textContent).toContain(
      "The history could not be read just now.",
    );
  });
});

describe("what a reader may do", () => {
  test("a reader without edit access sees values in the drawer, and nothing to edit them with", async () => {
    await render({ address: "?okr=g", canEdit: false });
    expect(drawer()?.querySelectorAll("input, select")).toHaveLength(0);
    expect(drawer()?.textContent).toContain(KR);
  });

  test("a value a KPI supplies is read-only in the drawer and the row", async () => {
    await render({
      address: "?okr=g",
      keyResults: [
        keyResult({ kpiId: "00000000-0000-7000-8000-00000000000a" }),
      ],
    });
    expect(inDrawer(`Current value for ${KR}`)).toBeNull();
    expect(inList(`Current value for ${KR}`)).toBeNull();
    expect(inDrawer(`Target for ${KR}`)).not.toBeNull();
  });
});

/**
 * Checking in from the drawer (P9-T08b). The form is the drawer's own until
 * Publish, and what it sends is only what moved.
 */
describe("checking in", () => {
  const form = () =>
    drawer()?.querySelector<HTMLFormElement>('[data-testid="drawer-check-in"]');

  async function fill(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ) {
    const setter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function submit() {
    await act(async () => {
      form()?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await act(async () => new Promise((done) => setTimeout(done)));
  }

  test("a milestone is checked in as done, not as a value (P9-T12c-a)", async () => {
    await render({
      address: "?okr=g&tab=check-in",
      keyResults: [keyResult({ kind: "milestone" })],
    });
    expect(inDrawer(`Value for ${KR} in this check-in`)).toBeNull();
    const done = inDrawer(`${KR} is done`) as HTMLInputElement;
    await act(async () => done.click());
    await fill(
      form()?.querySelector("textarea") as HTMLTextAreaElement,
      "The import shipped on Friday.",
    );
    await submit();
    expect(runOkrMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "checkIn",
        values: [{ keyResultId: "k", done: true }],
      }),
    );
  });

  test("a commitment set below the floor is told so before it is published (P9-T11b-c)", async () => {
    await render({ address: "?okr=g&tab=check-in", kind: "committed" });
    const floor = () =>
      drawer()?.querySelector('[data-testid="committed-floor"]') ?? null;
    await fill(
      inDrawer(`Confidence in ${KR}, out of 10`) as HTMLInputElement,
      "4",
    );
    expect(floor()?.textContent).toBe(
      "A commitment nobody believes in is a risk. Escalate now, or make it aspirational",
    );
    await fill(
      inDrawer(`Confidence in ${KR}, out of 10`) as HTMLInputElement,
      "7",
    );
    expect(floor()).toBeNull();
  });

  test("an aspirational key result at the same confidence is told nothing", async () => {
    await render({ address: "?okr=g&tab=check-in" });
    await fill(
      inDrawer(`Confidence in ${KR}, out of 10`) as HTMLInputElement,
      "4",
    );
    expect(
      drawer()?.querySelector('[data-testid="committed-floor"]'),
    ).toBeNull();
  });

  test("the row's check-in action opens the drawer on its check-in tab", async () => {
    await render({ address: "" });
    const action = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Check in on this objective"]',
    );
    await act(async () => action?.click());
    const params = new URLSearchParams(window.location.search);
    expect(params.get("okr")).toBe("g");
    expect(params.get("tab")).toBe("check-in");
  });

  test("publishes only what moved, with the last status carried forward, and then shows the history", async () => {
    await render({ address: "?okr=g&tab=check-in" });
    // The last check-in said caution, so that is where the status starts.
    expect(form()?.querySelector("select")?.value).toBe("caution");
    await fill(
      inDrawer(`Value for ${KR} in this check-in`) as HTMLInputElement,
      "40",
    );
    await fill(
      inDrawer(`Confidence in ${KR}, out of 10`) as HTMLInputElement,
      "7",
    );
    await fill(
      form()?.querySelector("textarea") as HTMLTextAreaElement,
      "The guide is back and activation moved again.",
    );
    await submit();
    expect(runOkrMutation).toHaveBeenCalledWith({
      kind: "checkIn",
      id: "g",
      status: "caution",
      confidence: 0.5,
      narrative: "The guide is back and activation moved again.",
      values: [{ keyResultId: "k", value: 40, confidence: 0.7 }],
    });
    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "history",
    );
  });

  test("with no check-in yet the status is the reader's to choose, and an empty narrative is said before anything is sent", async () => {
    readOkrDetail.mockResolvedValue({ ...detail(), checkIns: [] });
    await render({ address: "?okr=g&tab=check-in" });
    expect(form()?.querySelector("select")?.value).toBe("");
    await submit();
    expect(drawer()?.textContent).toContain("Choose a status");

    const select = form()?.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = "on_track";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submit();
    expect(drawer()?.textContent).toContain("A check-in needs a narrative.");
    expect(runOkrMutation).not.toHaveBeenCalled();
  });

  test("a reader who cannot edit has no check-in tab, even from a link", async () => {
    await render({ address: "?okr=g&tab=check-in", canEdit: false });
    expect(form()).toBeNull();
    const tabs = [...(drawer()?.querySelectorAll('[role="tab"]') ?? [])].map(
      (tab) => tab.textContent,
    );
    expect(tabs).not.toContain("Check in");
    expect(
      container.querySelector(
        'button[aria-label="Check in on this objective"]',
      ),
    ).toBeNull();
  });
});
