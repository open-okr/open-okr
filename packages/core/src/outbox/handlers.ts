/**
 * What each outbox topic does when it is delivered (P5-T01a).
 *
 * **The topics have been written since Phase 2 and nothing has ever read
 * them.** Every write enqueues correctly, `OutboxRelay` has existed in
 * `packages/adapters` since P1-T07, and no deployment ever constructed one. So
 * no invitation email was sent, no live session event reached a second browser
 * except by a page refresh, and nothing was indexed for retrieval. That is
 * PLAN.md §12's R10, and this table plus `apps/web/lib/relay.ts` is what closes
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
import {
  activeOnly,
  channelConnections,
  channelMessages,
  users,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { CHANNEL_MESSAGE_TOPIC } from "../actions/channels.ts";

import type { EmbedFunction } from "../embeddings/service.ts";
import { EMBED_TOPIC } from "../embeddings/subjects.ts";
import { parseEmbedJob, runEmbedJob } from "../embeddings/worker.ts";
import { EXPORT_TOPIC } from "../exports/kinds.ts";
import {
  type PutFile,
  parseExportJob,
  runExportJob,
} from "../exports/worker.ts";
import { parseIndexJob, runIndexJob } from "../search/worker.ts";
import { withoutTrailingSlashes } from "../urls.ts";
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
  /**
   * Delivers one message over a channel (P5-T01b-a).
   *
   * A function rather than the `Channel` port itself, for the same reason as
   * everything else here: the port lives in `packages/adapters`. The host
   * builds the driver and passes this.
   */
  readonly sendChannel?: (message: {
    /** Which provider the routing chose. The host picks the driver from it. */
    readonly provider: string;
    readonly memberId: string | null;
    readonly text: string;
    readonly subject?: string;
    readonly buttons?: readonly { label: string; url: string }[];
    /** The approved template, for a provider that will carry nothing else. */
    readonly templateKey?: string;
    readonly templateParameters?: readonly string[];
    readonly idempotencyKey: string;
  }) => Promise<{
    readonly delivered: boolean;
    readonly externalMessageId?: string;
    readonly suppressedReason?: string;
  }>;
  /**
   * Keeps one built file (P5-T15).
   *
   * A function rather than the `FileStorage` port, for the reason every other
   * dependency here is one: the port lives in `packages/adapters`. Absent
   * means this deployment has no storage configured, and a large export is
   * skipped rather than failed, the same as mail.
   */
  readonly putFile?: PutFile;
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
 * Indexes one entity for search (P5-T13).
 *
 * **Safe to run twice**: the write is an upsert on the index's own unique key,
 * so a repeat delivery costs one write rather than a duplicate row. An entity
 * that has gone since the row was enqueued has its projection removed, which is
 * what keeps a deleted title out of somebody's results.
 */
const indexContent: OutboxHandler = async (delivery, deps) => {
  const job = parseIndexJob(delivery.payload);
  if (!job) {
    throw new PermanentDispatchError(
      `${delivery.topic} does not carry an indexing job, so nothing can run it.`,
    );
  }
  const outcome = await runIndexJob(job, { pool: deps.pool });
  if (outcome.kind === "skipped") {
    deps.onSkipped?.(delivery, outcome.reason);
  }
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

  const link = `${withoutTrailingSlashes(deps.baseUrl)}/join/${token}`;
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
 * A member's email address, or null (P5-T01b-a).
 *
 * Exported because the relay host needs it to build the email channel, and it
 * is the one lookup that crosses from a member to the person behind them.
 * `users` carries no tenant policy of its own, so the join through
 * `workspace_members` under the workspace's own setting is what scopes it.
 */
export async function memberEmail(
  pool: Pool,
  workspaceId: string,
  memberId: string,
): Promise<string | null> {
  const db = drizzle(pool);
  const [row] = await withWorkspace(db, workspaceId, (tx) =>
    tx
      .select({ email: users.email })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.id, memberId),
        ),
      )
      .limit(1),
  );
  return row?.email ?? null;
}

