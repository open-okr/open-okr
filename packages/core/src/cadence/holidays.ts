/**
 * A space's holidays, read where the rhythm needs them (METHOD.md §7.4,
 * P9-T19b-a).
 *
 * `packages/method` decides what a holiday period is. This is the half that
 * reads the spans a space marked, so the due dates, the streak, the booking
 * and the nudges all start from the same rows.
 */
import {
  activeOnly,
  goals,
  spaceHolidays,
  type WorkspaceTx,
} from "@openokr/db";
import type {
  CheckInFrequency,
  Holiday,
  ResolvedThresholds,
} from "@openokr/method";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  formatLocalDate,
  localDateIn,
  parseLocalDate,
} from "../cycles/generation.ts";
import { workspaceTimeZone } from "../cycles/service.ts";
import { followGoalDueInTx } from "./blockers.ts";
import { cadence, dueInstant } from "./engine.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/** The spans a space marked, oldest first. A goal in no space has none. */
export async function spaceHolidaysInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  spaceId: string | null,
): Promise<Holiday[]> {
  if (!spaceId) {
    return [];
  }
  const rows = await tx
    .select({
      startsOn: spaceHolidays.startsOn,
      endsOn: spaceHolidays.endsOn,
    })
    .from(spaceHolidays)
    .where(
      activeOnly(
        spaceHolidays,
        and(
          eq(spaceHolidays.workspaceId, workspaceId),
          eq(spaceHolidays.spaceId, spaceId),
        ),
      ),
    )
    .orderBy(asc(spaceHolidays.startsOn));
  return rows;
}

/**
 * The open goals in a space whose next check-in falls in a holiday period,
 * moved on until it is clear (P9-T19b-a). Run when a space marks its
 * holidays, so a goal already open is asked nothing in them either.
 *
 * Only ever forward. A holiday taken off the calendar leaves a moved date
 * where it is: the next publication counts from it as from any other, and
 * pulling a deadline earlier behind somebody's back is the worse surprise.
 * Returns how many moved.
 */
export async function clearOpenGoalsOfHolidaysInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    readonly workspaceId: string;
    readonly spaceId: string;
    readonly holidays: readonly Holiday[];
    readonly thresholds: ResolvedThresholds;
    readonly now: Date;
  },
): Promise<number> {
  if (input.holidays.length === 0) {
    return 0;
  }
  const timeZone = await workspaceTimeZone(tx, input.workspaceId);
  const anchor = input.thresholds["cadence.anchorDay"];
  const open = await tx
    .select({
      id: goals.id,
      nextCheckInAt: goals.nextCheckInAt,
      frequency: goals.checkInFrequency,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        and(
          eq(goals.workspaceId, input.workspaceId),
          eq(goals.spaceId, input.spaceId),
          isNull(goals.closedAt),
          isNotNull(goals.nextCheckInAt),
        ),
      ),
    );
  let moved = 0;
  for (const goal of open) {
    const due = formatLocalDate(
      localDateIn(goal.nextCheckInAt as Date, timeZone),
    );
    const frequency = (goal.frequency ??
      input.thresholds["cadence.checkInFrequency"]) as CheckInFrequency;
    const clear = cadence.clearOfHolidays(
      due,
      frequency,
      anchor,
      input.holidays,
    );
    if (clear === due) {
      continue;
    }
    // openokr:allow-mutation: the calling Operation's own transaction, which
    // marked the holidays this date moves for.
    await tx
      .update(goals)
      .set({
        nextCheckInAt: dueInstant(parseLocalDate(clear), timeZone),
        updatedAt: input.now,
      })
      .where(activeOnly(goals, eq(goals.id, goal.id)));
    // A blocker is due by that check-in, so it moves with it (§7.3).
    await followGoalDueInTx(tx as WorkspaceTx, {
      workspaceId: input.workspaceId,
      goalId: goal.id,
      now: input.now,
    });
    moved += 1;
  }
  return moved;
}
