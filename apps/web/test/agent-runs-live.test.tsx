// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Live agent run streams, the browser half (PLAN.md §7, release 0.7.0 A11).
 *
 * The producing half, one outbox row per change to a run carrying its id and
 * version, is proved against a real database in
 * `packages/core/test/agent-run-live.test.ts` and, for the executor's steps,
 * `packages/agents/test/custom-agent-runs.test.ts`. What is checked here is the
 * wiring neither can see: who may open the stream, what of the event reaches a
 * browser, and that the screen re-reads, once per burst, and only for a version
 * it is not already showing.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const route = at("../app/api/agents/live/route.ts");
const page = at("../app/admin/agents/page.tsx");

describe("the agent runs stream", () => {
  test("is authorised by the read that lists the runs", () => {
    // `agents.listRuns` needs `full`, so a member who could not read the run
    // log gets a 404 rather than an open stream.
    expect(route).toContain('"agents.listRuns"');
    expect(route).toContain("agentRunsChannel(");
    expect(route).toContain("status: 401");
    expect(route).toContain("status: 404");
  });

  test("forwards the run's id and version and nothing else", () => {
    // The event on the channel also carries the workspace id. The route
    // builds a fresh object from the two fields the screen uses.
    expect(route).toContain("event: agentRun.changed");
    expect(route).toContain("JSON.stringify({ runId, version })");
    expect(route).not.toContain("JSON.stringify(event.data)");
  });

  test("the page mounts it with the versions it rendered", () => {
    expect(page).toMatch(/<AgentRunsLive\s+versions=\{/);
    expect(page).toContain("agentRunVersion(");
  });
});

const refresh = vi.fn();
// One router for the life of the page, as Next.js gives one.
const router = { refresh, push: () => undefined };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const { AgentRunsLive } = await import("../app/admin/agents/runs-live.tsx");

/** An `EventSource` the test drives by hand. */
class FakeEventSource {
  static opened: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  readonly #listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.opened.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const set = this.#listeners.get(type) ?? new Set();
    set.add(listener);
    this.#listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.#listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(
        new MessageEvent(type, {
          data: typeof data === "string" ? data : JSON.stringify(data),
        }),
      );
    }
  }
}

const RUN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

let host: HTMLDivElement;
let root: Root;

const render = async (versions: Record<string, number>) => {
  await act(async () => {
    root.render(<AgentRunsLive versions={versions} />);
  });
};

const stream = () => {
  const source = FakeEventSource.opened.at(-1);
  if (!source) {
    throw new Error("nothing opened a stream");
  }
  return source;
};

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  FakeEventSource.opened = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the agents screen, live", () => {
  test("listens on the runs stream", async () => {
    await render({ [RUN]: 1 });
    expect(stream().url).toBe("/api/agents/live");
  });

  test("re-reads when a run moves past what it shows", async () => {
    await render({ [RUN]: 1 });
    stream().emit("agentRun.changed", { runId: RUN, version: 2 });
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("re-reads for a run it has not shown yet", async () => {
    await render({ [RUN]: 1 });
    stream().emit("agentRun.changed", { runId: OTHER, version: 0 });
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("skips a version it already shows, such as its own write's echo", async () => {
    // An administrator who presses a run button refreshes when the action
    // returns; the event for that same run arrives after and says nothing new.
    await render({ [RUN]: 3 });
    stream().emit("agentRun.changed", { runId: RUN, version: 3 });
    stream().emit("agentRun.changed", { runId: RUN, version: 2 });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("coalesces a burst of steps into one re-read", async () => {
    await render({ [RUN]: 0 });
    for (const version of [1, 2, 3, 4]) {
      stream().emit("agentRun.changed", { runId: RUN, version });
    }
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("compares against what the latest render shows", async () => {
    await render({ [RUN]: 1 });
    // The refresh came back showing version 4.
    await render({ [RUN]: 4 });
    stream().emit("agentRun.changed", { runId: RUN, version: 4 });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(refresh).not.toHaveBeenCalled();
    // And one stream across both renders, not a second connection.
    expect(FakeEventSource.opened).toHaveLength(1);
  });

  test("re-reads on an event it cannot parse rather than missing a change", async () => {
    await render({ [RUN]: 1 });
    stream().emit("agentRun.changed", "not json");
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("closes the stream when the screen goes", async () => {
    await render({ [RUN]: 1 });
    const source = stream();
    await act(async () => {
      root.unmount();
    });
    expect(source.closed).toBe(true);
    root = createRoot(host);
  });
});
