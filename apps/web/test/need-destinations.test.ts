import { NEED_KEYS } from "@openokr/method";
import { describe, expect, test } from "vitest";
import { needDestination } from "../app/cycle/need-destinations";

// Plan 0.8.0 F1: every "Still needed here" item leads somewhere.

describe("needDestination", () => {
  test("every key the method package names has a place", () => {
    for (const key of NEED_KEYS) {
      const place = needDestination({ key, text: "x" });
      expect(place.kind === "anchor" ? place.anchor : place.href, key).toMatch(
        /^(need-|pack-|\/)/,
      );
    }
  });

  test("an input pack item leads to its own row", () => {
    expect(needDestination({ key: "pack.item", text: "x", ref: "4" })).toEqual({
      kind: "anchor",
      anchor: "pack-item-4",
      level: "edit",
    });
  });

  test("a failing draft leads to the goal's own page", () => {
    expect(
      needDestination({ key: "goal.quality", text: "x", ref: "g-1" }),
    ).toEqual({ kind: "page", href: "/goals/g-1", level: "edit" });
  });

  test("the roles are for whoever can set up the cycle (plan 0.8.0 R1)", () => {
    expect(needDestination({ key: "role.sponsor", text: "x" }).level).toBe(
      "setup",
    );
  });
});
