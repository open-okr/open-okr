import { blockerEscalation, resolveThresholds } from "@openokr/method";
import { describe, expect, it } from "vitest";
import { blockerClockOf, nextCheckInDueOn } from "../src/cadence/blockers.ts";
import { dueInstant } from "../src/cadence/engine.ts";
import { parseLocalDate } from "../src/cycles/generation.ts";

/**
 * A blocker's clock (METHOD.md §7.3, §11, P9-T19a-a).
 *
 * Pure, on fixed dates, because the acceptance criterion names weekdays: a
 * blocker opened on Tuesday in a weekly rhythm is due by the next Tuesday,
 * and nobody hears about it when Thursday passes. 6 October 2026 is a
 * Tuesday; the anchor below is Tuesday (2) so the rhythm checks in on them.
 */

const CANON = resolveThresholds({});
const TUESDAY = 2;
const UTC = "UTC";

/** The end of a local day, which is how a goal stores its next check-in. */
const endOf = (date: string, timeZone = UTC) =>
  dueInstant(parseLocalDate(date), timeZone);

describe("when a new blocker is due", () => {
  it("is the goal's next check-in when that is after the day it opens", () => {
    expect(
      nextCheckInDueOn({
        nextCheckInAt: endOf("2026-10-13"),
        frequency: "weekly",
        anchor: TUESDAY,
        now: new Date("2026-10-06T10:00:00Z"),
        timeZone: UTC,
      }),
    ).toBe("2026-10-13");
  });

  it("is the one after, for a blocker raised on the check-in day itself", () => {
    // Raised in the meeting, before this week's check-in is posted: the
    // goal's next check-in is still today, and today is not a deadline.
    expect(
      nextCheckInDueOn({
        nextCheckInAt: endOf("2026-10-06"),
        frequency: "weekly",
        anchor: TUESDAY,
        now: new Date("2026-10-06T10:00:00Z"),
        timeZone: UTC,
      }),
    ).toBe("2026-10-13");
  });

  it("steps an overdue goal forward, so a blocker is never born late", () => {
    expect(
      nextCheckInDueOn({
        nextCheckInAt: endOf("2026-09-22"),
        frequency: "weekly",
        anchor: TUESDAY,
        now: new Date("2026-10-06T10:00:00Z"),
        timeZone: UTC,
      }),
    ).toBe("2026-10-13");
  });

  it("follows a goal that checks in every two weeks, or monthly", () => {
    expect(
      nextCheckInDueOn({
        nextCheckInAt: endOf("2026-10-06"),
        frequency: "biweekly",
        anchor: TUESDAY,
        now: new Date("2026-10-06T10:00:00Z"),
        timeZone: UTC,
      }),
    ).toBe("2026-10-20");
    expect(
      nextCheckInDueOn({
        nextCheckInAt: endOf("2026-11-02"),
        frequency: "monthly",
        anchor: 2,
        now: new Date("2026-10-06T10:00:00Z"),
        timeZone: UTC,
      }),
    ).toBe("2026-11-02");
  });

  it("takes the first check-in from today for a goal with no date yet", () => {
    expect(
      nextCheckInDueOn({
        nextCheckInAt: null,
        frequency: "weekly",
        anchor: TUESDAY,
        now: new Date("2026-10-06T10:00:00Z"),
        timeZone: UTC,
      }),
    ).toBe("2026-10-13");
  });
});

describe("where an open blocker stands", () => {
  const dueAt = endOf("2026-10-13");
  const at = (instant: string) =>
    blockerClockOf({
      dueAt,
      frequency: "weekly",
      anchor: TUESDAY,
      now: new Date(instant),
      timeZone: UTC,
    });

  it("acceptance: opened on Tuesday, nobody is escalated when Thursday passes", () => {
    // Thursday 8 October has passed; it is Friday morning.
    const clock = at("2026-10-09T08:00:00Z");
    expect(clock).toEqual({ daysUntilDue: 4, followingPassed: false });
    expect(blockerEscalation(clock, CANON, false).step).toBeNull();
  });

  it("reminds the owner the day before, and tells the coordinator once it has passed", () => {
    expect(blockerEscalation(at("2026-10-12T09:00:00Z"), CANON, false)).toEqual(
      { step: 1, targets: ["champion"] },
    );
    expect(at("2026-10-13T23:00:00Z").daysUntilDue).toBe(0);
    expect(blockerEscalation(at("2026-10-14T00:30:00Z"), CANON, false)).toEqual(
      { step: 2, targets: ["champion", "coordinator"] },
    );
  });

  it("knows when the check-in after that has passed too", () => {
    expect(at("2026-10-20T12:00:00Z").followingPassed).toBe(false);
    expect(at("2026-10-21T00:30:00Z").followingPassed).toBe(true);
  });

  it("counts days in the workspace calendar, not the server's", () => {
    // Due at the end of 13 October in Jakarta, seven hours ahead of UTC. At
    // 20:00 UTC on the 13th it is already the 14th there, and the check-in
    // has passed.
    const clock = blockerClockOf({
      dueAt: endOf("2026-10-13", "Asia/Jakarta"),
      frequency: "weekly",
      anchor: TUESDAY,
      now: new Date("2026-10-13T20:00:00Z"),
      timeZone: "Asia/Jakarta",
    });
    expect(clock.daysUntilDue).toBe(-1);
  });
});
