// @vitest-environment jsdom
import {
  QueryClient,
  QueryClientProvider,
  ToastProvider,
  TranslationsProvider,
} from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { OkrGoal, OkrTree } from "../lib/okr-tree/cache.ts";

/**
 * One way to change the OKR tree, and what happens when the server says no
 * (P9-T06c, docs/design/p9-t00-okr-writing.md §6).
 *
 * **Rendered for real in jsdom** with the query client, the translations and
 * the toasts the shell provides, because each claim is about what a reader
 * sees: the row moves at once, moves back with the server's sentence, offers
 * keep-mine or take-theirs on a conflict, and offers an undo after a removal.
 * The server action is a stand-in; what it calls is proved in
 * `packages/core/test/goal-tree.test.ts` and `goal-targets.test.ts`, and the
 * two-tab case end to end in `e2e/s13-okr-editor.spec.ts`.
 */

const runOkrMutation = vi.fn();
vi.mock("../lib/okr-tree/actions.ts", () => ({
  readOkrTree: vi.fn(),
  runOkrMutation: (...args: unknown[]) => runOkrMutation(...args),
}));

/** A `BroadcastChannel` that records what was said and can be spoken to. */
class FakeChannel {
  static open: FakeChannel[] = [];
  static posted: unknown[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    FakeChannel.open.push(this);
  }
  postMessage(data: unknown) {
    FakeChannel.posted.push(data);
  }
  close() {
    FakeChannel.open = FakeChannel.open.filter((one) => one !== this);
  }
}

class SilentEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

const { useOkrLive, useOkrMutation } = await import(
  "../lib/okr-tree/use-okr-tree.ts"
);
const { okrTreeKey } = await import("../lib/okr-tree/cache.ts");

const node = (title: string): OkrGoal => ({
  id: "g",
  title,
  cycleId: "c",
  level: "team",
  spaceId: null,
  champion: { id: "m", name: "Priya" },
  reviewer: null,
  parentGoalId: null,
  parentKeyResultId: null,
  weight: 1,
  contributionStatement: null,
  progressPct: 20,
  health: "on_track",
  closedAt: null,
  nextCheckInOn: null,
  daysPastDue: null,
  position: 0,
  quality: { score: null, flags: [] },
  keyResults: [
    {
      id: "k",
      goalId: "g",
      title: "Trials from 0 to 100",
      unit: null,
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 0,
      targetValue: 100,
      currentValue: 20,
      dueOn: null,
      owner: null,
      weight: 1,
      kpiId: null,
      progressPct: 20,
      confidence: null,
      qualityFlags: [],
      position: 0,
    },
  ],
});

const tree = (title = "Grow the trial base"): OkrTree => ({
  cycle: {
    id: "c",
    name: "Q1",
    mode: "quarterly",
    startsOn: "2027-01-01",
    endsOn: "2027-03-31",
  },
  goals: [node(title)],
  context: [],
  dependencies: [],
});

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let okr: ReturnType<typeof useOkrMutation>;

function Harness() {
  okr = useOkrMutation({ cycleId: "c", scope: "all" });
  useOkrLive("c");
  return (
    <p data-testid="state">
      {okr.problem ?? ""}
      {okr.failed?.error ?? ""}
      {okr.conflict ? "conflict" : ""}
    </p>
  );
}

const cached = () => client.getQueryData<OkrTree>(okrTreeKey("c", "all"));
const settle = () => act(async () => new Promise((done) => setTimeout(done)));

beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  vi.stubGlobal("EventSource", SilentEventSource);
  FakeChannel.open = [];
  FakeChannel.posted = [];
  runOkrMutation.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(okrTreeKey("c", "all"), tree());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TranslationsProvider locale="en">
          <ToastProvider>
            <Harness />
          </ToastProvider>
        </TranslationsProvider>
      </QueryClientProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("useOkrMutation", () => {
  test("changes the row at once and puts it back, with the server's sentence, on a refusal", async () => {
    let answer: (value: unknown) => void = () => undefined;
    runOkrMutation.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    act(() =>
      okr.mutate({
        kind: "patchGoal",
        id: "g",
        set: { title: "Make trials turn into teams" },
        read: { title: "Grow the trial base" },
      }),
    );
    await settle();
    // Before the server answers, the reader sees what they typed.
    expect(cached()?.goals[0]?.title).toBe("Make trials turn into teams");

    await act(async () =>
      answer({ ok: false, error: "This workspace refuses that." }),
    );
    await settle();
    expect(cached()?.goals[0]?.title).toBe("Grow the trial base");
    expect(container.textContent).toContain("This workspace refuses that.");
    // What was typed is kept, so Retry sends it again as it was.
    expect(okr.failed?.mutation).toMatchObject({
      set: { title: "Make trials turn into teams" },
    });
    runOkrMutation.mockResolvedValueOnce({
      ok: true,
      goal: node("Make trials turn into teams"),
    });
    act(() => okr.retry());
    await settle();
    expect(cached()?.goals[0]?.title).toBe("Make trials turn into teams");
    expect(okr.failed).toBeNull();
  });

  test("puts the row back on a conflict and offers keep-mine, which sends it again from what is stored", async () => {
    runOkrMutation.mockResolvedValueOnce({
      ok: false,
      error: "Mei changed this since you read it.",
      conflict: {
        current: { title: "Mei's title" },
        changedBy: "Mei",
        changedAt: null,
      },
    });
    act(() =>
      okr.mutate({
        kind: "patchGoal",
        id: "g",
        set: { title: "Priya's title" },
        read: { title: "Grow the trial base" },
      }),
    );
    await settle();
    expect(cached()?.goals[0]?.title).toBe("Grow the trial base");
    expect(container.textContent).toContain("conflict");

    runOkrMutation.mockResolvedValueOnce({
      ok: true,
      goal: node("Priya's title"),
    });
    act(() => okr.keepMine());
    await settle();
    expect(runOkrMutation).toHaveBeenLastCalledWith({
      kind: "patchGoal",
      id: "g",
      set: { title: "Priya's title" },
      read: { title: "Mei's title" },
    });
    expect(cached()?.goals[0]?.title).toBe("Priya's title");
    expect(container.textContent).not.toContain("conflict");
  });

  test("merges the server's recomputed node and tells the other tabs", async () => {
    runOkrMutation.mockResolvedValueOnce({
      ok: true,
      goal: { ...node("Renamed"), progressPct: 64 },
    });
    act(() =>
      okr.mutate({
        kind: "patchGoal",
        id: "g",
        set: { title: "Renamed" },
        read: { title: "Grow the trial base" },
      }),
    );
    await settle();
    expect(cached()?.goals[0]).toMatchObject({
      title: "Renamed",
      progressPct: 64,
    });
    expect(FakeChannel.posted).toContainEqual({ cycleId: "c" });
  });

  test("offers an undo after a removal, which brings the key result back", async () => {
    runOkrMutation.mockResolvedValueOnce({ ok: true, goal: null });
    act(() => okr.mutate({ kind: "removeKeyResult", id: "k" }));
    await settle();
    expect(cached()?.goals[0]?.keyResults).toEqual([]);

    const undo = document.querySelector<HTMLButtonElement>(
      '[data-testid="toast-action"]',
    );
    expect(undo?.textContent).toBe("Undo");
    runOkrMutation.mockResolvedValueOnce({ ok: true, goal: node("Back") });
    await act(async () => undo?.click());
    await settle();
    expect(runOkrMutation).toHaveBeenLastCalledWith({
      kind: "restoreKeyResult",
      id: "k",
    });
    expect(cached()?.goals[0]?.keyResults.map((row) => row.id)).toEqual(["k"]);
  });
});

describe("useOkrLive", () => {
  test("re-reads the cycle when another tab says it changed", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const listening = FakeChannel.open.find((one) => one.onmessage);
    await act(async () =>
      listening?.onmessage?.({ data: { cycleId: "c" } } as MessageEvent),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["okr-tree", "c"] });
    invalidate.mockClear();
    await act(async () =>
      listening?.onmessage?.({ data: { cycleId: "other" } } as MessageEvent),
    );
    expect(invalidate).not.toHaveBeenCalled();
  });
});
