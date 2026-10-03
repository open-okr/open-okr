import { describe, expect, it } from "vitest";
import { applyEnforcement } from "../src/enforcement.ts";
import { defaultPractice } from "../src/practice.ts";
import {
  evaluateKeyResults,
  evaluateObjective,
  type KeyResultInput,
} from "../src/quality.ts";
import { canonThresholds } from "../src/thresholds.ts";

/**
 * The published OKRs METHOD-REVIEW.md §3.4 ran the shipped checker against,
 * re-run after P9-T03a.
 *
 * Before Phase 9, six of nine published objectives failed OBJ-1, including
 * Doerr's own example and Wodtke's good one, and "Increase revenue from $2M to
 * $3M" passed because "to" was a why marker. METHOD.md §4 now says no word
 * list blocks by default: a person decides what blocks, not a word. This
 * records what each example gets now, on the recommended practice, so a
 * change that makes a word-list check refuse a published OKR again fails here
 * by name.
 *
 * The two "pure output" key results still pass. A word list cannot see that
 * lines of code are an output, and METHOD.md says so: "a word list will always
 * be behind English". They are kept as a record of what the checks miss.
 */

const thresholds = canonThresholds();
const practice = defaultPractice();

const objectiveVerdict = (title: string) =>
  applyEnforcement(
    evaluateObjective(
      {
        title,
        hasCycle: true,
        hasTimeframe: false,
        championId: "m1",
        reviewerId: "m2",
        objectivesInUnit: 1,
        level: "team",
      },
      thresholds,
    ),
    practice,
  ).find((verdict) => verdict.id === "OBJ-1")?.status;

const keyResultVerdicts = (
  text: string,
  indicatorType: KeyResultInput["indicatorType"] = null,
) => {
  const verdicts = applyEnforcement(
    evaluateKeyResults(
      {
        keyResults: [
          {
            text,
            baseline: 0,
            target: 1,
            dueOn: "2026-12-31",
            ownerId: "m1",
            indicatorType,
            direction: "increase",
            confidence: 0.5,
          },
        ],
      },
      thresholds,
    ),
    practice,
  );
  const of = (id: string) => verdicts.find((entry) => entry.id === id)?.status;
  return { kr2: of("KR-2"), kr5: of("KR-5") };
};

describe("OBJ-1 on published objectives (METHOD-REVIEW §3.4)", () => {
  const expected: readonly (readonly [string, string, string])[] = [
    ["Build a planning model for their company", "Doerr", "warn"],
    [
      "Create the lowest carbon footprint in our industry",
      "whatmatters",
      "warn",
    ],
    ["Run a 10K in under 50 minutes by June", "whatmatters", "warn"],
    ["Launch an Awesome MVP", "Wodtke's good example", "warn"],
    [
      "Develop the next generation client platform for web applications",
      "Google Chrome",
      "warn",
    ],
    ["Run the best support team in the region", "test case", "warn"],
    ["Sales numbers up 30%", "Wodtke's bad example", "pass"],
    ["Double users", "Wodtke's bad example", "pass"],
    ["Increase revenue from $2M to $3M", "bare metric movement", "warn"],
  ];

  for (const [title, source, status] of expected) {
    it(`${status}: "${title}" (${source})`, () => {
      expect(objectiveVerdict(title)).toBe(status);
    });
  }

  it("fails none of them, because no word list blocks by default", () => {
    for (const [title] of expected) {
      expect(objectiveVerdict(title), title).not.toBe("fail");
    }
  });
});

describe("KR-2 and KR-5 on published key results (METHOD-REVIEW §3.4)", () => {
  it("warns rather than fails a done-or-not-done result, until milestones exist (P9-T12)", () => {
    expect(
      keyResultVerdicts("No one on the team experienced a major injury").kr2,
    ).toBe("warn");
    expect(keyResultVerdicts("Launch xx feature to all users")).toEqual({
      kr2: "warn",
      kr5: "warn",
    });
    expect(
      keyResultVerdicts("Establish the baseline for weekly active teams").kr2,
    ).toBe("warn");
  });

  it("exempts whatmatters' leading indicator from KR-5 once it is tagged leading", () => {
    const text = "Hold 10 meetings with heads of procurement";
    expect(keyResultVerdicts(text, "leading").kr5).toBe("pass");
    expect(keyResultVerdicts(text).kr5).toBe("warn");
  });

  it("still passes pure output that no word list can see", () => {
    for (const text of [
      "Increase lines of code shipped from 10000 to 20000",
      "Increase story points delivered from 40 to 60",
    ]) {
      expect(keyResultVerdicts(text), text).toEqual({
        kr2: "pass",
        kr5: "pass",
      });
    }
  });
});
