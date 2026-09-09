import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readScreen } from "./screen-text.ts";

/**
 * Phase 0 lists the year's objectives under the strategy each serves
 * (S-05, P6-G14b, GAP-AUDIT B-03).
 *
 * P6-G14 gave the frame an editor and split this out rather than half-build
 * it. §2.1's frame is two to five strategies, and until migration 0076 nothing
 * could point at one: a goal named a parent goal, a parent key result, a
 * cycle, a space and a member, and never the strategy it existed to advance.
 *
 * The read, the link and the count are proved against a real database in
 * `packages/core/test/cycles.test.ts`. What is checked here is the panel's own
 * two judgements: that an unlinked objective is surfaced rather than filed
 * away, and that the frame's agreement is reported from the existing gate
 * rather than from a rule invented for the occasion.
 */

const at = (path: string) =>
  readScreen(fileURLToPath(new URL(path, import.meta.url)));

const panel = at("../app/cycle/annual-objectives.tsx");
const actions = at("../app/cycle/frame-actions.ts");
const page = at("../app/cycle/page.tsx");

describe("the year's objectives on phase 0", () => {
  test("reads and writes through the registry", () => {
    expect(page).toContain('"frame.annualObjectives"');
    expect(actions).toContain('"goals.update"');
    expect(actions).toContain('"goals.create"');
  });

  test("an objective serving no strategy gets its own heading", () => {
    // §2.1's whole point. Filing it silently under "other" is the screen not
    // doing its job.
    expect(panel).toContain("Serving no strategy");
    expect(panel).toContain("one.strategyId === null");
  });

  test("a strategy with nothing under it says so", () => {
    expect(panel).toContain("Nothing is moving this strategy");
  });

  test("the frame's agreement is the existing gate, not a new rule", () => {
    // The annual planning gate already refuses to pass without recorded
    // agreement. Inventing a second rule key for it would be changing
    // practice, which is a human decision.
    expect(panel).toContain("frameAgreed");
    expect(panel).toContain("the annual\n            planning gate");
    expect(panel).not.toContain("ruleKey");
  });

  test("sending forward asks for a quarter by name", () => {
    // `cycles.ensureCurrent` defaults to the most recent cycle's cadence, and
    // a workspace that has opened an annual cycle for its frame has an annual
    // one as its most recent. A bare call here built the annual period
    // containing today and put "this quarter's objective" into it.
    expect(actions).toContain('cadence: "quarterly"');
  });

  test("sending forward is goals.create with a parent, not a new verb", () => {
    // The parent pointer is the link the alignment engine already reads.
    expect(actions).toContain("parentGoalId: goalId");
    expect(actions).not.toContain('"goals.sendForward"');
  });
});
