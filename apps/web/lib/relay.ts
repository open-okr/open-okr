/**
 * The outbox relay host (P5-T01a).
 *
 * **This is the process PLAN.md §12's R10 said did not exist.** Every write in
 * the product enqueues its outbox rows correctly, `OutboxRelay` has been in
 * `packages/adapters` since P1-T07, and nothing ever constructed one. So no
 * invitation email was ever sent, no live session event ever reached a second
 * browser except by a refresh, and nothing was ever indexed for retrieval. This
 * module is the missing constructor, and `instrumentation.node.ts` starts it.
 *
 * **Inside the web process, not a separate container.** R10 called a timer in
 * the application process the lesser option because several replicas would each
 * drain the queue on their own schedule. That turns out not to be a
 * correctness problem: the relay claims rows with `FOR UPDATE SKIP LOCKED`
 * under a lease, which is exactly the mechanism that makes concurrent relays
 * safe, and P1-T04's own test proves several drain the same queue without
 * double delivery. What is left is a little wasted polling.
 *
 * Against that: a separate container needs the whole adapter layer resolvable
 * outside the Next.js bundle. Next traces only `pg` into the standalone output
 * and compiles the rest into its server chunks, so a second entry point would
 * mean either shipping the AI, mail and socket dependencies again (the same
 * 400MB the Dockerfile already refused once for the migration runner) or adding
 * a bundler. Running in the process that already has every driver loaded costs
 * nothing and works in every deployment shape, including one container started
 * by hand.
 *
 * An operator who does want a dedicated drainer sets `OPENOKR_RELAY=off` on the
 * serving replicas and leaves one instance with it on.
 */
import {
  createAIProvider,
  EmailChannel,
  OutboxRelay,
  SlackChannel,
  TeamsChannel,
  TelegramChannel,
  WhatsAppChannel,
} from "@openokr/adapters";
import { type Env, loadEnv } from "@openokr/config";
import {
  dispatchOutbox,
  findSeededModel,
  memberEmail,
  memberExternalId,
  type OutboxDelivery,
  type OutboxHandlerDeps,
  openConnection,
  parseSlackSecret,
  parseTeamsSecret,
  parseTelegramSecret,
  parseWhatsAppSecret,
  resolveAICredential,
  resolveTierRoute,
} from "@openokr/core";
import { getMailSettings, mailerFrom } from "./mail";
import { getPool } from "./pool";
import { getRealtime } from "./realtime";
import { getKeyRing } from "./secrets";

/** How long one delivery may take before another relay may claim the row. */
const LEASE_SECONDS = 120;

const log = (message: string): void => {
  process.stdout.write(`relay: ${message}\n`);
};

const logError = (message: string): void => {
  process.stderr.write(`relay: ${message}\n`);
};

const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The embedding function for one workspace, or null.
 *
 * **Resolved per delivery rather than once at start.** A provider key is a
 * setting somebody can add at three in the afternoon, and a relay that resolved
 * its provider at boot would ignore it until the next restart.
 *
 * Null is an ordinary answer, not a failure: the chunk is stored with no
 * vector, full-text retrieval keeps working, and the vector fills in when a
 * provider arrives and the content next changes.
 */
async function embedFor(workspaceId: string) {
  const pool = getPool();
  const resolved = await resolveAICredential(pool, getKeyRing(), process.env, {
    workspaceId,
    provider: "openrouter",
  });
  if (resolved.source === "off") {
    return undefined;
  }
  const route = await resolveTierRoute(pool, { workspaceId, tier: "embed" });
  if (!route || !findSeededModel(route.provider, route.modelId)) {
    // An unpriced model cannot be metered, and an unmetered embedding loop is
    // the one place a runaway cost would not show until the bill.
    return undefined;
  }

  const provider = createAIProvider({
    provider: "openrouter",
    apiKey: resolved.apiKey,
    appName: "OpenOKR",
    appUrl: loadEnv().BETTER_AUTH_URL,
  });
  return async (inputs: readonly string[]) => {
    const result = await provider.embed({
      model: route.modelId,
      input: [...inputs],
    });
    return {
      vectors: result.vectors,
      dimensions: result.dimensions,
      model: route.modelId,
    };
  };
}

