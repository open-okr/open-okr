/**
 * A space's own check-in frequency (METHOD.md §7.1, §11, P9-T19a-d-a).
 *
 * "Every two weeks and monthly are valid check-in frequencies." A space has
 * stored one since P6-G18b, `spaces.settings.defaultCheckInFrequency`, and
 * nothing read it: a team that set every two weeks went on being asked every
 * week, because a goal's frequency fell straight through to the workspace's.
 *
 * A goal holds its own frequency, as the cadence design says, so the space's
 * is how that frequency is chosen rather than a second thing read beside it:
 * a goal created in a space takes the space's, and when the space's changes,
 * the open goals that were following it move with it. A goal somebody set to
 * a frequency of its own keeps it. Both run inside the calling Operation's
 * transaction, so the change and its due dates commit together.
 */
import { activeOnly, goals, spaces, type WorkspaceTx } from "@openokr/db";
import type { CheckInFrequency, ResolvedThresholds } from "@openokr/method";
import { and, eq, isNull, or } from "drizzle-orm";
import { stampFirstDue } from "./service.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/** The frequencies a goal can hold, which the goals table's own enum names. */
type GoalFrequency = "daily" | "weekly" | "biweekly" | "monthly";
const GOAL_FREQUENCIES: readonly string[] = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
];

/**
 * A space's frequency as a goal can hold it, or null. The space setting also
 * takes "quarterly", which no goal checks in at; a space set to it leaves its
 * goals on the workspace's frequency rather than refusing the write.
 */
const asGoalFrequency = (
  value: CheckInFrequency | null,
): GoalFrequency | null =>
  value !== null && GOAL_FREQUENCIES.includes(value)
    ? (value as GoalFrequency)
    : null;

/** The frequency a space chose, or null where it follows the workspace. */
async function spaceFrequencyOf<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  spaceId: string,
): Promise<CheckInFrequency | null> {
  const [space] = await tx
    .select({ settings: spaces.settings })
    // openokr:allow-raw-read: one setting off a space the calling write
    // already authorised, the goal's own or the one being edited, and it is
    // not shown to anybody.
    .from(spaces)
    .where(
      activeOnly(
        spaces,
        eq(spaces.workspaceId, workspaceId),
        eq(spaces.id, spaceId),
      ),
    )
    .limit(1);
  const value = (
    space?.settings as { defaultCheckInFrequency?: unknown } | undefined
  )?.defaultCheckInFrequency;
  return typeof value === "string" ? (value as CheckInFrequency) : null;
}

/**
 * A new goal in a space takes the space's frequency, where it has one. Called
 * before the first due date is stamped, so the rhythm starts at it.
 */
export async function seedGoalFrequencyInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    readonly workspaceId: string;
    readonly goalId: string;
    readonly spaceId: string | null;
  },
): Promise<void> {
  if (!input.spaceId) {
    return;
  }
  const frequency = asGoalFrequency(
    await spaceFrequencyOf(tx, input.workspaceId, input.spaceId),
  );
  if (frequency === null) {
    return;
  }
  // openokr:allow-mutation: the calling Operation's own transaction, which
  // created the goal this seeds.
  await tx
    .update(goals)
    .set({ checkInFrequency: frequency })
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, input.workspaceId),
        eq(goals.id, input.goalId),
        isNull(goals.checkInFrequency),
      ),
    );
}

/**
 * The open goals following a space's frequency move with it, and take their
 * next due date from the new one, counted from now so none is instantly
 * overdue (cadence design §8).
 *
 * "Following" is a goal with no frequency of its own, or the one the space
 * had until now: a goal set apart from its space is left where it was set.
 * Returns how many moved.
 */
export async function followSpaceFrequencyInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    readonly workspaceId: string;
    readonly spaceId: string;
    /** What the space's goals were asked at until now. */
    readonly previous: CheckInFrequency;
    /** The space's new choice, or null to follow the workspace again. */
    readonly next: CheckInFrequency | null;
    readonly thresholds: ResolvedThresholds;
    readonly now: Date;
  },
): Promise<number> {
  // openokr:allow-mutation: the calling Operation's own transaction, which
  // changed the space's frequency.
  const moved = await tx
    .update(goals)
    .set({
      checkInFrequency: asGoalFrequency(input.next),
      updatedAt: input.now,
    })
    .where(
      activeOnly(
        goals,
        and(
          eq(goals.workspaceId, input.workspaceId),
          eq(goals.spaceId, input.spaceId),
          isNull(goals.closedAt),
          or(
            isNull(goals.checkInFrequency),
            eq(goals.checkInFrequency, input.previous as never),
          ),
        ),
      ),
    )
    .returning({ id: goals.id, nextCheckInAt: goals.nextCheckInAt });
  for (const goal of moved) {
    // A draft that is not live yet owes no check-in and has no date to move.
    if (goal.nextCheckInAt === null) {
      continue;
    }
    await stampFirstDue(
      tx,
      input.workspaceId,
      goal.id,
      input.thresholds,
      input.now,
    );
  }
  return moved.length;
}
