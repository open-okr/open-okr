import { describe, expect, it } from "vitest";
import {
  afterWeeklyCheckIn,
  currentStreakOn,
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
    const one = afterWeeklyCheckIn(null, "2026-09-28");
    const sameWeek = afterWeeklyCheckIn(one, "2026-10-02");
    expect(sameWeek).toEqual(one);
    expect(sameWeek.currentWeeks).toBe(1);
  });

  it("extends on the following week", () => {
    const two = afterWeeklyCheckIn(
      afterWeeklyCheckIn(null, "2026-09-28"),
      "2026-10-06",
    );
    expect(two).toEqual({
      currentWeeks: 2,
      longestWeeks: 2,
      lastWeek: "2026-10-05",
    });
  });

  it("starts again after a skipped week, keeping the longest", () => {
    let state = afterWeeklyCheckIn(null, "2026-09-07");
    state = afterWeeklyCheckIn(state, "2026-09-14");
    state = afterWeeklyCheckIn(state, "2026-09-21");
    // The week of 28 September holds nothing.
    state = afterWeeklyCheckIn(state, "2026-10-05");
    expect(state).toEqual({
      currentWeeks: 1,
      longestWeeks: 3,
      lastWeek: "2026-10-05",
    });
  });

  it("ignores a close for a week already behind the run", () => {
    const state = afterWeeklyCheckIn(
      afterWeeklyCheckIn(null, "2026-09-21"),
      "2026-09-28",
    );
    expect(afterWeeklyCheckIn(state, "2026-09-14")).toEqual(state);
  });

  it("reads as broken once a whole week passes with nothing held", () => {
    const state = afterWeeklyCheckIn(
      afterWeeklyCheckIn(null, "2026-09-21"),
      "2026-09-28",
    );
    expect(currentStreakOn(state, "2026-10-02")).toBe(2); // same week
    expect(currentStreakOn(state, "2026-10-09")).toBe(2); // this week's may come
    expect(currentStreakOn(state, "2026-10-12")).toBe(0); // last week was skipped
    expect(currentStreakOn(null, "2026-10-12")).toBe(0);
  });
});
