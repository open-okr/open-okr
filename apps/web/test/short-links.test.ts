import { describe, expect, it } from "vitest";
import {
  keyResultLinkPath,
  shortLinkPath,
  withQuery,
} from "../lib/short-links.ts";

/**
 * The paths "Copy link" copies, and the redirect a short link takes to the
 * page at its key (docs/design/short-ids.md S6). The browser half is
 * `e2e/short-links.spec.ts`.
 */

const KEY = "0190f5e2-7d3c-7a1b-9c2d-3e4f5a6b7c8d";
const GOAL = "0190f5e2-7d3c-7a1b-9c2d-000000000001";

describe("the path a Copy link copies", () => {
  it("names each page by its short id", () => {
    const thing = { id: KEY, shortId: "aB3dE5fG7h" };
    expect(shortLinkPath("goal", thing)).toBe("/goals/aB3dE5fG7h");
    expect(shortLinkPath("initiative", thing)).toBe("/initiatives/aB3dE5fG7h");
    expect(shortLinkPath("task", thing)).toBe("/tasks/aB3dE5fG7h");
    expect(shortLinkPath("document", thing)).toBe("/documents/aB3dE5fG7h");
    expect(shortLinkPath("session", thing)).toBe("/session/aB3dE5fG7h");
    expect(shortLinkPath("cycle", thing)).toBe("/cycle?cycle=aB3dE5fG7h");
  });

  it("falls back to the key for a row the data change has not reached", () => {
    expect(shortLinkPath("goal", { id: KEY, shortId: null })).toBe(
      `/goals/${KEY}`,
    );
  });

  it("sends a key result to its own route, or to its goal's row without a short id", () => {
    expect(
      keyResultLinkPath({ id: KEY, shortId: "aB3dE5fG7h", goalId: GOAL }),
    ).toBe("/key-results/aB3dE5fG7h");
    expect(keyResultLinkPath({ id: KEY, shortId: null, goalId: GOAL })).toBe(
      `/goals/${GOAL}#kr-${KEY}`,
    );
  });
});

describe("the page at its key, with the query the short link came with", () => {
  it("keeps every parameter, and adds to a query already in the path", () => {
    expect(withQuery(`/goals/${KEY}`, {})).toBe(`/goals/${KEY}`);
    expect(
      withQuery(`/goals/${KEY}`, { at: "2026-11-10", id: undefined }),
    ).toBe(`/goals/${KEY}?at=2026-11-10`);
    expect(withQuery("/cycle", { cycle: KEY, phase: "4" })).toBe(
      `/cycle?cycle=${KEY}&phase=4`,
    );
    expect(withQuery("/cycle?x=1", { team: ["a", "b"] })).toBe(
      "/cycle?x=1&team=a&team=b",
    );
  });
});
