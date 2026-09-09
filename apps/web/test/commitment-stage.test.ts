import { fileURLToPath } from "node:url";
import { resolveThresholds } from "@openokr/method";
import { describe, expect, test } from "vitest";
import { readScreen } from "./screen-text.ts";

/**
 * §7.2 step 3 has a surface, and its numbers are the registry's (P6-G19a).
 *
 * **B-10 was a screen telling the room its tables already existed.** The
 * weekly session rendered a sentence naming the tasks that built the
 * commitment, digest and streak tables and offered nothing that read them.
 * `sessions.setCommitments` and `sessions.closeCommitments` shipped at P4-T08
 * with no caller.
 *
 * The behaviour of the rollover, the gate and the verdicts is proved against a
 * real database in `packages/core/test/sessions.test.ts`. What is checked here
 * is the wiring: which actions the stage calls, and that no threshold was
 * written out by hand on the way to the browser.
 */

const at = (path: string) =>
  readScreen(fileURLToPath(new URL(path, import.meta.url)));

const actions = at("../app/session/[id]/commitment-actions.ts");
const panel = at("../app/session/[id]/commitments.tsx");
const page = at("../app/session/[id]/page.tsx");

describe("the commitment stage", () => {
  test("calls the three actions P4-T08 left without a caller", () => {
    expect(actions).toContain('"sessions.setCommitments"');
    expect(actions).toContain('"sessions.closeCommitments"');
    expect(page).toContain('"sessions.carriedCommitments"');
  });

  test("takes the weekly bounds from the workspace, not from the canon", () => {
    // The panel must not know the numbers. A component that renders "2 to 3"
    // from a literal shows the canon default to a workspace that moved its
    // own bound, which is the failure the method rule exists to prevent, and
    // which the gate in `sessions.advanceStage` was committing until P6-G19a.
    const bounds = resolveThresholds()["sessions.weeklyCommitmentBounds"];
    expect(bounds).toEqual({ low: 2, high: 3 });
    expect(panel).not.toContain(`${bounds.low} to ${bounds.high} a week`);
    // The sentence is assembled from catalogue pieces since P6-G22c, so the
    // whole of it is no longer one literal to match. What the test is actually
    // about survives that: the bounds arrive as values and are interpolated.
    expect(panel).toContain("{low}");
    expect(panel).toContain("{high}");
    expect(panel).toContain("a week");
    expect(page).toContain('"sessions.weeklyCommitmentBounds"');
  });

  test("an unanswered verdict leaves the commitment open", () => {
    // Radios, not checkboxes, and nothing preselected. A default of "not
    // delivered" would let the clock mark a commitment failed for a room that
    // simply ran out of time.
    expect(panel).toContain('type="radio"');
    expect(panel).not.toContain("defaultChecked");
    expect(actions).toContain("Nothing was answered");
  });

  test("the form appends rather than replacing, and says so", () => {
    // `sessions.setCommitments` inserts. Offering the filled form again would
    // write every commitment a second time on a second press.
    expect(panel).toContain("already.length === 0 ? high : 1");
    expect(panel).toContain("Add one more");
  });

  test("a stage gate's refusal reaches the facilitator", () => {
    // The advance control was an inline server action inside a plain form, so
    // every gate refusal went to the error boundary: a facilitator standing in
    // front of a room saw "something went wrong" instead of the sentence
    // naming what was missing.
    const control = at("../app/session/[id]/advance-control.tsx");
    expect(actions).toContain("advanceStageWithReason");
    expect(control).toContain('role="alert"');
    // And the action it replaced is gone rather than left behind.
    expect(at("../app/session/[id]/actions.ts")).not.toContain(
      "advanceStageAction",
    );
  });
});