/**
 * What one delivery is handed.
 *
 * Built per delivery, for the same reason `getMailSettings` is read per use:
 * mail settings, provider keys and tier routing all live in the database, and
 * an administrator can change any of them while this process runs.
 */
async function relayDeps(delivery: OutboxDelivery): Promise<OutboxHandlerDeps> {
  const workspaceId =
    typeof delivery.payload.workspaceId === "string"
      ? delivery.payload.workspaceId
      : null;
  // Never fatal to a delivery: an instance with no mail configured should skip
  // its invitation rows, not fail them.
  const mail = await getMailSettings().catch(() => null);

  return {
    pool: getPool(),
    ...(workspaceId ? { embed: await embedFor(workspaceId) } : {}),
    async publish(channel, event, data) {
      await getRealtime().publish(channel, { name: event, data });
    },
    ...(mail
      ? {
          async sendMail(message) {
            await mailerFrom(mail).send(message);
          },
          /**
           * The driver for whatever provider the routing chose.
           *
           * **Nothing here decides anything.** `resolveDelivery` picked the
           * provider and wrote it on the message row; this only builds the
           * driver that speaks it. A provider with no driver yet suppresses
           * with a reason, which is what a workspace that connected Teams
           * before P5-T03 exists should get.
           */
          async sendChannel(message) {
            if (!workspaceId || !message.memberId) {
              return {
                delivered: false,
                suppressedReason: "the message names no member to reach",
              };
            }
            const outbound = {
              text: message.text,
              ...(message.subject ? { subject: message.subject } : {}),
              ...(message.buttons ? { buttons: message.buttons } : {}),
              // WhatsApp outside its conversation window (P5-T04b-b). Every
              // other driver ignores both, which is why they are carried here
              // rather than in a WhatsApp-shaped branch.
              ...(message.templateKey
                ? { templateKey: message.templateKey }
                : {}),
              ...(message.templateParameters
                ? { templateParameters: message.templateParameters }
                : {}),
              idempotencyKey: message.idempotencyKey,
            };

            if (message.provider === "email") {
              const channel = new EmailChannel({
                mailer: mailerFrom(mail),
                addressFor: (recipient) =>
                  memberEmail(getPool(), workspaceId, recipient.memberId),
              });
              return channel.send({ memberId: message.memberId }, outbound);
            }

            if (message.provider === "slack") {
              // Decrypted per delivery, not held: a process keeping every
              // workspace's bot token resident is a process whose heap dump is
              // a breach (P5-T02a).
              const connection = await openConnection(getPool(), getKeyRing(), {
                workspaceId,
                provider: "slack",
              });
              const secret = connection
                ? parseSlackSecret(connection.secret)
                : null;
              if (!secret) {
                return {
                  delivered: false,
                  suppressedReason:
                    "Slack is not connected, or its stored credentials are not readable",
                };
              }
              const channel = new SlackChannel({
                botToken: secret.botToken,
                signingSecret: secret.signingSecret,
                slackUserFor: (recipient) =>
                  memberExternalId(getPool(), {
                    workspaceId,
                    provider: "slack",
                    memberId: recipient.memberId,
                  }),
              });
              return channel.send({ memberId: message.memberId }, outbound);
            }

            if (message.provider === "teams") {
              const connection = await openConnection(getPool(), getKeyRing(), {
                workspaceId,
                provider: "teams",
              });
              const secret = connection
                ? parseTeamsSecret(connection.secret)
                : null;
              if (!secret) {
                return {
                  delivered: false,
                  suppressedReason:
                    "Teams is not connected, or its stored credentials are not readable",
                };
              }
              // The service URL was learned from an inbound activity and kept
              // on the connection. Without one the driver suppresses with that
              // reason rather than failing, because there is nowhere to send.
              const serviceUrl = connection?.config.serviceUrl;
              const channel = new TeamsChannel({
                appId: secret.appId,
                appPassword: secret.appPassword,
                ...(typeof serviceUrl === "string" ? { serviceUrl } : {}),
                conversationFor: (recipient) =>
                  memberExternalId(getPool(), {
                    workspaceId,
                    provider: "teams",
                    memberId: recipient.memberId,
                  }),
              });
              return channel.send({ memberId: message.memberId }, outbound);
            }

            if (message.provider === "whatsapp") {
              const connection = await openConnection(getPool(), getKeyRing(), {
                workspaceId,
                provider: "whatsapp",
              });
              const secret = connection
                ? parseWhatsAppSecret(connection.secret)
                : null;
              const phoneNumberId = connection?.config.teamId;
              if (!secret || typeof phoneNumberId !== "string") {
                return {
                  delivered: false,
                  suppressedReason:
                    "WhatsApp is not connected, or its stored credentials are not readable",
                };
              }
              const channel = new WhatsAppChannel({
                phoneNumberId,
                accessToken: secret.accessToken,
                appSecret: secret.appSecret,
                numberFor: (recipient) =>
                  memberExternalId(getPool(), {
                    workspaceId,
                    provider: "whatsapp",
                    memberId: recipient.memberId,
                  }),
              });
              return channel.send({ memberId: message.memberId }, outbound);
            }

            if (message.provider === "telegram") {
              const connection = await openConnection(getPool(), getKeyRing(), {
                workspaceId,
                provider: "telegram",
              });
              const secret = connection
                ? parseTelegramSecret(connection.secret)
                : null;
              if (!secret) {
                return {
                  delivered: false,
                  suppressedReason:
                    "Telegram is not connected, or its stored credentials are not readable",
                };
              }
              const channel = new TelegramChannel({
                botToken: secret.botToken,
                webhookSecret: secret.webhookSecret,
                chatIdFor: (recipient) =>
                  memberExternalId(getPool(), {
                    workspaceId,
                    provider: "telegram",
                    memberId: recipient.memberId,
                  }),
              });
              return channel.send({ memberId: message.memberId }, outbound);
            }

            return {
              delivered: false,
              suppressedReason: `no driver for ${message.provider} yet`,
            };
          },
        }
      : {}),
    baseUrl: loadEnv().BETTER_AUTH_URL,
    onSkipped(skipped, why) {
      // Logged rather than silent. One skip is ordinary; a run of them is not.
      // "no mail transport is configured" a hundred times is how an operator
      // finds out their invitations are going nowhere.
      log(`skipped ${skipped.topic} (${skipped.idempotencyKey}): ${why}`);
    },
  };
}

