/**
 * The session an external agent holds, recorded (P5-T09b).
 *
 * **A session is a record, never an authority.** Every request presents its own
 * access token and is resolved from scratch, so a session whose grant was
 * revoked a second ago is refused a second ago. What this table buys is that a
 * person can see what is connected, and that a support question about which
 * protocol version a client agreed to has an answer.
 *
 * **The identifier is hashed like every other secret here.** It is not a
 * credential and must never become one; storing the digest costs nothing and
 * means a table of live sessions is not a table of ways to attach to somebody's
 * stream if the transport ever comes to trust it.
 */

import { randomUUID } from "node:crypto";
import {
  activeOnly,
  mcpSessions,
  type WorkspaceTx,
  withOAuthSecret,
  withWorkspace,
} from "@openokr/db";
import { eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { hashSecret } from "../oauth/secrets.ts";

/**
 * The versions of the protocol this server speaks.
 *
 * Newest first, which is what a negotiation walks. Listed rather than taken
 * from the SDK so that upgrading the library cannot silently change what an
 * instance claims to support.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

/** The version to answer with, or null when nothing overlaps. */
export function negotiateVersion(asked: string | null): string | null {
  if (!asked) {
    // A client that names none gets the oldest, which is what the
    // specification says a version-less request means.
    return SUPPORTED_PROTOCOL_VERSIONS[
      SUPPORTED_PROTOCOL_VERSIONS.length - 1
    ] as string;
  }
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
    ? asked
    : null;
}

/**
 * Whether an origin header may open a session here.
 *
 * **This is the rebinding defence and it is not optional.** An agent runtime
 * often runs a local HTTP server; a page in a browser can be made to resolve a
 * name to a loopback address and then talk to it. The protocol's own guidance is
 * to validate `Origin`, and the only origin that has business here is the
 * instance's own. A request with no origin at all is a program rather than a
 * page, which is the ordinary case for an agent.
 */
export function originAllowed(origin: string | null, issuer: string): boolean {
  if (origin === null || origin === "") {
    return true;
  }
  try {
    return new URL(origin).origin === new URL(issuer).origin;
  } catch {
    return false;
  }
}

/** Records a session the transport just started. */
export async function recordSession(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly grantId: string;
    readonly sessionId: string;
    readonly protocolVersion: string;
    readonly clientName?: string | null;
    readonly clientVersion?: string | null;
    readonly now: Date;
  },
): Promise<void> {
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .insert(mcpSessions)
    .values({
      workspaceId: input.workspaceId,
      grantId: input.grantId,
      sessionHash: hashSecret(input.sessionId),
      protocolVersion: input.protocolVersion,
      clientName: input.clientName ?? null,
      clientVersion: input.clientVersion ?? null,
      lastSeenAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    })
    // A transport that re-initialises an identifier it already used is one
    // session, not two.
    .onConflictDoNothing();
}

/** Marks a session closed, which a client asks for with a DELETE. */
export async function closeSession(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly sessionId: string;
    readonly now: Date;
  },
): Promise<void> {
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(mcpSessions)
    .set({ closedAt: input.now, updatedAt: input.now })
    .where(
      activeOnly(
        mcpSessions,
        eq(mcpSessions.workspaceId, input.workspaceId),
        eq(mcpSessions.sessionHash, hashSecret(input.sessionId)),
        isNull(mcpSessions.closedAt),
      ),
    );
}

/** Records a session against a grant, opening its own transaction. */
export async function recordSessionFor(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly grantId: string;
    readonly sessionId: string;
    readonly protocolVersion: string;
    readonly clientName?: string | null;
    readonly clientVersion?: string | null;
    readonly now: Date;
  },
): Promise<void> {
  await withWorkspace(drizzle(pool), input.workspaceId, (tx) =>
    recordSession(tx, input),
  );
}

/** Closes one, the same way. */
export async function closeSessionFor(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly sessionId: string;
    readonly now: Date;
  },
): Promise<void> {
  await withWorkspace(drizzle(pool), input.workspaceId, (tx) =>
    closeSession(tx, input),
  );
}

export interface SessionRecord {
  readonly workspaceId: string;
  readonly grantId: string;
  readonly protocolVersion: string;
  readonly closedAt: Date | null;
}

/**
 * The session one identifier names, read before a workspace is known.
 *
 * Uses the same pre-tenant key the OAuth secrets do. Nothing authenticates from
 * this: it is here so a transport can find which workspace a resumed stream
 * belonged to, and the token on that request still decides everything.
 */
export async function sessionFor(
  pool: Pool,
  sessionId: string,
): Promise<SessionRecord | null> {
  const hash = hashSecret(sessionId);
  const row = await withOAuthSecret(drizzle(pool), hash, async (tx) => {
    const [found] = await tx
      .select({
        workspaceId: mcpSessions.workspaceId,
        grantId: mcpSessions.grantId,
        protocolVersion: mcpSessions.protocolVersion,
        closedAt: mcpSessions.closedAt,
      })
      .from(mcpSessions)
      .where(activeOnly(mcpSessions, eq(mcpSessions.sessionHash, hash)))
      .limit(1);
    return found;
  });
  return row ?? null;
}

/**
 * Stamps a session as seen, so a person can tell live from abandoned.
 *
 * Best effort and deliberately outside the request's own work, exactly as a
 * token's use stamp is: a failed stamp must never fail a call that was
 * otherwise fine.
 */
export async function stampSessionUse(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly sessionId: string;
    readonly now: Date;
  },
): Promise<void> {
  try {
    await withWorkspace(drizzle(pool), input.workspaceId, async (tx) => {
      // openokr:allow-mutation: a use stamp, not domain state. Nothing reads it
      // to decide anything, which is why it does not go through the Operation
      // pipeline.
      await tx
        .update(mcpSessions)
        .set({ lastSeenAt: input.now })
        .where(
          activeOnly(
            mcpSessions,
            eq(mcpSessions.workspaceId, input.workspaceId),
            eq(mcpSessions.sessionHash, hashSecret(input.sessionId)),
          ),
        );
    });
  } catch {
    // Deliberately swallowed.
  }
}

/**
 * A new session identifier, which the route hands back in the header.
 *
 * Generated here rather than by the transport, because the transport is
 * stateless and the session is this product's record rather than its memory.
 */
export function newSessionId(): string {
  return randomUUID();
}
