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
  inviteLinks,
  users,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { CHANNEL_MESSAGE_TOPIC } from "../actions/channels.ts";
import {
  COACH_MENTION_TOPIC,
  parseCoachMentionJob,
} from "../agents/coach-mention.ts";
import { runCoachMention } from "../agents/coach-mention-run.ts";
import type { AgentDrafter } from "../agents/drafter.ts";
import { AGENT_RUN_CHANGED_TOPIC } from "../agents/live.ts";
import {
  AGENT_RUN_STEP_TOPIC,
  type AgentRunStepJob,
  type AgentRunStepOutcome,
  parseAgentRunStepJob,
} from "../agents/run-steps.ts";
import {
  ACCOUNT_DELETION_CANCELLED_TOPIC,
  ACCOUNT_DELETION_DONE_TOPIC,
  ACCOUNT_DELETION_REQUESTED_TOPIC,
  ACCOUNT_DELETION_TOMORROW_TOPIC,
} from "../auth/account-deletion.ts";
import {
  CHANGE_EMAIL_TOPIC,
  EMAIL_CHANGE_NOTICE_TOPIC,
  EMAIL_CHANGE_TAKEN_TOPIC,
} from "../auth/email-change.ts";
import {
  PASSWORD_CHANGE_VIAS,
  PASSWORD_CHANGED_TOPIC,
  type PasswordChangeVia,
} from "../auth/password-change.ts";
import {
  EMAIL_VERIFICATION_LINK_SECONDS,
  VERIFY_EMAIL_TOPIC,
} from "../auth/verification-links.ts";
import {
  endSubscriptionOnClosing,
  type SubscriptionEnder,
} from "../billing/closing.ts";
import {
  BLOB_SCAN_TOPIC,
  parseScanJob,
  runScanJob,
  type ScanFile,
} from "../blobs/scan.ts";
import { parseCopilotRunJob, runCopilotAnswer } from "../copilot/background.ts";
import type { EmbedFunction } from "../embeddings/service.ts";
import { EMBED_TOPIC } from "../embeddings/subjects.ts";
import { parseEmbedJob, runEmbedJob } from "../embeddings/worker.ts";
import { EXPORT_TOPIC } from "../exports/kinds.ts";
import {
  type PutFile,
  parseExportJob,
  runExportJob,
} from "../exports/worker.ts";
import {
  changeEmailMail,
  type DeletionCancelReason,
  deletionCancelledMail,
  deletionDoneMail,
  deletionRequestedMail,
  deletionTomorrowMail,
  emailChangeNoticeMail,
  emailChangeTakenMail,
  passwordChangedMail,
  verifyEmailMail,
} from "../mail/account.ts";
import {
  closureMail,
  erasureReminderMail,
  invitationMail,
  notificationDigestMail,
  renderStoredEmail,
  type StoredEmail,
  trialEndedMail,
  trialReminderMail,
  webhookTurnedOffMail,
} from "../mail/mails.ts";
import { mailLocale, mailWords } from "../mail/words.ts";
import { workspaceMail, workspaceMailInTx } from "../mail/workspace.ts";
import { digestItemsFor } from "../notifications/digest.ts";
import { DIGEST_TOPIC } from "../notifications/drain.ts";
import { parseIndexJob, runIndexJob } from "../search/worker.ts";
import { instanceNameOr } from "../secrets/instance-registry.ts";
import type { KeyRing } from "../secrets/key-ring.ts";
import { resolveInstanceDefaultLanguage } from "../settings/workspace-defaults.ts";
import { defaultMetrics, METRIC } from "../telemetry/recorder.ts";
import {
  END_SUBSCRIPTION_TOPIC,
  ERASURE_REMINDER_TOPIC,
  readClosureNotice,
  WORKSPACE_CLOSED_TOPIC,
} from "../tenancy/closing.ts";
import { ERASE_CUSTOMER_TOPIC, ERASE_FILES_TOPIC } from "../tenancy/erasure.ts";
import {
  TRIAL_ENDED_TOPIC,
  TRIAL_REMINDER_TOPIC,
} from "../tenancy/trial-topics.ts";
import { readTrialNotice } from "../tenancy/trials.ts";
import { withoutTrailingSlashes } from "../urls.ts";
import {
  deliverWebhook,
  readTurnedOff,
  type WebhookPost,
} from "../webhooks/deliver.ts";
import {
  FAILURES_BEFORE_OFF,
  parseWebhookJob,
  WEBHOOK_DELIVER_TOPIC,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_TURNED_OFF_TOPIC,
  webhookRetrySeconds,
} from "../webhooks/jobs.ts";
import { timezoneForAccount } from "../workspaces/memberships.ts";
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
    /**
     * The HTML alternative, for a message that has one (P6-G01b).
     *
     * The Mailer port has taken it since P1-T07 and this shape did not
     * describe it, so the digest's rendered list could only have been sent as
     * plain text. Optional, because the invitation deliberately sends none:
     * "the link is the message".
     */
    readonly html?: string;
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
    /** The email layout's HTML part, for an email message that has one. */
    readonly html?: string;
    readonly subject?: string;
    readonly buttons?: readonly { label: string; url: string }[];
    /** The approved template, for a provider that will carry nothing else. */
    readonly templateKey?: string;
    readonly templateParameters?: readonly string[];
    /**
     * The provider's own channel id, for a post to a space's channel rather
     * than to a member (completeness review M-23). Present exactly when
     * `memberId` is null, and the host sends it with `sendToChannel`.
     */
    readonly target?: string;
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
  /**
   * Reads one stored file back, or null when the object is gone (completeness
   * review M-24). What a virus scan reads. A function rather than the port,
   * for the reason `putFile` is one.
   */
  readonly getFile?: (key: string) => Promise<Buffer | null>;
  /**
   * The virus scanner this instance is configured with, or null for none
   * (completeness review M-24).
   *
   * A function resolved when a scan is delivered rather than a scanner built
   * once, because `scan.clamd.host` is a stored setting an administrator can
   * change while the relay runs, and because every other topic should not pay
   * for reading it.
   */
  readonly scanner?: () => Promise<ScanFile | null>;
  /**
   * The workspace's AI drafter (P4-T14b-b).
   *
   * A function rather than the provider itself, for the reason every other
   * dependency here is one: the provider lives in `packages/adapters`. Absent,
   * or answering null, means this workspace has no provider configured and a
   * copilot run halts saying so rather than failing.
   *
   * `forUser` is the account that asked (completeness review M-36), so the
   * host can answer with that person's own key where they stored one. A run
   * nobody asked for passes nothing and gets the workspace's.
   */
  readonly drafterFor?: (
    workspaceId: string,
    forUser?: string,
  ) => Promise<AgentDrafter | null | undefined>;
  /**
   * Takes one step of an agent run (completeness review M-11).
   *
   * A function rather than the run executor itself, because the executor
   * lives in `packages/agents`, which depends on this package. The host joins
   * the two, and resolves the run's AI provider through its one choke point
   * while it does. Absent means this process runs no agents.
   */
  readonly continueAgentRun?: (
    job: AgentRunStepJob,
  ) => Promise<AgentRunStepOutcome>;
  /**
   * The payment provider, for the one call a closure makes of it
   * (docs/design/workspace-erasure.md §3). Resolved per delivery, because billing
   * is a stored setting. Absent, or answering null, means no provider.
   */
  readonly billingFor?: () => Promise<SubscriptionEnder | null>;
  /**
   * Deletes every stored object under one workspace's prefix, for erasure
   * (docs/design/workspace-erasure.md §4). A function rather than the port, for
   * the reason `putFile` is one. Absent means no storage, and erasure waits.
   */
  readonly deleteFiles?: (prefix: string) => Promise<void>;
  /**
   * The root key ring, which opens a webhook's signing secret at the moment
   * it signs (outbound-webhooks.md W6). Absent, a webhook waits for a relay
   * that has one rather than being skipped.
   */
  readonly ring?: KeyRing;
  /**
   * Posts one signed webhook body through the outbound guard (W7). A
   * function rather than the guard, which lives in `packages/adapters`.
   */
  readonly postWebhook?: WebhookPost;
  /** The instance's own address, for links inside emails. */
  readonly baseUrl?: string;
  /**
   * What the instance calls itself, for the words around those links
   * (completeness review M-33). Resolved by the host per delivery, like mail
   * settings, because a rename should reach the next email. Absent says
   * "OpenOKR".
   */
  readonly instanceName?: string;
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
  // The topic, never the channel. A topic is one of a fixed handful; a
  // channel names a session, a goal or a workspace and is unbounded.
  defaultMetrics().count(METRIC.realtimeEventsTotal, {
    topic: delivery.topic,
  });
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
  const name = instanceNameOr(deps.instanceName);
  const workspaceId = asString(delivery.payload.workspaceId);
  const linkId = asString(delivery.payload.linkId);
  // The workspace's name, colour and language, and who sent the invitation
  // and until when (docs/design/email-templates.md). A row queued before
  // these were read, or one whose link has gone, still sends: the link is
  // the message, and the rest is said where it can be.
  const context = workspaceId
    ? await withWorkspace(drizzle(deps.pool), workspaceId, async (tx) => {
        const mail = await workspaceMailInTx(tx, workspaceId);
        const [invite] = linkId
          ? await tx
              .select({
                inviterName: workspaceMembers.name,
                expiresAt: inviteLinks.expiresAt,
              })
              .from(inviteLinks)
              .leftJoin(
                workspaceMembers,
                eq(workspaceMembers.id, inviteLinks.invitedByMemberId),
              )
              .where(
                activeOnly(
                  inviteLinks,
                  eq(inviteLinks.workspaceId, workspaceId),
                  eq(inviteLinks.id, linkId),
                ),
              )
              .limit(1)
          : [];
        return { mail, invite };
      })
    : null;
  const built = invitationMail({
    mail: context?.mail ?? {
      name: "",
      color: null,
      locale: "en",
      words: mailWords("en"),
    },
    instanceName: name,
    baseUrl: deps.baseUrl,
    link,
    inviterName: context?.invite?.inviterName ?? null,
    expiresAt: context?.invite?.expiresAt ?? null,
  });
  await deps.sendMail({ to, ...built });
};

