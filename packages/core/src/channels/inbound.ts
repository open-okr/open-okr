/**
 * What happens to an inbound channel message before anybody acts on it
 * (AI-NATIVE-PLAN.md §6, P5-T02a).
 *
 * §6 lists eight checks in a fixed order. The first two belong to the driver,
 * because they read raw bytes and the algorithm is the provider's own. Steps
 * three to six are here, because they are the same four questions for every
 * provider and a second copy per driver is how they come to disagree. Steps
 * seven and eight, resolving a command and authorising it, belong to the router
 * (P5-T06).
 *
 * | Step | Question | Answer when it fails |
 * |---|---|---|
 * | 3 | Have we seen this delivery id? | Ignored as a duplicate |
 * | 4 | Does the sender resolve to a *verified* identity? | Nothing at all |
 * | 5 | Is the member active and not suspended? | Nothing at all |
 * | 6 | Is this member inside their rate limit? | A plain message |
 *
 * **Steps four and five answer with silence, and that is deliberate.** §5.3's
 * reason is in the sentence: a helpful error confirms the workspace exists. An
 * unlinked sender learns nothing about whether they guessed a real instance.
 * Step six is different, because by then the sender is a known member and
 * telling them to slow down costs nothing.
 *
 * **Inbound content is untrusted throughout.** A message whose text looks like
 * an instruction is a string in a payload. Nothing here interprets it, and the
 * router that will is generated from the action registry rather than from
 * whatever the message asked for.
 */

