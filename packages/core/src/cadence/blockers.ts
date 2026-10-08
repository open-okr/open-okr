/**
 * A blocker's clock (METHOD.md §7.3, §11, P9-T19a-a).
 *
 * §7.3: "The next action is due by the next check-in. A blocker whose action
 * passes that point is escalated to the coordinator, not re-discussed." It was
 * twenty-four hours from opening, which escalated a blocker raised at
 * Tuesday's check-in to the coordinator on Wednesday, days before the team
 * met again to look at it.
 *
 * The check-in is the goal's own, at the goal's own frequency, in the
 * workspace calendar. Two halves: when a new blocker is due, which is stored
 * on the row when it is opened, and where an open one stands against that
 * date, which the nudges, the board and the digest all read the same way.
 */
import { activeOnly, blockers, goals, type WorkspaceTx } from "@openokr/db";
import type {
  BlockerClock,
  CheckInFrequency,
  Holiday,
  ResolvedThresholds,
} from "@openokr/method";
import { and, eq, gte, isNull, lt } from "drizzle-orm";
import {
  formatLocalDate,
  localDateIn,
  parseLocalDate,
} from "../cycles/generation.ts";
import { cadence, dueInstant } from "./engine.ts";
import { spaceHolidaysInTx } from "./holidays.ts";

/** How often a goal checks in: its own frequency, or the workspace's. */
export function frequencyOf(
  goalFrequency: string | null,
  thresholds: ResolvedThresholds,
): CheckInFrequency {
  return (goalFrequency ??
    thresholds["cadence.checkInFrequency"]) as CheckInFrequency;
}

/**
 * The check-in a new blocker's next action is due by, as a local date. A low
 * score's next action (§7.2 step 2) is due by the same one.
 *
 * The goal's next check-in, unless that falls on the day the blocker is
 * opened or earlier: a blocker raised in the meeting that is this week's
 * check-in, before the check-in itself is posted, is due by the next one,
 * not by the meeting it was raised in. An overdue goal steps forward the same
 * way, so a blocker is never born past its own deadline.
 */
export function nextCheckInDueOn(input: {
  readonly nextCheckInAt: Date | null;
  readonly frequency: CheckInFrequency;
  readonly anchor: number;
  readonly now: Date;
  readonly timeZone: string;
  /** The goal's space's holidays, which no check-in is due in (P9-T19b-a). */
  readonly holidays?: readonly Holiday[];
}): string {
  const today = formatLocalDate(localDateIn(input.now, input.timeZone));
  let due = input.nextCheckInAt
    ? formatLocalDate(localDateIn(input.nextCheckInAt, input.timeZone))
    : cadence.firstDue(today, input.frequency, input.anchor);
  // Bounded for the same reason the cadence engine bounds its own stepping:
  // a goal years overdue is a data problem, not a reason to spin.
  for (let guard = 0; guard < 4000 && due <= today; guard += 1) {
    due = cadence.advance(due, input.frequency, input.anchor);
  }
  return cadence.clearOfHolidays(
    due,
    input.frequency,
    input.anchor,
    input.holidays ?? [],
  );
}

/**
 * The instant a new blocker or next action on this goal is due: the local end
 * of `nextCheckInDueOn`, which is when a check-in on that day stops being on
 * time.
 *
 * A blocker on no goal, which a session no longer writes but an older row may
 * be, takes the workspace's own frequency from today.
 */
export async function nextCheckInDueAt(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly goalId: string | null;
    readonly now: Date;
    readonly thresholds: ResolvedThresholds;
    readonly timeZone: string;
  },
): Promise<Date> {
  const [goal] = input.goalId
    ? await tx
        .select({
          nextCheckInAt: goals.nextCheckInAt,
          checkInFrequency: goals.checkInFrequency,
          spaceId: goals.spaceId,
        })
        .from(goals)
        .where(
          activeOnly(
            goals,
            and(
              eq(goals.workspaceId, input.workspaceId),
              eq(goals.id, input.goalId),
            ),
          ),
        )
        .limit(1)
    : [];
  const due = nextCheckInDueOn({
    nextCheckInAt: goal?.nextCheckInAt ?? null,
    frequency: frequencyOf(goal?.checkInFrequency ?? null, input.thresholds),
    anchor: input.thresholds["cadence.anchorDay"],
    now: input.now,
    timeZone: input.timeZone,
    holidays: await spaceHolidaysInTx(
      tx,
      input.workspaceId,
      goal?.spaceId ?? null,
    ),
  });
  return dueInstant(parseLocalDate(due), input.timeZone);
}

/**
 * Where an open blocker stands against the check-in it is due by, for
 * `blockerEscalation` in `packages/method`.
 *
 * Whole local days, as the check-in ladder counts them: a blocker due on
 * Tuesday is one day out all of Monday and has passed from the first minute
 * of Wednesday, wherever the server is.
 */
export function blockerClockOf(input: {
  readonly dueAt: Date;
  readonly frequency: CheckInFrequency;
  readonly anchor: number;
  readonly now: Date;
  readonly timeZone: string;
}): BlockerClock {
  const dueOn = formatLocalDate(localDateIn(input.dueAt, input.timeZone));
  const today = formatLocalDate(localDateIn(input.now, input.timeZone));
  const days =
    (Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
    86_400_000;
  const following = cadence.advance(dueOn, input.frequency, input.anchor);
  return {
    daysUntilDue: Math.round(days),
    followingPassed: today > following,
  };
}

/**
 * Moves a goal's pending blockers forward with the goal's own next check-in
 * (§7.3, P9-T19a-a): a blocker is due by the next check-in, so when holidays
 * or a new frequency move that check-in later, its blockers move with it.
 *
 * Only ever forward, and never one already past due: a blocker that has
 * passed its check-in has been raised with the coordinator, and a holiday
 * marked afterwards does not take that back. Returns how many moved.
 */
export async function followGoalDueInTx(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly goalId: string;
    readonly now: Date;
  },
): Promise<number> {
  const [goal] = await tx
    .select({ nextCheckInAt: goals.nextCheckInAt })
    .from(goals)
    .where(
      activeOnly(
        goals,
        and(
          eq(goals.workspaceId, input.workspaceId),
          eq(goals.id, input.goalId),
        ),
      ),
    )
    .limit(1);
  const next = goal?.nextCheckInAt ?? null;
  if (next === null) {
    return 0;
  }
  // openokr:allow-mutation: the calling Operation's own transaction, which
  // moved the goal's check-in this follows.
  const moved = await tx
    .update(blockers)
    .set({ dueAt: next, updatedAt: input.now })
    .where(
      activeOnly(
        blockers,
        and(
          eq(blockers.workspaceId, input.workspaceId),
          eq(blockers.goalId, input.goalId),
          isNull(blockers.resolvedAt),
          gte(blockers.dueAt, input.now),
          lt(blockers.dueAt, next),
        ),
      ),
    )
    .returning({ id: blockers.id });
  return moved.length;
}
