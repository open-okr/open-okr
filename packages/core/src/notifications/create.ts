/**
 * Creating notification rows (TECHNICAL-PLAN §4.11, P2-T06).
 *
 * A mention delivers immediately when the recipient's settings say so;
 * every other reason batches, coalescing bursts through
 * `ensurePendingBatch`. `sentAt` stays null either way: nothing in this
 * package calls a mailer (CLAUDE.md: vendor SDKs and their ports live only
 * in `packages/adapters`). A row with `sentAt` still null and, for a
 * batch, a `batchId` pointing at a batch whose own `send_at` has arrived is
 * what a future send worker's query watches for — not yet built, the same
 * gap this task leaves on the outbox dispatcher (P2-T04) and the orphan
 * job (P2-T05).
 */
import {
  activeOnly,
  notifications,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { ensurePendingBatch } from "./batching.ts";
import type { Recipient } from "./recipients.ts";
import {
  DEFAULT_BATCH_WINDOW_MINUTES,
  getOrCreateNotificationSettings,
} from "./settings.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

async function primaryChannelFor<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, memberId: string): Promise<string> {
  const [member] = await tx
    .select({ primaryChannel: workspaceMembers.primaryChannel })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return member?.primaryChannel ?? "email";
}

export interface NotifyRecipientsInput {
  readonly workspaceId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly activityId?: string;
  readonly recipients: readonly Recipient[];
  /**
   * The bulk-suppression flag TECHNICAL-PLAN §7.1 asks for: set by an
   * import run (through the Operation pipeline, dispatch suppressed) so a
   * thousand imported rows do not each notify their new watchers.
   */
  readonly suppress?: boolean;
}

export interface NotifyRecipientsResult {
  readonly created: number;
  readonly immediate: number;
  readonly batched: number;
}

export async function notifyRecipients<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: NotifyRecipientsInput,
): Promise<NotifyRecipientsResult> {
  if (input.suppress) {
    return { created: 0, immediate: 0, batched: 0 };
  }

  let immediate = 0;
  let batched = 0;

  for (const recipient of input.recipients) {
    const settings = await getOrCreateNotificationSettings(
      tx,
      input.workspaceId,
      recipient.memberId,
    );
    const channel =
      settings.routing[recipient.reason] ??
      (await primaryChannelFor(tx, input.workspaceId, recipient.memberId));
    const sendImmediately =
      recipient.reason === "mentioned" && settings.mentionImmediate;

    if (sendImmediately) {
      // openokr:allow-mutation: this helper is called only from inside an
      // Operation's execute, on the transaction that Operation opened.
      await tx.insert(notifications).values({
        workspaceId: input.workspaceId,
        recipientMemberId: recipient.memberId,
        activityId: input.activityId ?? null,
        reason: recipient.reason,
        channel,
      });
      immediate++;
    } else {
      const batchId = await ensurePendingBatch(tx, {
        workspaceId: input.workspaceId,
        memberId: recipient.memberId,
        channel,
        windowMinutes:
          settings.batchWindowMinutes ?? DEFAULT_BATCH_WINDOW_MINUTES,
      });
      // openokr:allow-mutation: same reason as the branch above.
      await tx.insert(notifications).values({
        workspaceId: input.workspaceId,
        recipientMemberId: recipient.memberId,
        activityId: input.activityId ?? null,
        batchId,
        reason: recipient.reason,
        channel,
      });
      batched++;
    }
  }

  return { created: immediate + batched, immediate, batched };
}
