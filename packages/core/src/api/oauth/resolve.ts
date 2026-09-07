/**
 * Turning a presented OAuth secret into a workspace, then a principal
 * (P5-T08a).
 *
 * **Two steps, and the order is the security property.** A secret names no
 * workspace, so the first read runs in the pre-tenant transaction where the
 * only row reachable is the one whose digest the caller already holds. Once
 * that row has named a workspace, everything after it is an ordinary read under
 * the ordinary tenant setting. Nothing here ever queries across tenants.
 *
 * **An API token is not an MCP token.** They live in different tables with
 * different prefixes, so presenting one where the other belongs finds nothing
 * at all, which is the strongest form the rule can take: not a comparison that
 * could be forgotten, but a lookup that cannot succeed.
 */
import {
  activeOnly,
  oauthAccessTokens,
  oauthCodes,
  oauthRefreshTokens,
  withOAuthSecret,
  withWorkspace,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  redeemAuthorisationCode,
  rotateRefreshToken,
  type TokenOutcome,
} from "./flow.ts";
import { liveGrant, stampGrantUse } from "./grants.ts";
import { hashSecret, kindFromText } from "./secrets.ts";

export type AccessRejection =
  | "invalid"
  | "expired"
  | "revoked"
  | "wrong_resource"
  | "no_member";

export type AccessResolution =
  | {
      readonly kind: "ok";
      readonly grantId: string;
      readonly workspaceId: string;
      readonly memberId: string;
      readonly userId: string;
      readonly scopes: readonly string[];
    }
  | { readonly kind: "rejected"; readonly reason: AccessRejection };

/** Which workspace a secret belongs to, read before any tenant is known. */
async function workspaceForAccessToken(
  pool: Pool,
  hash: string,
): Promise<{ workspaceId: string; grantId: string } | null> {
  const found = await withOAuthSecret(drizzle(pool), hash, async (tx) => {
    const [row] = await tx
      .select({
        workspaceId: oauthAccessTokens.workspaceId,
        grantId: oauthAccessTokens.grantId,
      })
      .from(oauthAccessTokens)
      .where(
        activeOnly(oauthAccessTokens, eq(oauthAccessTokens.tokenHash, hash)),
      )
      .limit(1);
    return row;
  });
  return found ?? null;
}

/** The same lookup for a refresh token, which the token endpoint needs. */
export async function workspaceForRefreshToken(
  pool: Pool,
  raw: string,
): Promise<{ workspaceId: string; hash: string } | null> {
  if (kindFromText(raw) !== "refresh") {
    return null;
  }
  const hash = hashSecret(raw);
  const found = await withOAuthSecret(drizzle(pool), hash, async (tx) => {
    const [row] = await tx
      .select({ workspaceId: oauthRefreshTokens.workspaceId })
      .from(oauthRefreshTokens)
      .where(
        activeOnly(oauthRefreshTokens, eq(oauthRefreshTokens.tokenHash, hash)),
      )
      .limit(1);
    return row;
  });
  return found ? { workspaceId: found.workspaceId, hash } : null;
}

/** And for an authorisation code. */
export async function workspaceForCode(
  pool: Pool,
  raw: string,
): Promise<{ workspaceId: string; hash: string } | null> {
  if (kindFromText(raw) !== "code") {
    return null;
  }
  const hash = hashSecret(raw);
  const found = await withOAuthSecret(drizzle(pool), hash, async (tx) => {
    const [row] = await tx
      .select({ workspaceId: oauthCodes.workspaceId })
      .from(oauthCodes)
      .where(activeOnly(oauthCodes, eq(oauthCodes.codeHash, hash)))
      .limit(1);
    return row;
  });
  return found ? { workspaceId: found.workspaceId, hash } : null;
}

/**
 * Turns a presented access token into a principal, or a refusal.
 *
 * The grant's membership is revalidated here rather than trusted from the
 * token, so somebody suspended a minute ago is refused a minute ago.
 */
