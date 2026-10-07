/**
 * §8.6's rhythm, measured for a review (METHOD.md §8.6, P9-T20d).
 *
 * "The share of due check-ins published within tolerance, measured by the
 * product. Holiday periods (§7.4) are not due, so they are not counted."
 * `packages/method` counts; this is the half that reads the rows: every
 * objective in the review's scope, the dates its check-ins fell due across
 * the cycle at its own frequency, and the dates they were published.
 *
 * **Only a due date whose tolerance has run out is counted.** A check-in due
 * on the morning of the review may still arrive on time that afternoon, and
 * counting it as missed would hold the room to a deadline that has not
 * passed.
 */
import {
  activeOnly,
  checkIns,
  cycles,
  goals,
  type WorkspaceTx,
} from "@openokr/db";
import {
  type CheckInFrequency,
  type CheckInRecord,
  type Holiday,
  isHolidayPeriod,
  onTimeShare,
  type ResolvedThresholds,
} from "@openokr/method";
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { cadence } from "../cadence/engine.ts";
import { spaceHolidaysInTx } from "../cadence/holidays.ts";
import { formatLocalDate, localDateIn } from "../cycles/generation.ts";
import { workspaceTimeZone } from "../cycles/service.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

const addDays = (on: string, days: number): string =>
  new Date(Date.parse(`${on}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
const earlier = (a: string, b: string): string => (a < b ? a : b);
const later = (a: string, b: string): string => (a > b ? a : b);

export interface MeasuredRhythm {
  readonly due: number;
  readonly onTime: number;
  /** Null when nothing fell due, which is no rhythm to read. */
  readonly share: number | null;
}

/** The measured rhythm of a review's scope, as of a moment. */
export async function measuredRhythmInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    readonly workspaceId: string;
    readonly spaceId: string | null;
    readonly cycleId: string | null;
    readonly asOf: Date;
    readonly thresholds: ResolvedThresholds;
    /**
     * The objectives the review graded, measured whatever space they sit in.
     * A company objective belongs to no space, and a review is held in one.
     */
    readonly gradedGoalIds?: readonly string[];
  },
): Promise<MeasuredRhythm> {
  if (!input.cycleId) {
    return { due: 0, onTime: 0, share: null };
  }
  const [cycle] = await tx
    .select({ startsOn: cycles.startsOn, endsOn: cycles.endsOn })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, input.workspaceId),
        eq(cycles.id, input.cycleId),
      ),
    )
    .limit(1);
  if (!cycle) {
    return { due: 0, onTime: 0, share: null };
  }

  const timeZone = await workspaceTimeZone(tx, input.workspaceId);
  const tolerance = input.thresholds["cadence.toleranceDays"];
  const anchor = input.thresholds["cadence.anchorDay"];
  const today = formatLocalDate(localDateIn(input.asOf, timeZone));
  // The last due date whose tolerance has run out by today.
  const counted = earlier(cycle.endsOn, addDays(today, -tolerance - 1));

  const scope = await tx
    .select({
      id: goals.id,
      spaceId: goals.spaceId,
      frequency: goals.checkInFrequency,
      addedMidCycleAt: goals.addedMidCycleAt,
      closedAt: goals.closedAt,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        and(
          eq(goals.workspaceId, input.workspaceId),
          eq(goals.cycleId, input.cycleId),
          input.spaceId
            ? (input.gradedGoalIds ?? []).length > 0
              ? or(
                  eq(goals.spaceId, input.spaceId),
                  inArray(goals.id, [...(input.gradedGoalIds ?? [])]),
                )
              : eq(goals.spaceId, input.spaceId)
            : undefined,
          // A draft owes no check-in until it is live.
          or(isNotNull(goals.nextCheckInAt), isNotNull(goals.closedAt)),
          isNull(goals.draftState),
        ),
      ),
    );
  if (scope.length === 0) {
    return { due: 0, onTime: 0, share: null };
  }

  const published = await tx
    .select({ goalId: checkIns.subjectId, publishedAt: checkIns.publishedAt })
    .from(checkIns)
    .where(
      activeOnly(
        checkIns,
        eq(checkIns.workspaceId, input.workspaceId),
        eq(checkIns.state, "published"),
        inArray(
          checkIns.subjectId,
          scope.map((goal) => goal.id),
        ),
      ),
    );

  const holidaysBySpace = new Map<string, Holiday[]>();
  const holidaysOf = async (spaceId: string | null): Promise<Holiday[]> => {
    if (!spaceId) {
      return [];
    }
    const known = holidaysBySpace.get(spaceId);
    if (known) {
      return known;
    }
    const read = await spaceHolidaysInTx(tx, input.workspaceId, spaceId);
    holidaysBySpace.set(spaceId, read);
    return read;
  };

  const records: CheckInRecord[] = [];
  for (const goal of scope) {
    const frequency = (goal.frequency ??
      input.thresholds["cadence.checkInFrequency"]) as CheckInFrequency;
    const holidays = await holidaysOf(goal.spaceId);
    // From the cycle's start, or from the day an objective was started
    // mid-cycle (§2.9): it owed nothing before it existed. Not from the row's
    // creation, which an import or a backfill writes long after the fact.
    const from = goal.addedMidCycleAt
      ? later(
          cycle.startsOn,
          formatLocalDate(localDateIn(goal.addedMidCycleAt, timeZone)),
        )
      : cycle.startsOn;
    const until = goal.closedAt
      ? earlier(counted, formatLocalDate(localDateIn(goal.closedAt, timeZone)))
      : counted;
    const dueOn: string[] = [];
    // `firstDue` is strictly after its reference, so the day before the
    // start finds a due date on the start itself.
    let due = cadence.firstDue(addDays(from, -1), frequency, anchor);
    for (let guard = 0; guard < 800 && due <= until; guard += 1) {
      if (!isHolidayPeriod(due, frequency, holidays)) {
        dueOn.push(due);
      }
      due = cadence.advance(due, frequency, anchor);
    }
    records.push({
      dueOn,
      publishedOn: published
        .filter((row) => row.goalId === goal.id && row.publishedAt)
        .map((row) =>
          formatLocalDate(localDateIn(row.publishedAt as Date, timeZone)),
        ),
    });
  }

  return onTimeShare(records, tolerance);
}
