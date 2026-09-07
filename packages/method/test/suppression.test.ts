import { describe, expect, it } from "vitest";
import {
  deferralFor,
  insideQuietHours,
  suppressionFor,
} from "../src/suppression.ts";
import { canonThresholds, resolveThresholds } from "../src/thresholds.ts";

/**
 * The five reasons the product stays quiet (P4-T04b, AI-NATIVE-PLAN.md §6.3).
 *
 * Pure, so every one of them is tested without a clock, a member row or a
 * queue. The cases that matter are the ones where two reasons could both apply:
 * which one is reported decides what the volume dashboard says a workspace's
 * problem is.
 */

const thresholds = canonThresholds();

const base = {
  ruleKey: "checkin.due",
  escalationStep: 0,
  urgent: false,
  ruleEnabled: true,
  quietModeExempt: false,
  workspaceQuietMode: false,
  previous: null,
  localTime: { hour: 10, minute: 0 },
  quietHours: null,
  snoozedUntilHoursAway: null,
  sentThisWeek: 0,
} as const;

describe("nothing in the way", () => {
  it("sends", () => {
    expect(suppressionFor(base, thresholds)).toBeNull();
  });
});

describe("deduplication", () => {
  it("swallows a repeat inside the window at the same step", () => {
    expect(
      suppressionFor(
        { ...base, previous: { hoursAgo: 2, escalationStep: 0 } },
        thresholds,
      ),
    ).toBe("dedup");
  });

  it("lets it through once the window has passed", () => {
    const window = thresholds["cadence.nudgeDeduplicationHours"];
    expect(
      suppressionFor(
        { ...base, previous: { hoursAgo: window, escalationStep: 0 } },
        thresholds,
      ),
    ).toBeNull();
  });

  it("lets a higher step through immediately", () => {
    // §11: one per subject per member per day **unless the escalation step
    // increases**. A ladder widens rather than repeats, so a higher step is a
    // new fact and not the same message twice.
    expect(
      suppressionFor(
        {
          ...base,
          escalationStep: 3,
          previous: { hoursAgo: 1, escalationStep: 2 },
        },
        thresholds,
      ),
    ).toBeNull();
  });

  it("still swallows a step that has not moved", () => {
    expect(
      suppressionFor(
        {
          ...base,
          escalationStep: 2,
          previous: { hoursAgo: 1, escalationStep: 2 },
        },
        thresholds,
      ),
    ).toBe("dedup");
  });

  it("reads the window from the §11 registry", () => {
    const tuned = resolveThresholds({ "cadence.nudgeDeduplicationHours": 1 });
    expect(
      suppressionFor(
        { ...base, previous: { hoursAgo: 2, escalationStep: 0 } },
        tuned,
      ),
    ).toBeNull();
  });
});

describe("quiet hours in the member's own timezone", () => {
  it("wraps midnight, so 22:00 to 07:00 is nine hours of night", () => {
    const night = { start: "22:00", end: "07:00" };
    expect(insideQuietHours({ hour: 23, minute: 30 }, night)).toBe(true);
    expect(insideQuietHours({ hour: 3, minute: 0 }, night)).toBe(true);
    expect(insideQuietHours({ hour: 12, minute: 0 }, night)).toBe(false);
    // The boundaries: inclusive at the start, exclusive at the end, so a window
    // ending at 07:00 lets a 07:00 nudge through.
    expect(insideQuietHours({ hour: 22, minute: 0 }, night)).toBe(true);
    expect(insideQuietHours({ hour: 7, minute: 0 }, night)).toBe(false);
  });

  it("treats a window with no width as no window", () => {
    // Somebody who typed the same time twice meant to switch it off, not to
    // silence the product forever.
    expect(
      insideQuietHours(
        { hour: 3, minute: 0 },
        { start: "09:00", end: "09:00" },
      ),
    ).toBe(false);
  });

  it("ignores a window it cannot read rather than silencing everything", () => {
    expect(
      insideQuietHours(
        { hour: 3, minute: 0 },
        { start: "evening", end: "morning" },
      ),
    ).toBe(false);
    expect(
      insideQuietHours(
        { hour: 3, minute: 0 },
        { start: "25:00", end: "07:00" },
      ),
    ).toBe(false);
  });

  it("defers an ordinary nudge rather than dropping it, and lets an escalation through", () => {
    const night = { start: "22:00", end: "07:00" };
    const asleep = {
      ...base,
      localTime: { hour: 2, minute: 0 },
      quietHours: night,
    };

    // Not suppressed. Until P5-T01b-b this returned "quiet_hours", which wrote
    // a row with a reason and never sent it: a member whose night covered the
    // sweep never heard about their overdue check-in at all. AI-NATIVE-PLAN
    // §5.4 says it queues to the next open window instead.
    expect(suppressionFor(asleep, thresholds)).toBeNull();
    expect(deferralFor(asleep)).toBe(5 * 60);

    // Step 1 is the due-day reminder to the champion, and it is still held
    // until morning. Deriving urgency from "step > 0" would have woken
    // somebody at two in the morning to tell them a check-in was due today,
    // which is what this distinction exists to prevent.
    // The step is irrelevant to the wait, which is the distinction: only
    // urgency, set by the caller, sends through somebody’s night.
    expect(deferralFor(asleep)).toBe(5 * 60);

    // §6.3: an escalation delivers during quiet hours. A blocker aging past its
    // clock at three in the morning is still aging.
    expect(
      suppressionFor(
        { ...asleep, escalationStep: 4, urgent: true },
        thresholds,
      ),
    ).toBeNull();
    expect(deferralFor({ ...asleep, urgent: true })).toBe(0);
  });

  it("waits until the window ends, whichever side of midnight it starts", () => {
    const night = { start: "22:00", end: "07:00" };
    // 23:00 is eight hours from a seven-o-clock morning, across midnight.
    expect(
      deferralFor({
        urgent: false,
        localTime: { hour: 23, minute: 0 },
        quietHours: night,
      }),
    ).toBe(8 * 60);
    // 06:30 is half an hour.
    expect(
      deferralFor({
        urgent: false,
        localTime: { hour: 6, minute: 30 },
        quietHours: night,
      }),
    ).toBe(30);
    // Awake already: nothing to wait for.
    expect(
      deferralFor({
        urgent: false,
        localTime: { hour: 9, minute: 0 },
        quietHours: night,
      }),
    ).toBe(0);
    // No window set is the default a fresh member has, and it never defers.
    expect(
      deferralFor({
        urgent: false,
        localTime: { hour: 3, minute: 0 },
        quietHours: null,
      }),
    ).toBe(0);
  });
});

