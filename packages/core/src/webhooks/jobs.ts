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
import { type DeliveredEvent, PING_EVENT, WEBHOOK_EVENTS } from "./events.ts";

export const WEBHOOK_DELIVER_TOPIC = "webhooks.deliver";

/** How long a delivery row is kept, and so what the log shows (W10). */
export const DELIVERY_LOG_DAYS = 30;

/** A run of failed deliveries this long turns the hook off (W9). */
export const FAILURES_BEFORE_OFF = 50;

/** How long the old secret keeps signing after a rotation (W5). */
export const PREVIOUS_SECRET_HOURS = 24;

/** The mail to a hook's creator when it turns itself off (W9). */
export const WEBHOOK_TURNED_OFF_TOPIC = "webhooks.turnedOff";

/**
 * How long after each failed attempt the next one is made, in seconds (W9):
 * five seconds, five minutes, half an hour, two hours, five hours, ten hours
 * and six more. The Standard Webhooks schedule, stopped at about a day, so a
 * receiver down for a weekend is not hammered for it.
 */
const RETRY_SECONDS = [5, 300, 1_800, 7_200, 18_000, 36_000, 21_600] as const;

/** Every attempt one event gets: the first, then one after each wait. */
export const WEBHOOK_MAX_ATTEMPTS = RETRY_SECONDS.length + 1;

/** The wait after the given number of attempts have failed. */
export function webhookRetrySeconds(attempts: number): number {
  return RETRY_SECONDS[Math.max(0, attempts - 1)] ?? 21_600;
}

/** What one delivery may take, and how much of the answer is read (W7). */
export const DELIVERY_TIMEOUT_MS = 10_000;
export const ANSWER_READ_BYTES = 64 * 1024;

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

const KNOWN_EVENTS: ReadonlySet<string> = new Set([
  ...WEBHOOK_EVENTS,
  PING_EVENT,
]);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/** The job on a row, or null when the row is not one. */
export function parseWebhookJob(
  payload: Readonly<Record<string, unknown>>,
): WebhookJob | null {
  const workspaceId = text(payload.workspaceId);
  const webhookId = text(payload.webhookId);
  const event = text(payload.event);
  const eventId = text(payload.eventId);
  const occurredAt = text(payload.occurredAt);
  if (
    !workspaceId ||
    !webhookId ||
    !event ||
    !KNOWN_EVENTS.has(event) ||
    !eventId ||
    !occurredAt
  ) {
    return null;
  }
  return {
    workspaceId,
    webhookId,
    event: event as DeliveredEvent,
    eventId,
    occurredAt,
    subjectType: text(payload.subjectType),
    subjectId: text(payload.subjectId),
    checkInId: text(payload.checkInId),
  };
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
