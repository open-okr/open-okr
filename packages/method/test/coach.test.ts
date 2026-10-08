import { describe, expect, it } from "vitest";
import { COACH_LINES, coachLineFor, coachSentence } from "../src/coach.ts";

/**
 * What the coach says (METHOD.md §10, P9-T21).
 *
 * The comparison against the document's own words is `pnpm method:check`.
 * These tests guard what a caller relies on: one line per rule, and a line
 * that reads as a sentence wherever it lands.
 */

describe("the coach's lines", () => {
  it("are §10's twenty situations", () => {
    expect(COACH_LINES).toHaveLength(20);
  });

  it("cite one rule each, so a rule has at most one line", () => {
    const keys = COACH_LINES.map((line) => line.ruleKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("finds a line by its rule, and nothing for a rule §10 does not name", () => {
    expect(coachLineFor("checkin.stale")?.says).toBe(
      "This goal is stale. It cannot quietly stay green",
    );
    expect(coachLineFor("checkin.due")).toBeUndefined();
  });

  it("reads as a sentence: its own question mark kept, a full stop added", () => {
    const question = coachLineFor("OBJ-1");
    const statement = coachLineFor("confidence.critical");
    expect(question && coachSentence(question)).toBe(
      "If we do it and nothing changes, did we succeed?",
    );
    expect(statement && coachSentence(statement)).toBe(
      "What changed? Name the next action.",
    );
  });
});
