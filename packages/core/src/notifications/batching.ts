/**
 * Per-member batch coalescing (TECHNICAL-PLAN §4.11, P2-T06).
 *
 * "Found or created under a row lock so bursts cannot duplicate": the lock
 * here is the unique partial index migration 0013 puts on
 * `(workspace_id, member_id, channel) where status = 'pending'`, not an
 * explicit `SELECT ... FOR UPDATE`. Two concurrent inserts for the same
 * member and channel cannot both succeed; the loser's insert violates the
 * index and this falls back to reading the winner's row, so both callers end
 * up pointing at the same batch regardless of which one actually created it.
 */
import { activeOnly, notificationBatches, type WorkspaceTx } from "@openokr/db";
import { eq } from "drizzle-orm";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

export interface EnsurePendingBatchInput {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly channel: string;
  readonly windowMinutes: number;
}

export async function ensurePendingBatch<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: EnsurePendingBatchInput): Promise<string> {
  const [existing] = await tx
    .select({ id: notificationBatches.id })
    .from(notificationBatches)
    .where(
      activeOnly(
        notificationBatches,
        eq(notificationBatches.workspaceId, input.workspaceId),
        eq(notificationBatches.memberId, input.memberId),
        eq(notificationBatches.channel, input.channel),
        eq(notificationBatches.status, "pending"),
      ),
    )
    .limit(1);
  if (existing) {
    return existing.id;
  }

  const sendAt = new Date(Date.now() + input.windowMinutes * 60 * 1000);
  // openokr:allow-mutation: called only from inside an Operation's execute,
  // on the transaction that Operation opened.
  const [created] = await tx
    .insert(notificationBatches)
    .values({
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      channel: input.channel,
      windowMinutes: input.windowMinutes,
      sendAt,
    })
    .onConflictDoNothing()
    .returning({ id: notificationBatches.id });
  if (created) {
    return created.id;
  }

  // Lost the race to the unique partial index: the winner's row is the
  // answer, not an error.
  const [row] = await tx
    .select({ id: notificationBatches.id })
    .from(notificationBatches)
    .where(
      activeOnly(
        notificationBatches,
        eq(notificationBatches.workspaceId, input.workspaceId),
        eq(notificationBatches.memberId, input.memberId),
        eq(notificationBatches.channel, input.channel),
        eq(notificationBatches.status, "pending"),
      ),
    )
    .limit(1);
  return (row as { id: string }).id;
}