/**
 * Whether this process drains the queue.
 *
 * Read through the validated environment rather than `process.env` directly, so
 * `OPENOKR_RELAY=fasle` is a boot error naming the variable rather than a
 * deployment that quietly stops delivering.
 */
export function relayEnabled(
  env: Pick<Env, "OPENOKR_RELAY"> = loadEnv(),
): boolean {
  return env.OPENOKR_RELAY !== "off";
}

const globals = globalThis as typeof globalThis & {
  openokrRelay?: OutboxRelay;
};

/**
 * Starts the relay once per process.
 *
 * Idempotent, and cached on `globalThis` for the same reason the pool is:
 * Next.js reloads modules in development, and a second relay per reload would
 * leave the first one polling forever.
 */
export function startRelay(): OutboxRelay | null {
  if (!relayEnabled()) {
    log("disabled by OPENOKR_RELAY=off");
    return null;
  }
  if (globals.openokrRelay) {
    return globals.openokrRelay;
  }

  const relay = new OutboxRelay(getPool(), {
    leaseSeconds: LEASE_SECONDS,
    async dispatch(record) {
      await dispatchOutbox(record, await relayDeps(record));
    },
    onError(error) {
      logError(`drain failed: ${reason(error)}`);
    },
    onDeadLetter(record, error) {
      // The loudest line this process writes. A dead letter is work the product
      // decided to do and then gave up on, and nothing else will mention it.
      logError(
        `dead letter ${record.topic} (${record.idempotencyKey}) after ` +
          `${record.attempts} attempts: ${reason(error)}`,
      );
    },
  });

  globals.openokrRelay = relay;
  relay.start();
  log("started");

  // Finishes the drain in flight rather than cutting it off, so a deploy does
  // not turn an in-flight delivery into a retry.
  const stop = () => {
    void relay.stop();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  return relay;
}
