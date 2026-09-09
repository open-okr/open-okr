import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BLOCKER_TYPE_DEFINITIONS, resolveThresholds } from "@openokr/method";
import { describe, expect, test } from "vitest";

/**
 * The weekly session shows what its own tables hold (S-22, P6-G19b).
 *
 * **B-10's remaining half.** The screen carried a sentence saying the trend,
 * the blockers and the streak would arrive, naming the tasks that had already
 * built all three tables. The diagnose stage rendered nothing at all, so a
 * room could not raise a blocker in the session that found one, and the gate
 * below it refuses to advance while a low-confidence key result has no
 * blocker: the weekly ritual was unfinishable from the browser in any week
 * that was going badly.
 *
 * Behaviour is proved against a database in `packages/core`. What is checked
 * here is the wiring and, twice over, that no threshold or taxonomy was
 * written out by hand on the way to the browser.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/**
 * Source with its comments taken out.
 *
 * A "this file must not contain 0.7" assertion is about the code, and the
 * comment explaining why 0.7 is not in the code contains it. Stripping first
 * keeps the assertion honest without forbidding the explanation.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const figures = at("../lib/weekly-figures.tsx");
const blockers = at("../app/session/[id]/blocker-panel.tsx");
const blockerActions = at("../app/session/[id]/blocker-actions.ts");
const page = at("../app/session/[id]/page.tsx");

describe("the weekly session panels", () => {
  test("call the reads and writes that had no caller", () => {
    for (const action of [
      "sessions.confidenceTrend",
      "sessions.readStreak",
      "sessions.blockerStatus",
    ]) {
      expect(page).toContain(`"${action}"`);
    }
    for (const action of [
      "sessions.createBlocker",
      "sessions.resolveBlocker",
      "sessions.reassignBlocker",
      "sessions.setCoordinatorNote",
    ]) {
      expect(blockerActions).toContain(`"${action}"`);
    }
  });

  test("the trend's colours are §3.2's bands, not numbers written here", () => {
    // The first draft compared against 0.7 and 0.4 in this component, which
    // is the same hardcoding P6-G19a had just removed from the stage gate.
    const thresholds = resolveThresholds();
    expect(thresholds["scoring.confidenceHigh"]).toBe(0.7);
    expect(thresholds["scoring.confidenceLow"]).toBe(0.4);
    expect(code(figures)).not.toContain("0.7");
    expect(code(figures)).not.toContain("0.4");
    expect(figures).toContain("confidenceBand(point.average, thresholds)");
  });

  test("the blocker taxonomy is the canon's, so a sixth type needs no change here", () => {
    expect(BLOCKER_TYPE_DEFINITIONS).toHaveLength(5);
    expect(blockers).toContain("BLOCKER_TYPE_DEFINITIONS.map");
    // And none of the five is named in the component.
    for (const one of BLOCKER_TYPE_DEFINITIONS) {
      expect(code(blockers)).not.toContain(`"${one.type}"`);
    }
  });

  test("the raised type is checked against the canon, not cast", () => {
    // A select is not a guarantee: the value arrives in a form body like any
    // other string.
    expect(blockerActions).toContain(
      "BLOCKER_TYPE_DEFINITIONS.find((one) => one.type === type)",
    );
    expect(blockerActions).not.toContain("as BlockerType");
  });

  test("a short history is drawn short", () => {
    // Padding twelve weeks with zeroes would draw a collapse that never
    // happened, and a team four weeks old would be reading a lie about their
    // own first month.
    expect(figures).toContain("A week with no session is not a point");
    expect(figures).not.toContain("Array.from({ length: weeks }");
  });

  test("the placeholder that named this task is gone", () => {
    expect(page).not.toContain("arrive at P6-G19");
    expect(page).not.toContain("Their tables are already here");
  });
});
