import { describe, expect, it } from "vitest";
import { canonThresholds } from "../src/thresholds.ts";
import {
  closeIsSandbagged,
  commitmentDueToday,
  committedBelowFloor,
  confidenceIsCritical,
  draftIsSandbagged,
  objectivesOverCap,
  phasesClosingToday,
  streakAtRisk,
} from "../src/trigger-conditions.ts";

/** The conditions behind the twelve silent §6.4 triggers (H-11). */
const thresholds = canonThresholds();

describe("confidence.critical", () => {
  it("fires at and below §3.2's critical line, and never on no answer", () => {
    expect(confidenceIsCritical(0.3, thresholds)).toBe(true);
    expect(confidenceIsCritical(0.1, thresholds)).toBe(true);
    expect(confidenceIsCritical(0.31, thresholds)).toBe(false);
    expect(confidenceIsCritical(null, thresholds)).toBe(false);
  });
});

describe("quality.committed_floor (METHOD.md §3.2, P9-T11b-c)", () => {
  it("fires on a committed key result below the floor, never on an aspirational one", () => {
    expect(
      committedBelowFloor(
        [
          { confidence: 0.9, kind: "committed" },
          { confidence: 0.4, kind: "committed" },
        ],
        thresholds,
      ),
    ).toBe(true);
    expect(
      committedBelowFloor(
        [{ confidence: 0.4, kind: "aspirational" }],
        thresholds,
      ),
    ).toBe(false);
  });

  it("is quiet at the floor and on a key result nobody has given a confidence", () => {
    expect(
      committedBelowFloor([{ confidence: 0.7, kind: "committed" }], thresholds),
    ).toBe(false);
    expect(
      committedBelowFloor(
        [{ confidence: null, kind: "committed" }],
        thresholds,
      ),
    ).toBe(false);
  });
});

describe("commitment.due", () => {
  it("falls on the Friday of the commitment's week", () => {
    // The week of Monday 5 October 2026.
    expect(commitmentDueToday("2026-10-05", "2026-10-09")).toBe(true);
    expect(commitmentDueToday("2026-10-05", "2026-10-08")).toBe(false);
    // A week start written mid-week still means that week.
    expect(commitmentDueToday("2026-10-07", "2026-10-09")).toBe(true);
  });
});

describe("streak.at_risk", () => {
  const base = {
    today: "2026-10-09",
    currentWeeks: 4,
    lastSessionOn: "2026-10-01",
    bookedLaterThisWeek: false,
  };
  it("fires on the Friday of a week with no session after one held last week", () => {
    expect(streakAtRisk(base)).toBe(true);
  });
  it("is quiet on any other day, with nothing to lose, or with a session still ahead", () => {
    expect(streakAtRisk({ ...base, today: "2026-10-08" })).toBe(false);
    expect(streakAtRisk({ ...base, currentWeeks: 0 })).toBe(false);
    expect(streakAtRisk({ ...base, bookedLaterThisWeek: true })).toBe(false);
    // Held this week already.
    expect(streakAtRisk({ ...base, lastSessionOn: "2026-10-06" })).toBe(false);
    // Already broken: the last one was two weeks ago.
    expect(streakAtRisk({ ...base, lastSessionOn: "2026-09-24" })).toBe(false);
  });
  it("is quiet in a holiday week, and reads the week before a holiday as the last one (P9-T19b-a)", () => {
    const holiday = [{ startsOn: "2026-10-05", endsOn: "2026-10-11" }];
    // The Friday of the holiday itself: nothing can break.
    expect(streakAtRisk({ ...base, holidays: holiday })).toBe(false);
    // The Friday after it, with the last session the week before it.
    expect(
      streakAtRisk({
        ...base,
        today: "2026-10-16",
        lastSessionOn: "2026-10-01",
        holidays: holiday,
      }),
    ).toBe(true);
    expect(
      streakAtRisk({
        ...base,
        today: "2026-10-16",
        lastSessionOn: "2026-10-01",
      }),
    ).toBe(false);
  });
});

describe("cycle.phase_blocked", () => {
  it("reads each phase's window from the §2.4 timeline", () => {
    // Quarterly, as §2.4 prints it: phase 1 four weeks before, so due three
    // weeks out; phase 2 two weeks before, due one week out; phases 3 to 5
    // by the start. The teams' step runs after the start and closes nothing.
    expect(phasesClosingToday("quarterly", 21)).toEqual([1]);
    expect(phasesClosingToday("quarterly", 14)).toEqual([]);
    expect(phasesClosingToday("quarterly", 7)).toEqual([2]);
    expect(phasesClosingToday("quarterly", 0)).toEqual([3, 4, 5]);
    expect(phasesClosingToday("quarterly", 10)).toEqual([]);
    // Annual: phase 1 runs 6 to 5 weeks before, so it is due four weeks out.
    expect(phasesClosingToday("annual", 28)).toEqual([1]);
    expect(phasesClosingToday("annual", 0)).toEqual([5]);
  });
});

describe("quality.too_many_objectives", () => {
  it("names the company level and each unit over its cap", () => {
    const company = Array.from({ length: 6 }, () => ({
      level: "company",
      unitId: null,
    }));
    const team = Array.from({ length: 4 }, () => ({
      level: "team",
      unitId: "s1",
      unitName: "Growth",
    }));
    expect(objectivesOverCap([...company, ...team], thresholds)).toEqual([
      "6 company objectives, above the cap of 5",
      "Growth holds 4 objectives, above the cap of 3",
    ]);
    expect(objectivesOverCap(team.slice(0, 3), thresholds)).toEqual([]);
  });
});

describe("the two sandbagging checks", () => {
  const aspirational = (confidence: number | null) => ({
    confidence,
    kind: "aspirational" as const,
  });
  const committed = (confidence: number | null) => ({
    confidence,
    kind: "committed" as const,
  });

  it("fire above their §11 lines on aspirational key results and ignore unanswered ones", () => {
    expect(
      draftIsSandbagged(
        [aspirational(0.95), aspirational(0.92), aspirational(null)],
        thresholds,
      ),
    ).toBe(true);
    expect(
      draftIsSandbagged([aspirational(0.9), aspirational(0.9)], thresholds),
    ).toBe(false);
    expect(draftIsSandbagged([aspirational(null)], thresholds)).toBe(false);
  });

  it("leave committed key results out, where high confidence is right (P9-T11a)", () => {
    expect(draftIsSandbagged([committed(0.95), committed(1)], thresholds)).toBe(
      false,
    );
    expect(
      draftIsSandbagged([committed(0.95), aspirational(0.5)], thresholds),
    ).toBe(false);
  });

  it("at the close, three quarters or more of the aspirational key results at 1.0 is the pattern", () => {
    const score = (value: number, kind: "aspirational" | "committed") => ({
      score: value,
      kind,
    });
    expect(
      closeIsSandbagged(
        [
          score(1, "aspirational"),
          score(1, "aspirational"),
          score(1, "aspirational"),
          score(0.6, "aspirational"),
        ],
        thresholds,
      ),
    ).toBe(true);
    expect(
      closeIsSandbagged(
        [score(1, "aspirational"), score(0.7, "aspirational")],
        thresholds,
      ),
    ).toBe(false);
    // A row of commitments met is the point of them.
    expect(
      closeIsSandbagged(
        [score(1, "committed"), score(1, "committed")],
        thresholds,
      ),
    ).toBe(false);
  });
});
