import { describe, expect, it } from "vitest";
import {
  cycleClosingDue,
  cycleStartsDue,
  planningOpensDue,
  publicationCountdownMilestone,
  reviewPreparationDue,
  sessionLifecycleStage,
} from "../src/countdown.ts";
import { resolveThresholds } from "../src/thresholds.ts";

/**
 * The per-cycle countdown and the session lifecycle, as pure functions
 * (METHOD.md §11, P4-T05b).
 *
 * Every number these answer with comes from a §11 parameter passed in, so a
 * workspace that moves its planning lead moves these with it. Nothing here
 * reads a clock or a row: the caller counts the days and asks which trigger,
 * if any, that day count fires.
 *
 * The tests are written as day counts rather than dates on purpose. A test that
 * built dates would be testing the calendar as well as the rule, and the
 * calendar is P3-T06's, already golden-master tested across both hemispheres'
 * daylight transitions.
 */

const thresholds = resolveThresholds({});

describe("the planning-open lead (§11: 6 weeks annual, 3 weeks quarterly)", () => {
  it("opens an annual cycle six weeks out, to the day", () => {
    expect(planningOpensDue(42, "annual", thresholds)).toBe(true);
    expect(planningOpensDue(43, "annual", thresholds)).toBe(false);
    expect(planningOpensDue(41, "annual", thresholds)).toBe(false);
  });

  it("opens a quarterly cycle three weeks out", () => {
    expect(planningOpensDue(21, "quarterly", thresholds)).toBe(true);
    expect(planningOpensDue(42, "quarterly", thresholds)).toBe(false);
  });

  it("does not fire for a cycle that has already started", () => {
    // A planning window that opens after the cycle it plans is not a reminder,
    // it is an accusation.
    expect(planningOpensDue(0, "quarterly", thresholds)).toBe(false);
    expect(planningOpensDue(-1, "quarterly", thresholds)).toBe(false);
  });

  it("moves with the parameter rather than with a number in here", () => {
    const moved = resolveThresholds({
      "cadence.planningOpenLeadWeeks": { annual: 8, quarterly: 4 },
    });
    expect(planningOpensDue(56, "annual", moved)).toBe(true);
    expect(planningOpensDue(42, "annual", moved)).toBe(false);
    expect(planningOpensDue(28, "quarterly", moved)).toBe(true);
  });
});

describe("the publication deadline countdown (§11: 14, 7 and 1 days)", () => {
  it("names the milestone the day count matches", () => {
    expect(publicationCountdownMilestone(14, thresholds)).toBe(14);
    expect(publicationCountdownMilestone(7, thresholds)).toBe(7);
    expect(publicationCountdownMilestone(1, thresholds)).toBe(1);
  });

  it("stays quiet between the milestones", () => {
    // Three reminders, not fourteen. The point of naming the days is that the
    // ones in between are silent.
    for (const days of [13, 12, 8, 6, 2]) {
      expect(publicationCountdownMilestone(days, thresholds)).toBeNull();
    }
  });

  it("stays quiet on and after the deadline itself", () => {
    // A countdown that carried on past zero would be a different message: the
    // deadline is missed, and that is `cycle.phase_blocked`, not a countdown.
    expect(publicationCountdownMilestone(0, thresholds)).toBeNull();
    expect(publicationCountdownMilestone(-3, thresholds)).toBeNull();
  });

  it("reads whatever list the workspace configured, in any order", () => {
    const moved = resolveThresholds({
      "cadence.publicationCountdownDays": [3, 30],
    });
    expect(publicationCountdownMilestone(30, moved)).toBe(30);
    expect(publicationCountdownMilestone(3, moved)).toBe(3);
    expect(publicationCountdownMilestone(14, moved)).toBeNull();
  });
});

describe("review preparation (§11: 2 weeks before the cycle ends)", () => {
  it("fires two weeks out, to the day", () => {
    expect(reviewPreparationDue(14, thresholds)).toBe(true);
    expect(reviewPreparationDue(15, thresholds)).toBe(false);
    expect(reviewPreparationDue(13, thresholds)).toBe(false);
  });

  it("does not fire once the cycle has ended", () => {
    expect(reviewPreparationDue(0, thresholds)).toBe(false);
    expect(reviewPreparationDue(-7, thresholds)).toBe(false);
  });
});

describe("day one and the unscored close", () => {
  it("announces a cycle on the day it starts and not before", () => {
    expect(cycleStartsDue(0)).toBe(true);
    expect(cycleStartsDue(1)).toBe(false);
    expect(cycleStartsDue(-1)).toBe(false);
  });

  it("raises the close only once the cycle has ended unscored", () => {
    expect(cycleClosingDue(0, "active")).toBe(true);
    expect(cycleClosingDue(3, "closing")).toBe(true);
    // A cycle somebody has already closed owes nobody a reminder to close it.
    expect(cycleClosingDue(3, "closed")).toBe(false);
    // Before the end date there is nothing to close.
    expect(cycleClosingDue(-1, "active")).toBe(false);
  });
});

describe("the weekly session lifecycle", () => {
  it("warns one day before, using the §11 due-soon lead", () => {
    expect(sessionLifecycleStage(24, "scheduled", thresholds)).toBe("due_soon");
    // Well outside the lead: nothing yet.
    expect(sessionLifecycleStage(72, "scheduled", thresholds)).toBeNull();
  });

  it("opens the session at its scheduled hour", () => {
    expect(sessionLifecycleStage(0, "scheduled", thresholds)).toBe("open");
    // Inside the hour it was due, still the opening message rather than a
    // missed one. A facilitator who is nine minutes late has not skipped it.
    expect(sessionLifecycleStage(-0.5, "scheduled", thresholds)).toBe("open");
  });

  it("calls it missed once the scheduled day has passed with the session never opened", () => {
    expect(sessionLifecycleStage(-25, "scheduled", thresholds)).toBe("missed");
    expect(sessionLifecycleStage(-47, "scheduled", thresholds)).toBe("missed");
  });

  it("stops talking about a session two days gone", () => {
    // A permanent `missed` would nudge about a session from March every day
    // until somebody deleted the row. Last week's session is history.
    expect(sessionLifecycleStage(-49, "scheduled", thresholds)).toBeNull();
    expect(sessionLifecycleStage(-24 * 90, "scheduled", thresholds)).toBeNull();
  });

  it("says nothing about a session that was held, is running, or was skipped deliberately", () => {
    // A session somebody opened is not missed however late it ran, and a
    // skipped one was a decision rather than a lapse.
    expect(sessionLifecycleStage(-25, "running", thresholds)).toBeNull();
    expect(sessionLifecycleStage(-25, "closed", thresholds)).toBeNull();
    expect(sessionLifecycleStage(-25, "skipped", thresholds)).toBeNull();
    expect(sessionLifecycleStage(24, "closed", thresholds)).toBeNull();
  });

  it("moves the warning with the due-soon lead", () => {
    const moved = resolveThresholds({ "cadence.dueSoonLeadDays": 2 });
    expect(sessionLifecycleStage(40, "scheduled", moved)).toBe("due_soon");
    expect(sessionLifecycleStage(40, "scheduled", thresholds)).toBeNull();
  });
});
