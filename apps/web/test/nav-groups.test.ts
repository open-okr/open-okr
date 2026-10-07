import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import { describe, expect, test } from "vitest";
import { navBlocks } from "../lib/nav-groups.ts";

/**
 * §3's separated sidebar blocks. The sidebar drew one flat column of eleven
 * items until 2026-09-01, because the registry had no way to say which block
 * an item was in. Regrouped at P9-T07a-b into OKR and Work, per
 * okr-entry-points.md §3.1, with Check in, Sessions and Scorecard moved inside
 * the modules they belong to.
 */
describe("navBlocks", () => {
  const items = navigationFor("sidebar", ACCESS_LEVELS.full);

  test("splits the registry into labelled blocks, in order", () => {
    const blocks = navBlocks(items);
    expect(blocks.map((b) => b.id)).toEqual([
      "primary",
      "okr",
      "work",
      "spaces",
      "account",
    ]);
    expect(blocks.map((b) => b.label)).toEqual([
      undefined,
      "OKR",
      "Work",
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
    const blocks = navBlocks(items.filter((item) => item.group === "okr"));
    expect(blocks.map((b) => b.id)).toEqual(["okr"]);
  });

  test("the first block carries no heading", () => {
    const first = navBlocks(items)[0];
    expect(first?.label).toBeUndefined();
    // Named rather than counted, so an item landing in the wrong group is a
    // failure here rather than a surprise in the sidebar. Search joined them at
    // P5-T13: every member searches and the index filters each row by access,
    // so it is a destination rather than a part of the practice.
    // Inbox joined them at P6-G07a, between Overview and Review, which is
    // where UIUX-PLAN §3 puts it: "Inbox in the primary sidebar block beside
    // Home and Review".
    expect(first?.items.map((i) => i.id)).toEqual([
      "overview",
      "inbox",
      "review",
      "search",
    ]);
  });

  test("holds the OKR block and the Work block in okr-entry-points §3.1's order", () => {
    const blocks = navBlocks(items);
    expect(blocks.find((b) => b.id === "okr")?.items.map((i) => i.id)).toEqual([
      "cycle",
      "goals",
      "kpis",
    ]);
    expect(blocks.find((b) => b.id === "work")?.items.map((i) => i.id)).toEqual(
      ["initiatives", "board"],
    );
    expect(blocks.find((b) => b.id === "okr")?.items[1]?.label).toBe("OKRs");
  });

  test("moves Check in, Sessions and Scorecard inside the module each belongs to", () => {
    const inside = navigationFor("inside", ACCESS_LEVELS.full);
    expect(inside.map((item) => [item.id, item.parent]).sort()).toEqual([
      ["check-in", "goals"],
      ["scorecard", "cycle"],
      ["sessions", "cycle"],
    ]);
    expect(items.map((item) => item.id)).not.toContain("sessions");
  });
});
