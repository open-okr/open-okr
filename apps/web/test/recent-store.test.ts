// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  openedAt,
  pruneRecents,
  readRecents,
  recentStoreKey,
  recordRecent,
} from "../lib/recent-store.ts";

/**
 * What the browser remembers a member opened (work-layer.md §5.1, G2-D1 and
 * G2-D2). The list is per device and per workspace, newest first, at most
 * twenty, and a blocked store means no recents and never an error.
 */

const WS = "ws-1";
const id = (n: number) =>
  `${String(n).padStart(8, "0")}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("the stored list", () => {
  test("a second open moves the thing to the top", () => {
    recordRecent(WS, "task", id(1), 1);
    recordRecent(WS, "goal", id(2), 2);
    recordRecent(WS, "task", id(1), 3);
    expect(readRecents(WS).map((one) => one.id)).toEqual([id(1), id(2)]);
    expect(readRecents(WS)[0]?.at).toBe(3);
  });

  test("keeps the last twenty", () => {
    for (let n = 1; n <= 25; n += 1) {
      recordRecent(WS, "task", id(n), n);
    }
    const list = readRecents(WS);
    expect(list).toHaveLength(20);
    expect(list[0]?.id).toBe(id(25));
    expect(list[19]?.id).toBe(id(6));
  });

  test("is kept per workspace", () => {
    recordRecent(WS, "task", id(1));
    expect(readRecents("ws-2")).toEqual([]);
    expect(window.localStorage.getItem(recentStoreKey(WS))).not.toBeNull();
  });

  test("drops an entry that is malformed and keeps the rest", () => {
    window.localStorage.setItem(
      recentStoreKey(WS),
      JSON.stringify([
        { kind: "task", id: id(1), at: 1 },
        { kind: "document", id: id(2), at: 1 },
        { kind: "task", id: "not-an-id", at: 1 },
        "nonsense",
      ]),
    );
    expect(readRecents(WS).map((one) => one.id)).toEqual([id(1)]);
    window.localStorage.setItem(recentStoreKey(WS), "{not json");
    expect(readRecents(WS)).toEqual([]);
  });

  test("a blocked store means no recents, never an error", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => recordRecent(WS, "task", id(1))).not.toThrow();
    expect(readRecents(WS)).toEqual([]);
    expect(() => pruneRecents(WS, [], [])).not.toThrow();
  });

  test("prunes what the server dropped and keeps what it did not ask about", () => {
    recordRecent(WS, "task", id(1), 1);
    recordRecent(WS, "goal", id(2), 2);
    // Opened while the answer was coming, so it was not part of the question.
    const asked = readRecents(WS);
    recordRecent(WS, "kpi", id(3), 3);
    pruneRecents(WS, asked, [{ kind: "task", id: id(1) }]);
    expect(readRecents(WS).map((one) => one.id)).toEqual([id(3), id(1)]);
  });
});

describe("what an address says was opened", () => {
  const none = new URLSearchParams();

  test.each([
    ["goals", "goal"],
    ["kpis", "kpi"],
    ["initiatives", "initiative"],
    ["tasks", "task"],
    ["people", "person"],
    ["spaces", "space"],
  ])("/%s/<id> opens a %s", (segment, kind) => {
    expect(openedAt(`/${segment}/${id(1)}`, none)).toEqual([
      { kind, id: id(1) },
    ]);
    expect(openedAt(`/${segment}/${id(1)}/settings`, none)).toHaveLength(1);
  });

  test("a list page, or a page with no key in it, opens nothing", () => {
    expect(openedAt("/goals", none)).toEqual([]);
    expect(openedAt("/tasks/abc", none)).toEqual([]);
    expect(openedAt(`/reports/${id(1)}`, none)).toEqual([]);
  });

  test("the drawer opens an objective, and a key result newest of all", () => {
    expect(
      openedAt("/goals", new URLSearchParams({ okr: id(1), kr: id(2) })),
    ).toEqual([
      { kind: "goal", id: id(1) },
      { kind: "key_result", id: id(2) },
    ]);
    expect(openedAt("/home", new URLSearchParams({ okr: "x" }))).toEqual([]);
  });
});
