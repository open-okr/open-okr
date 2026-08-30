/**
 * The authorisation code flow, both halves (RFC 6749 and 7636, P5-T08a).
 *
 * **Every dangerous moment in OAuth is a race, so every one of them is a
 * transaction here.** Redeeming a code marks it consumed in the same
 * transaction that mints the tokens, so a second redemption cannot find an
 * unconsumed row. Rotating a refresh token marks it used and writes its
 * replacement together, so two concurrent refreshes cannot both succeed.
 *
 * **A refresh token presented twice is not an error, it is evidence.** Rotation
 * means each one is used exactly once. A second presentation means the value
 * was copied, and the honest response is to assume the attacker has it and end
 * the whole lineage rather than refuse one request and let them keep the rest.
 */
import {
  activeOnly,
  oauthAccessTokens,
  oauthCodes,
  oauthRefreshTokens,
  type WorkspaceTx,
} from "@openokr/db";
import { eq, isNull } from "drizzle-orm";
import { liveGrant, revokeGrant } from "./grants.ts";
import { CHALLENGE_METHOD, verifierMatches } from "./pkce.ts";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  CODE_TTL_SECONDS,
  hashSecret,
  mintSecret,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./secrets.ts";

const seconds = (from: Date, count: number) =>
  new Date(from.getTime() + count * 1000);

/** What a client is handed after a successful grant or refresh. */
export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly scopes: readonly string[];
}

/**
 * Issues a single-use code against a PKCE challenge.
 *
 * Called by the consent screen once somebody has approved (P5-T08c). The raw
 * code goes back to the client through the redirect and is never stored.
 */
export async function issueAuthorisationCode(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly grantId: string;
    readonly challenge: string;
    readonly challengeMethod?: string;
    readonly redirectUri: string;
    readonly resource: string;
    readonly now: Date;
  },
): Promise<string> {
  const secret = mintSecret("code");
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx.insert(oauthCodes).values({
    workspaceId: input.workspaceId,
    grantId: input.grantId,
    codeHash: secret.hash,
    challenge: input.challenge,
    challengeMethod: input.challengeMethod ?? CHALLENGE_METHOD,
    redirectUri: input.redirectUri,
    resource: input.resource,
    expiresAt: seconds(input.now, CODE_TTL_SECONDS),
    createdAt: input.now,
    updatedAt: input.now,
  });
  return secret.raw;
}

export type GrantRefusal =
  | "invalid_grant"
  | "invalid_request"
  | "invalid_client"
  | "access_denied";

export type TokenOutcome =
  | { readonly kind: "issued"; readonly tokens: IssuedTokens }
  | {
      readonly kind: "refused";
      readonly error: GrantRefusal;
      readonly description: string;
    };

/**
 * Mints one access token and one refresh token for a grant.
 *
 * Shared by the code and refresh paths, because what a client receives must be
 * identical either way. Two copies of this would be two chances for a refresh
 * to hand back a token with a different lifetime than the first one had.
 */
async function issueTokens(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly grantId: string;
    readonly resource: string;
    readonly scopes: readonly string[];
    readonly now: Date;
  },
): Promise<{ tokens: IssuedTokens; refreshId: string }> {
  const access = mintSecret("access");
  const refresh = mintSecret("refresh");

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx.insert(oauthAccessTokens).values({
    workspaceId: input.workspaceId,
    grantId: input.grantId,
    tokenHash: access.hash,
    resource: input.resource,
    expiresAt: seconds(input.now, ACCESS_TOKEN_TTL_SECONDS),
    createdAt: input.now,
    updatedAt: input.now,
  });

  // openokr:allow-mutation: the calling Operation's own transaction.
  const [refreshRow] = await tx
    .insert(oauthRefreshTokens)
    .values({
      workspaceId: input.workspaceId,
      grantId: input.grantId,
      tokenHash: refresh.hash,
      expiresAt: seconds(input.now, REFRESH_TOKEN_TTL_SECONDS),
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: oauthRefreshTokens.id });

  if (!refreshRow) {
    throw new Error("The refresh token could not be recorded.");
  }

  return {
    tokens: {
      accessToken: access.raw,
      refreshToken: refresh.raw,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      scopes: input.scopes,
    },
    refreshId: refreshRow.id,
  };
}

/**
 * Redeems an authorisation code.
 *
 * Runs under the tenant setting for the workspace the code named, which the
 * caller resolved through the pre-tenant lookup. Four things are checked and
 * all four refuse identically, because telling a client *which* of them failed
 * is telling an attacker which half of a guess was right.
 */
