import { describe, expect, it } from "vitest";
import {
  applyStrictness,
  evaluateKeyResults,
  evaluateObjective,
  type KeyResultInput,
  strengthScore,
} from "../src/quality.ts";
import { canonThresholds } from "../src/thresholds.ts";

/**
 * P4-T02b's two measurable requirements.
 *
 * One: evaluation completes inside sixteen milliseconds for a five-key-result
 * objective. Sixteen is one frame at sixty hertz, and the Draft Coach runs on
 * every keystroke with no debounce, so anything slower is felt as the editor
 * lagging behind the typist.
 *
 * Two: the browser and the server produce identical verdicts for the same
 * input. They already run the same functions from the same package, so this
 * asserts what makes that true rather than hoping it stays true: purity. No
 * clock, no locale, no global state, no I/O.
 */

const thresholds = canonThresholds();

/** Five key results, the size the budget is written against. */
const FIVE: KeyResultInput[] = [
  {
    text: "Increase NPS from 32 to 50",
    baseline: 32,
    target: 50,
    dueOn: "2026-09-30",
    ownerId: "m1",
    indicatorType: "lagging",
    direction: "increase",
    confidence: 0.5,
  },
  {
    text: "Cut first-response time from 9h to 2h",
    baseline: 9,
    target: 2,
    dueOn: "2026-09-30",
    ownerId: "m1",
    indicatorType: "leading",
    direction: "reduce",
    confidence: 0.6,
  },
  {
    text: "Hold 12 customer interviews per month",
    baseline: 0,
    target: 12,
    dueOn: "2026-09-30",
    ownerId: "m2",
    indicatorType: "leading",
    direction: "increase",
    confidence: 0.4,
  },
  {
    text: "Raise activation rate of new sign-ups from 41% to 60%",
    baseline: 41,
    target: 60,
    dueOn: "2026-09-30",
    ownerId: "m2",
    indicatorType: "lagging",
    direction: "increase",
    confidence: 0.55,
  },
  {
    text: "Complete the onboarding redesign",
    baseline: 0,
    target: 1,
    dueOn: null,
    ownerId: null,
    indicatorType: "leading",
    direction: "move",
    confidence: null,
  },
];

const OBJECTIVE = {
  title: "Become the preferred platform for mid-market teams",
  hasCycle: true,
  hasTimeframe: false,
  championId: "m1",
  reviewerId: "m2",
  objectivesInUnit: 3,
  level: "company" as const,
};

/** One pass of exactly what the Draft Coach does per keystroke. */
const evaluateOnce = (title: string) => {
  const strictness = thresholds["quality.coachStrictness"];
  const objective = applyStrictness(
    evaluateObjective({ ...OBJECTIVE, title }, thresholds),
    strictness,
  );
  const keyResults = applyStrictness(
    evaluateKeyResults({ keyResults: FIVE }, thresholds),
    strictness,
  );
  return {
    verdicts: [...objective, ...keyResults],
    score: strengthScore([...objective, ...keyResults]),
  };
};

describe("the sixteen-millisecond budget", () => {
  it("evaluates a five-key-result objective well inside one frame", () => {
    // Warm the code paths first, so the measurement is of the work rather than
    // of the first-call compilation.
    for (let index = 0; index < 100; index += 1) {
      evaluateOnce(OBJECTIVE.title);
    }

    const runs = 1000;
    const started = performance.now();
    for (let index = 0; index < runs; index += 1) {
      // A different title each time, because a typist is not typing the same
      // character and a cache that happened to exist would be measured instead
      // of the evaluation.
      evaluateOnce(`${OBJECTIVE.title} ${index}`);
    }
    const perRun = (performance.now() - started) / runs;

    expect(perRun).toBeLessThan(16);
    // The real number is two orders of magnitude under the budget, and a test
    // asserting only "under 16" would keep passing through a hundredfold
    // regression. One millisecond is still comfortably a frame's worth of room.
    expect(perRun).toBeLessThan(1);
  });
});

describe("the browser and the server", () => {
  it("produce identical verdicts, because it is the same pure function", () => {
    // There is no second implementation to compare against, and that is the
    // point: this asserts the property that makes one implementation safe to
    // run in both places. Same input, same output, every time.
    const first = evaluateOnce("Become the preferred platform");
    const second = evaluateOnce("Become the preferred platform");
    expect(second).toEqual(first);
  });

  it("does not read a clock, so two calls a second apart agree", async () => {
    const before = evaluateOnce(OBJECTIVE.title);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(evaluateOnce(OBJECTIVE.title)).toEqual(before);
  });

  it("keeps no state between calls, so order does not change an answer", () => {
    const strong = evaluateOnce("Become the preferred platform for teams");
    const weak = evaluateOnce("Launch the app");
    const strongAgain = evaluateOnce("Become the preferred platform for teams");
    expect(strongAgain).toEqual(strong);
    expect(weak.score).not.toBe(strong.score);
  });

  it("carries the matched condition on every verdict, which the card needs", () => {
    // The prompt says what to do; the condition says what was seen. A card with
    // only the prompt makes a writer guess which part of their sentence did it.
    for (const verdict of evaluateOnce("Launch the app").verdicts) {
      expect(verdict.condition.length).toBeGreaterThan(0);
    }
  });
});
