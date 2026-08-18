import type { ResolvedThresholds } from "./thresholds.ts";

/**
 * Whether to stay quiet, and why (AI-NATIVE-PLAN.md §6.3, P4-T04b).
 *
 * Pure, so the five reasons a product says nothing are golden-master tested
 * without a clock, a member row or a queue. Every one of them is a decision
 * rather than an accident, which is why the answer is a reason and never a
 * bare boolean: a product that silently drops a message cannot answer "why did
 * nobody hear about this".
 *
 * The order matters and is the order below. Deduplication is checked before
 * quiet hours because a nudge that was already sent today should read as
 * `dedup` rather than as `quiet_hours`: the second is a delay and the first is
 * a decision never to send at all, and telling somebody their message was held
 * until morning when it was actually dropped would be a lie.
 */

export type SuppressionReason =
  | "dedup"
  | "quiet_hours"
  | "snooze"
  | "disabled"
  | "ceiling";

export interface SuppressionInput {
  /** The rule this nudge cites, for the exemption check. */
  readonly ruleKey: string;
  /**
   * 0 for a trigger that does not escalate, 1 and up for a ladder position.
   *
   * Read only by deduplication: §11's rule is one per subject per day *unless
   * the step increases*, so a higher step is a new fact and not the same
   * message twice.
   */
  readonly escalationStep: number;
  /**
   * Whether this one delivers through quiet hours and past the ceiling.
   *
   * **Not derived from the step**, and that distinction cost a test. §11's
   * ladder puts steps 0 to 2 on the champion alone: the day before, the due day,
   * and one repeat. None of those is an escalation, and none of them earns
   * waking somebody at three in the morning. It is an escalation once the ladder
   * has widened past the person who owns the work, which is what §6.3 means by
   * "urgent". The caller decides, because the caller is what knows who the step
   * reached.
   */
  readonly urgent: boolean;
  /** Whether this rule is switched off for the workspace. */
  readonly ruleEnabled: boolean;
  /** Whether this rule speaks through workspace quiet mode. */
  readonly quietModeExempt: boolean;
  readonly workspaceQuietMode: boolean;
  /**
   * The most recent nudge this member already has about this subject, if any.
   *
   * `hoursAgo` and `escalationStep` together are what the deduplication rule
   * reads: one per subject per member per day **unless the escalation step
   * increases**.
   */
  readonly previous: {
    readonly hoursAgo: number;
    readonly escalationStep: number;
  } | null;
  /** Local hour and minute for the recipient, 0 to 23 and 0 to 59. */
  readonly localTime: { readonly hour: number; readonly minute: number };
  /** The member's quiet window in their own timezone, `HH:MM` each. */
  readonly quietHours: { readonly start: string; readonly end: string } | null;
  /** Set while a member has snoozed this subject. */
  readonly snoozedUntilHoursAway: number | null;
  /** How many nudges this member has already had in the last seven days. */
  readonly sentThisWeek: number;
}

/** `HH:MM` as minutes past midnight, or null when it is not a time. */
const minutesOf = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
};

/**
 * Whether a local time falls inside a quiet window.
 *
 * The window wraps midnight in the normal case: 22:00 to 07:00 is nine hours of
 * night, not fifteen hours of day. A window whose start equals its end is
 * treated as no window rather than as all day, because a member who typed the
 * same time twice meant to switch it off and not to silence the product forever.
 */
export function insideQuietHours(
  localTime: { readonly hour: number; readonly minute: number },
  quietHours: { readonly start: string; readonly end: string } | null,
): boolean {
  if (!quietHours) {
    return false;
  }
  const start = minutesOf(quietHours.start);
  const end = minutesOf(quietHours.end);
  if (start === null || end === null || start === end) {
    return false;
  }
  const now = localTime.hour * 60 + localTime.minute;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/**
 * The reason to stay quiet, or null to send.
 *
 * `disabled` comes first because a switched-off rule should never appear in the
 * volume dashboard as noise the product decided to hold: it was not held, it was
 * turned off, and those are different facts about different decisions.
 */
export function suppressionFor(
  input: SuppressionInput,
  thresholds: ResolvedThresholds,
): SuppressionReason | null {
  if (!input.ruleEnabled) {
    return "disabled";
  }

  // Deduplication: one per subject per member per window, unless the step
  // increases. A repeat at the same step is the same message twice.
  const window = thresholds["cadence.nudgeDeduplicationHours"];
  if (
    input.previous &&
    input.previous.hoursAgo < window &&
    input.escalationStep <= input.previous.escalationStep
  ) {
    return "dedup";
  }

  if (input.snoozedUntilHoursAway !== null && input.snoozedUntilHoursAway > 0) {
    // A snooze silences the nudge. It never silences the review-inbox
    // obligation, which is a row of its own and not a message.
    return "snooze";
  }

  if (input.workspaceQuietMode && !input.urgent && !input.quietModeExempt) {
    return "quiet_hours";
  }

  if (!input.urgent && insideQuietHours(input.localTime, input.quietHours)) {
    return "quiet_hours";
  }

  // The ceiling last, so a member at their limit still hears an escalation.
  // §11 bounds noise; it does not bound the product's duty to tell somebody
  // their goal has been stale for a fortnight.
  const ceiling = thresholds["cadence.nudgeCeilingPerWeek"];
  if (!input.urgent && input.sentThisWeek >= ceiling) {
    return "ceiling";
  }

  return null;
}
