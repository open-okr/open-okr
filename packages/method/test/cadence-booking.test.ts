import { describe, expect, it } from "vitest";
import {
  type BookedRitual,
  cadenceCoverage,
  planCycleCadence,
} from "../src/cadence-booking.ts";

/**
 * §7.1: "Book all of them for the whole cycle before the cycle starts"
 * (completeness review H-08). Q4 2026 runs Thursday 1 October to Thursday
 * 31 December: it starts and ends mid-week, crosses three months, and holds
 * fourteen Monday-to-Sunday weeks, which is every edge the planner has.
 */
const Q4 = { startsOn: "2026-10-01", endsOn: "2026-12-31" } as const;

describe("planning the whole cycle", () => {
  const plan = planCycleCadence(Q4, {
    weekday: 1,
    from: Q4.startsOn,
    existing: [],
  });
  const of = (kind: BookedRitual["kind"]) =>
    plan.filter((row) => row.kind === kind).map((row) => row.on);

  it("books one weekly check-in in each of the fourteen weeks", () => {
    const weekly = of("weekly");
    expect(weekly).toHaveLength(14);
    // The first week has no Monday inside the cycle, so the nearest working
    // day in it is taken; after that every one is a Monday.
    expect(weekly[0]).toBe("2026-10-01");
    expect(weekly[1]).toBe("2026-10-05");
    expect(weekly.at(-1)).toBe("2026-12-28");
  });

  it("books a monthly review in the months the quarterly review does not cover", () => {
    // The last Monday of October and of November. December holds the close.
    expect(of("monthly")).toEqual(["2026-10-26", "2026-11-30"]);
  });

  it("books the quarterly review about two weeks before the cycle ends (P9-T20a)", () => {
    // §8: "held about two weeks before the cycle ends", the §11 review
    // preparation lead. Its week runs 14 to 20 December, around the 17th,
    // and its Monday is the 14th: time to act on what it decides.
    expect(of("quarterly")).toEqual(["2026-12-14"]);
  });

  it("books it at the lead a workspace chose", () => {
    const oneWeek = planCycleCadence(Q4, {
      weekday: 1,
      from: Q4.startsOn,
      existing: [],
      reviewLeadWeeks: 1,
    });
    expect(
      oneWeek.filter((row) => row.kind === "quarterly").map((row) => row.on),
    ).toEqual(["2026-12-21"]);
  });

  it("reads as booked, and a second run books nothing", () => {
    expect(cadenceCoverage(Q4, plan)).toEqual({ booked: true, missing: [] });
    expect(
      planCycleCadence(Q4, { weekday: 1, from: Q4.startsOn, existing: plan }),
    ).toEqual([]);
  });

  it("fills only the gaps around sessions somebody already booked", () => {
    const existing: BookedRitual[] = [
      { kind: "weekly", on: "2026-10-07" },
      { kind: "monthly", on: "2026-10-21" },
    ];
    const gaps = planCycleCadence(Q4, {
      weekday: 1,
      from: Q4.startsOn,
      existing,
    });
    // The week of 5 October and October's review are already booked.
    expect(gaps.some((row) => row.on === "2026-10-05")).toBe(false);
    expect(
      gaps.some(
        (row) => row.kind === "monthly" && row.on.startsWith("2026-10"),
      ),
    ).toBe(false);
    expect(cadenceCoverage(Q4, [...existing, ...gaps]).booked).toBe(true);
  });

  it("books nothing in the past, and the check still names the weeks missed", () => {
    const late = planCycleCadence(Q4, {
      weekday: 3,
      from: "2026-10-20",
      existing: [],
    });
    expect(late.every((row) => row.on >= "2026-10-20")).toBe(true);
    // The week of 19 October is still booked, on its Wednesday.
    expect(late.some((row) => row.on === "2026-10-21")).toBe(true);
    const coverage = cadenceCoverage(Q4, late);
    expect(coverage.booked).toBe(false);
    expect(coverage.missing).toEqual([
      "No weekly check-in is booked in 3 week(s): the weeks from 2026-10-01, 2026-10-05, 2026-10-12",
    ]);
  });
});

