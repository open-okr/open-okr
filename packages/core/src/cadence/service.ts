/**
 * Maintaining `next_check_in_at`, and the staleness sweep (P3-T06).
 *
 * The engine next door decides the dates. This is the half that reads and writes
 * rows, and it is the only place `goals.next_check_in_at` is written.
 *
 * §8 of the cadence design lists what resets the cadence. Four of the seven
 * events are here: creation, a frequency or anchor change, a close and a reopen.
 * Publication is the fifth and needs check-ins (P3-T07); deleting the latest
 * check-in is the sixth and needs the same. Moving a goal between cycles is the
 * seventh and deliberately changes nothing, because the rhythm belongs to the
 * goal.
 *
 * The workspace default frequency changing rewrites nothing either. Goals hold
 * their own frequency, seeded from the default at creation, because one setting
 * change silently moving thousands of deadlines is not a setting change anybody
 * would expect.
 */
import { activeOnly, goals, type WorkspaceTx } from "@openokr/db";
import type { CheckInFrequency, ResolvedThresholds } from "@openokr/method";
import { eq, isNotNull, isNull, lt } from "drizzle-orm";
import { formatLocalDate, localDateIn } from "../cycles/generation.ts";
import { workspaceTimeZone } from "../cycles/service.ts";
import { type CadenceAnchor, dueInstant, firstDue } from "./engine.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

interface CadenceSettings {
  readonly frequency: CheckInFrequency;
  readonly anchor: CadenceAnchor;
  readonly timeZone: string;
}

/**
 * The cadence a goal runs on: its own frequency where it has one, the workspace
 * default otherwise.
 */
function resolveCadence(
  goalFrequency: CheckInFrequency | null,
  thresholds: ResolvedThresholds,
  timeZone: string,
): CadenceSettings {
  return {
    frequency: goalFrequency ?? thresholds["cadence.checkInFrequency"],
    anchor: thresholds["cadence.anchorDay"],
    timeZone,
  };
}

/**
 * Stamps the first due date on a goal, counted from a reference instant read as a
 * local date in the workspace timezone.
 *
 * Used at creation and again at reopen. Both are "start the rhythm from now", and
 * §8 says a reopened goal is not instantly overdue.
 */
export async function stampFirstDue<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  goalId: string,
  thresholds: ResolvedThresholds,
  from: Date,
): Promise<void> {
  const [goal] = await tx
    .select({ frequency: goals.checkInFrequency })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.id, goalId),
      ),
    )
    .limit(1);
  if (!goal) {
    return;
  }

  const timeZone = await workspaceTimeZone(tx, workspaceId);
  const settings = resolveCadence(goal.frequency, thresholds, timeZone);
  const due = firstDue(
    localDateIn(from, timeZone),
    settings.frequency,
    settings.anchor,
  );

  // openokr:allow-mutation: runs on the transaction the calling Operation
  // opened, so the due date commits with the change that set it.
  await tx
    .update(goals)
    .set({ nextCheckInAt: dueInstant(due, timeZone), updatedAt: from })
    .where(activeOnly(goals, eq(goals.id, goalId)));
}

/**
 * Clears the due date. A closed goal is never due, and leaving a date on it would
 * make the staleness sweep report an archive as neglected.
 */
export async function clearDue<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, goalId: string): Promise<void> {
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(goals)
    .set({ nextCheckInAt: null, updatedAt: new Date() })
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.id, goalId),
      ),
    );
}

export interface SweepResult {
  readonly examined: number;
  readonly flipped: number;
}

/**
 * The staleness sweep (§5 of the cadence design).
 *
 * Writes health only, for open goals whose grace boundary has passed, and it is
 * idempotent: a second run over the same rows changes nothing because they
 * already read `outdated`.
 *
 * The comparison is on the stored instant rather than on local dates, because the
 * instant already carries the local end of the due date in the workspace
 * timezone. `due + grace` in absolute terms is therefore the right boundary, and
 * the boundary is exclusive: at exactly the grace limit the goal is not yet
 * outdated.
 *
 * A goal already reading `achieved` or `missed` is closed, and closed goals have
 * no due date to be past. The filter is on `closed_at` rather than on health, so
 * a health value that somehow disagreed with the close cannot smuggle a goal in.
 */
export async function sweepStaleness<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  thresholds: ResolvedThresholds,
  now: Date,
): Promise<SweepResult> {
  const graceDays = thresholds["cadence.stalenessGraceDays"];
  // Anything due before this instant has used up its whole grace window.
  const boundary = new Date(now.getTime() - graceDays * 86_400_000);

  const due = await tx
    .select({ id: goals.id, health: goals.health })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        isNull(goals.closedAt),
        isNotNull(goals.nextCheckInAt),
        lt(goals.nextCheckInAt, boundary),
      ),
    );

  const stale = due.filter((row) => row.health !== "outdated");
  for (const row of stale) {
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .update(goals)
      .set({ health: "outdated", updatedAt: now })
      .where(activeOnly(goals, eq(goals.id, row.id)));
  }

  return { examined: due.length, flipped: stale.length };
}

/**
 * How many days past due a goal is, in its workspace's calendar.
 *
 * The nudge engine at P4-T05 feeds this to `escalation` in `packages/method`.
 * Returned as a whole number of local days rather than an hour count, because the
 * ladder is written in days and a goal due at 23:59 is one day overdue at any hour
 * of the next day.
 */
export function daysPastDue(
  nextCheckInAt: Date | string | null,
  now: Date,
  timeZone: string,
): number | null {
  if (!nextCheckInAt) {
    return null;
  }
  const dueLocal = localDateIn(new Date(nextCheckInAt), timeZone);
  const todayLocal = localDateIn(now, timeZone);
  const asUtc = (date: { year: number; month: number; day: number }): number =>
    Date.UTC(date.year, date.month - 1, date.day);
  return Math.round((asUtc(todayLocal) - asUtc(dueLocal)) / 86_400_000);
}

/** The due date as the local date a surface should render. */
export function dueLocalDate(
  nextCheckInAt: Date | string | null,
  timeZone: string,
): string | null {
  if (!nextCheckInAt) {
    return null;
  }
  return formatLocalDate(localDateIn(new Date(nextCheckInAt), timeZone));
}