/**
 * Sends one link that confirms an email address (docs/design/
 * email-verification.md D5, plan 0.8.0 S3).
 *
 * **Checks before it sends, and skips rather than fails.** A link nobody can
 * use is not worth a mail: no mail configured, the link expired, the account
 * gone, the address already confirmed, or the account's address changed
 * since. A refusal that lasts, such as a mail service still in its sandbox,
 * is retried on the relay's default policy and then dead-lettered; the person
 * asks for another link once the operator has fixed it.
 *
 * **Safe to run twice** in the sense mail can be: a second delivery sends the
 * same link again, which works the same as the first.
 */
const sendVerificationLink: OutboxHandler = async (delivery, deps) => {
  const userId = asString(delivery.payload.userId);
  const to = asString(delivery.payload.to);
  const url = asString(delivery.payload.url);
  const expiresAt = Date.parse(asString(delivery.payload.expiresAt) ?? "");
  if (!userId || !to || !url || Number.isNaN(expiresAt)) {
    throw new PermanentDispatchError(
      "A confirmation link needs an account, an address, a link and when it expires, and this row is missing one.",
    );
  }
  if (!deps.sendMail || !deps.baseUrl) {
    deps.onSkipped?.(delivery, "no mail transport is configured");
    return;
  }
  if (expiresAt <= Date.now()) {
    deps.onSkipped?.(delivery, "the link has expired");
    return;
  }

  // `users` has no tenant policy and no soft delete: an account is there or
  // it is not.
  const { rows } = await deps.pool.query<{
    email: string;
    email_verified: boolean;
  }>("select email, email_verified from users where id = $1", [userId]);
  const account = rows[0];
  if (!account) {
    deps.onSkipped?.(delivery, "the account is gone");
    return;
  }
  if (account.email_verified) {
    deps.onSkipped?.(delivery, "the address is already confirmed");
    return;
  }
  if (account.email.toLowerCase() !== to.toLowerCase()) {
    deps.onSkipped?.(delivery, "the account's address has changed");
    return;
  }

  const language = await resolveInstanceDefaultLanguage(deps.pool).catch(
    () => "en",
  );
  const built = verifyEmailMail({
    instanceName: instanceNameOr(deps.instanceName),
    locale: mailLocale(language),
    to,
    url,
    hours: EMAIL_VERIFICATION_LINK_SECONDS / 3600,
    // Plan 0.8.0 S4: confirmation off, the account works already.
    optional: delivery.payload.optional === true,
  });
  await deps.sendMail({ to, ...built });
};