/**
 * Delivers one row from the channel message log (P5-T01b-a).
 *
 * **Safe to run twice** by status: the row is marked `sent` in the same
 * statement that stamps `sent_at`, and a repeat delivery finds it already
 * marked and stops before calling the driver. The window between the send and
 * that update is the one place a duplicate is still possible, which is what
 * `channel_messages.idempotency_key` and the driver's own key are for.
 */
const deliverChannelMessage: OutboxHandler = async (delivery, deps) => {
  const workspaceId = asString(delivery.payload.workspaceId);
  const messageId = asString(delivery.payload.messageId);
  if (!workspaceId || !messageId) {
    throw new PermanentDispatchError(
      "A channel message row needs a workspace and a message id.",
    );
  }

  const db = drizzle(deps.pool);
  const [row] = await withWorkspace(db, workspaceId, (tx) =>
    tx
      .select({
        memberId: channelMessages.memberId,
        provider: channelMessages.provider,
        payload: channelMessages.payload,
        status: channelMessages.status,
        idempotencyKey: channelMessages.idempotencyKey,
      })
      .from(channelMessages)
      .where(
        activeOnly(
          channelMessages,
          eq(channelMessages.workspaceId, workspaceId),
          eq(channelMessages.id, messageId),
        ),
      )
      .limit(1),
  );

  if (!row) {
    // The row was deleted between the enqueue and the delivery. Nothing will
    // bring it back, so this is not something to retry ten times.
    throw new PermanentDispatchError(
      "The message this row names no longer exists.",
    );
  }
  if (row.status !== "queued") {
    deps.onSkipped?.(delivery, `already ${row.status}`);
    return;
  }
  if (!deps.sendChannel) {
    deps.onSkipped?.(delivery, "no channel driver is configured");
    return;
  }

  const payload = (row.payload ?? {}) as {
    text?: unknown;
    subject?: unknown;
    buttons?: unknown;
    templateKey?: unknown;
    templateParameters?: unknown;
  };
  const text = asString(payload.text);
  const templateKey = asString(payload.templateKey);
  // **A template message has no text, and that is not an empty message**
  // (P5-T04b-b). WhatsApp outside its conversation window carries the approved
  // template and nothing else, so the row is a template name and its filled-in
  // parameters. A row with neither is the only one there is nothing to send.
  if (!text && !templateKey) {
    throw new PermanentDispatchError("The message row has no text to send.");
  }

  const outcome = await deps
    .sendChannel({
      provider: row.provider,
      memberId: row.memberId,
      // Empty for a template-only send, which is the shape the driver expects:
      // it decides on the template key, not on whether there are words.
      text: text ?? "",
      ...(asString(payload.subject)
        ? { subject: payload.subject as string }
        : {}),
      ...(Array.isArray(payload.buttons)
        ? {
            buttons: payload.buttons as readonly {
              label: string;
              url: string;
            }[],
          }
        : {}),
      ...(templateKey ? { templateKey } : {}),
      ...(Array.isArray(payload.templateParameters)
        ? {
            templateParameters: payload.templateParameters as readonly string[],
          }
        : {}),
      idempotencyKey: row.idempotencyKey,
    })
    // A driver that throws is a failed send, not a crashed relay. The row
    // records why and the relay's own backoff decides whether to try again.
    .catch((error: unknown) => ({
      delivered: false,
      failure: error instanceof Error ? error.message : String(error),
    }));

  const failure = "failure" in outcome ? outcome.failure : undefined;
  const status = outcome.delivered
    ? ("sent" as const)
    : failure
      ? ("failed" as const)
      : ("suppressed" as const);

  // openokr:allow-mutation: the delivery side of the outbox, marking the row
  // the relay has already claimed. Not a domain write: nothing about the
  // workspace changed, only the record of what this delivery did.
  await withWorkspace(db, workspaceId, (tx) =>
    tx
      .update(channelMessages)
      .set({
        status,
        error:
          failure ??
          ("suppressedReason" in outcome
            ? (outcome.suppressedReason ?? null)
            : null),
        sentAt: outcome.delivered ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(activeOnly(channelMessages, eq(channelMessages.id, messageId))),
  );

  if (status === "failed") {
    // The connection is marked broken, which is what closes the loop
    // (P5-T01b-b): routing reads `state = 'connected'`, so the next nudge for
    // anybody on this provider goes to email and its owner is told once that
    // it needs reconnecting. Without this the same send would fail again every
    // hour and nobody would ever be told why.
    if (row.provider !== "email") {
      // openokr:allow-mutation: the delivery side of the outbox, recording
      // what a driver just reported. Not a domain write.
      await withWorkspace(db, workspaceId, (tx) =>
        tx
          .update(channelConnections)
          .set({
            state: "error",
            error: (failure ?? "the driver failed").slice(0, 500),
            updatedAt: new Date(),
          })
          .where(
            activeOnly(
              channelConnections,
              eq(channelConnections.workspaceId, workspaceId),
              eq(
                channelConnections.provider,
                row.provider as "slack" | "teams" | "whatsapp" | "telegram",
              ),
            ),
          ),
      );
    }
    // Rethrown so the relay retries and, at the ceiling, dead-letters. The row
    // already says what happened, so this is about the queue, not the record.
    throw new Error(failure ?? "the driver failed");
  }
  if (status === "suppressed") {
    deps.onSkipped?.(
      delivery,
      "suppressedReason" in outcome
        ? (outcome.suppressedReason ?? "the driver sent nothing")
        : "the driver sent nothing",
    );
  }
};

/**
 * A rename, which nothing needs to deliver anywhere yet.
 *
 * Acknowledged rather than dead-lettered: the row is a record that the rename
 * happened and a hook for whatever wants it later, and a dead letter for every
 * rename would be noise in the one place operators go to find real failures.
 */
/**
 * Builds one large export and puts it in storage (P5-T15).
 *
 * **Safe to run twice**: the run's state is the ledger. A redelivery for a run
 * already `ready` does nothing, and one for a run left `building` by a relay
 * that died rebuilds over its own storage key.
 *
 * A failure is written on the run rather than thrown, because the person who
 * asked is watching a row that would otherwise say "being prepared" forever.
 * That means this handler does not retry, which is right: an export that failed
 * because a member was suspended will fail the same way ten more times.
 */
const buildExport: OutboxHandler = async (delivery, deps) => {
  const job = parseExportJob(delivery.payload);
  if (!job) {
    throw new PermanentDispatchError(
      `${delivery.topic} has no workspace and run on its payload, so nothing can be built.`,
    );
  }
  if (!deps.putFile) {
    deps.onSkipped?.(delivery, "no file storage is configured");
    return;
  }
  const outcome = await runExportJob(job, {
    pool: deps.pool,
    putFile: deps.putFile,
  });
  if (outcome.kind === "skipped" || outcome.kind === "failed") {
    deps.onSkipped?.(delivery, outcome.reason);
  }
};

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
  [CHANNEL_MESSAGE_TOPIC]: deliverChannelMessage,
  "invitation.email": sendInvitation,
  "session.stageChanged": publishEvent,
  "session.micPassed": publishEvent,
  "session.scoresRevealed": publishEvent,
  // The board tells every watcher to re-read (P5-T11). Identifiers only, like
  // every event on a realtime channel.
  "board.changed": publishEvent,
  "content.index": indexContent,
  // The large-export path (P5-T15). The row names a run; the worker rebuilds
  // the list as the member who asked, writes the file to storage and marks the
  // run ready. It acknowledged and did nothing between P5-T13 and P5-T15.
  [EXPORT_TOPIC]: buildExport,
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
