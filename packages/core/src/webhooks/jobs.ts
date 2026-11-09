/**
 * The outbox row a webhook delivery rides on (docs/design/outbound-webhooks.md
 * W8), and the limits every delivery keeps.
 *
 * The row carries identifiers and nothing else. The body is built when the
 * relay sends it, from the subject as the hook's owner sees it then (W1), so
 * nothing on the queue is workspace content and a redelivery reads afresh.
 */
import { randomUUID } from "node:crypto";
import { newId, type OutboxMessage } from "@openokr/db";
import type { DeliveredEvent } from "./events.ts";

export const WEBHOOK_DELIVER_TOPIC = "webhooks.deliver";

/** How long a delivery row is kept, and so what the log shows (W10). */
export const DELIVERY_LOG_DAYS = 30;

/** How long the old secret keeps signing after a rotation (W5). */
export const PREVIOUS_SECRET_HOURS = 24;

/** One delivery, as the outbox row names it. */
export interface WebhookJob {
  readonly workspaceId: string;
  readonly webhookId: string;
  readonly event: DeliveredEvent;
  /** The `webhook-id` header, the same on every attempt of this event. */
  readonly eventId: string;
  readonly occurredAt: string;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly checkInId: string | null;
}

/** A fresh event id, time-ordered so a receiver's log sorts by it. */
export function newEventId(): string {
  return `msg_${newId().replaceAll("-", "")}`;
}

/**
 * The outbox row for one job.
 *
 * The key carries a fresh suffix, because the same event is enqueued again by
 * a redelivery, and the unique key is there to stop one write enqueuing a row
 * twice rather than to stop a person asking twice.
 */
export function webhookDeliveryMessage(job: WebhookJob): OutboxMessage {
  return {
    topic: WEBHOOK_DELIVER_TOPIC,
    payload: { ...job },
    idempotencyKey: `${WEBHOOK_DELIVER_TOPIC}:${job.webhookId}:${job.eventId}:${randomUUID()}`,
  };
}