/**
 * Tells an account holder that its password changed (docs/design/
 * account-self-service.md §4.2, D9, D13).
 *
 * **Sent to the address the account had when the password changed**, which
 * the row carries and which is gone from it once delivered. Skipped when the
 * account is gone, because a mail about an account nobody holds helps nobody.
 * Otherwise sent even when the address has changed since: that is exactly
 * when the old address should hear of it.
 */
const sendPasswordChanged: OutboxHandler = async (delivery, deps) => {
  const userId = asString(delivery.payload.userId);
  const to = asString(delivery.payload.to);
  const via = asString(delivery.payload.via);
  const at = new Date(asString(delivery.payload.at) ?? "");
  if (
    !userId ||
    !to ||
    !PASSWORD_CHANGE_VIAS.includes(via as PasswordChangeVia) ||
    Number.isNaN(at.getTime())
  ) {
    throw new PermanentDispatchError(
      "A password notice needs an account, an address, how the password changed and when, and this row is missing one.",
    );
  }
  if (!deps.sendMail || !deps.baseUrl) {
    deps.onSkipped?.(delivery, "no mail transport is configured");
    return;
  }
  // `users` has no tenant policy and no soft delete: an account is there or
  // it is not.
  const { rows } = await deps.pool.query<{ id: string }>(
    "select id from users where id = $1",
    [userId],
  );
  if (rows.length === 0) {
    deps.onSkipped?.(delivery, "the account is gone");
    return;
  }

  const language = await resolveInstanceDefaultLanguage(deps.pool).catch(
    () => "en",
  );
  const built = passwordChangedMail({
    instanceName: instanceNameOr(deps.instanceName),
    locale: mailLocale(language),
    to,
    via: via as PasswordChangeVia,
    otherSessionsEnded: delivery.payload.otherSessionsEnded === true,
    at,
    // In the person's own timezone, named (UAT 0.8.0 Q-7).
    timeZone: await timezoneForAccount(deps.pool, userId).catch(() => "UTC"),
    baseUrl: deps.baseUrl,
  });
  await deps.sendMail({ to, ...built });
};

/**
 * Sends the link that makes a new address the sign-in email (docs/design/
 * account-self-service.md §4.2, D18, plan 0.8.0 Y4), to that new address.
 *
 * **Skips rather than fails** a link nobody can use: no mail configured, the
 * link expired, the account gone, or its address no longer the one the link
 * was asked from. Better Auth refuses such a link when it is opened anyway;
 * this only spares a mail that could do nothing.
 */
const sendChangeEmailLink: OutboxHandler = async (delivery, deps) => {
  const userId = asString(delivery.payload.userId);
  const from = asString(delivery.payload.from);
  const to = asString(delivery.payload.to);
  const url = asString(delivery.payload.url);
  const expiresAt = Date.parse(asString(delivery.payload.expiresAt) ?? "");
  if (!userId || !from || !to || !url || Number.isNaN(expiresAt)) {
    throw new PermanentDispatchError(
      "A change-of-email link needs an account, both addresses, a link and when it expires, and this row is missing one.",
    );
  }
  if (!deps.sendMail || !deps.baseUrl) {
    deps.onSkipped?.(delivery, "no mail transport is configured");
    return;
  }
  if (expiresAt <= Date.now()) {
    deps.onSkipped?.(delivery, "the link has expired");
    return;
  }
  // `users` has no tenant policy and no soft delete: an account is there or
  // it is not.
  const { rows } = await deps.pool.query<{ email: string }>(
    "select email from users where id = $1",
    [userId],
  );
  const account = rows[0];
  if (!account) {
    deps.onSkipped?.(delivery, "the account is gone");
    return;
  }
  if (account.email.toLowerCase() !== from.toLowerCase()) {
    deps.onSkipped?.(delivery, "the account's address has changed");
    return;
  }

  const language = await resolveInstanceDefaultLanguage(deps.pool).catch(
    () => "en",
  );
  const built = changeEmailMail({
    instanceName: instanceNameOr(deps.instanceName),
    locale: mailLocale(language),
    to,
    url,
    hours: EMAIL_VERIFICATION_LINK_SECONDS / 3600,
  });
  await deps.sendMail({ to, ...built });
};

/**
 * Tells the current address that a new sign-in email was asked for
 * (account-self-service.md §4.2, D16, AS-Q4 (a)). The same mail whether or
 * not the new address has an account. Skipped only when the account is gone;
 * sent even when the address has changed since, because that is exactly
 * when the old address should hear of it.
 */
const sendEmailChangeNotice: OutboxHandler = async (delivery, deps) => {
  const userId = asString(delivery.payload.userId);
  const to = asString(delivery.payload.to);
  const newEmail = asString(delivery.payload.newEmail);
  const at = new Date(asString(delivery.payload.at) ?? "");
  if (!userId || !to || !newEmail || Number.isNaN(at.getTime())) {
    throw new PermanentDispatchError(
      "A change-of-email notice needs an account, both addresses and when it was asked for, and this row is missing one.",
    );
  }
  if (!deps.sendMail || !deps.baseUrl) {
    deps.onSkipped?.(delivery, "no mail transport is configured");
    return;
  }
  const { rows } = await deps.pool.query<{ id: string }>(
    "select id from users where id = $1",
    [userId],
  );
  if (rows.length === 0) {
    deps.onSkipped?.(delivery, "the account is gone");
    return;
  }

  const language = await resolveInstanceDefaultLanguage(deps.pool).catch(
    () => "en",
  );
  const built = emailChangeNoticeMail({
    instanceName: instanceNameOr(deps.instanceName),
    locale: mailLocale(language),
    to,
    newEmail,
    at,
    // In the person's own timezone, named (UAT 0.8.0 Q-7).
    timeZone: await timezoneForAccount(deps.pool, userId).catch(() => "UTC"),
    baseUrl: deps.baseUrl,
  });
  await deps.sendMail({ to, ...built });
};

