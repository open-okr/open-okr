import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import { describe, expect, test } from "vitest";
import { navBlocks } from "../lib/nav-groups.ts";

/**
 * §3's three separated sidebar blocks. The sidebar drew one flat column of
 * eleven items until 2026-09-01, because the registry had no way to say which
 * block an item was in.
 */
describe("navBlocks", () => {
  const items = navigationFor("sidebar", ACCESS_LEVELS.full);

  test("splits the registry into labelled blocks, in order", () => {
    const blocks = navBlocks(items);
    expect(blocks.map((b) => b.id)).toEqual([
      "primary",
      "practice",
      "spaces",
      "account",
    ]);
    expect(blocks.map((b) => b.label)).toEqual([
      undefined,
      "Practice",
      "Spaces",
      "Account",
    ]);
  });

  test("loses no item and duplicates none", () => {
    const flattened = navBlocks(items).flatMap((b) => b.items.map((i) => i.id));
    expect(flattened.slice().sort()).toEqual(items.map((i) => i.id).sort());
    expect(new Set(flattened).size).toBe(flattened.length);
  });

  test("drops a block whose only module is out of reach", () => {
    // A reader below every module's level sees nothing, and an empty block
    // must not render as a heading with no rows under it.
    const blocks = navBlocks(items.filter((item) => item.group === "practice"));
    expect(blocks.map((b) => b.id)).toEqual(["practice"]);
  });

  test("the first block carries no heading", () => {
    const first = navBlocks(items)[0];
    expect(first?.label).toBeUndefined();
    // Named rather than counted, so an item landing in the wrong group is a
    // failure here rather than a surprise in the sidebar. Search joined them at
    // P5-T13: every member searches and the index filters each row by access,
    // so it is a destination rather than a part of the practice.
    expect(first?.items.map((i) => i.id)).toEqual([
      "overview",
      "review",
      "search",
    ]);
  });
});
