/**
 * The grant, and everything that hangs off it (P5-T08a).
 *
 * **The grant is the unit that gets revoked.** Every code, access token and
 * refresh token points at one, so ending a connection is one update here rather
 * than a sweep across three tables, and a token whose grant is gone stops
 * working on its next use without anything having had to find it.
 *
 * **Membership is revalidated on every use, not cached on the grant.** A person
 * who leaves a workspace, or is suspended, loses everything they connected,
 * immediately, with nobody having to remember to revoke it. That is the same
 * rule `resolveApiToken` follows, and for the same reason: authority is a fact
 * about now.
 */
import {
  activeOnly,
  oauthAccessTokens,
  oauthGrants,
  oauthRefreshTokens,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { eq, isNull } from "drizzle-orm";

/** Why a grant ended. Shown to the person in their connections list. */
export const REVOCATION_REASONS = {
  member: "You ended this connection.",
  reuse:
    "A refresh token was presented twice, which means it was copied. Every token in this connection was revoked.",
  membership: "You are no longer an active member of this workspace.",
} as const;

export type RevocationReason = keyof typeof REVOCATION_REASONS;

export interface GrantInput {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly resource: string;
  readonly now: Date;
}

/** Records one person's decision about one client. */
export async function createGrant(
  tx: WorkspaceTx,
  input: GrantInput,
): Promise<string> {
  // openokr:allow-mutation: the calling Operation's own transaction.
  const [row] = await tx
    .insert(oauthGrants)
    .values({
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      clientId: input.clientId,
      scopes: [...input.scopes],
      resource: input.resource,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning({ id: oauthGrants.id });

  if (!row) {
    throw new Error("The grant could not be recorded.");
  }
  return row.id;
}

/**
 * Ends a grant and every token under it.
 *
 * All three writes, always, even when the caller believes there are no live
 * tokens: a revocation that left one behind because a count looked right is the
 * kind of bug nobody finds until it matters.
 */
export async function revokeGrant(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly grantId: string;
    readonly reason: RevocationReason;
    readonly now: Date;
  },
): Promise<void> {
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(oauthGrants)
    .set({
      revokedAt: input.now,
      revokedReason: input.reason,
      updatedAt: input.now,
    })
    .where(
      activeOnly(
        oauthGrants,
        eq(oauthGrants.workspaceId, input.workspaceId),
        eq(oauthGrants.id, input.grantId),
        isNull(oauthGrants.revokedAt),
      ),
    );

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(oauthAccessTokens)
    .set({ revokedAt: input.now, updatedAt: input.now })
    .where(
      activeOnly(
        oauthAccessTokens,
        eq(oauthAccessTokens.workspaceId, input.workspaceId),
        eq(oauthAccessTokens.grantId, input.grantId),
        isNull(oauthAccessTokens.revokedAt),
      ),
    );

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(oauthRefreshTokens)
    .set({ revokedAt: input.now, updatedAt: input.now })
    .where(
      activeOnly(
        oauthRefreshTokens,
        eq(oauthRefreshTokens.workspaceId, input.workspaceId),
        eq(oauthRefreshTokens.grantId, input.grantId),
        isNull(oauthRefreshTokens.revokedAt),
      ),
    );
}

export type GrantRejection =
  | "revoked"
  | "no_member"
  /** Bound to a different instance than the one being called. */
  | "wrong_resource";

export type LiveGrant =
  | {
      readonly kind: "ok";
      readonly grantId: string;
      readonly workspaceId: string;
      readonly memberId: string;
      readonly userId: string;
      readonly scopes: readonly string[];
    }
  | { readonly kind: "rejected"; readonly reason: GrantRejection };

/**
 * Whether this grant may still be used, right now, against this instance.
 *
 * Read after the secret has already named a workspace, so the ordinary tenant
 * setting applies and the membership check is an ordinary read under it.
 */
export async function liveGrant(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly grantId: string;
    readonly resource: string;
  },
): Promise<LiveGrant> {
  const [row] = await tx
    .select({
      id: oauthGrants.id,
      memberId: oauthGrants.memberId,
      scopes: oauthGrants.scopes,
      resource: oauthGrants.resource,
      revokedAt: oauthGrants.revokedAt,
    })
    .from(oauthGrants)
    .where(
      activeOnly(
        oauthGrants,
        eq(oauthGrants.workspaceId, input.workspaceId),
        eq(oauthGrants.id, input.grantId),
      ),
    )
    .limit(1);

  if (!row || row.revokedAt) {
    return { kind: "rejected", reason: "revoked" };
  }
  if (row.resource !== input.resource) {
    return { kind: "rejected", reason: "wrong_resource" };
  }

  const [member] = await tx
    .select({
      userId: workspaceMembers.userId,
      status: workspaceMembers.status,
    })
    .from(workspaceMembers)
    .where(activeOnly(workspaceMembers, eq(workspaceMembers.id, row.memberId)))
    .limit(1);

  if (!member || member.status !== "active" || !member.userId) {
    return { kind: "rejected", reason: "no_member" };
  }

  return {
    kind: "ok",
    grantId: row.id,
    workspaceId: input.workspaceId,
    memberId: row.memberId,
    userId: member.userId,
    scopes: row.scopes,
  };
}

/** Stamps a grant as used. Best effort, exactly as a token's use stamp is. */
export async function stampGrantUse(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly grantId: string;
    readonly now: Date;
  },
): Promise<void> {
  // openokr:allow-mutation: a use stamp, not domain state. Nothing reads it to
  // decide anything, which is why it does not go through the Operation
  // pipeline.
  await tx
    .update(oauthGrants)
    .set({ lastUsedAt: input.now })
    .where(
      activeOnly(
        oauthGrants,
        eq(oauthGrants.workspaceId, input.workspaceId),
        eq(oauthGrants.id, input.grantId),
      ),
    );
}