import { createHash, randomInt } from "node:crypto";
import {
  activeOnly,
  channelIdentities,
  channelInstallations,
  channelLinkCodes,
  channelMessages,
  includeDeleted,
  type WorkspaceTx,
  withProviderTeam,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { ChannelConnectionKey } from "./capabilities.ts";

/** How many inbound messages one member may send per window. */
export const INBOUND_RATE_LIMIT = 30;
export const INBOUND_RATE_WINDOW_SECONDS = 60;

/** How long a link code lives. §5.5's ten minutes. */
export const LINK_CODE_TTL_SECONDS = 600;

export type InboundOutcome =
  | { readonly kind: "duplicate" }
  /** Steps four and five, which answer identically on purpose. */
  | { readonly kind: "ignored"; readonly reason: string }
  | { readonly kind: "rate_limited" }
  /** A code the member sent to prove their account, now verified. */
  | { readonly kind: "linked"; readonly memberId: string }
  | { readonly kind: "accepted"; readonly memberId: string };

export interface InboundRequestFacts {
  readonly workspaceId: string;
  readonly provider: ChannelConnectionKey;
  /** Whatever the provider's own identifier for this delivery is. */
  readonly deliveryId: string;
  readonly externalSenderId: string;
  readonly text: string;
  readonly now: Date;
  /**
   * The rate-limit check, supplied by the host.
   *
   * A function rather than the `Cache` port, for the reason everything else in
   * this package takes functions: the port lives in `packages/adapters`.
   * Absent means no limiter is configured, and an instance with no cache
   * should still accept messages.
   */
  readonly withinRateLimit?: (key: string) => Promise<boolean>;
}

/** A code a person can read out loud, and hard enough to guess in ten minutes. */
export function generateLinkCode(): string {
  // Six digits from a crypto source. Slack strips nothing and a member types
  // this into a chat window, so letters that look like digits are a support
  // ticket rather than entropy.
  return String(randomInt(100_000, 1_000_000));
}

export const hashLinkCode = (code: string): string =>
  createHash("sha256").update(code.trim()).digest("hex");

/**
 * Records the inbound row, or reports that it is a repeat (§6 step three).
 *
 * The log row *is* the duplicate check: `(workspace_id, idempotency_key)` is
 * unique, and the delivery id is the key. A provider that retries a webhook
 * because our first answer was slow gets the same silence as a replay.
 */
async function recordInbound(
  tx: WorkspaceTx,
  facts: InboundRequestFacts,
  memberId: string | null,
): Promise<boolean> {
  const key = `inbound:${facts.provider}:${facts.deliveryId}`;
  const [existing] = await tx
    .select({ id: channelMessages.id })
    .from(channelMessages)
    .where(
      // Soft-deleted rows count: the unique index is not partial, and deleting
      // the record of a delivery must not make it deliverable again.
      includeDeleted(
        channelMessages,
        and(
          eq(channelMessages.workspaceId, facts.workspaceId),
          eq(channelMessages.idempotencyKey, key),
        ),
      ),
    )
    .limit(1);
  if (existing) {
    return false;
  }

  // openokr:allow-mutation: runs on the transaction the calling Operation
  // opened, so this row and that Operation's audit row commit together.
  await tx.insert(channelMessages).values({
    workspaceId: facts.workspaceId,
    provider: facts.provider,
    direction: "in" as const,
    memberId,
    // Stored after verification, never before: the driver has already proved
    // these bytes came from the provider.
    payload: { text: facts.text, externalSenderId: facts.externalSenderId },
    idempotencyKey: key,
    status: "sent" as const,
    sentAt: facts.now,
  });
  return true;
}

/**
 * Turns a code the sender typed into a verified identity, or null.
 *
 * The one place an unknown sender is allowed to get somewhere: they are proving
 * who they are, and until they do the product has nothing to refuse them from.
 */
async function consumeLinkCode(
  tx: WorkspaceTx,
  facts: InboundRequestFacts,
): Promise<string | null> {
  const digits = /\b(\d{6})\b/.exec(facts.text);
  if (!digits?.[1]) {
    return null;
  }

  const [code] = await tx
    .select({ id: channelLinkCodes.id, memberId: channelLinkCodes.memberId })
    .from(channelLinkCodes)
    .where(
      activeOnly(
        channelLinkCodes,
        eq(channelLinkCodes.workspaceId, facts.workspaceId),
        eq(channelLinkCodes.provider, facts.provider),
        eq(channelLinkCodes.codeHash, hashLinkCode(digits[1])),
        isNull(channelLinkCodes.consumedAt),
        gt(channelLinkCodes.expiresAt, facts.now),
      ),
    )
    .limit(1);
  if (!code) {
    return null;
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(channelLinkCodes)
    .set({ consumedAt: facts.now, updatedAt: facts.now })
    .where(activeOnly(channelLinkCodes, eq(channelLinkCodes.id, code.id)));

  const [existing] = await tx
    .select({ id: channelIdentities.id })
    .from(channelIdentities)
    .where(
      activeOnly(
        channelIdentities,
        eq(channelIdentities.workspaceId, facts.workspaceId),
        eq(channelIdentities.provider, facts.provider),
        eq(channelIdentities.memberId, code.memberId),
      ),
    )
    .limit(1);

  const row = {
    workspaceId: facts.workspaceId,
    memberId: code.memberId,
    provider: facts.provider,
    externalId: facts.externalSenderId,
    verifiedAt: facts.now,
    updatedAt: facts.now,
  };
  if (existing) {
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .update(channelIdentities)
      .set(row)
      .where(
        activeOnly(channelIdentities, eq(channelIdentities.id, existing.id)),
      );
  } else {
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx.insert(channelIdentities).values(row);
  }
  return code.memberId;
}

/**
 * §6 steps three to six, in that order.
 *
 * The order is not decorative. Deduplication comes before identity resolution
 * so a retry of a message from an unlinked sender costs one indexed read rather
 * than four. Identity comes before the rate limit so an unknown sender cannot
 * consume a known member's budget.
 */
export async function resolveInbound(
  tx: WorkspaceTx,
  facts: InboundRequestFacts,
): Promise<InboundOutcome> {
  // Step 3.
  const fresh = await recordInbound(tx, facts, null);
  if (!fresh) {
    return { kind: "duplicate" };
  }

  // Step 4, with the linking flow in front of it: somebody proving their
  // account is by definition not yet resolvable.
  const linked = await consumeLinkCode(tx, facts);
  if (linked) {
    return { kind: "linked", memberId: linked };
  }

  const [identity] = await tx
    .select({
      memberId: channelIdentities.memberId,
      verifiedAt: channelIdentities.verifiedAt,
    })
    .from(channelIdentities)
    .where(
      activeOnly(
        channelIdentities,
        eq(channelIdentities.workspaceId, facts.workspaceId),
        eq(channelIdentities.provider, facts.provider),
        // By the provider's own id, never by a handle: a handle is changeable,
        // reusable and sometimes shared.
        eq(channelIdentities.externalId, facts.externalSenderId),
      ),
    )
    .limit(1);
  if (!identity) {
    return { kind: "ignored", reason: "no identity for this sender" };
  }
  // A row that exists and was never verified is somebody's claim, and gets the
  // same silence as no row at all. Checked here rather than in the query so
  // the two cases can be told apart in a log without a second read.
  if (!identity.verifiedAt) {
    return { kind: "ignored", reason: "this identity was never verified" };
  }

  // Step 5.
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, facts.workspaceId),
        eq(workspaceMembers.id, identity.memberId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    return { kind: "ignored", reason: "this member is not active" };
  }

  // Step 6. Only now, when the sender is somebody the product knows.
  if (facts.withinRateLimit) {
    const allowed = await facts.withinRateLimit(
      `inbound:${facts.provider}:${member.id}`,
    );
    if (!allowed) {
      return { kind: "rate_limited" };
    }
  }

  // The row was written before the sender was known, which is what step three
  // needs. Now that they are, the log says who it was.
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(channelMessages)
    .set({ memberId: member.id, updatedAt: facts.now })
    .where(
      activeOnly(
        channelMessages,
        eq(channelMessages.workspaceId, facts.workspaceId),
        eq(
          channelMessages.idempotencyKey,
          `inbound:${facts.provider}:${facts.deliveryId}`,
        ),
      ),
    );

  return { kind: "accepted", memberId: member.id };
}

/**
 * The whole inbound decision, from a pool (P5-T02a).
 *
 * The endpoint handler cannot open a transaction of its own: TECHNICAL-PLAN §1
 * keeps `apps/web` out of the database, and importing drizzle there is exactly
 * the thing the boundary gate refuses. So the tenant setting and the four
 * checks are one call, the same arrangement `memberEmail` and `openConnection`
 * already have.
 */
export async function handleInbound(
  pool: Pool,
  facts: InboundRequestFacts,
): Promise<InboundOutcome> {
  const db = drizzle(pool);
  return withWorkspace(db, facts.workspaceId, (tx) =>
    resolveInbound(tx, facts),
  );
}

/**
 * Which workspace installed this provider team, or null.
 *
 * **The one read in this product that runs before a tenant is known, and it
 * has to.** An inbound webhook has not identified a workspace yet: finding out
 * which one it is *is* the question.
 *
 * The first version of this asked `channel_connections`, through the ordinary
 * application role, with no tenant setting. Forced row-level security answered
 * with nothing, every time, so the endpoint could never have resolved a
 * workspace and no inbound message could ever have been accepted. A test caught
 * it before it shipped.
 *
 * What replaced it keeps the tenant floor rather than lifting it:
 * `channel_installations` admits a row through `app.workspace_id` *or* through
 * `app.channel_team_id` matching its own `external_team_id`, which is the same
 * arrangement `app.user_id` has on `workspace_members` for the "which
 * workspaces are mine" lookup. The caller can reach exactly the row for a team
 * id they already hold.
 *
 * A team nobody installed answers null, and the endpoint gives that the same
 * silence as everything else.
 */
export async function workspaceForProviderTeam(
  pool: Pool,
  input: {
    readonly provider: ChannelConnectionKey;
    /** The provider's own workspace or tenant identifier. */
    readonly teamId: string;
  },
): Promise<string | null> {
  const db = drizzle(pool);
  const [row] = await withProviderTeam(db, input.teamId, (tx) =>
    tx
      .select({ workspaceId: channelInstallations.workspaceId })
      .from(channelInstallations)
      .where(
        and(
          eq(channelInstallations.provider, input.provider),
          eq(channelInstallations.externalTeamId, input.teamId),
        ),
      )
      .limit(1),
  );
  return row?.workspaceId ?? null;
}