describe("workspace quiet mode", () => {
  it("silences everything except escalations", () => {
    const quiet = { ...base, workspaceQuietMode: true };
    expect(suppressionFor(quiet, thresholds)).toBe("quiet_hours");
    expect(
      suppressionFor({ ...quiet, escalationStep: 3, urgent: true }, thresholds),
    ).toBeNull();
  });

  it("lets an exempted rule speak through it", () => {
    expect(
      suppressionFor(
        { ...base, workspaceQuietMode: true, quietModeExempt: true },
        thresholds,
      ),
    ).toBeNull();
  });
});

describe("a snooze", () => {
  it("silences the nudge while it lasts", () => {
    expect(
      suppressionFor({ ...base, snoozedUntilHoursAway: 5 }, thresholds),
    ).toBe("snooze");
  });

  it("stops silencing it once it has expired", () => {
    expect(
      suppressionFor({ ...base, snoozedUntilHoursAway: 0 }, thresholds),
    ).toBeNull();
  });
});

describe("the volume ceiling", () => {
  it("stops an ordinary nudge at the §11 limit", () => {
    const ceiling = thresholds["cadence.nudgeCeilingPerWeek"];
    expect(suppressionFor({ ...base, sentThisWeek: ceiling }, thresholds)).toBe(
      "ceiling",
    );
    expect(
      suppressionFor({ ...base, sentThisWeek: ceiling - 1 }, thresholds),
    ).toBeNull();
  });

  it("never stops an escalation", () => {
    // §11 bounds noise. It does not bound the product's duty to tell somebody
    // their goal has been stale for a fortnight.
    expect(
      suppressionFor(
        { ...base, sentThisWeek: 999, escalationStep: 5, urgent: true },
        thresholds,
      ),
    ).toBeNull();
  });
});

describe("which reason wins when two apply", () => {
  it("reports a switched-off rule as disabled, not as anything else", () => {
    // A switched-off rule was not held, it was turned off, and the volume
    // dashboard should not read it as noise the product decided to swallow.
    expect(
      suppressionFor(
        {
          ...base,
          ruleEnabled: false,
          workspaceQuietMode: true,
          snoozedUntilHoursAway: 5,
          previous: { hoursAgo: 1, escalationStep: 0 },
          sentThisWeek: 999,
        },
        thresholds,
      ),
    ).toBe("disabled");
  });

  it("reports a same-day repeat as dedup rather than as quiet hours", () => {
    // The two are different facts: quiet hours is a delay until morning, and
    // deduplication is a decision never to send this one at all. Reporting the
    // delay would be a lie about what happened.
    expect(
      suppressionFor(
        {
          ...base,
          previous: { hoursAgo: 1, escalationStep: 0 },
          localTime: { hour: 2, minute: 0 },
          quietHours: { start: "22:00", end: "07:00" },
        },
        thresholds,
      ),
    ).toBe("dedup");
  });

  it("reports a snooze ahead of quiet hours, because the member chose it", () => {
    expect(
      suppressionFor(
        {
          ...base,
          snoozedUntilHoursAway: 5,
          localTime: { hour: 2, minute: 0 },
          quietHours: { start: "22:00", end: "07:00" },
        },
        thresholds,
      ),
    ).toBe("snooze");
  });

  it("reports quiet hours ahead of the ceiling", () => {
    // Both are the product's decisions, and the earlier one is the one that
    // actually stopped it.
    // The ceiling, not the quiet hours: a member’s own night defers rather
    // than suppresses now, so the ceiling is the decision that actually
    // stopped this one (P5-T01b-b).
    expect(
      suppressionFor(
        {
          ...base,
          sentThisWeek: 999,
          localTime: { hour: 2, minute: 0 },
          quietHours: { start: "22:00", end: "07:00" },
        },
        thresholds,
      ),
    ).toBe("ceiling");
  });
});