/**
 * Tells an address that already has an account that somebody asked to make
 * it another account's sign-in email, and that nothing changed
 * (account-self-service.md AS-Q5 (b)). Names no account, so it reads nothing
 * and is never skipped while mail is configured.
 */
const sendEmailChangeTaken: OutboxHandler = async (delivery, deps) => {
  const to = asString(delivery.payload.to);
  if (!to) {
    throw new PermanentDispatchError(
      "An address-taken notice needs the address, and this row has none.",
    );
  }
  if (!deps.sendMail || !deps.baseUrl) {
    deps.onSkipped?.(delivery, "no mail transport is configured");
    return;
  }
  const language = await resolveInstanceDefaultLanguage(deps.pool).catch(
    () => "en",
  );
  const built = emailChangeTakenMail({
    instanceName: instanceNameOr(deps.instanceName),
    locale: mailLocale(language),
    baseUrl: deps.baseUrl,
  });
  await deps.sendMail({ to, ...built });
};

/**
 * The four mails of deleting your own account (account-deletion.md §7, plan
 * 0.8.0 Y7). Each carries its address, which leaves the row once delivered.
 * The account's row is still there when every one of them is sent, the last
 * included: it is anonymised, never removed.
 */
const sendDeletionMail =
  (kind: "requested" | "tomorrow" | "cancelled" | "done"): OutboxHandler =>
  async (delivery, deps) => {
    const to = asString(delivery.payload.to);
    const runsAt = new Date(asString(delivery.payload.runsAt) ?? "");
    if (
      !to ||
      ((kind === "requested" || kind === "tomorrow") &&
        Number.isNaN(runsAt.getTime()))
    ) {
      throw new PermanentDispatchError(
        "A deletion mail needs an address, and a date where it says one, and this row is missing one.",
      );
    }
    if (!deps.sendMail || !deps.baseUrl) {
      deps.onSkipped?.(delivery, "no mail transport is configured");
      return;
    }
    const language = await resolveInstanceDefaultLanguage(deps.pool).catch(
      () => "en",
    );
    const common = {
      instanceName: instanceNameOr(deps.instanceName),
      locale: mailLocale(language),
      to,
      baseUrl: deps.baseUrl,
    };
    const built =
      kind === "requested"
        ? deletionRequestedMail({ ...common, runsAt })
        : kind === "tomorrow"
          ? deletionTomorrowMail({ ...common, runsAt })
          : kind === "cancelled"
            ? deletionCancelledMail({
                ...common,
                reason: cancelReasonOf(delivery.payload),
              })
            : deletionDoneMail(common);
    await deps.sendMail({ to, ...built });
  };

function cancelReasonOf(
  payload: Readonly<Record<string, unknown>>,
): DeletionCancelReason {
  if (payload.reason === "signed_in") {
    return { kind: "signed_in" };
  }
  const workspace = asString(payload.workspace);
  if (payload.block === "last_owner" && workspace) {
    return { kind: "last_owner", workspace };
  }
  if (payload.block === "directory") {
    return { kind: "directory" };
  }
  return { kind: "other" };
}

/**
 * Sends one closed batch as a digest (P6-G01b).
 *
 * **Safe to run twice in the only sense mail can be.** The batch is claimed
 * once by `claimDueBatches`, so this row exists once, but a relay that dies
 * between the send and the commit will deliver a second copy of the same
 * digest. That is the same exposure `invitation.email` has, for the same
 * reason: mail has no idempotency of its own and inventing one here would mean
 * a sent-mail table nothing else needs.
 *
 * **The items are built here, not at claim time.** Two reasons. The access
 * filter has to run against the state at delivery, so a member who lost access
 * to a goal in the minutes between the window closing and the mail going out
 * does not read its title in their inbox. And a digest built at claim time
 * would have to be stored somewhere, which is a payload of unbounded size on a
 * queue row.
 *
 * A batch whose items all fail the access filter sends nothing and says so.
 * That is a normal outcome rather than a failure: the rows are still in the
 * member's in-app inbox, filtered there by the same rule.
 */