export async function resolveAccessToken(
  pool: Pool,
  input: {
    readonly raw: string;
    readonly resource: string;
    readonly now: Date;
  },
): Promise<AccessResolution> {
  const raw = input.raw.trim();
  if (raw === "" || kindFromText(raw) !== "access") {
    return { kind: "rejected", reason: "invalid" };
  }

  const hash = hashSecret(raw);
  const located = await workspaceForAccessToken(pool, hash);
  if (!located) {
    return { kind: "rejected", reason: "invalid" };
  }

  const db = drizzle(pool);
  return withWorkspace(db, located.workspaceId, async (tx) => {
    const [row] = await tx
      .select()
      .from(oauthAccessTokens)
      .where(
        activeOnly(
          oauthAccessTokens,
          eq(oauthAccessTokens.workspaceId, located.workspaceId),
          eq(oauthAccessTokens.tokenHash, hash),
        ),
      )
      .limit(1);

    if (!row) {
      return { kind: "rejected", reason: "invalid" } as const;
    }
    if (row.revokedAt) {
      return { kind: "rejected", reason: "revoked" } as const;
    }
    if (row.expiresAt.getTime() <= input.now.getTime()) {
      return { kind: "rejected", reason: "expired" } as const;
    }
    if (row.resource !== input.resource) {
      return { kind: "rejected", reason: "wrong_resource" } as const;
    }

    const grant = await liveGrant(tx, {
      workspaceId: located.workspaceId,
      grantId: row.grantId,
      resource: input.resource,
    });
    if (grant.kind !== "ok") {
      return {
        kind: "rejected",
        reason: grant.reason === "no_member" ? "no_member" : "revoked",
      } as const;
    }

    await stampGrantUse(tx, {
      workspaceId: located.workspaceId,
      grantId: row.grantId,
      now: input.now,
    });

    return {
      kind: "ok",
      grantId: row.grantId,
      workspaceId: located.workspaceId,
      memberId: grant.memberId,
      userId: grant.userId,
      scopes: grant.scopes,
    } as const;
  });
}

/**
 * The token endpoint's code path, tenant resolution and all (P5-T08a).
 *
 * Exposed as one call taking a pool, because `apps/web` may not open a
 * transaction of its own: the route holds the transport and this holds the two
 * steps. A code that names no workspace is refused in the same words as one
 * that names a workspace but fails every other check.
 */
export async function redeemCodeForTokens(
  pool: Pool,
  input: {
    readonly code: string;
    readonly verifier: string;
    readonly redirectUri: string;
    readonly resource: string;
    readonly now: Date;
  },
): Promise<TokenOutcome> {
  const located = await workspaceForCode(pool, input.code);
  if (!located) {
    return {
      kind: "refused",
      error: "invalid_grant",
      description: "That authorisation code is not one this server issued.",
    };
  }
  return withWorkspace(drizzle(pool), located.workspaceId, (tx) =>
    redeemAuthorisationCode(tx, {
      workspaceId: located.workspaceId,
      codeHash: located.hash,
      verifier: input.verifier,
      redirectUri: input.redirectUri,
      resource: input.resource,
      now: input.now,
    }),
  );
}

/** The same for the refresh path. */
export async function refreshForTokens(
  pool: Pool,
  input: {
    readonly refreshToken: string;
    readonly resource: string;
    readonly now: Date;
  },
): Promise<TokenOutcome> {
  const located = await workspaceForRefreshToken(pool, input.refreshToken);
  if (!located) {
    return {
      kind: "refused",
      error: "invalid_grant",
      description: "That refresh token is not one this server issued.",
    };
  }
  return withWorkspace(drizzle(pool), located.workspaceId, (tx) =>
    rotateRefreshToken(tx, {
      workspaceId: located.workspaceId,
      tokenHash: located.hash,
      resource: input.resource,
      now: input.now,
    }),
  );
}
