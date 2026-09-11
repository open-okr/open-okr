/**
 * Retention for the channel message log (P7-T08c).
 *
 * **One log, not three.** The original card named message logs, nudge
 * records and agent run logs. Two of those are not ordinary data. CLAUDE.md
 * requires that every proactive message is a recorded nudge row carrying a
 * rule key, a channel, an escalation step and a suppression reason when
 * suppressed; an agent run log is the record of what an agent did on the
 * workspace's behalf. A retention sweep over either would delete the
 * evidence the product is required to keep. Agung settled it on
 * 11 September 2026: retention covers this log and nothing else.
 *
 * **Zero means delete nothing, and that is the default.** "Not configured"
 * must never mean "delete everything". An instance that has never thought
 * about retention keeps every row, and a number arrives only because
 * somebody put one there.
 */
import { channelMessages, includeDeleted } from "@openokr/db";
import { and, eq, lt, sql } from "drizzle-orm";
import type { OperationTx } from "../operations/operation.ts";

/**
 * How many rows one sweep may remove.
 *
 * A bound rather than a preference. The sweep runs inside the calling
 * Operation's transaction, and a workspace that turns retention on after a
 * year of messages would otherwise hold that transaction open over every
 * row at once: a long lock on the table the relay writes to, and a single
 * statement that either finishes or rolls back the lot. Bounded, the
 * backlog drains over as many runs as it takes and each one commits.
 */
const RETENTION_BATCH = 1_000;

export interface RetentionSweep {
  /** Rows deleted by this run. */
  readonly deleted: number;
  /** The window that was in force, in days. Zero means retention is off. */
  readonly retentionDays: number;
  /** True when the batch filled, so a backlog remains for the next run. */
  readonly more: boolean;
}

/**
 * Deletes message log rows older than the window, up to the batch bound.
 *
 * Returns without a query when retention is off, which is the common case
 * and the default: an instance that never chose a number should not pay for
 * a delete that matches nothing.
 */
export async function sweepMessageLog(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly retentionDays: number;
    readonly now: Date;
    /**
     * How many rows this run may remove. Defaults to the bound above.
     *
     * A parameter rather than only a constant so a test can prove the cap
     * holds without inserting a thousand rows to do it. No caller in the
     * product passes one.
     */
    readonly batchSize?: number;
  },
): Promise<RetentionSweep> {
  if (input.retentionDays <= 0) {
    return { deleted: 0, retentionDays: input.retentionDays, more: false };
  }

  const batch = input.batchSize ?? RETENTION_BATCH;
  const cutoff = new Date(
    input.now.getTime() - input.retentionDays * 24 * 60 * 60 * 1000,
  );

  // **`includeDeleted`, because a soft-deleted row still holds its payload.**
  // Soft delete hides a row from the product; it does not remove the words
  // inside it. A retention sweep that respected the default scope would
  // leave exactly the rows nobody is looking at, which is the same mistake
  // the erasure sweep had to avoid at P7-T08b.
  //
  // openokr:allow-mutation: the calling Operation's own transaction.
  const removed = await tx
    .delete(channelMessages)
    .where(
      includeDeleted(
        channelMessages,
        and(
          eq(channelMessages.workspaceId, input.workspaceId),
          lt(channelMessages.createdAt, cutoff),
          // The bound, expressed as a subquery rather than a `limit`:
          // Postgres has no LIMIT on DELETE, and taking the ids first is
          // what makes the batch both bounded and deterministic.
          sql`${channelMessages.id} in (
            select id from channel_messages
             where workspace_id = ${input.workspaceId}
               and created_at < ${cutoff}
             order by created_at
             limit ${batch}
          )`,
        ),
      ),
    )
    .returning({ id: channelMessages.id });

  return {
    deleted: removed.length,
    retentionDays: input.retentionDays,
    more: removed.length === batch,
  };
}
