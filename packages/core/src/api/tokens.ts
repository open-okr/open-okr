/**
 * Bearer tokens for the public surfaces (TECHNICAL-PLAN §14, P5-T07a).
 *
 * **The same shape every other token in this product has**: a random raw value
 * handed over once, and only its SHA-256 digest stored. Nothing here can show a
 * person their token a second time, and that is the point.
 *
 * **A token narrows authority, it never widens it.** It carries the authority of
 * the member who minted it, and its scopes narrow that further. A write-scoped
 * token held by a view-level member writes nothing, because `can()` runs exactly
 * as it does for the browser. There is no access level on a token for the same
 * reason there is no service account: a second answer to "who may do this" is a
 * second thing to get wrong.
 *
 * **The audience is read from the row, not the string.** The readable prefix
 * lets a person tell two of their own tokens apart and lets the wrong door give
 * a clear refusal without a query, but a string presented by a caller is not
 * evidence of anything.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  type ApiToken,
  activeOnly,
  apiTokens,
  type TokenAudience,
  type TokenScope,
  withApiToken,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { SafetyClass } from "../actions/define.ts";

/**
 * The head of a raw token, which says which door it is for.
 *
 * Two reasons it is there. A person with four tokens in four configuration
 * files can tell which is which from the first characters, and a REST token
 * arriving at the agent endpoint can be refused before a query runs. Neither
 * reason makes it authoritative.
 */
const PREFIXES: Readonly<Record<TokenAudience, string>> = {
  rest: "okr_rest_",
  mcp: "okr_mcp_",
};

/** How much of the raw token is kept in the clear, for display. */
const PREFIX_LENGTH = 16;

/**
 * How many requests one token may make per window.
 *
 * Per token rather than per member, because two services sharing one person's
 * authority should not be able to starve each other by accident. A constant
 * rather than a §4.14 setting, for the same reason the inbound channel limit is
 * one: it bounds abuse of a public door rather than expressing a practice
 * choice, and nobody should have to configure it to be protected.
 */
export const API_RATE_LIMIT = 600;
export const API_RATE_WINDOW_SECONDS = 60;

export interface MintedToken {
  /** Shown once, to the person who asked for it. Never stored. */
  readonly raw: string;
  readonly hash: string;
  /** The clear head, for the list screen. */
  readonly prefix: string;
}

/**
 * 32 bytes of randomness behind a readable prefix.
 *
 * base64url so it survives a URL, a header, an environment variable and a shell
 * without quoting, which is where these actually live.
 */
export function mintApiToken(audience: TokenAudience): MintedToken {
  const raw = `${PREFIXES[audience]}${randomBytes(32).toString("base64url")}`;
  return {
    raw,
    hash: hashApiToken(raw),
    prefix: raw.slice(0, PREFIX_LENGTH),
  };
}

export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw.trim()).digest("hex");
}

/**
 * Which door the token's text claims to be for, or null.
 *
 * A hint. `resolveApiToken` compares the stored audience and that is the answer
 * that counts.
 */
export function audienceFromText(raw: string): TokenAudience | null {
  const value = raw.trim();
  for (const [audience, prefix] of Object.entries(PREFIXES)) {
    if (value.startsWith(prefix)) {
      return audience as TokenAudience;
    }
  }
  return null;
}

/** Reads the `Authorization` header, or null. */
export function bearerFrom(header: string | null | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export type TokenRejection =
  /** Not the shape of a token at all, or not a token that exists. */
  | "invalid"
  | "revoked"
  | "expired"
  /** A real token, for the other door. */
  | "wrong_audience"
  /** The member it belongs to is suspended or gone. */
  | "no_member";

export type TokenResolution =
  | {
      readonly kind: "ok";
      readonly tokenId: string;
      readonly workspaceId: string;
      readonly memberId: string;
      /** The global user, for the actor. A token is never its own principal. */
      readonly userId: string;
      readonly scopes: readonly TokenScope[];
    }
  | { readonly kind: "rejected"; readonly reason: TokenRejection };

/** Which scope an action of this safety class needs. */
export function scopeFor(safety: SafetyClass): TokenScope {
  return safety;
}

/**
 * Turns a presented token into a principal, or a refusal.
 *
 * Runs in the pre-tenant transaction described in migration 0058: the only row
 * it can see is the one whose hash the caller already holds. The membership is
 * checked in the same transaction, under the workspace the token names, so a
 * suspended member's token stops working without anything having to remember to
 * revoke it.
 */
export async function resolveApiToken(
  pool: Pool,
  input: {
    readonly raw: string;
    readonly audience: TokenAudience;
    readonly now: Date;
  },
): Promise<TokenResolution> {
  const raw = input.raw.trim();
  if (raw === "" || audienceFromText(raw) === null) {
    return { kind: "rejected", reason: "invalid" };
  }

  const hash = hashApiToken(raw);
  const db = drizzle(pool);
  const row = await withApiToken(db, hash, async (tx) => {
    const [found] = await tx
      .select()
      .from(apiTokens)
      .where(activeOnly(apiTokens, eq(apiTokens.tokenHash, hash)))
      .limit(1);
    return found as ApiToken | undefined;
  });

  if (!row) {
    return { kind: "rejected", reason: "invalid" };
  }
  if (row.revokedAt) {
    return { kind: "rejected", reason: "revoked" };
  }
  if (row.expiresAt && row.expiresAt.getTime() <= input.now.getTime()) {
    return { kind: "rejected", reason: "expired" };
  }
  if (row.audience !== input.audience) {
    return { kind: "rejected", reason: "wrong_audience" };
  }

  // Now that the token has named a workspace, the ordinary tenant setting
  // applies and the membership check is an ordinary read under it.
  const member = await withWorkspace(db, row.workspaceId, async (tx) => {
    const [found] = await tx
      .select({
        userId: workspaceMembers.userId,
        status: workspaceMembers.status,
      })
      .from(workspaceMembers)
      .where(
        activeOnly(workspaceMembers, eq(workspaceMembers.id, row.memberId)),
      )
      .limit(1);
    return found;
  });

  if (member?.status !== "active" || !member.userId) {
    return { kind: "rejected", reason: "no_member" };
  }

  return {
    kind: "ok",
    tokenId: row.id,
    workspaceId: row.workspaceId,
    memberId: row.memberId,
    userId: member.userId,
    scopes: row.scopes,
  };
}

/**
 * Stamps a token as used.
 *
 * Best effort and deliberately outside the request's own work: a person wants
 * to know which of their four tokens is still in something's configuration,
 * and a failed stamp must never fail a call that was otherwise fine.
 */
export async function stampTokenUse(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly tokenId: string;
    readonly now: Date;
  },
): Promise<void> {
  try {
    await withWorkspace(drizzle(pool), input.workspaceId, async (tx) => {
      // openokr:allow-mutation: a use stamp, not domain state. Nothing reads
      // it to decide anything and no activity or audit row describes it, which
      // is why it does not go through the Operation pipeline.
      await tx
        .update(apiTokens)
        .set({ lastUsedAt: input.now })
        .where(
          activeOnly(
            apiTokens,
            eq(apiTokens.workspaceId, input.workspaceId),
            eq(apiTokens.id, input.tokenId),
          ),
        );
    });
  } catch {
    // Deliberately silent. See above.
  }
}
