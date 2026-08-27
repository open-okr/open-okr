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
