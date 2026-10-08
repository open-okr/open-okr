/**
 * What the weekly ceiling held back, put where the member will find it
 * (METHOD.md §11, P9-T19a-c-b).
 *
 * "Anything past the ceiling waits for the next digest." A held nudge is a
 * row with the reason `ceiling` and no `sent_at`: it was never said, and it is
 * still owed. The morning summary lists it in words where it goes by an
 * outside channel, and this puts it in the inbox whichever channel the summary
 * went by, so a member who reads only the product sees it too.
 *
 * A member who turned the summary off has no next digest to wait for, so for
 * them it goes in the moment it is held. It still never becomes a message of
 * its own: an inbox row is the record, not a second push past the limit.
 */
import {
  activeOnly,
  notifications,
  nudges,
  type WorkspaceTx,
} from "@openokr/db";
import { and, eq, gt, inArray, isNull, notExists, sql } from "drizzle-orm";

/** How far back a summary reaches for what was held: the ceiling's own week. */
const HELD_WINDOW_MS = 7 * 86_400_000;

/**
 * Writes an inbox row for each held nudge of this member that has none yet,
 * from the last week, or for the named nudges only. Returns how many.
 */
export async function releaseHeldInTx(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly now: Date;
    /** Only these held nudges, rather than everything held this week. */
    readonly nudgeIds?: readonly string[];
  },
): Promise<number> {
  const held = await tx
    .select({
      id: nudges.id,
      subjectType: nudges.subjectType,
      subjectId: nudges.subjectId,
    })
    .from(nudges)
    .where(
      activeOnly(
        nudges,
        and(
          eq(nudges.workspaceId, input.workspaceId),
          eq(nudges.recipientMemberId, input.memberId),
          eq(nudges.suppressedReason, "ceiling"),
          isNull(nudges.sentAt),
          input.nudgeIds === undefined
            ? gt(
                nudges.createdAt,
                new Date(input.now.getTime() - HELD_WINDOW_MS),
              )
            : inArray(nudges.id, [...input.nudgeIds]),
          // Once each: a summary that runs twice, or a release at the hold
          // followed by a summary, never writes a second row.
          notExists(
            tx
              .select({ one: sql`1` })
              .from(notifications)
              .where(eq(notifications.nudgeId, nudges.id)),
          ),
        ),
      ),
    );
  if (held.length === 0) {
    return 0;
  }
  // openokr:allow-mutation: called inside the Operation that delivered the
  // summary or recorded the hold, so the rows commit with it.
  await tx.insert(notifications).values(
    held.map((row) => ({
      workspaceId: input.workspaceId,
      recipientMemberId: input.memberId,
      nudgeId: row.id,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      // One reason across every cadence, as the delivered nudges use.
      reason: "check_in" as const,
      channel: "in_app",
      sentAt: input.now,
    })),
  );
  return held.length;
}
