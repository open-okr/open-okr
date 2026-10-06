/**
 * The weekly digest template (METHOD.md §7.2 step 4, P4-T15b-a, P9-T19a-d-c).
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
      pastCheckIn: true,
    },
  ],
  commitmentCount: 4,
  wins: ["Pricing page live", "Two renewals signed early"],
  staleGoals: [],
  coordinatorNote: "Billing is the whole story this week.",
};

describe("every part, in §7.2's order", () => {
  it("renders them, the wins after the commitments (P9-T19a-d-c)", () => {
    expect(weeklyDigestLines(base)).toEqual([
      "Product, week of 2026-08-24: confidence 62%, up 7 points on last week.",
      "3 objectives on track.",
      "1 at risk: Raise mid-market activation (Ada, caution).",
      "1 blocker open, 1 past its check-in: dependency: chase the billing team (Ada, past its check-in).",
      "4 commitments for next week.",
      "Wins: Pricing page live and Two renewals signed early.",
      "For leadership: Billing is the whole story this week.",
    ]);
  });
});

describe("the wins (§7.2 step 3, P9-T19a-d-c)", () => {
  it("says none were named rather than leaving the line out", () => {
    expect(weeklyDigestLines({ ...base, wins: [] })).toContain(
      "No wins named this week.",
    );
  });
});

describe("stale goals (§11, P9-T19a-c-a)", () => {
  it("names the space's stale goals after what is at risk, and only when there are some", () => {
    const lines = weeklyDigestLines({
      ...base,
      staleGoals: [
        { title: "Keep the platform standing", ownerName: "Leo" },
        { title: "Answer once, in the product", ownerName: null },
      ],
    });
    expect(lines[3]).toBe(
      "2 stale, past the check-in grace: Keep the platform standing (Leo) and Answer once, in the product (no owner named).",
    );
    expect(weeklyDigestLines(base).some((line) => line.includes("stale"))).toBe(
      false,
    );
    expect(
      weeklyDigestNumbers({
        ...base,
        staleGoals: [{ title: "One", ownerName: null }],
      }),
    ).toContain(1);
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

describe("the check-in's clock (§7.3, P9-T19a-a)", () => {
  it("marks the ones past their check-in and counts them", () => {
    const line = weeklyDigestLines({
      ...base,
      blockers: [
        { title: "One", ownerName: "Ada", pastCheckIn: true },
        { title: "Two", ownerName: "Ben", pastCheckIn: false },
      ],
    })[3];
    expect(line).toContain("2 blockers open, 1 past its check-in");
    expect(line).toContain("One (Ada, past its check-in)");
    expect(line).toContain("Two (Ben)");
  });

  it("says their check-in for more than one", () => {
    expect(
      weeklyDigestLines({
        ...base,
        blockers: [
          { title: "One", ownerName: "Ada", pastCheckIn: true },
          { title: "Two", ownerName: "Ben", pastCheckIn: true },
        ],
      })[3],
    ).toContain("2 blockers open, 2 past their check-in");
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
      6,
    );
    expect(weeklyDigestLines({ ...base, coordinatorNote: "   " })).toHaveLength(
      6,
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

  it("includes how many are past their check-in", () => {
    expect(
      weeklyDigestNumbers({
        ...base,
        blockers: [
          { title: "One", ownerName: "Ada", pastCheckIn: true },
          { title: "Two", ownerName: "Ben", pastCheckIn: true },
          { title: "Three", ownerName: "Cy", pastCheckIn: false },
        ],
      }),
    ).toEqual(expect.arrayContaining([3, 2]));
  });
});
