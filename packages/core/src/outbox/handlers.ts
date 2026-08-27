/**
 * What each outbox topic does when it is delivered (P5-T01a).
 *
 * **The topics have been written since Phase 2 and nothing has ever read
 * them.** Every write enqueues correctly, `OutboxRelay` has existed in
 * `packages/adapters` since P1-T07, and no deployment ever constructed one. So
 * no invitation email was sent, no live session event reached a second browser
 * except by a page refresh, and nothing was indexed for retrieval. That is
 * PLAN.md §12's R10, and this table plus `apps/web/bin/relay.ts` is what closes
 * it.
 *
 * **Dependencies arrive as plain functions, not as ports.** `packages/core` may
 * not import `packages/adapters`, so this file declares the shape of what it
 * needs and the host supplies it, exactly as `AgentDrafter` and `EmbedFunction`
 * already do. The relay host is the one place that holds both.
 *
 * **Every handler must be safe to run twice.** Delivery is at-least-once by
 * design: a relay that dies between the driver call and the commit that marks
 * the row will deliver it again. The idempotency key is on the row for
 * consumers that need it, and each handler below says how it copes.
 */
import type { Pool } from "pg";
import type { EmbedFunction } from "../embeddings/service.ts";
import { EMBED_TOPIC } from "../embeddings/subjects.ts";
import { parseEmbedJob, runEmbedJob } from "../embeddings/worker.ts";
import { PermanentDispatchError } from "./permanent.ts";

/** One delivered outbox row, as a handler sees it. */
export interface OutboxDelivery {
  readonly topic: string;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly attempts: number;
}

/**
 * What the host provides.
 *
 * Every field but `pool` is optional, and absent means that capability is not
 * configured on this deployment. A topic whose dependency is missing is
 * **skipped, not failed**: an instance with no mail server should not
 * accumulate dead letters for every invitation, it should tell somebody its
 * mail is not configured, which the settings screen already does.
 */
export interface OutboxHandlerDeps {
  readonly pool: Pool;
  /** Turns text into vectors. Absent leaves retrieval on full text. */
  readonly embed?: EmbedFunction;
  /** Publishes a realtime event. Absent on a deployment with no realtime. */
  readonly publish?: (
    channel: string,
    event: string,
    data: Record<string, unknown>,
  ) => Promise<void>;
  /** Sends one message. Absent when no mail is configured. */
  readonly sendMail?: (message: {
    readonly to: string;
    readonly subject: string;
    readonly text: string;
  }) => Promise<void>;
  /** The instance's own address, for links inside emails. */
  readonly baseUrl?: string;
  /** Where a skipped delivery is reported. */
  readonly onSkipped?: (delivery: OutboxDelivery, reason: string) => void;
}

export type OutboxHandler = (
  delivery: OutboxDelivery,
  deps: OutboxHandlerDeps,
) => Promise<void>;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/**
 * Publishes one realtime event.
 *
 * The channel is already on the payload, put there by the action that enqueued
 * it, because `packages/core` cannot name a channel the transport understands
 * and the action is where the session's identifiers are.
 *
 * **Safe to run twice**: a client that receives the same event twice re-reads
 * the session through the normal path twice, which is a wasted request and
 * nothing worse. That is why these events carry identifiers only.
 */
const publishEvent: OutboxHandler = async (delivery, deps) => {
  const channel = asString(delivery.payload.channel);
  if (!channel) {
    throw new PermanentDispatchError(
      `${delivery.topic} has no channel on its payload, so nothing can receive it.`,
    );
  }
  if (!deps.publish) {
    deps.onSkipped?.(delivery, "no realtime transport is configured");
    return;
  }
  const { channel: _channel, ...data } = delivery.payload;
  await deps.publish(channel, delivery.topic, data);
};

/**
 * Embeds one entity's text.
 *
 * **Safe to run twice** by content hash: `runEmbedJob` re-reads the entity and
 * skips when the hash has not moved, so a repeat delivery costs one read.
 */
const embedContent: OutboxHandler = async (delivery, deps) => {
  // Parsed rather than cast. A row whose payload is not an embed job cannot
  // become one by being retried.
  const job = parseEmbedJob(delivery.payload);
  if (!job) {
    throw new PermanentDispatchError(
      "This row is not an embed job: it needs a workspace, an entity type and an entity id.",
    );
  }
  const result = await runEmbedJob(job, {
    pool: deps.pool,
    embed: deps.embed ?? null,
  });
  if (result.kind === "skipped") {
    deps.onSkipped?.(delivery, result.reason);
  }
};

/**
 * Sends one invitation email.
 *
 * **Safe to run twice** only in the sense that the link is still the same link:
 * a second delivery sends a second copy of the same invitation, which is
 * annoying and not harmful. Mail has no idempotency of its own, and inventing
 * one here would mean a sent-mail table this row does not need.
 */
const sendInvitation: OutboxHandler = async (delivery, deps) => {
  const to = asString(delivery.payload.to);
  const token = asString(delivery.payload.token);
  if (!to || !token) {
    throw new PermanentDispatchError(
      "An invitation email needs an address and a token, and this row has one of them at most.",
    );
  }
  if (!deps.sendMail || !deps.baseUrl) {
    // Not a failure. An instance with no mail configured has an invitation
    // link its admin can copy from the invitations screen.
    deps.onSkipped?.(delivery, "no mail transport is configured");
    return;
  }

  const link = `${deps.baseUrl.replace(/\/+$/, "")}/join/${token}`;
  await deps.sendMail({
    to,
    subject: "You have been invited to OpenOKR",
    // Plain text, and short. The link is the message; anything else is
    // decoration around a URL somebody is about to click.
    text: [
      "You have been invited to a workspace on OpenOKR.",
      "",
      link,
      "",
      "If you were not expecting this, you can ignore it.",
    ].join("\n"),
  });
};

/**
 * A rename, which nothing needs to deliver anywhere yet.
 *
 * Acknowledged rather than dead-lettered: the row is a record that the rename
 * happened and a hook for whatever wants it later, and a dead letter for every
 * rename would be noise in the one place operators go to find real failures.
 */
const acknowledge: OutboxHandler = async (delivery, deps) => {
  deps.onSkipped?.(delivery, "no consumer for this topic yet");
};

/**
 * Every topic the product enqueues, and what delivers it.
 *
 * A topic absent from this table dead-letters on its first attempt, because a
 * producer that shipped ahead of its consumer is something to see rather than
 * something to retry ten times.
 */
export const OUTBOX_HANDLERS: Readonly<Record<string, OutboxHandler>> = {
  [EMBED_TOPIC]: embedContent,
  "invitation.email": sendInvitation,
  "session.stageChanged": publishEvent,
  "session.micPassed": publishEvent,
  "session.scoresRevealed": publishEvent,
  "workspace.renamed": acknowledge,
};

/** Runs one delivery, or refuses it permanently when nothing handles it. */
export async function dispatchOutbox(
  delivery: OutboxDelivery,
  deps: OutboxHandlerDeps,
): Promise<void> {
  const handler = OUTBOX_HANDLERS[delivery.topic];
  if (!handler) {
    throw new PermanentDispatchError(
      `Nothing handles "${delivery.topic}". A producer has shipped ahead of its consumer.`,
    );
  }
  await handler(delivery, deps);
}
