import { GATE_TITLES } from "@openokr/method";
import { describe, expect, test } from "vitest";
import { FIX } from "../app/cycle/gates";

/**
 * Where a red gate sends a facilitator (P4-T03, corrected at P6-G17).
 *
 * A checklist that says "gate 4 is red" and stops has told somebody the one
 * thing they already knew from the dot, so every unmet gate links at what would
 * clear it. Gate 4's link pointed at `/cycle?phase=5`, which is the page the
 * gates panel is already on, and nothing there could confirm a dependency: the
 * whole register was unbuilt. The gap audit of 7 September 2026 recorded it as
 * B-04, and this test is what stops a remedy pointing at itself again.
 */

describe("gate remedies", () => {
  test("every gate has one", () => {
    for (let gate = 1; gate <= GATE_TITLES.length; gate++) {
      expect(FIX[gate], `gate ${gate}`).toBeDefined();
      expect(FIX[gate]?.label.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("has one per gate METHOD declares, and no more", () => {
    // A seventh entry would be a remedy for a gate that does not exist, which
    // is a sign somebody renumbered the gates and stopped halfway.
    expect(Object.keys(FIX).map(Number).sort()).toEqual(
      GATE_TITLES.map((_, index) => index + 1),
    );
  });

  test("gate 4 sends a facilitator to the register, not back to the same page", () => {
    // The specific defect. `/cycle?phase=5` is where the gates panel renders,
    // so that link was "go where you already are".
    expect(FIX[4]?.href).toBe("#dependency-register");
  });

  test("no remedy is the page its own panel renders on", () => {
    // The general form. The gates panel renders on phase 5, so a remedy that
    // navigates there has told nobody anything; an anchor into a block on that
    // page is a different thing and is allowed.
    for (const [gate, fix] of Object.entries(FIX)) {
      expect(fix.href, `gate ${gate}`).not.toBe("/cycle?phase=5");
    }
  });
});
