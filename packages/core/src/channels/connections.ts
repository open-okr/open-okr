/**
 * Opening a connection's stored credentials, server-side only (P5-T02a).
 *
 * The connection row holds an envelope-encrypted string and nothing reads it
 * back except the relay, at the moment it is about to build a driver. No read
 * action returns it, no log line carries it, and it is decrypted per delivery
 * rather than held in memory: a process that keeps every workspace's bot token
 * resident is a process whose heap dump is a breach.
 *
 * **The credential is one string on purpose.** Slack needs a bot token *and* a
 * signing secret, Teams needs three values, WhatsApp needs a phone number id.
 * Rather than a column per provider, the string is that provider's own JSON and
 * this module parses it. The table stays the same shape for every provider and
 * the driver decides what its own secret looks like.
 */
import {
  activeOnly,
  channelConnections,
  channelIdentities,
  withWorkspace,
} from "@openokr/db";
import { eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { decryptSecret, type KeyRing } from "../secrets/key-ring.ts";
import type { ChannelConnectionKey } from "./capabilities.ts";

export interface OpenedConnection {
  readonly provider: ChannelConnectionKey;
  /** The provider's own secret, decrypted. Never log this. */
  readonly secret: string;
  readonly config: Record<string, unknown>;
}

/**
 * The connection for one provider, decrypted, or null.
 *
 * Null for a workspace that never connected it, for one an administrator
 * disabled, and for one whose last send failed. All three mean "do not send
 * through this", which is the only question the caller has.
 */
export async function openConnection(
  pool: Pool,
  ring: KeyRing,
  input: {
    readonly workspaceId: string;
    readonly provider: ChannelConnectionKey;
  },
): Promise<OpenedConnection | null> {
  const db = drizzle(pool);
  const [row] = await withWorkspace(db, input.workspaceId, (tx) =>
    tx
      .select({
        ciphertext: channelConnections.ciphertext,
        dataKey: channelConnections.dataKey,
        keyId: channelConnections.keyId,
        config: channelConnections.config,
        state: channelConnections.state,
      })
      .from(channelConnections)
      .where(
        activeOnly(
          channelConnections,
          eq(channelConnections.workspaceId, input.workspaceId),
          eq(channelConnections.provider, input.provider),
          eq(channelConnections.state, "connected"),
        ),
      )
      .limit(1),
  );
  if (!row) {
    return null;
  }

  return {
    provider: input.provider,
    secret: decryptSecret(ring, {
      ciphertext: row.ciphertext,
      dataKey: row.dataKey,
      keyId: row.keyId,
    }),
    config: (row.config ?? {}) as Record<string, unknown>,
  };
}

/** What a Slack connection's secret holds. */
export interface SlackSecret {
  readonly botToken: string;
  readonly signingSecret: string;
}

/**
 * The Slack secret, or null when the stored string is not one.
 *
 * Parsed rather than cast, and null rather than a throw: a connection somebody
 * pasted the wrong thing into should stop that provider from sending, not stop
 * the relay from draining every other topic.
 */
export function parseSlackSecret(secret: string): SlackSecret | null {
  try {
    const parsed = JSON.parse(secret) as Record<string, unknown>;
    const botToken = parsed.botToken;
    const signingSecret = parsed.signingSecret;
    if (typeof botToken !== "string" || typeof signingSecret !== "string") {
      return null;
    }
    return { botToken, signingSecret };
  } catch {
    return null;
  }
}

/**
 * A member's verified account id on one provider, or null.
 *
 * Verified only, for the same reason the router reads it that way: an
 * unverified identity is somebody's claim, and sending to a claim is how one
 * person's nudge reaches another person.
 */
export async function memberExternalId(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly provider: ChannelConnectionKey;
    readonly memberId: string;
  },
): Promise<string | null> {
  const db = drizzle(pool);
  const [row] = await withWorkspace(db, input.workspaceId, (tx) =>
    tx
      .select({ externalId: channelIdentities.externalId })
      .from(channelIdentities)
      .where(
        activeOnly(
          channelIdentities,
          eq(channelIdentities.workspaceId, input.workspaceId),
          eq(channelIdentities.provider, input.provider),
          eq(channelIdentities.memberId, input.memberId),
          isNotNull(channelIdentities.verifiedAt),
        ),
      )
      .limit(1),
  );
  return row?.externalId ?? null;
}