describe("reading whether a cycle is booked", () => {
  it("names all three rituals when nothing is booked", () => {
    const coverage = cadenceCoverage(Q4, []);
    expect(coverage.booked).toBe(false);
    expect(coverage.missing).toEqual([
      "No weekly check-in is booked in 14 week(s): the weeks from 2026-10-01, 2026-10-05, 2026-10-12 and 11 more",
      "No monthly review is booked in 3 month(s): 2026-10, 2026-11, 2026-12",
      "No quarterly review is booked for the cycle's close, between 2026-12-14 and 2027-01-07",
    ]);
  });

  it("accepts a quarterly review in the week after the cycle ends", () => {
    const plan = planCycleCadence(Q4, {
      weekday: 1,
      from: Q4.startsOn,
      existing: [{ kind: "quarterly", on: "2027-01-05" }],
    });
    // December now needs its own monthly review, because the close is in
    // January.
    expect(
      plan.some((row) => row.kind === "monthly" && row.on >= "2026-12-01"),
    ).toBe(true);
    expect(
      cadenceCoverage(Q4, [...plan, { kind: "quarterly", on: "2027-01-05" }])
        .booked,
    ).toBe(true);
  });

  it("does not ask for a check-in in a week the cycle only touches on a weekend", () => {
    // August 2026 starts on a Saturday.
    const august = { startsOn: "2026-08-01", endsOn: "2026-08-31" };
    const plan = planCycleCadence(august, {
      weekday: 1,
      from: august.startsOn,
      existing: [],
    });
    expect(plan.some((row) => row.on < "2026-08-03")).toBe(false);
    expect(cadenceCoverage(august, plan).booked).toBe(true);
  });

  it("does not count a weekly check-in outside the cycle", () => {
    const plan = planCycleCadence(Q4, {
      weekday: 1,
      from: Q4.startsOn,
      existing: [],
    }).filter((row) => row.on !== "2026-10-01");
    const coverage = cadenceCoverage(Q4, [
      ...plan,
      { kind: "weekly", on: "2026-09-30" },
    ]);
    expect(coverage.booked).toBe(false);
  });
});

/**
 * §7.1 since METHOD v2 (P9-T19a-d-b): "Every two weeks and monthly are valid
 * check-in frequencies. The streak and the escalation ladders follow
 * whichever is chosen." Booking follows it too.
 */
describe("a space at its own frequency", () => {
  it("books one check-in a fortnight for a space on every two weeks", () => {
    const plan = planCycleCadence(Q4, {
      weekday: 1,
      from: Q4.startsOn,
      existing: [],
      frequency: "biweekly",
    });
    const weekly = plan.filter((row) => row.kind === "weekly");
    // The streak's fortnights, from a fixed Monday: the cycle starts in the
    // last days of one (21 September to 4 October), and ends in the first of
    // another, so eight are touched.
    expect(weekly).toHaveLength(8);
    expect(weekly.map((row) => row.on).slice(0, 3)).toEqual([
      "2026-10-01",
      "2026-10-05",
      "2026-10-19",
    ]);
    expect(cadenceCoverage(Q4, plan, "biweekly")).toEqual({
      booked: true,
      missing: [],
    });
    // The same plan read weekly is short of every week between.
    expect(cadenceCoverage(Q4, plan, "weekly").booked).toBe(false);
  });

  it("books one check-in a month for a monthly space, and names a missing month", () => {
    const plan = planCycleCadence(Q4, {
      weekday: 1,
      from: Q4.startsOn,
      existing: [],
      frequency: "monthly",
    });
    expect(plan.filter((row) => row.kind === "weekly")).toHaveLength(3);
    const withoutNovember = plan.filter(
      (row) => !(row.kind === "weekly" && row.on.startsWith("2026-11")),
    );
    expect(cadenceCoverage(Q4, withoutNovember, "monthly").missing).toContain(
      "No check-in is booked in 1 month(s): the periods from 2026-11-01",
    );
  });
});

/**
 * No check-in is due in a holiday period, so none is booked there and none is
 * missing (P9-T19b-a). The week of Monday 9 November is the holiday.
 */
describe("a holiday in the booking", () => {
  const NOVEMBER = [{ startsOn: "2026-11-09", endsOn: "2026-11-15" }] as const;

  it("books no check-in in the holiday week", () => {
    const plan = planCycleCadence(Q4, {
      weekday: 1,
      from: Q4.startsOn,
      existing: [],
      holidays: NOVEMBER,
    });
    const weekly = plan.filter((ritual) => ritual.kind === "weekly");
    expect(weekly.map((ritual) => ritual.on)).not.toContain("2026-11-09");
    expect(weekly.map((ritual) => ritual.on)).toContain("2026-11-16");
    expect(cadenceCoverage(Q4, plan, "weekly", NOVEMBER)).toEqual({
      booked: true,
      missing: [],
    });
    // Without the holiday, the same plan has a week missing.
    expect(cadenceCoverage(Q4, plan).booked).toBe(false);
  });
});
