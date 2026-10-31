import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import { describe, expect, test } from "vitest";
import { navBlocks } from "../lib/nav-groups.ts";

/**
 * The sidebar's blocks. Regrouped at P9-T07a-b into OKR and Work, and again
 * into five areas after the OKRGoal UX review (navigation-five-areas.md):
 * Home, Updates, Goals, Work, the spaces term and Cycle, in one unheaded
 * block, with the screens they replaced as tabs inside them.
 */
describe("navBlocks", () => {
  const items = navigationFor("sidebar", ACCESS_LEVELS.full);

  test("draws the areas in one block, and the account rows apart", () => {
    const blocks = navBlocks(items);
    expect(blocks.map((b) => b.id)).toEqual(["primary", "account"]);
    expect(blocks[0]?.label).toBeUndefined();
    expect(blocks[0]?.items.map((i) => i.id)).toEqual([
      "overview",
      "review",
      "goals",
      "initiatives",
      "spaces",
      "cycle",
    ]);
  });

  test("loses no item and duplicates none", () => {
    const flattened = navBlocks(items).flatMap((b) => b.items.map((i) => i.id));
    expect(flattened.slice().sort()).toEqual(items.map((i) => i.id).sort());
    expect(new Set(flattened).size).toBe(flattened.length);
  });

  test("drops a block whose only module is out of reach", () => {
    const blocks = navBlocks(items.filter((item) => item.group === "account"));
    expect(blocks.map((b) => b.id)).toEqual(["account"]);
  });

  test("puts each replaced row inside the area that holds it", () => {
    const inside = navigationFor("inside", ACCESS_LEVELS.full);
    expect(inside.map((item) => [item.id, item.parent ?? null]).sort()).toEqual(
      [
        ["board", "initiatives"],
        ["check-in", "goals"],
        ["inbox", "review"],
        ["kpis", "goals"],
        ["map", "goals"],
        ["scorecard", "cycle"],
        ["search", null],
        ["sessions", "cycle"],
      ],
    );
    expect(items.map((item) => item.id)).not.toContain("inbox");
  });
});
