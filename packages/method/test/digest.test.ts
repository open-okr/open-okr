/**
 * The weekly digest template (METHOD.md §7.2 step 4, P4-T15b-a).
 *
 * §7.2's own sentence lists six parts: "headline average and the change on last
 * week, what is on track, what is at risk with owners, blockers on the 24-hour
 * clock, and the commitment count. The coordinator adds a note for leadership."
 * Each test below is one of those parts, and the first one asserts they all
 * appear, in order, because a digest missing a part is a digest somebody has to
 * go and look something up for.
 */
import { describe, expect, it } from "vitest";
import {
  BLOCKER_CLOCK_HOURS,
  type WeeklyDigestInput,
  weeklyDigestLines,
  weeklyDigestNumbers,
} from "../src/digest.ts";

const base: WeeklyDigestInput = {
  spaceName: "Product",
  weekStart: "2026-08-24",
  averageConfidence: 0.62,
  previousAverageConfidence: 0.55,
  onTrackCount: 3,
  atRiskCount: 1,
  risks: [
    {
      title: "Raise mid-market activation",
      ownerName: "Ada",
      status: "caution",
    },
  ],
  blockers: [
    {
      title: "dependency: chase the billing team",
      ownerName: "Ada",
      ageHours: 30,
    },
  ],
  commitmentCount: 4,
  coordinatorNote: "Billing is the whole story this week.",
};

describe("all six parts, in §7.2's order", () => {
  it("renders them", () => {
    expect(weeklyDigestLines(base)).toEqual([
      "Product, week of 2026-08-24: confidence 62%, up 7 points on last week.",
      "3 objectives on track.",
      "1 at risk: Raise mid-market activation (Ada, caution).",
      "1 blocker open, 1 past the clock: dependency: chase the billing team (Ada, 30h, past the 24-hour clock).",
      "4 commitments for next week.",
      "For leadership: Billing is the whole story this week.",
    ]);
  });
});

describe("the headline and the change on last week", () => {
  it("says level when nothing moved", () => {
    expect(
      weeklyDigestLines({ ...base, previousAverageConfidence: 0.62 })[0],
    ).toContain("level with last week");
  });

  it("says down, in points, when it fell", () => {
    expect(
      weeklyDigestLines({
        ...base,
        averageConfidence: 0.4,
        previousAverageConfidence: 0.55,
      })[0],
    ).toContain("down 15 points on last week");
  });

  it("says nothing about last week when there was none", () => {
    const first = weeklyDigestLines({
      ...base,
      previousAverageConfidence: null,
    })[0];
    expect(first).toContain("confidence 62%");
    expect(first).not.toContain("last week");
  });
});

describe("what is at risk", () => {
  it("names the owner, and says so when there is not one", () => {
    expect(
      weeklyDigestLines({
        ...base,
        risks: [
          { title: "Cut onboarding", ownerName: null, status: "off_track" },
        ],
      })[2],
    ).toBe("1 at risk: Cut onboarding (no owner named, off track).");
  });

  it("says nothing is at risk rather than leaving the line out", () => {
    // A missing line is not information. "Nothing at risk" is.
    expect(weeklyDigestLines({ ...base, atRiskCount: 0, risks: [] })[2]).toBe(
      "Nothing at risk.",
    );
  });

  it("lists several with an and, not a trailing comma", () => {
    expect(
      weeklyDigestLines({
        ...base,
        atRiskCount: 2,
        risks: [
          { title: "One", ownerName: "Ada", status: "caution" },
          { title: "Two", ownerName: "Ben", status: "off_track" },
        ],
      })[2],
    ).toBe("2 at risk: One (Ada, caution) and Two (Ben, off track).");
  });
});

describe("the 24-hour clock", () => {
  it("marks the ones past it and counts them", () => {
    const line = weeklyDigestLines({
      ...base,
      blockers: [
        { title: "One", ownerName: "Ada", ageHours: 30 },
        { title: "Two", ownerName: "Ben", ageHours: 3 },
      ],
    })[3];
    expect(line).toContain("2 blockers open, 1 past the clock");
    expect(line).toContain(
      `One (Ada, 30h, past the ${BLOCKER_CLOCK_HOURS}-hour clock)`,
    );
    expect(line).toContain("Two (Ben, 3h)");
  });

  it("does not mark one exactly at the clock as inside it", () => {
    // §7.2's clock is a deadline. At 24 hours it has run out.
    expect(
      weeklyDigestLines({
        ...base,
        blockers: [{ title: "One", ownerName: "Ada", ageHours: 24 }],
      })[3],
    ).toContain("past the 24-hour clock");
  });

  it("says none are open rather than leaving the line out", () => {
    expect(weeklyDigestLines({ ...base, blockers: [] })[3]).toBe(
      "No blockers open.",
    );
  });
});

describe("the coordinator's note", () => {
  it("is left out when there is not one, because it is the coordinator's own", () => {
    expect(weeklyDigestLines({ ...base, coordinatorNote: null })).toHaveLength(
      5,
    );
    expect(weeklyDigestLines({ ...base, coordinatorNote: "   " })).toHaveLength(
      5,
    );
  });
});

describe("the numbers a narration is allowed to state", () => {
  it("holds every figure the lines state", () => {
    // Derived from the rendered text on purpose: if a line gains a figure and
    // this list does not, the assist starts refusing valid narrations, and that
    // failure would be silent.
    //
    // The week start comes out first, because it is a date rather than a
    // measurement and nothing narrating a digest needs permission to write it.
    const rendered = weeklyDigestLines(base)
      .join(" ")
      .replace(base.weekStart, "");
    const stated = (rendered.match(/\d+/g) ?? []).map(Number);
    expect(stated.length).toBeGreaterThan(0);
    for (const value of stated) {
      expect(weeklyDigestNumbers(base)).toContain(value);
    }
  });

  it("includes the change, both ways round, so either wording passes", () => {
    // A model may write "up 7 points" or "7 points lower". Both are the same
    // measurement and neither is invented.
    expect(weeklyDigestNumbers(base)).toContain(7);
  });

  it("includes each blocker's age", () => {
    expect(
      weeklyDigestNumbers({
        ...base,
        blockers: [
          { title: "One", ownerName: "Ada", ageHours: 30 },
          { title: "Two", ownerName: "Ben", ageHours: 3 },
        ],
      }),
    ).toEqual(expect.arrayContaining([30, 3]));
  });
});