const sendDigest: OutboxHandler = async (delivery, deps) => {
  const workspaceId = asString(delivery.payload.workspaceId);
  const batchId = asString(delivery.payload.batchId);
  const memberId = asString(delivery.payload.memberId);
  if (!workspaceId || !batchId || !memberId) {
    // The workspace is on the payload rather than the delivery, the way
    // `channel.message` carries it: `OutboxDelivery` describes the queue row
    // and not the tenant, and every handler that touches business data has to
    // open the transaction under a workspace of its own.
    throw new PermanentDispatchError(
      "A digest needs a workspace, a batch and a member, and this row is missing one.",
    );
  }
  if (!deps.sendMail || !deps.baseUrl) {
    // Not a failure. An instance with no mail configured has an in-app inbox,
    // and the rows are in it.
    deps.onSkipped?.(delivery, "no mail transport is configured");
    return;
  }

  const to = await memberEmail(deps.pool, workspaceId, memberId);
  if (!to) {
    // An agent member, or somebody removed between the claim and now. Both are
    // ordinary and neither is worth a retry.
    deps.onSkipped?.(delivery, "the member has no address");
    return;
  }

  const db = drizzle(deps.pool);
  const contents = await withWorkspace(db, workspaceId, (tx) =>
    digestItemsFor(tx, {
      workspaceId: workspaceId,
      memberId,
      batchId,
      baseUrl: withoutTrailingSlashes(deps.baseUrl as string),
    }),
  );

  if (contents.items.length === 0) {
    deps.onSkipped?.(delivery, "nothing in this batch is still visible");
    return;
  }

  // Never silently truncated. A digest is capped at twenty lines because a
  // hundred-line mail is not read, and saying how many were left is what keeps
  // the cap from hiding them. Both parts say it now: the line used to be in
  // the text part only.
  const built = notificationDigestMail({
    mail: await workspaceMail(deps.pool, workspaceId),
    baseUrl: deps.baseUrl,
    items: contents.items,
    omitted: contents.omitted,
  });
  await deps.sendMail({ to, ...built });
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
    target?: unknown;
    email?: unknown;
  };
  const text = asString(payload.text);
  // The email layout, framed in the workspace as it is at sending time.
  const html =
    row.provider === "email" &&
    payload.email &&
    typeof payload.email === "object" &&
    deps.baseUrl
      ? renderStoredEmail({
          mail: await workspaceMail(deps.pool, workspaceId),
          baseUrl: deps.baseUrl,
          stored: payload.email as StoredEmail,
        }).html
      : null;
  const templateKey = asString(payload.templateKey);
  // A post to a space's own channel names where it goes and nobody it is for
  // (M-23). Only ever read on a row with no member: a member's message goes to
  // their own identity, whatever its payload says.
  const target = row.memberId === null ? asString(payload.target) : null;
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
      ...(html ? { html } : {}),
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
      ...(target ? { target } : {}),
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

  // **The provider and the status, and nothing else** (P7-T06b). Not the
  // member, not the idempotency key, and above all not `failure`: that
  // string is a provider's own error text and can carry an address, a
  // phone number or a fragment of the message. It belongs on the row,
  // which is access-scoped, and never in a label, which is served to
  // whoever can read the exposition and kept for the life of the process.
  defaultMetrics().count(METRIC.channelDeliveriesTotal, {
    provider: row.provider,
    outcome: status,
  });

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
    //
    // **Not for a post to a space's channel** (M-23). The bot not being in
    // one team's channel is that space's link being wrong, not the
    // connection: marking it broken would move every member of the workspace
    // off Slack because one space pasted the wrong id. The row says why.
    if (row.provider !== "email" && !target) {
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

/**
 * Produces one copilot answer, outside the request that asked for it
 * (P4-T14b-b).
 *
 * **Safe to run twice** by the message it answers: `copilot.completeRun`
 * refuses one that has already completed, so a redelivered row costs one
 * retrieval and one refused write rather than a second answer charged to the
 * workspace.
 *
 * The run acts as the member who asked, so the audit row names a person rather
 * than a queue. Nothing about the answer is decided here: which workspace,
 * which thread and who asked are all on the row, put there by the transaction
 * that recorded the question.
 */
const runCopilot: OutboxHandler = async (delivery, deps) => {
  const job = parseCopilotRunJob(delivery.payload);
  if (!job) {
    throw new PermanentDispatchError(
      `${delivery.topic} does not carry a copilot run, so nothing can answer it.`,
    );
  }
  // The asker's own key where they stored one, as the same question answered
  // in the request would have used (M-36).
  const drafter = await deps.drafterFor?.(job.workspaceId, job.userId);
  const outcome = await runCopilotAnswer(
    {
      pool: deps.pool,
      workspaceId: job.workspaceId,
      actor: { kind: "human", userId: job.userId },
      ...(drafter ? { drafter } : {}),
    },
    job,
    ...(deps.publish ? [{ publish: deps.publish }] : []),
  );
  if (outcome.haltedReason) {
    deps.onSkipped?.(delivery, outcome.haltedReason);
  }
};

/**
 * Scans one held file and records the verdict (completeness review M-24).
 *
 * **Safe to run twice**: `runScanJob` leaves a file alone once it is no longer
 * `scanning`, so a redelivery costs one read.
 *
 * **Nothing here decides a file is clean.** A scanner that cannot be reached
 * throws, and so does a relay with no scanner or no storage to read from: the
 * relay backs off and tries again, and at its ceiling the row is a dead letter
 * in the log. The file stays held throughout. Releasing it unscanned because
 * this one process was missing a setting would make the scan a formality
 * whenever a replica was configured differently from the rest.
 */
const scanBlob: OutboxHandler = async (delivery, deps) => {
  const job = parseScanJob(delivery.payload);
  if (!job) {
    throw new PermanentDispatchError(
      `${delivery.topic} has no workspace and file on its payload, so nothing can be scanned.`,
    );
  }
  if (!deps.getFile) {
    throw new Error(
      "A file is waiting for a virus scan and this relay has no file storage to read it from.",
    );
  }
  const scanFile = await deps.scanner?.();
  if (!scanFile) {
    throw new Error(
      "A file is waiting for a virus scan and no scanner is configured where this relay runs. It stays held until scan.clamd.host names one.",
    );
  }
  const outcome = await runScanJob(job, {
    pool: deps.pool,
    getFile: deps.getFile,
    scanFile,
  });
  if (outcome.kind === "skipped") {
    deps.onSkipped?.(delivery, outcome.reason);
  }
};

/**
 * Takes the next step of an agent run (completeness review M-11).
 *
 * **The run advances one task per delivery.** Each step that leaves tasks
 * behind enqueues the next one in its own transaction, so a run survives a
 * restart between any two steps: what is left to do is on the run row, not in
 * this process.
 *
 * **Safe to run twice** by the task index on the row: a step delivered again
 * after the run moved past it finds a different index and is skipped, and so
 * is one for a run somebody cancelled in the meantime.
 */
const continueAgentRun: OutboxHandler = async (delivery, deps) => {
  const job = parseAgentRunStepJob(delivery.payload);
  if (!job) {
    throw new PermanentDispatchError(
      `${delivery.topic} does not carry a run and a task index, so no step can be taken.`,
    );
  }
  if (!deps.continueAgentRun) {
    deps.onSkipped?.(delivery, "this process runs no agents");
    return;
  }
  const outcome = await deps.continueAgentRun(job);
  if (outcome.kind === "skipped") {
    deps.onSkipped?.(delivery, outcome.reason);
  }
};

/**
 * The Coach answers a mention on a goal (plan 0.7.0 A8).
 *
 * **Safe to run twice**: the action refuses a second answer to one comment, and
 * that refusal, like every other one, is a skip with its reason rather than a
 * retry. Nothing about it needs a provider.
 */
const answerCoachMention: OutboxHandler = async (delivery, deps) => {
  const job = parseCoachMentionJob(delivery.payload);
  if (!job) {
    throw new PermanentDispatchError(
      `${delivery.topic} does not carry a workspace, a comment and a goal, so the Coach has nothing to answer.`,
    );
  }
  const outcome = await runCoachMention(
    {
      pool: deps.pool,
      ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}),
      ...(deps.instanceName ? { instanceName: deps.instanceName } : {}),
    },
    job,
  );
  if (outcome.kind === "skipped") {
    deps.onSkipped?.(delivery, outcome.reason);
  }
};

