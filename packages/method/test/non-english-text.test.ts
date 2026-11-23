import { describe, expect, it } from "vitest";
import {
  applyEnforcement,
  canonThresholds,
  evaluateKeyResults,
  evaluateObjective,
  resolvePractice,
  strengthScore,
} from "../src/index.ts";

const HAN =
  "让企业客户在第三季度末之前把满意度提高到百分之九十并且减少流失以及提升续约率";
const NOTICE =
  "The word checks read English only, so this text was not checked for them.";
const thresholds = canonThresholds();

const objective = (title: string) =>
  evaluateObjective(
    {
      title,
      hasCycle: true,
      hasTimeframe: false,
      championId: null,
      reviewerId: null,
      objectivesInUnit: 1,
      level: "team",
    },
    thresholds,
  );

describe("quality checks on non-English text (languages §14)", () => {
  it("excludes the skipped word checks on a Han objective from the score and enforcement", () => {
    const verdicts = objective(HAN);
    const skipped = verdicts.filter(
      (verdict) => verdict.id === "OBJ-1" || verdict.id === "OBJ-2",
    );
    expect(skipped).toHaveLength(2);
    for (const verdict of skipped) {
      expect(verdict).toMatchObject({
        status: "info",
        prompt: NOTICE,
        feedsStrengthScore: false,
      });
    }
    const evaluated = verdicts.filter((verdict) => !skipped.includes(verdict));
    expect(strengthScore(verdicts, thresholds)).toBe(
      strengthScore(evaluated, thresholds),
    );
    const strict = resolvePractice("recommended", { strictMode: "on" });
    expect(
      applyEnforcement(skipped, strict).map((verdict) => verdict.status),
    ).toEqual(["info", "info"]);
  });

  it("checks digits in a Han objective even though it skips word count", () => {
    expect(
      objective(`${HAN} ٩٠`).find((verdict) => verdict.id === "OBJ-2"),
    ).toMatchObject({
      condition: "Contains digits other than a four-digit year",
      feedsStrengthScore: true,
    });
  });

  it.each(["رفع رضا العملاء من ٧٠ إلى ٩٠", "رفع رضا العملاء من ۷۰ إلى ۹۰"])(
    "counts two numbers in a key result written as %s",
    (text) => {
      const verdicts = evaluateKeyResults(
        {
          keyResults: [
            {
              text,
              baseline: 70,
              target: 90,
              dueOn: "2027-03-31",
              ownerId: "member",
              indicatorType: "lagging",
              direction: "increase",
              confidence: 0.7,
            },
          ],
        },
        thresholds,
      );
      expect(verdicts.find((verdict) => verdict.id === "KR-2")?.status).toBe(
        "pass",
      );
      expect(verdicts.find((verdict) => verdict.id === "KR-5")).toMatchObject({
        status: "info",
        prompt: NOTICE,
        feedsStrengthScore: false,
      });
    },
  );

  it("still warns about an English objective starting with Launch", () => {
    expect(
      objective("Launch the new onboarding flow").find(
        (verdict) => verdict.id === "OBJ-1",
      ),
    ).toMatchObject({
      status: "warn",
      condition: "Starts with an output verb",
    });
  });
});
