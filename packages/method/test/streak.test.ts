import { describe, expect, it } from "vitest";
import {
  afterCheckIn,
  currentStreakOn,
  lastWorkingDayOfPeriod,
  periodStartOf,
  weekStartOf,
} from "../src/streak.ts";

/**
 * METHOD.md §7.4: consecutive weeks in which a space held its check-in, and a
 * skipped week breaks it (completeness review M-04).
 */
describe("the rhythm streak", () => {
  it("starts weeks on Monday", () => {
    expect(weekStartOf("2026-09-28")).toBe("2026-09-28"); // a Monday
    expect(weekStartOf("2026-10-04")).toBe("2026-09-28"); // the Sunday after
    expect(weekStartOf("2026-10-01")).toBe("2026-09-28");
  });

  it("counts weeks, not sessions", () => {
    const one = afterCheckIn(null, "2026-09-28");
    const sameWeek = afterCheckIn(one, "2026-10-02");
    expect(sameWeek).toEqual(one);
    expect(sameWeek.currentWeeks).toBe(1);
  });

  it("extends on the following week", () => {
    const two = afterCheckIn(afterCheckIn(null, "2026-09-28"), "2026-10-06");
    expect(two).toEqual({
      currentWeeks: 2,
      longestWeeks: 2,
      lastWeek: "2026-10-05",
    });
  });

  it("starts again after a skipped week, keeping the longest", () => {
    let state = afterCheckIn(null, "2026-09-07");
    state = afterCheckIn(state, "2026-09-14");
    state = afterCheckIn(state, "2026-09-21");
    // The week of 28 September holds nothing.
    state = afterCheckIn(state, "2026-10-05");
    expect(state).toEqual({
      currentWeeks: 1,
      longestWeeks: 3,
      lastWeek: "2026-10-05",
    });
  });

  it("ignores a close for a week already behind the run", () => {
    const state = afterCheckIn(afterCheckIn(null, "2026-09-21"), "2026-09-28");
    expect(afterCheckIn(state, "2026-09-14")).toEqual(state);
  });

  it("reads as broken once a whole week passes with nothing held", () => {
    const state = afterCheckIn(afterCheckIn(null, "2026-09-21"), "2026-09-28");
    expect(currentStreakOn(state, "2026-10-02")).toBe(2); // same week
    expect(currentStreakOn(state, "2026-10-09")).toBe(2); // this week's may come
    expect(currentStreakOn(state, "2026-10-12")).toBe(0); // last week was skipped
    expect(currentStreakOn(null, "2026-10-12")).toBe(0);
  });
});

/**
 * §7.4 since METHOD v2 (P9-T19a-d-b): "consecutive check-in periods in which a
 * space held its check-in, at whatever frequency the space runs."
 */
describe("the streak at the space's own frequency", () => {
  it("counts fortnights from a fixed Monday, whatever day a team started", () => {
    expect(periodStartOf("2026-10-05", "biweekly")).toBe(
      periodStartOf("2026-10-18", "biweekly"),
    );
    expect(periodStartOf("2026-10-19", "biweekly")).not.toBe(
      periodStartOf("2026-10-18", "biweekly"),
    );
  });

  it("holds a team on every two weeks through the week between (acceptance)", () => {
    // Checked in on 5 October; nothing in the week of 12 October, which is
    // the week between; checked in again on 19 October.
    let state = afterCheckIn(null, "2026-10-05", "biweekly");
    expect(currentStreakOn(state, "2026-10-16", "biweekly")).toBe(1);
    state = afterCheckIn(state, "2026-10-19", "biweekly");
    expect(state.currentWeeks).toBe(2);
    expect(currentStreakOn(state, "2026-10-30", "biweekly")).toBe(2);
    // On weekly periods the same two check-ins are a break.
    let weekly = afterCheckIn(null, "2026-10-05");
    weekly = afterCheckIn(weekly, "2026-10-19");
    expect(weekly.currentWeeks).toBe(1);
  });

  it("breaks a fortnightly run once a whole fortnight passes with nothing", () => {
    const state = afterCheckIn(null, "2026-10-05", "biweekly");
    const after = periodStartOf("2026-10-05", "biweekly");
    // Two fortnights on, nothing held in the one between.
    const later = new Date(Date.parse(`${after}T00:00:00Z`) + 28 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(currentStreakOn(state, later, "biweekly")).toBe(0);
  });

  it("counts calendar months for a monthly space", () => {
    let state = afterCheckIn(null, "2026-09-28", "monthly");
    state = afterCheckIn(state, "2026-10-02", "monthly");
    expect(state.currentWeeks).toBe(2);
    expect(state.lastWeek).toBe("2026-10-01");
    expect(currentStreakOn(state, "2026-11-30", "monthly")).toBe(2);
    expect(currentStreakOn(state, "2026-12-01", "monthly")).toBe(0);
  });

  it("reads a daily space's streak in weeks, the rhythm it meets in", () => {
    expect(periodStartOf("2026-10-08", "daily")).toBe("2026-10-05");
  });

  it("finds the last working day of a period", () => {
    expect(lastWorkingDayOfPeriod("2026-10-06", "weekly")).toBe("2026-10-09");
    // October 2026 ends on a Saturday.
    expect(lastWorkingDayOfPeriod("2026-10-06", "monthly")).toBe("2026-10-30");
  });
});