/**
 * Stops the subscription of a workspace that closed (workspace-erasure.md §3).
 *
 * **Safe to run twice**: the provider is asked to end at the period's end, and
 * asking again changes nothing. A provider that fails throws, and the relay asks
 * again, which is what "retries until it answers" means.
 */
const endSubscription: OutboxHandler = async (delivery, deps) => {
  const workspaceId = asString(delivery.payload.workspaceId);
  if (!workspaceId) {
    throw new PermanentDispatchError(
      "Stopping a subscription needs a workspace, and this row names none.",
    );
  }
  const outcome = await endSubscriptionOnClosing(
    deps.pool,
    workspaceId,
    (await deps.billingFor?.()) ?? null,
  );
  if (outcome !== "ended") {
    deps.onSkipped?.(delivery, outcome);
  }
};

/**
 * Tells a closed workspace's owners and administrators the date it will be
 * deleted (workspace-erasure.md §3).
 *
 * **Safe to run twice in the only sense mail can be**, like the digest: a relay
 * that dies after sending sends again. A workspace reopened before this ran is
 * not told it closed.
 */
const sendClosureNotice: OutboxHandler = async (delivery, deps) => {
  const workspaceId = asString(delivery.payload.workspaceId);
  const closedAt = asString(delivery.payload.closedAt);
  if (!workspaceId || !closedAt) {
    throw new PermanentDispatchError(
      "A closure notice needs a workspace and the instant it closed.",
    );
  }
  if (!deps.sendMail || !deps.baseUrl) {
    deps.onSkipped?.(delivery, "no mail transport is configured");
    return;
  }
  const notice = await readClosureNotice(deps.pool, {
    workspaceId,
    byMemberId: asString(delivery.payload.byMemberId),
  });
  if (notice.schedule?.closedAt.toISOString() !== closedAt) {
    deps.onSkipped?.(delivery, "the workspace was reopened since");
    return;
  }
  const mail = await workspaceMail(deps.pool, workspaceId);
  for (const recipient of notice.recipients) {
    await deps.sendMail({
      to: recipient.email,
      ...closureMail({
        mail,
        baseUrl: deps.baseUrl,
        closedByName: notice.closedByName,
        closedAt: notice.schedule.closedAt,
        eraseOn: notice.schedule.eraseOn,
        ownerMayReopen: notice.schedule.ownerMayReopen,
      }),
    });
  }
};

/**
 * Erasure's half that needs the server's drivers: the files, and the customer at
 * the payment provider (docs/design/workspace-erasure.md §4). The erasure command
 * waits for both to be delivered before it deletes any rows.
 *
 * **Never skipped, only failed.** A skip marks the row delivered, and erasure
 * would then report files gone that are still there. With nothing to do it with,
 * the row dead-letters, the command says why, and asks again on its next run.
 */
const eraseFiles: OutboxHandler = async (delivery, deps) => {
  const workspaceId = asString(delivery.payload.workspaceId);
  if (!workspaceId) {
    throw new PermanentDispatchError("Erasing files needs a workspace.");
  }
  if (!deps.deleteFiles) {
    throw new PermanentDispatchError(
      "This server has no storage to delete the workspace's files from.",
    );
  }
  await deps.deleteFiles(`${workspaceId}/`);
};

const deleteCustomer: OutboxHandler = async (delivery, deps) => {
  const provider = asString(delivery.payload.provider);
  const customerRef = asString(delivery.payload.customerRef);
  if (!provider || !customerRef) {
    throw new PermanentDispatchError(
      "Deleting a customer needs the provider and the customer.",
    );
  }
  const billing = (await deps.billingFor?.()) ?? null;
  if (!billing || billing.provider !== provider) {
    throw new PermanentDispatchError(
      `No ${provider} billing is configured on this server to delete the customer.`,
    );
  }
  await billing.deleteCustomer(customerRef);
};

/**
 * Reminds a closed workspace's owners and administrators, seven days before it is
 * erased (workspace-erasure.md §12, decision 3). Not sent once the workspace has
 * been reopened, closed again, or claimed by erasure.
 */
const sendErasureReminder: OutboxHandler = async (delivery, deps) => {
  const workspaceId = asString(delivery.payload.workspaceId);
  const closedAt = asString(delivery.payload.closedAt);
  if (!workspaceId || !closedAt) {
    throw new PermanentDispatchError(
      "An erasure reminder needs a workspace and the instant it closed.",
    );
  }
  if (!deps.sendMail || !deps.baseUrl) {
    deps.onSkipped?.(delivery, "no mail transport is configured");
    return;
  }
  const notice = await readClosureNotice(deps.pool, {
    workspaceId,
    byMemberId: null,
  });
  const schedule = notice.schedule;
  if (!schedule?.eraseOn || schedule.closedAt.toISOString() !== closedAt) {
    deps.onSkipped?.(delivery, "the workspace is no longer due for erasure");
    return;
  }
  const mail = await workspaceMail(deps.pool, workspaceId);
  for (const recipient of notice.recipients) {
    await deps.sendMail({
      to: recipient.email,
      ...erasureReminderMail({
        mail,
        baseUrl: deps.baseUrl,
        closedAt: schedule.closedAt,
        eraseOn: schedule.eraseOn,
        ownerMayReopen: schedule.ownerMayReopen,
      }),
    });
  }
};

/**
 * Seven days before a trial ends, to the owners and administrators
 * (tenant-lifecycle.md §11 Q2, plan 0.7.0 P4c). Not sent once the date has
 * moved or the trial is over: the mail would be about a day that no longer
 * comes.
 */
const sendTrialReminder: OutboxHandler = async (delivery, deps) => {
  const workspaceId = asString(delivery.payload.workspaceId);
  const trialEndsAt = asString(delivery.payload.trialEndsAt);
  if (!workspaceId || !trialEndsAt) {
    throw new PermanentDispatchError(
      "A trial reminder needs a workspace and the day the trial ends.",
    );
  }
  if (!deps.sendMail || !deps.baseUrl) {
    deps.onSkipped?.(delivery, "no mail transport is configured");
    return;
  }
  const notice = await readTrialNotice(deps.pool, workspaceId);
  if (notice.trialEndsAt?.toISOString() !== trialEndsAt) {
    deps.onSkipped?.(delivery, "the trial no longer ends on that day");
    return;
  }
  const mail = await workspaceMail(deps.pool, workspaceId);
  for (const recipient of notice.recipients) {
    await deps.sendMail({
      to: recipient.email,
      ...trialReminderMail({
        mail,
        baseUrl: deps.baseUrl,
        endsAt: notice.trialEndsAt,
        planName: notice.planName ?? "",
        fallbackName: notice.defaultPlanName ?? mail.words("trial.noPlan"),
      }),
    });
  }
};

