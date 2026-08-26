import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLOSE_DECISION_MEANINGS,
  lowestProcessHealthStatement,
  MANAGEMENT_RETRO_QUESTIONS,
  PROCESS_HEALTH_STATEMENTS,
  REVIEW_STAGE_KEYS,
  REVIEW_STAGES,
  RHYTHM_STATEMENTS,
  RITUALS,
  ROOT_CAUSES,
  reviewStageKey,
  reviewStages,
  rhythmDiagnostic,
  rhythmScore,
  roomPulseRead,
  WEEKLY_STEPS,
} from "../src/sessions.ts";
import { canonThresholds, resolveThresholds } from "../src/thresholds.ts";

/**
 * The rituals as data (P4-T01f).
 *
 * The statement and question lists are compared against METHOD.md itself, so
 * editing the document without editing the package fails here rather than
 * shipping a survey that asks something the method does not.
 */

const thresholds = canonThresholds();
const method = readFileSync(
  join(import.meta.dirname, "../../../docs/development-plan/METHOD.md"),
  "utf8",
);

describe("§8.1's eleven stages", () => {
  it("are all here, numbered in order", () => {
    expect(REVIEW_STAGES).toHaveLength(11);
    expect(REVIEW_STAGES.map((entry) => entry.stage)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  it("sum to the sixty minutes §7.1 gives the quarterly review", () => {
    // The minutes come from §11's `sessions.quarterlyStageMinutes`, not from
    // this list. The list carries the order, which §11 says is canon.
    const total = reviewStages(thresholds).reduce(
      (sum, entry) => sum + entry.minutes,
      0,
    );
    expect(total).toBe(60);
    expect(RITUALS.find((r) => r.kind === "quarterly")?.length).toBe(
      "60 minutes",
    );
  });

  it("takes its durations from the registry, so a tuned workspace is timed by its own numbers", () => {
    const tuned = resolveThresholds({
      "sessions.quarterlyStageMinutes": [10, 12, 9, 3, 7, 3, 5, 3, 5, 4, 4],
    });
    expect(reviewStages(tuned)[0]?.minutes).toBe(10);
    expect(reviewStages(thresholds)[0]?.minutes).toBe(5);
  });

  it("each carry one stage key, in the same order (P4-T10a-a)", () => {
    // The keys are what `sessions.stage_key`, `sessions.elapsed` and
    // `sessions.notes` are keyed by, so the pairing with the stage numbers has
    // to hold or a stored note stops resolving to the stage it was written in.
    expect(REVIEW_STAGE_KEYS).toHaveLength(REVIEW_STAGES.length);
    expect(new Set(REVIEW_STAGE_KEYS).size).toBe(REVIEW_STAGE_KEYS.length);
    for (const stage of REVIEW_STAGES) {
      expect(reviewStageKey(stage.stage)).toBe(
        REVIEW_STAGE_KEYS[stage.stage - 1],
      );
    }
    // Out of range is null rather than undefined-shaped, so a caller has one
    // thing to check.
    expect(reviewStageKey(0)).toBeNull();
    expect(reviewStageKey(12)).toBeNull();
  });

  it("group into the four acts, in the document's order", () => {
    const acts = REVIEW_STAGES.map((entry) => entry.act);
    // An act never resumes after another has started: the rail is drawn in
    // these four blocks and a stage out of place would break the grouping.
    expect(acts).toEqual([
      "open",
      "review",
      "review",
      "review",
      "retro",
      "retro",
      "retro",
      "retro",
      "reset",
      "reset",
      "reset",
    ]);
  });

  it("carry each stage title the document lists", () => {
    for (const stage of REVIEW_STAGES) {
      expect(method).toContain(stage.title);
    }
  });
});

describe("§7.2's four steps", () => {
  it("are all here, in order", () => {
    expect(WEEKLY_STEPS).toHaveLength(4);
    expect(WEEKLY_STEPS.map((entry) => entry.step)).toEqual([1, 2, 3, 4]);
    for (const step of WEEKLY_STEPS) {
      expect(method).toContain(step.title);
    }
  });
});

describe("§8.8's close decisions", () => {
  it("carry the document's three meanings, word for word", () => {
    // Read back out of METHOD.md rather than restated here. The three words
    // themselves live in `packages/db` as GOAL_CLOSE_DECISIONS because a goal
    // stores which one it ended on; what belongs to the method is what each one
    // means, and a screen writing its own gloss on "modify" is drift.
    expect(Object.keys(CLOSE_DECISION_MEANINGS)).toEqual([
      "keep",
      "modify",
      "abandon",
    ]);
    for (const meaning of Object.values(CLOSE_DECISION_MEANINGS)) {
      expect(method).toContain(meaning);
    }
  });

  it("states the rule the stage exists for", () => {
    // §8.8's closing line, and the reason no decision is pre-selected anywhere.
    expect(method).toContain("Nothing carries over by default.");
  });
});

describe("§8.4's root causes", () => {
  it("are the document's eight, word for word", () => {
    // Read back out of METHOD.md rather than restated here, so editing either
    // one without the other fails the build. Same shape as the §8.5 statements
    // and the §8.7 questions below.
    expect(ROOT_CAUSES).toHaveLength(8);
    for (const cause of ROOT_CAUSES) {
      expect(method).toContain(cause);
    }
  });

  it("keeps the document's order, because the picker shows it", () => {
    // §8.4 numbers them, and a room reading the picker top to bottom should be
    // reading the document. A set comparison would pass on a shuffled list.
    const section = method.slice(
      method.indexOf("### 8.4 Root causes"),
      method.indexOf("### 8.5 Process health"),
    );
    let cursor = -1;
    for (const cause of ROOT_CAUSES) {
      const at = section.indexOf(cause);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
  });
});

describe("§8.5's process-health statements", () => {
  it("are the document's five, word for word", () => {
    expect(PROCESS_HEALTH_STATEMENTS).toHaveLength(5);
    for (const statement of PROCESS_HEALTH_STATEMENTS) {
      expect(method).toContain(statement);
    }
  });

  it("names which two the rhythm score averages, rather than hiding the indexes", () => {
    expect(RHYTHM_STATEMENTS).toEqual([2, 5]);
    // §8.6: the average of statements 2 and 5. Those are the cadence one and
    // the say-it-early one, which is why they read the rhythm rather than the
    // results.
    expect(PROCESS_HEALTH_STATEMENTS[1]).toContain("check-in cadence");
    expect(PROCESS_HEALTH_STATEMENTS[4]).toContain("said so early");
  });

  it("averages only the two named statements", () => {
    // 1 and 5 are the ones being averaged; the other three are deliberately
    // extreme so a bug that averaged all five would not land on 3.
    expect(rhythmScore([5, 1, 5, 5, 5])).toBe(3);
  });

  it("returns null when a rhythm statement went unanswered", () => {
    // A diagnostic built on a missing answer is worse than none, because it
    // reads as evidence.
    expect(rhythmScore([5, null, 5, 5, 5])).toBeNull();
    expect(rhythmScore([])).toBeNull();
  });

  it("finds the lowest statement, which becomes next cycle's process OKR", () => {
    const lowest = lowestProcessHealthStatement([4, 4, 2, 5, 3]);
    expect(lowest?.position).toBe(3);
    expect(lowest?.statement).toBe(PROCESS_HEALTH_STATEMENTS[2]);
  });

  it("keeps the earlier statement on a tie, so the answer is not iteration order", () => {
    expect(lowestProcessHealthStatement([2, 2, 5, 5, 5])?.position).toBe(1);
  });

  it("has no lowest statement when nobody answered", () => {
    expect(lowestProcessHealthStatement([null, null])).toBeNull();
  });
});

describe("§8.7's management retro", () => {
  it("asks the document's four questions", () => {
    expect(MANAGEMENT_RETRO_QUESTIONS).toHaveLength(4);
    for (const question of MANAGEMENT_RETRO_QUESTIONS) {
      expect(method).toContain(question);
    }
  });
});

describe("§8.6's rhythm diagnostic", () => {
  const cycleFloor = thresholds["sessions.diagnosticCycleScore"];
  const rhythmFloor = thresholds["sessions.diagnosticRhythmScore"];

  it("reads a delivered cycle without consulting the rhythm at all", () => {
    // The first row is the whole answer when it holds. A delivered cycle raises
    // a question about ambition, not about process, so a terrible rhythm score
    // must not change the verdict.
    expect(rhythmDiagnostic(cycleFloor, 1, thresholds).kind).toBe(
      "results_delivered",
    );
    expect(rhythmDiagnostic(0.95, 5, thresholds).kind).toBe(
      "results_delivered",
    );
  });

  it("blames the OKRs when the team ran the rhythm and still missed", () => {
    const result = rhythmDiagnostic(cycleFloor - 0.01, rhythmFloor, thresholds);
    expect(result.kind).toBe("strategy_or_quality");
    expect(result.prescription).toContain(
      "Fix the key results before you push the team",
    );
  });

  it("blames the cadence when neither held", () => {
    const result = rhythmDiagnostic(
      cycleFloor - 0.01,
      rhythmFloor - 0.01,
      thresholds,
    );
    expect(result.kind).toBe("rhythm");
    expect(result.prescription).toContain(
      "Restore the weekly check-in before you rewrite a single objective",
    );
  });

  it("prescribes opposite fixes either side of the rhythm threshold", () => {
    // Getting this backwards is the failure §8.6 exists to prevent: pushing a
    // team that already ran the rhythm, or rewriting objectives for a team that
    // never met. One hundredth of a point apart, opposite instructions.
    const ran = rhythmDiagnostic(0.5, rhythmFloor, thresholds);
    const skipped = rhythmDiagnostic(0.5, rhythmFloor - 0.01, thresholds);
    expect(ran.prescription).not.toBe(skipped.prescription);
  });

  it("reads every verdict and prescription out of the document", () => {
    for (const [cycle, rhythmValue] of [
      [0.9, 5],
      [0.5, 4],
      [0.5, 2],
    ] as const) {
      const result = rhythmDiagnostic(cycle, rhythmValue, thresholds);
      expect(method).toContain(result.diagnosis);
      expect(method).toContain(result.prescription);
    }
  });
});

describe("section 8.2's read of the room (P4-T10a-b)", () => {
  it("reads every band's sentence out of the document", () => {
    // The same conformance the diagnostic gets: a facilitator acts on these
    // words, so a paraphrase would be the product giving different advice than
    // the method does.
    for (const pulses of [
      [5, 4],
      [3, 4],
      [1, 2],
    ]) {
      const result = roomPulseRead(pulses, thresholds);
      expect(result).not.toBeNull();
      expect(method).toContain(result?.read);
    }
  });

  it("puts the boundaries where the document puts them", () => {
    // "4.0 and above", "3.0 to 3.9", "below 3.0". Inclusive at the top of each
    // band, exclusive at the bottom, and the boundary values themselves are
    // the cases most likely to be written the wrong way round.
    expect(roomPulseRead([4], thresholds)?.band).toBe("energetic");
    expect(roomPulseRead([3.9], thresholds)?.band).toBe("steady");
    expect(roomPulseRead([3], thresholds)?.band).toBe("steady");
    expect(roomPulseRead([2.99], thresholds)?.band).toBe("costly");
  });

  it("takes its boundaries from the registry, not from literals", () => {
    // A workspace that retuned the bands is read by its own numbers. Four is
    // energetic by default and merely steady once the bar moves to 4.5.
    const strict = resolveThresholds({
      "sessions.roomPulseBands": { high: 4.5, low: 3.5 },
    });
    expect(roomPulseRead([4], thresholds)?.band).toBe("energetic");
    expect(roomPulseRead([4], strict)?.band).toBe("steady");
  });

  it("returns nothing when nobody has spoken", () => {
    // An empty room is not a costly one. Telling a facilitator the cycle cost
    // something before anybody has given a pulse would be the product
    // inventing a mood.
    expect(roomPulseRead([], thresholds)).toBeNull();
  });

  it("carries the average it read, unrounded", () => {
    // The screen decides how to display it. Rounding here would make 3.95 show
    // as 4.0 beside the sentence for a steady room, which reads as a bug in the
    // bands rather than a rounding choice.
    expect(roomPulseRead([4, 3, 4, 5], thresholds)?.average).toBe(4);
    expect(roomPulseRead([3, 4], thresholds)?.average).toBe(3.5);
  });
});