export async function redeemAuthorisationCode(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly codeHash: string;
    readonly verifier: string;
    readonly redirectUri: string;
    readonly resource: string;
    readonly now: Date;
  },
): Promise<TokenOutcome> {
  const [code] = await tx
    .select()
    .from(oauthCodes)
    .where(
      activeOnly(
        oauthCodes,
        eq(oauthCodes.workspaceId, input.workspaceId),
        eq(oauthCodes.codeHash, input.codeHash),
      ),
    )
    .limit(1);

  const refuse = (description: string): TokenOutcome => ({
    kind: "refused",
    error: "invalid_grant",
    description,
  });

  if (!code) {
    return refuse("That authorisation code is not one this server issued.");
  }
  if (code.consumedAt) {
    // **A replayed code is evidence, exactly as a replayed refresh token is.**
    // The tokens the first redemption produced are already in somebody's hands
    // and one of the two holders is not the client. Ending the grant is the
    // only answer that does not leave an attacker holding a live session.
    await revokeGrant(tx, {
      workspaceId: input.workspaceId,
      grantId: code.grantId,
      reason: "reuse",
      now: input.now,
    });
    return refuse("That authorisation code has already been used.");
  }
  if (code.expiresAt.getTime() <= input.now.getTime()) {
    return refuse("That authorisation code has expired.");
  }
  if (code.redirectUri !== input.redirectUri) {
    return refuse("That authorisation code was issued for another address.");
  }
  if (code.resource !== input.resource) {
    return refuse("That authorisation code was issued for another instance.");
  }
  if (
    !verifierMatches({
      verifier: input.verifier,
      challenge: code.challenge,
      method: code.challengeMethod,
    })
  ) {
    return refuse("That verifier does not match the challenge.");
  }

  const grant = await liveGrant(tx, {
    workspaceId: input.workspaceId,
    grantId: code.grantId,
    resource: input.resource,
  });
  if (grant.kind !== "ok") {
    return refuse("That connection is no longer active.");
  }

  // Consumed in the same transaction that mints the tokens, and conditioned on
  // still being unconsumed, so two concurrent redemptions cannot both pass.
  // openokr:allow-mutation: the calling Operation's own transaction.
  const consumed = await tx
    .update(oauthCodes)
    .set({ consumedAt: input.now, updatedAt: input.now })
    .where(
      activeOnly(
        oauthCodes,
        eq(oauthCodes.id, code.id),
        isNull(oauthCodes.consumedAt),
      ),
    )
    .returning({ id: oauthCodes.id });

  if (consumed.length === 0) {
    return refuse("That authorisation code has already been used.");
  }

  const issued = await issueTokens(tx, {
    workspaceId: input.workspaceId,
    grantId: code.grantId,
    resource: input.resource,
    scopes: grant.scopes,
    now: input.now,
  });
  return { kind: "issued", tokens: issued.tokens };
}

/**
 * Rotates a refresh token, or ends the lineage because it was replayed.
 *
 * The whole grant goes, not just this token. A copied refresh token means the
 * attacker has whatever the client has, and revoking one link while leaving the
 * chain intact would refuse one request and change nothing.
 */
export async function rotateRefreshToken(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly tokenHash: string;
    readonly resource: string;
    readonly now: Date;
  },
): Promise<TokenOutcome> {
  const [token] = await tx
    .select()
    .from(oauthRefreshTokens)
    .where(
      activeOnly(
        oauthRefreshTokens,
        eq(oauthRefreshTokens.workspaceId, input.workspaceId),
        eq(oauthRefreshTokens.tokenHash, input.tokenHash),
      ),
    )
    .limit(1);

  const refuse = (description: string): TokenOutcome => ({
    kind: "refused",
    error: "invalid_grant",
    description,
  });

  if (!token) {
    return refuse("That refresh token is not one this server issued.");
  }
  if (token.usedAt) {
    await revokeGrant(tx, {
      workspaceId: input.workspaceId,
      grantId: token.grantId,
      reason: "reuse",
      now: input.now,
    });
    return refuse(
      "That refresh token was already used, so this connection was revoked.",
    );
  }
  if (token.revokedAt) {
    return refuse("That connection has been revoked.");
  }
  if (token.expiresAt.getTime() <= input.now.getTime()) {
    return refuse("That refresh token has expired.");
  }

  const grant = await liveGrant(tx, {
    workspaceId: input.workspaceId,
    grantId: token.grantId,
    resource: input.resource,
  });
  if (grant.kind !== "ok") {
    if (grant.reason === "no_member") {
      // Membership is gone, so the grant goes with it rather than being
      // refused once per request forever.
      await revokeGrant(tx, {
        workspaceId: input.workspaceId,
        grantId: token.grantId,
        reason: "membership",
        now: input.now,
      });
    }
    return refuse("That connection is no longer active.");
  }

  // Claimed before anything is minted, and conditioned on still being unused,
  // so two concurrent refreshes cannot both mint.
  // openokr:allow-mutation: the calling Operation's own transaction.
  const claimed = await tx
    .update(oauthRefreshTokens)
    .set({ usedAt: input.now, updatedAt: input.now })
    .where(
      activeOnly(
        oauthRefreshTokens,
        eq(oauthRefreshTokens.id, token.id),
        isNull(oauthRefreshTokens.usedAt),
      ),
    )
    .returning({ id: oauthRefreshTokens.id });

  if (claimed.length === 0) {
    return refuse("That refresh token was already used.");
  }

  const issued = await issueTokens(tx, {
    workspaceId: input.workspaceId,
    grantId: token.grantId,
    resource: input.resource,
    scopes: grant.scopes,
    now: input.now,
  });

  // The chain, so the lineage is walkable from any link.
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(oauthRefreshTokens)
    .set({ replacedBy: issued.refreshId, updatedAt: input.now })
    .where(
      activeOnly(
        oauthRefreshTokens,
        eq(oauthRefreshTokens.workspaceId, input.workspaceId),
        eq(oauthRefreshTokens.id, token.id),
      ),
    );

  return { kind: "issued", tokens: issued.tokens };
}

/** The digest of a presented secret, so callers never handle the raw value. */
export const digest = hashSecret;
