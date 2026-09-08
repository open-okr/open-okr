import {
  activeOnly,
  notificationBatches,
  type OutboxMessage,
  type WorkspaceTx,
} from "@openokr/db";
import { and, asc, count, eq, lte } from "drizzle-orm";

/**
 * Draining the notification batches whose window has closed (P6-G01b).
 *
 * **No batch had ever been delivered.** P2-T06 built the coalescing, the
 * template and the settings, and its own file comment said the plain truth at
 * the time: "nothing dispatches a `pending` batch or an unsent immediate row
 * yet". Nothing had, for four months and nine tasks, so a member who set a
 * thirty-minute window received nothing at all rather than one mail every half
 * hour. The gap audit recorded it as the second half of B-01.
 *
 * **The claim is the idempotence, and it is one statement.** A conditional
 * update from `pending` to `sent` returning the row means exactly one caller
 * owns each batch however many hosts are draining: the loser's update matches
 * no row. It runs inside the drain's own transaction alongside the outbox row,
 * so a batch is claimed and enqueued together or neither.
 *
 * **`sent` means handed to the outbox, and that is deliberate.** The outbox is
 * durable, leased, retried and dead-lettered, so a row in it either arrives or
 * is visible as a failure with its own attempt count. Marking the batch `sent`
 * at claim time and letting the outbox own delivery is the same contract
 * `invitation.email` has had since P1-T07. `failed` stays for a batch this
 * drain itself refuses, which today means a member it cannot resolve at all.
 */

/** The outbox topic one closed batch is delivered under. */
export const DIGEST_TOPIC = "notification.digest";

/** How many batches one pass claims. A pass is a poll, not a backlog sweep. */
const DRAIN_BATCH_LIMIT = 100;

export interface DrainInput {
  readonly workspaceId: string;
  /** Defaults to now. Overridden by tests. */
  readonly now?: Date;
  readonly limit?: number;
}

export interface DrainResult {
  /** Batches claimed and enqueued on this pass. */
  readonly claimed: number;
  /**
   * Batches still pending after this pass, which is what says whether the
   * drain is keeping up. A figure that never falls means the window is shorter
   * than the poll, or that something is refusing every claim.
   */
  readonly waiting: number;
  readonly outbox: readonly OutboxMessage[];
}

/**
 * Claims every batch whose `send_at` has passed and returns the outbox rows.
 *
 * The messages are returned rather than enqueued here, so the calling
 * Operation puts them in its own `outbox` array and the pipeline writes them in
 * the one transaction that also claimed the batches. A helper that enqueued
 * them itself would work and would put the decision about atomicity in the
 * wrong place.
 */
export async function claimDueBatches(
  tx: WorkspaceTx,
  input: DrainInput,
): Promise<DrainResult> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? DRAIN_BATCH_LIMIT;

  const due = await tx
    .select({
      id: notificationBatches.id,
      memberId: notificationBatches.memberId,
      channel: notificationBatches.channel,
    })
    .from(notificationBatches)
    .where(
      activeOnly(
        notificationBatches,
        and(
          eq(notificationBatches.workspaceId, input.workspaceId),
          eq(notificationBatches.status, "pending"),
          lte(notificationBatches.sendAt, now),
        ),
      ),
    )
    .orderBy(asc(notificationBatches.sendAt))
    .limit(limit);

  // Every batch still pending, including the ones this pass is about to claim.
  // Subtracting the claim below is what makes it "still waiting after this
  // pass", which is the number worth logging: a figure that never falls is a
  // drain that is not keeping up.
  const [pendingRow] = await tx
    .select({ pending: count() })
    .from(notificationBatches)
    .where(
      activeOnly(
        notificationBatches,
        and(
          eq(notificationBatches.workspaceId, input.workspaceId),
          eq(notificationBatches.status, "pending"),
        ),
      ),
    );
  const pending = Number(pendingRow?.pending ?? 0);

  const outbox: OutboxMessage[] = [];
  let claimed = 0;

  for (const batch of due) {
    // openokr:allow-mutation: called only from inside an Operation's execute,
    // on the transaction that Operation opened.
    const [won] = await tx
      .update(notificationBatches)
      .set({ status: "sent", sentAt: now, updatedAt: now })
      .where(
        activeOnly(
          notificationBatches,
          and(
            eq(notificationBatches.id, batch.id),
            // The whole of the race. A second host reading the same page of
            // due batches finds this row no longer pending and matches nothing.
            eq(notificationBatches.status, "pending"),
          ),
        ),
      )
      .returning({ id: notificationBatches.id });
    if (!won) {
      continue;
    }
    claimed++;
    outbox.push({
      topic: DIGEST_TOPIC,
      payload: {
        // The workspace travels on the payload, the way channel.message
        // carries it: the queue row describes the job and not the tenant, and
        // the handler has to open its transaction under one.
        workspaceId: input.workspaceId,
        batchId: batch.id,
        memberId: batch.memberId,
        channel: batch.channel,
      },
      // The batch id alone. A batch is claimed once, so this key can never
      // collide with itself, and it is what makes a retried write one mail.
      idempotencyKey: `${DIGEST_TOPIC}:${batch.id}`,
    });
  }

  return {
    claimed,
    waiting: Math.max(0, pending - claimed),
    outbox,
  };
}
