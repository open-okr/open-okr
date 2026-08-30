/**
 * Writing one outbound message into the log and its outbox row (P5-T01b-b).
 *
 * The in-transaction twin of the `channels.send` action. The action is the
 * public surface a caller reaches through the registry; this is what the nudge
 * delivery uses, because it is already inside the transaction that wrote the
 * nudge rows and calling an action from there would open a second one.
 *
 * Both write the same two rows, in the same order, with the same idempotency
 * key doing the same job: the log row first, so a repeated ask finds it and
 * stops before anything is queued.
 */

import type { WorkspaceTx } from "@openokr/db";
import { channelMessages, enqueueOutbox, includeDeleted } from "@openokr/db";
import { and, eq } from "drizzle-orm";
import { CHANNEL_MESSAGE_TOPIC } from "../actions/channels.ts";
import type { BuiltMessage } from "./builder.ts";
import type { DeliveryChannel } from "./routing.ts";

export interface QueuedMessage {
  /** False when this key had already been queued, so nothing new was written. */
  readonly queued: boolean;
  readonly messageId: string | null;
}

export async function queueChannelMessageInTx(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly channel: Exclude<DeliveryChannel, "in_app">;
    readonly message: BuiltMessage;
    readonly idempotencyKey: string;
    /** Recorded on the row so the log can say why this is not the primary. */
    readonly fallbackReason?: string;
  },
): Promise<QueuedMessage> {
  const [existing] = await tx
    .select({ id: channelMessages.id })
    .from(channelMessages)
    .where(
      // Deliberately including soft-deleted rows: the unique index is not
      // partial on `deleted_at`, so a deleted row still holds the key and a
      // scoped read would miss it and then fail on the insert.
      includeDeleted(
        channelMessages,
        and(
          eq(channelMessages.workspaceId, input.workspaceId),
          eq(channelMessages.idempotencyKey, input.idempotencyKey),
        ),
      ),
    )
    .limit(1);

  if (existing) {
    return { queued: false, messageId: existing.id };
  }

  // openokr:allow-mutation: runs on the transaction the calling Operation
  // opened, so this row and that Operation's audit row commit together.
  const [row] = await tx
    .insert(channelMessages)
    .values({
      workspaceId: input.workspaceId,
      provider: input.channel,
      direction: "out" as const,
      memberId: input.memberId,
      payload: {
        text: input.message.text,
        ...(input.message.subject ? { subject: input.message.subject } : {}),
        ...(input.message.buttons ? { buttons: input.message.buttons } : {}),
        ...(input.message.templateKey
          ? { templateKey: input.message.templateKey }
          : {}),
        // Meaningless without a template key, and required with one: Meta
        // refuses a send whose parameter count does not match (P5-T04b-b).
        ...(input.message.templateParameters
          ? { templateParameters: input.message.templateParameters }
          : {}),
        ...(input.message.degraded.length > 0
          ? { degraded: input.message.degraded }
          : {}),
        ...(input.fallbackReason
          ? { fallbackReason: input.fallbackReason }
          : {}),
      },
      idempotencyKey: input.idempotencyKey,
      status: "queued" as const,
    })
    .returning({ id: channelMessages.id });

  if (!row) {
    return { queued: false, messageId: null };
  }

  await enqueueOutbox(tx, {
    topic: CHANNEL_MESSAGE_TOPIC,
    payload: { workspaceId: input.workspaceId, messageId: row.id },
    idempotencyKey: `${CHANNEL_MESSAGE_TOPIC}:${row.id}`,
  });

  return { queued: true, messageId: row.id };
}