/**
 * Records something the provider told us about itself (P5-T03a).
 *
 * Teams needs this and nothing else does yet. There is no fixed endpoint to
 * send a Teams message to: every inbound activity carries the `serviceUrl` for
 * its own region, and outbound has to go back to that one, so a workspace whose
 * bot has never been messaged cannot be messaged either. The inbound door
 * records it here and the next outbound send has one.
 *
 * openokr:allow-mutation: a routing fact the provider supplied, not domain
 * state. Nothing reads it to decide anything about a person, no activity or
 * audit row describes it, and it is written on an inbound path where there is
 * no actor to attribute an Operation to.
 */
export async function rememberConnectionConfig(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly provider: ChannelConnectionKey;
    readonly patch: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  const db = drizzle(pool);
  await withWorkspace(db, input.workspaceId, async (tx) => {
    const [row] = await tx
      .select({ config: channelConnections.config })
      .from(channelConnections)
      .where(
        activeOnly(
          channelConnections,
          eq(channelConnections.workspaceId, input.workspaceId),
          eq(channelConnections.provider, input.provider),
        ),
      )
      .limit(1);
    if (!row) {
      return;
    }
    const current = (row.config ?? {}) as Record<string, unknown>;
    const next = { ...current, ...input.patch };
    if (JSON.stringify(current) === JSON.stringify(next)) {
      // Nothing moved. Writing anyway would touch the row on every inbound
      // message, which is a lot of writes to say the same thing.
      return;
    }
    // openokr:allow-mutation: see the note on this function.
    await tx
      .update(channelConnections)
      .set({ config: next, updatedAt: new Date() })
      .where(
        activeOnly(
          channelConnections,
          eq(channelConnections.workspaceId, input.workspaceId),
          eq(channelConnections.provider, input.provider),
        ),
      );
  });
}

/** What a WhatsApp connection's secret holds. */
export interface WhatsAppSecret {
  /** The permanent access token that sends. Never logged. */
  readonly accessToken: string;
  /** The app secret that signs every inbound body. Never logged. */
  readonly appSecret: string;
  /**
   * The token echoed back during Meta's subscription handshake.
   *
   * Chosen by the administrator rather than issued, like Telegram's webhook
   * secret, and stored beside the other two because all three are set once on
   * the same screen.
   */
  readonly verifyToken: string;
}

/**
 * The WhatsApp secret, or null when the stored string is not one.
 *
 * Three fields rather than two, because this provider has three separate
 * credentials and folding any of them into another would mean one screen
 * pretending they are the same thing.
 */
export function parseWhatsAppSecret(secret: string): WhatsAppSecret | null {
  try {
    const parsed = JSON.parse(secret) as Record<string, unknown>;
    const accessToken = parsed.accessToken;
    const appSecret = parsed.appSecret;
    const verifyToken = parsed.verifyToken;
    if (
      typeof accessToken !== "string" ||
      typeof appSecret !== "string" ||
      typeof verifyToken !== "string"
    ) {
      return null;
    }
    return { accessToken, appSecret, verifyToken };
  } catch {
    return null;
  }
}

/** What a Teams connection's secret holds. */
export interface TeamsSecret {
  /** The bot's application id, which is also the inbound token's audience. */
  readonly appId: string;
  /** The bot's client secret. Never logged. */
  readonly appPassword: string;
}

/**
 * The Teams secret, or null when the stored string is not one.
 *
 * The same shape as the other two parsers, for the same reason: one
 * envelope-encrypted string per connection, and each provider decides what its
 * own secret looks like, so the table stays one shape for all four.
 */
export function parseTeamsSecret(secret: string): TeamsSecret | null {
  try {
    const parsed = JSON.parse(secret) as Record<string, unknown>;
    const appId = parsed.appId;
    const appPassword = parsed.appPassword;
    if (typeof appId !== "string" || typeof appPassword !== "string") {
      return null;
    }
    return { appId, appPassword };
  } catch {
    return null;
  }
}

/** What a Telegram connection's secret holds. */
export interface TelegramSecret {
  /** The bot token. Goes in an outbound URL, so it never reaches a log. */
  readonly botToken: string;
  /** The secret Telegram echoes on every inbound request. */
  readonly webhookSecret: string;
}

/**
 * The Telegram secret, or null when the stored string is not one.
 *
 * The same shape as `parseSlackSecret` and for the same reason: the connection
 * holds one envelope-encrypted string and each provider decides what its own
 * secret looks like, so the table stays one shape for all four.
 */
export function parseTelegramSecret(secret: string): TelegramSecret | null {
  try {
    const parsed = JSON.parse(secret) as Record<string, unknown>;
    const botToken = parsed.botToken;
    const webhookSecret = parsed.webhookSecret;
    if (typeof botToken !== "string" || typeof webhookSecret !== "string") {
      return null;
    }
    return { botToken, webhookSecret };
  } catch {
    return null;
  }
}