/** What the end of a trial did, to the owners and administrators (§11 Q2). */
const sendTrialEnded: OutboxHandler = async (delivery, deps) => {
  const workspaceId = asString(delivery.payload.workspaceId);
  const outcome = asString(delivery.payload.outcome);
  if (
    !workspaceId ||
    (outcome !== "subscribed" && outcome !== "moved" && outcome !== "suspended")
  ) {
    throw new PermanentDispatchError(
      "A trial's end needs a workspace and what the end did.",
    );
  }
  if (!deps.sendMail || !deps.baseUrl) {
    deps.onSkipped?.(delivery, "no mail transport is configured");
    return;
  }
  const notice = await readTrialNotice(deps.pool, workspaceId);
  const mail = await workspaceMail(deps.pool, workspaceId);
  const fallbackName =
    asString(delivery.payload.defaultPlanName) ?? mail.words("trial.noPlan");
  for (const recipient of notice.recipients) {
    await deps.sendMail({
      to: recipient.email,
      ...trialEndedMail({
        mail,
        baseUrl: deps.baseUrl,
        outcome,
        fallbackName,
      }),
    });
  }
};

/**
 * Signs and posts one webhook event (docs/design/outbound-webhooks.md W8).
 *
 * **Safe to run twice** in the sense a receiver needs: a relay that dies
 * after the post sends the same event again, with the same `webhook-id`, so a
 * receiver that keeps the ids it has seen drops the copy. Every attempt is a
 * row in the hook's log.
 *
 * A failure is thrown, so the relay backs off and tries again for about a day
 * (`OUTBOX_RETRY_POLICY`). The last attempt is not thrown: a receiver that was
 * down all day is the receiver's problem rather than a dead letter on this
 * instance, and its log says it gave up. A refusal and a withheld subject are
 * never retried, because waiting changes neither.
 */
const deliverWebhookEvent: OutboxHandler = async (delivery, deps) => {
  const job = parseWebhookJob(delivery.payload);
  if (!job) {
    throw new PermanentDispatchError(
      `${delivery.topic} does not name a workspace, a webhook and an event, so nothing can be sent.`,
    );
  }
  const outcome = await deliverWebhook(job, {
    pool: deps.pool,
    ...(deps.ring ? { ring: deps.ring } : {}),
    ...(deps.postWebhook ? { post: deps.postWebhook } : {}),
    attempt: Math.max(1, delivery.attempts),
    lastAttempt: WEBHOOK_MAX_ATTEMPTS,
  });
  if (outcome.kind === "failed" && outcome.retry) {
    throw new Error(outcome.reason);
  }
  if (outcome.kind === "skipped" || outcome.kind === "refused") {
    deps.onSkipped?.(delivery, outcome.reason);
  }
  if (outcome.kind === "withheld") {
    deps.onSkipped?.(delivery, "the webhook's owner cannot see the subject");
  }
  if (outcome.kind === "failed") {
    deps.onSkipped?.(delivery, `gave up: ${outcome.reason}`);
  }
};

/**
 * Tells a webhook's creator it turned itself off after a run of failures
 * (W9). Not sent once somebody has turned it back on or removed it. Safe to
 * run twice in the only sense mail can be, like the digest.
 */
const sendWebhookTurnedOff: OutboxHandler = async (delivery, deps) => {
  const workspaceId = asString(delivery.payload.workspaceId);
  const webhookId = asString(delivery.payload.webhookId);
  const failures =
    typeof delivery.payload.failures === "number"
      ? delivery.payload.failures
      : FAILURES_BEFORE_OFF;
  if (!workspaceId || !webhookId) {
    throw new PermanentDispatchError(
      "A webhook's turned-off mail needs a workspace and a webhook.",
    );
  }
  if (!deps.sendMail || !deps.baseUrl) {
    deps.onSkipped?.(delivery, "no mail transport is configured");
    return;
  }
  const hook = await readTurnedOff(deps.pool, workspaceId, webhookId);
  if (!hook) {
    deps.onSkipped?.(delivery, "the webhook is on again, or gone");
    return;
  }
  const to = await memberEmail(deps.pool, workspaceId, hook.creatorMemberId);
  if (!to) {
    deps.onSkipped?.(delivery, "the webhook's creator has no address");
    return;
  }
  let host = "";
  try {
    host = new URL(hook.url).host;
  } catch {
    host = "";
  }
  await deps.sendMail({
    to,
    ...webhookTurnedOffMail({
      mail: await workspaceMail(deps.pool, workspaceId),
      baseUrl: deps.baseUrl,
      name: hook.name,
      host,
      failures,
    }),
  });
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
  // The link that confirms an address, queued by `createAuth` rather than
  // sent inside the sign-up request (email-verification.md D1, S3).
  [VERIFY_EMAIL_TOPIC]: sendVerificationLink,
  // A password was changed, set or reset (account-self-service.md D9).
  [PASSWORD_CHANGED_TOPIC]: sendPasswordChanged,
  // A change of sign-in email (account-self-service.md §4.2, plan 0.8.0
  // Y4): the link to the new address, the notice to the current one, and
  // the mail to an address that already has an account.
  [CHANGE_EMAIL_TOPIC]: sendChangeEmailLink,
  [EMAIL_CHANGE_NOTICE_TOPIC]: sendEmailChangeNotice,
  [EMAIL_CHANGE_TAKEN_TOPIC]: sendEmailChangeTaken,
  // Deleting your own account (account-deletion.md §7, plan 0.8.0 Y7).
  [ACCOUNT_DELETION_REQUESTED_TOPIC]: sendDeletionMail("requested"),
  [ACCOUNT_DELETION_TOMORROW_TOPIC]: sendDeletionMail("tomorrow"),
  [ACCOUNT_DELETION_CANCELLED_TOPIC]: sendDeletionMail("cancelled"),
  [ACCOUNT_DELETION_DONE_TOPIC]: sendDeletionMail("done"),
  // The batch drain's delivery (P6-G01b). `renderDigest` had no caller
  // outside the package barrel from P2-T06 until this row existed.
  [DIGEST_TOPIC]: sendDigest,
  "session.stageChanged": publishEvent,
  "session.micPassed": publishEvent,
  "session.scoresRevealed": publishEvent,
  // The board tells every watcher to re-read (P5-T11). Identifiers only, like
  // every event on a realtime channel.
  "board.changed": publishEvent,
  // One member's inbox is told a row landed, so an open screen re-reads
  // instead of waiting for a navigation (P6-G07c). Identifiers only.
  "inbox.added": publishEvent,
  // Every open feed in the workspace is told it moved (P6-G11c). No subject
  // and no kind: each scope route decides whether to forward, and the server
  // render that follows applies the filter and can().
  "feed.added": publishEvent,
  // Every open agents screen is told one run moved (release 0.7.0 A11). The
  // run's id and version, never a log line: the screen re-reads.
  [AGENT_RUN_CHANGED_TOPIC]: publishEvent,
  "content.index": indexContent,
  // The large-export path (P5-T15). The row names a run; the worker rebuilds
  // the list as the member who asked, writes the file to storage and marks the
  // run ready. It acknowledged and did nothing between P5-T13 and P5-T15.
  [EXPORT_TOPIC]: buildExport,
  // The copilot's answer, produced outside the request that asked for it
  // (P4-T14b-b). Before this, an answer existed only inside one HTTP response
  // and closing the tab took the run with it.
  "copilot.run": runCopilot,
  // One step of an agent run (completeness review M-11). The executor has
  // written this topic since P2-T17 and nothing read it, so a run started
  // through `agents.startRun` sat at its first task forever.
  [AGENT_RUN_STEP_TOPIC]: continueAgentRun,
  // The Coach's reply to a mention on a goal (plan 0.7.0 A8).
  [COACH_MENTION_TOPIC]: answerCoachMention,
  // The virus scan (completeness review M-24). Written by a claim only when a
  // scanner is configured, so an instance without one never sees this topic.
  [BLOB_SCAN_TOPIC]: scanBlob,
  "workspace.renamed": acknowledge,
  // A workspace closed (docs/design/workspace-erasure.md §3): stop the bill, and
  // tell its owners and administrators when it will be deleted.
  [END_SUBSCRIPTION_TOPIC]: endSubscription,
  [WORKSPACE_CLOSED_TOPIC]: sendClosureNotice,
  [ERASURE_REMINDER_TOPIC]: sendErasureReminder,
  [TRIAL_REMINDER_TOPIC]: sendTrialReminder,
  [TRIAL_ENDED_TOPIC]: sendTrialEnded,
  // Erasure's half that only the server can do (workspace-erasure.md §4).
  [ERASE_FILES_TOPIC]: eraseFiles,
  [ERASE_CUSTOMER_TOPIC]: deleteCustomer,
  // Outbound webhooks (docs/design/outbound-webhooks.md W8, W9).
  [WEBHOOK_DELIVER_TOPIC]: deliverWebhookEvent,
  [WEBHOOK_TURNED_OFF_TOPIC]: sendWebhookTurnedOff,
};

/**
 * Topics that retry on a schedule of their own rather than the relay's.
 *
 * The relay's default gives up after ten attempts in about a quarter of an
 * hour, which is right for an email and wrong for a webhook receiver that is
 * down for a deploy: W9 retries for about a day. The relay host passes this
 * table to the relay, as it passes `OUTBOX_REDACT_ON_DELIVERY`.
 */
export const OUTBOX_RETRY_POLICY: Readonly<
  Record<
    string,
    {
      readonly maxAttempts: number;
      readonly backoffSeconds: (attempts: number) => number;
    }
  >
> = {
  [WEBHOOK_DELIVER_TOPIC]: {
    maxAttempts: WEBHOOK_MAX_ATTEMPTS,
    backoffSeconds: webhookRetrySeconds,
  },
};

/**
 * What each topic's payload must lose once it is delivered (completeness
 * review M-19). The relay strips these fields in the statement that marks the
 * row delivered.
 *
 * An invitation's email carries the raw token and the address, because the row
 * is the only place either exists once the write commits: the invitation
 * table holds the token's digest. After the email has gone, both are a secret
 * and a personal address kept for nothing. Every other topic carries
 * identifiers only.
 */
export const OUTBOX_REDACT_ON_DELIVERY: Readonly<
  Record<string, readonly string[]>
> = {
  "invitation.email": ["to", "token"],
  // The address and the link, which confirms an account to whoever opens it
  // (email-verification.md D4). A dead-lettered row keeps both until the
  // daily purge, by which time the link has expired.
  [VERIFY_EMAIL_TOPIC]: ["to", "url"],
  // The address a password notice went to (account-self-service.md §4.2).
  [PASSWORD_CHANGED_TOPIC]: ["to"],
  // Both addresses and the link of a change of sign-in email, and the
  // addresses its two notices went to (§4.2). `from` goes too, which the
  // design's table did not list: an address is no use once delivered.
  [CHANGE_EMAIL_TOPIC]: ["to", "url", "from"],
  [EMAIL_CHANGE_NOTICE_TOPIC]: ["to", "newEmail"],
  [EMAIL_CHANGE_TAKEN_TOPIC]: ["to"],
  // The address each deletion mail went to (account-deletion.md §3.3): the
  // last one's is the only copy of it left once the account is anonymised.
  [ACCOUNT_DELETION_REQUESTED_TOPIC]: ["to"],
  [ACCOUNT_DELETION_TOMORROW_TOPIC]: ["to"],
  [ACCOUNT_DELETION_CANCELLED_TOPIC]: ["to"],
  [ACCOUNT_DELETION_DONE_TOPIC]: ["to"],
  // Of a customer the provider no longer has. Nothing needs it once it is gone.
  [ERASE_CUSTOMER_TOPIC]: ["customerRef"],
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
