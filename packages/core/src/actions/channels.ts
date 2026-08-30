/**
 * Channel connections, identities and the message log (AI-NATIVE-PLAN.md §5,
 * P5-T01b-a).
 *
 * What this file owns: what a channel *is*. A workspace holds one connection
 * per provider, a member holds one identity per provider, and every outbound
 * message is a row before it is a send. What it deliberately does not own is
 * what the product *decides*: which channel a nudge takes, quiet hours, and the
 * degradation ladder are P5-T01b-b, and every send here goes to email.
 *
 * **The message row is written before the send, not after it.** That order is
 * the whole point of the log: the unique key on `(workspace_id,
 * idempotency_key)` is checked inside the same transaction as the write that
 * asked for the message, so a caller that asks twice gets one row and one
 * outbox job. A log written after a successful send would record what happened
 * and prevent nothing.
 */
import {
  activeOnly,
  CHANNEL_CONNECTION_PROVIDERS,
  CHANNEL_MESSAGE_PROVIDERS,
  channelConnections,
  channelIdentities,
  channelInstallations,
  channelLinkCodes,
  channelMessages,
  // The dedupe read below is the one query in this file that must see a
  // soft-deleted row: the unique index is not partial on `deleted_at`, so a
  // deleted log row still blocks the key and a scoped read would miss it and
  // then fail on the insert.
  includeDeleted,
  withContext,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  generateLinkCode,
  hashLinkCode,
  LINK_CODE_TTL_SECONDS,
} from "../channels/inbound.ts";
import {
  listTemplates,
  recordTemplates,
  type StoredTemplate,
} from "../channels/templates.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { encryptSecret, type KeyRing } from "../secrets/key-ring.ts";
import {
  type ActionCallContext,
  defineReadAction,
  defineWriteAction,
} from "./define.ts";

/** The topic P5-T01a's dispatch table delivers a channel message under. */
export const CHANNEL_MESSAGE_TOPIC = "channel.message";

const connectionProviderSchema = z.enum(CHANNEL_CONNECTION_PROVIDERS);
const messageProviderSchema = z.enum(CHANNEL_MESSAGE_PROVIDERS);

function requireRing(context: ActionCallContext): KeyRing {
  if (!context.ring) {
    throw new Error(
      "This host built an ActionCallContext with no key ring, but reached a " +
        "channel action that needs one to seal a connection's credentials.",
    );
  }
  return context.ring;
}

/**
 * The member acting, or a refusal.
 *
 * The pipeline has already resolved this, so nothing here re-queries it. An
 * actor with no member row is an agent or an instance administrator, and
 * neither has a channel identity of their own to link.
 */
function requireMember(actor: { readonly memberId: string | null }): string {
  if (!actor.memberId) {
    throw new OperationError(
      "forbidden",
      "Only a member of this workspace has channel identities.",
    );
  }
  return actor.memberId;
}

/** The same, for a read action, which opens its own transaction. */
async function readingMember(
  tx: OperationTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string> {
  if (!userId) {
    throw new OperationError("not_found", "No such workspace.");
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError("not_found", "No such workspace.");
  }
  return member.id;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/**
 * What a connection looks like from outside.
 *
 * There is no field here that could carry key material, which is the reason
 * the shape is declared rather than selected with a spread. A column added to
 * the table later cannot leak through this action by accident.
 */
const connectionOutput = z.object({
  provider: connectionProviderSchema,
  state: z.enum(["connected", "error", "disabled"]),
  config: z.record(z.string(), z.unknown()),
  installedById: z.string().nullable(),
  lastVerifiedAt: z.string().nullable(),
  error: z.string().nullable(),
});

export const listConnections = defineReadAction({
  name: "channels.listConnections",
  summary: "Every channel provider this workspace has connected.",
  input: z.object({}),
  output: z.object({ connections: z.array(connectionOutput) }),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    return withContext(
      drizzle(context.pool),
      {
        workspaceId: context.workspaceId,
        userId: context.actor.userId ?? "",
      },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const rows = await tx
          .select({
            provider: channelConnections.provider,
            state: channelConnections.state,
            config: channelConnections.config,
            installedById: channelConnections.installedById,
            lastVerifiedAt: channelConnections.lastVerifiedAt,
            error: channelConnections.error,
          })
          .from(channelConnections)
          .where(
            activeOnly(
              channelConnections,
              eq(channelConnections.workspaceId, context.workspaceId),
            ),
          )
          .orderBy(channelConnections.provider);

        return {
          connections: rows.map((row) => ({
            provider: row.provider,
            state: row.state,
            config: (row.config ?? {}) as Record<string, unknown>,
            installedById: row.installedById,
            lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
            error: row.error,
          })),
        };
      },
    );
  },
});

export const connect = defineWriteAction({
  name: "channels.connect",
  summary: "Stores a provider's credentials and marks it connected.",
  input: z.object({
    provider: connectionProviderSchema,
    /** The provider's token or secret. Sealed here and never read back. */
    credentials: z.string().trim().min(1),
    config: z.record(z.string(), z.unknown()).optional(),
  }),
  output: connectionOutput,
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const ring = requireRing(context);
      const sealed = encryptSecret(ring, input.credentials);
      const memberId = requireMember(actor);
      const config = input.config ?? {};

      const [existing] = await tx
        .select({ id: channelConnections.id })
        .from(channelConnections)
        .where(
          activeOnly(
            channelConnections,
            eq(channelConnections.workspaceId, workspaceId),
            eq(channelConnections.provider, input.provider),
          ),
        )
        .limit(1);

      const row = {
        workspaceId,
        provider: input.provider,
        state: "connected" as const,
        ciphertext: sealed.ciphertext,
        dataKey: sealed.dataKey,
        keyId: sealed.keyId,
        config,
        installedById: memberId,
        // Not set here: connecting is storing a credential, and verifying is
        // calling the provider. A connection that says it verified because
        // somebody pasted a string is the kind of green light that costs a
        // support hour later.
        lastVerifiedAt: null,
        error: null,
        updatedAt: new Date(),
      };

      if (existing) {
        // openokr:allow-mutation: inside this operation's own transaction.
        await tx
          .update(channelConnections)
          .set(row)
          .where(
            activeOnly(
              channelConnections,
              eq(channelConnections.id, existing.id),
            ),
          );
      } else {
        // openokr:allow-mutation: same reason as the update above.
        await tx.insert(channelConnections).values(row);
      }

      // The routing row an inbound webhook needs (P5-T02a). Written here
      // rather than derived from the connection, because an inbound request
      // has no tenant setting yet and a workspace-scoped policy would answer
      // it with nothing. `channel_installations` is the one table with a
      // second key for exactly that lookup.
      const teamId =
        typeof config.teamId === "string" && config.teamId.trim() !== ""
          ? config.teamId.trim()
          : null;
      if (teamId) {
        // openokr:allow-mutation: inside this operation's own transaction.
        await tx
          .delete(channelInstallations)
          .where(
            and(
              eq(channelInstallations.workspaceId, workspaceId),
              eq(channelInstallations.provider, input.provider),
            ),
          );
        // openokr:allow-mutation: same reason as the delete above.
        await tx.insert(channelInstallations).values({
          workspaceId,
          provider: input.provider,
          externalTeamId: teamId,
        });
      }

      return {
        result: {
          provider: input.provider,
          state: "connected" as const,
          config,
          installedById: memberId,
          lastVerifiedAt: null,
          error: null,
        },
        activity: {
          kind: "channel.connected",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { provider: input.provider },
        },
        audit: {
          action: "channels.connect",
          targetType: "workspace",
          targetId: workspaceId,
          // The provider, never the credential. This row is append-only and
          // read by people.
          payload: { provider: input.provider },
        },
      };
    },
  }),
});

export const disconnect = defineWriteAction({
  name: "channels.disconnect",
  summary: "Removes a provider's connection and its stored credentials.",
  input: z.object({ provider: connectionProviderSchema }),
  output: z.object({ provider: connectionProviderSchema }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [existing] = await tx
        .select({ id: channelConnections.id })
        .from(channelConnections)
        .where(
          activeOnly(
            channelConnections,
            eq(channelConnections.workspaceId, workspaceId),
            eq(channelConnections.provider, input.provider),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new OperationError(
          "not_found",
          `${input.provider} is not connected.`,
        );
      }

      // openokr:allow-mutation: inside this operation's own transaction.
      await tx
        .update(channelConnections)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          activeOnly(
            channelConnections,
            eq(channelConnections.id, existing.id),
          ),
        );

      // Really removed, not soft-deleted: an installation is a routing fact,
      // and a tombstone would hold the unique index so the same provider
      // workspace could never be reconnected.
      // openokr:allow-mutation: inside this operation's own transaction.
      await tx
        .delete(channelInstallations)
        .where(
          and(
            eq(channelInstallations.workspaceId, workspaceId),
            eq(channelInstallations.provider, input.provider),
          ),
        );

      return {
        result: { provider: input.provider },
        activity: {
          kind: "channel.disconnected",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { provider: input.provider },
        },
        audit: {
          action: "channels.disconnect",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { provider: input.provider },
        },
      };
    },
  }),
});

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

const identityOutput = z.object({
  provider: connectionProviderSchema,
  externalId: z.string(),
  externalHandle: z.string().nullable(),
  verifiedAt: z.string().nullable(),
});

export const listIdentities = defineReadAction({
  name: "channels.listIdentities",
  summary: "The caller's own linked channel identities.",
  input: z.object({}),
  output: z.object({ identities: z.array(identityOutput) }),
  // Everybody's own identities are their own business, so this is the level
  // any member of the workspace already has rather than an administrative one.
  access: ACCESS_LEVELS.comment,
  async handler(context) {
    const userId = context.actor.userId;
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId: userId ?? "" },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const memberId = await readingMember(tx, context.workspaceId, userId);
        const rows = await tx
          .select({
            provider: channelIdentities.provider,
            externalId: channelIdentities.externalId,
            externalHandle: channelIdentities.externalHandle,
            verifiedAt: channelIdentities.verifiedAt,
          })
          .from(channelIdentities)
          .where(
            activeOnly(
              channelIdentities,
              eq(channelIdentities.workspaceId, context.workspaceId),
              eq(channelIdentities.memberId, memberId),
            ),
          )
          .orderBy(channelIdentities.provider);

        return {
          identities: rows.map((row) => ({
            provider: row.provider,
            externalId: row.externalId,
            externalHandle: row.externalHandle,
            verifiedAt: row.verifiedAt?.toISOString() ?? null,
          })),
        };
      },
    );
  },
});

export const linkIdentity = defineWriteAction({
  name: "channels.linkIdentity",
  summary: "Links the caller's own account on a provider.",
  input: z.object({
    provider: connectionProviderSchema,
    externalId: z.string().trim().min(1),
    externalHandle: z.string().trim().min(1).optional(),
  }),
  output: identityOutput,
  access: ACCESS_LEVELS.comment,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = requireMember(actor);
      const now = new Date();

      const [existing] = await tx
        .select({ id: channelIdentities.id })
        .from(channelIdentities)
        .where(
          activeOnly(
            channelIdentities,
            eq(channelIdentities.workspaceId, workspaceId),
            eq(channelIdentities.provider, input.provider),
            eq(channelIdentities.memberId, memberId),
          ),
        )
        .limit(1);

      // Somebody else's claim on the same account. Refused rather than moved:
      // an external id that two members both claim is two people or one person
      // confusing the audit trail, and the product cannot tell which.
      const [claimed] = await tx
        .select({ memberId: channelIdentities.memberId })
        .from(channelIdentities)
        .where(
          activeOnly(
            channelIdentities,
            eq(channelIdentities.workspaceId, workspaceId),
            eq(channelIdentities.provider, input.provider),
            eq(channelIdentities.externalId, input.externalId),
          ),
        )
        .limit(1);
      if (claimed && claimed.memberId !== memberId) {
        throw new OperationError(
          "forbidden",
          `That ${input.provider} account is already linked to another member.`,
        );
      }

      const row = {
        workspaceId,
        memberId,
        provider: input.provider,
        externalId: input.externalId,
        externalHandle: input.externalHandle ?? null,
        // Linked by the member themselves, in their own session, so the
        // product already knows who they are. The short-code flow in the
        // design document is for the other direction: proving an account the
        // member names from inside the provider (P5-T02 onwards).
        verifiedAt: now,
        updatedAt: now,
      };

      if (existing) {
        // openokr:allow-mutation: inside this operation's own transaction.
        await tx
          .update(channelIdentities)
          .set(row)
          .where(
            activeOnly(
              channelIdentities,
              eq(channelIdentities.id, existing.id),
            ),
          );
      } else {
        // openokr:allow-mutation: same reason as the update above.
        await tx.insert(channelIdentities).values(row);
      }

      return {
        result: {
          provider: input.provider,
          externalId: input.externalId,
          externalHandle: input.externalHandle ?? null,
          verifiedAt: now.toISOString(),
        },
        activity: {
          kind: "channel.identity_linked",
          subjectType: "member",
          subjectId: memberId,
          payload: { provider: input.provider },
        },
        audit: {
          action: "channels.linkIdentity",
          targetType: "member",
          targetId: memberId,
          payload: { provider: input.provider },
        },
      };
    },
  }),
});

export const unlinkIdentity = defineWriteAction({
  name: "channels.unlinkIdentity",
  summary: "Unlinks the caller's own account on a provider.",
  input: z.object({ provider: connectionProviderSchema }),
  output: z.object({ provider: connectionProviderSchema }),
  access: ACCESS_LEVELS.comment,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = requireMember(actor);
      const [existing] = await tx
        .select({ id: channelIdentities.id })
        .from(channelIdentities)
        .where(
          activeOnly(
            channelIdentities,
            eq(channelIdentities.workspaceId, workspaceId),
            eq(channelIdentities.provider, input.provider),
            eq(channelIdentities.memberId, memberId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new OperationError(
          "not_found",
          `You have no ${input.provider} account linked.`,
        );
      }

      // openokr:allow-mutation: inside this operation's own transaction.
      await tx
        .update(channelIdentities)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          activeOnly(channelIdentities, eq(channelIdentities.id, existing.id)),
        );

      return {
        result: { provider: input.provider },
        activity: {
          kind: "channel.identity_unlinked",
          subjectType: "member",
          subjectId: memberId,
          payload: { provider: input.provider },
        },
        audit: {
          action: "channels.unlinkIdentity",
          targetType: "member",
          targetId: memberId,
          payload: { provider: input.provider },
        },
      };
    },
  }),
});

/**
 * A short code the member sends to the bot to prove their account (§5.5,
 * P5-T02a).
 *
 * **The code is returned once and never stored in the clear.** The row holds
 * its hash, so this response is the only place it exists. A member who loses it
 * asks for another, which replaces the first: pressing the button twice means
 * "the last one, please", not "two live ways to become me".
 *
 * The provider's own authorise link is the other half of §5.5 and belongs to
 * the install flow. This is the half that works for every provider, including
 * the two that have no OAuth for a person.
 */
export const startLink = defineWriteAction({
  name: "channels.startLink",
  summary: "Issues a short code for linking the caller's own account.",
  input: z.object({ provider: connectionProviderSchema }),
  output: z.object({
    /** Shown once. Never readable again. */
    code: z.string(),
    expiresAt: z.string(),
    provider: connectionProviderSchema,
  }),
  access: ACCESS_LEVELS.comment,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = requireMember(actor);
      const now = new Date();
      const code = generateLinkCode();
      const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_SECONDS * 1000);

      // Any code this member already had for this provider stops working. The
      // partial unique index would refuse a second live row anyway; consuming
      // rather than deleting keeps "that code was replaced" answerable.
      // openokr:allow-mutation: inside this operation's own transaction.
      await tx
        .update(channelLinkCodes)
        .set({ consumedAt: now, updatedAt: now })
        .where(
          activeOnly(
            channelLinkCodes,
            eq(channelLinkCodes.workspaceId, workspaceId),
            eq(channelLinkCodes.memberId, memberId),
            eq(channelLinkCodes.provider, input.provider),
            isNull(channelLinkCodes.consumedAt),
          ),
        );

      // openokr:allow-mutation: inside this operation's own transaction.
      await tx.insert(channelLinkCodes).values({
        workspaceId,
        memberId,
        provider: input.provider,
        codeHash: hashLinkCode(code),
        expiresAt,
      });

      return {
        result: {
          code,
          expiresAt: expiresAt.toISOString(),
          provider: input.provider,
        },
        activity: {
          kind: "channel.link_started",
          subjectType: "member",
          subjectId: memberId,
          payload: { provider: input.provider },
        },
        audit: {
          action: "channels.startLink",
          targetType: "member",
          targetId: memberId,
          // The provider, never the code. An audit row is read by people.
          payload: { provider: input.provider },
        },
      };
    },
  }),
});

// ---------------------------------------------------------------------------
// The message log
// ---------------------------------------------------------------------------

const buttonSchema = z.object({
  label: z.string().trim().min(1),
  url: z.string().url(),
});

export const send = defineWriteAction({
  name: "channels.send",
  summary: "Queues one message to a member, at most once per key.",
  input: z.object({
    memberId: z.string().uuid(),
    text: z.string().trim().min(1),
    subject: z.string().trim().min(1).optional(),
    buttons: z.array(buttonSchema).max(5).optional(),
    /**
     * What makes this safe to ask for twice. Callers build it from what the
     * message is about, not from the clock: `checkin.due:<goalId>:<date>`
     * asked for twice is one message, `...:<Date.now()>` is two.
     */
    idempotencyKey: z.string().trim().min(1).max(200),
  }),
  output: z.object({
    /** False when this key had already been queued. */
    queued: z.boolean(),
    provider: messageProviderSchema,
  }),
  // Sending on behalf of the workspace, not on behalf of yourself. The routing
  // layer (P5-T01b-b) calls this from the nudge engine with the workspace's
  // own authority; a member with `comment` should not be able to email
  // everybody.
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [member] = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.id, input.memberId),
          ),
        )
        .limit(1);
      if (!member) {
        throw new OperationError("not_found", "No such member.");
      }

      // Email until P5-T01b-b builds the routing. Stated here rather than
      // hidden in a default, because a message log whose provider column is
      // always the same value is a fact about this task and not about the
      // product.
      const provider = "email" as const;

      const [existing] = await tx
        .select({ id: channelMessages.id })
        .from(channelMessages)
        .where(
          includeDeleted(
            channelMessages,
            eq(channelMessages.workspaceId, workspaceId),
            eq(channelMessages.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (existing) {
        // No new row, no outbox job, no send. A caller asking twice is the
        // ordinary case this is built for, not an error. The activity still
        // records the attempt, because "the nudge engine asked again" is worth
        // seeing when somebody is working out why a member received nothing.
        return {
          result: { queued: false, provider },
          activity: {
            kind: "channel.message_queued",
            subjectType: "member",
            subjectId: input.memberId,
            payload: { provider, duplicate: true },
          },
          audit: {
            action: "channels.send",
            targetType: "member",
            targetId: input.memberId,
            payload: { provider, duplicate: true },
          },
        };
      }

      // openokr:allow-mutation: inside this operation's own transaction.
      const [row] = await tx
        .insert(channelMessages)
        .values({
          workspaceId,
          provider,
          direction: "out" as const,
          memberId: input.memberId,
          payload: {
            text: input.text,
            ...(input.subject ? { subject: input.subject } : {}),
            ...(input.buttons ? { buttons: input.buttons } : {}),
          },
          idempotencyKey: input.idempotencyKey,
          status: "queued" as const,
        })
        .returning({ id: channelMessages.id });

      if (!row) {
        throw new OperationError(
          "not_found",
          "The message could not be queued.",
        );
      }

      return {
        result: { queued: true, provider },
        activity: {
          kind: "channel.message_queued",
          subjectType: "member",
          subjectId: input.memberId,
          payload: { provider, duplicate: false },
        },
        audit: {
          action: "channels.send",
          targetType: "member",
          targetId: input.memberId,
          // The provider and the recipient, never the body. An audit row is
          // read by people entitled to know a message was sent, not
          // necessarily to read it.
          payload: { provider },
        },
        outbox: [
          {
            topic: CHANNEL_MESSAGE_TOPIC,
            // The identifier only. The body is on the row, which the handler
            // reads under the workspace's own tenant setting, so a payload
            // sitting in the outbox table never carries a member's message.
            payload: { workspaceId, messageId: row.id },
            idempotencyKey: `${CHANNEL_MESSAGE_TOPIC}:${row.id}`,
          },
        ],
      };
    },
  }),
});

export const listMessages = defineReadAction({
  name: "channels.listMessages",
  summary: "The recent outbound message log, newest first.",
  input: z.object({ limit: z.number().int().min(1).max(100).optional() }),
  output: z.object({
    messages: z.array(
      z.object({
        provider: messageProviderSchema,
        memberId: z.string().nullable(),
        status: z.enum(["queued", "sent", "failed", "suppressed"]),
        error: z.string().nullable(),
        sentAt: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.full,
  async handler(context, input) {
    return withContext(
      drizzle(context.pool),
      {
        workspaceId: context.workspaceId,
        userId: context.actor.userId ?? "",
      },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const rows = await tx
          .select({
            provider: channelMessages.provider,
            memberId: channelMessages.memberId,
            status: channelMessages.status,
            error: channelMessages.error,
            sentAt: channelMessages.sentAt,
            createdAt: channelMessages.createdAt,
          })
          .from(channelMessages)
          .where(
            activeOnly(
              channelMessages,
              eq(channelMessages.workspaceId, context.workspaceId),
              eq(channelMessages.direction, "out"),
            ),
          )
          .orderBy(desc(channelMessages.createdAt))
          .limit(input.limit ?? 20);

        return {
          messages: rows.map((row) => ({
            provider: row.provider,
            memberId: row.memberId,
            status: row.status,
            error: row.error,
            sentAt: row.sentAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
          })),
        };
      },
    );
  },
});

/**
 * Everything one member needs to decide where the product reaches them
 * (P5-T02c).
 *
 * One read for one screen. The alternative was four calls the page would have
 * to assemble, and a member's own channel settings are one question: where do
 * messages go, when am I asleep, and which accounts have I proved.
 */
export const mySettings = defineReadAction({
  name: "channels.mySettings",
  summary: "The caller's own primary channel, quiet hours and linked accounts.",
  input: z.object({}),
  output: z.object({
    primaryChannel: z.enum(["app", ...CHANNEL_MESSAGE_PROVIDERS]),
    quietHours: z.object({ start: z.string(), end: z.string() }).nullable(),
    timezone: z.string(),
    identities: z.array(identityOutput),
    /** Providers the workspace has connected, so the page offers only those. */
    connected: z.array(connectionProviderSchema),
  }),
  access: ACCESS_LEVELS.comment,
  async handler(context) {
    const userId = context.actor.userId;
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId: userId ?? "" },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const workspaceId = context.workspaceId;
        const memberId = await readingMember(tx, workspaceId, userId);

        const [member] = await tx
          .select({
            primaryChannel: workspaceMembers.primaryChannel,
            quietHours: workspaceMembers.quietHours,
            timezone: workspaceMembers.timezone,
          })
          .from(workspaceMembers)
          .where(
            activeOnly(workspaceMembers, eq(workspaceMembers.id, memberId)),
          )
          .limit(1);

        const identities = await tx
          .select({
            provider: channelIdentities.provider,
            externalId: channelIdentities.externalId,
            externalHandle: channelIdentities.externalHandle,
            verifiedAt: channelIdentities.verifiedAt,
          })
          .from(channelIdentities)
          .where(
            activeOnly(
              channelIdentities,
              eq(channelIdentities.workspaceId, workspaceId),
              eq(channelIdentities.memberId, memberId),
            ),
          )
          .orderBy(channelIdentities.provider);

        const connections = await tx
          .select({ provider: channelConnections.provider })
          .from(channelConnections)
          .where(
            activeOnly(
              channelConnections,
              eq(channelConnections.workspaceId, workspaceId),
              eq(channelConnections.state, "connected"),
            ),
          );

        return {
          primaryChannel: (member?.primaryChannel ?? "email") as
            | "app"
            | (typeof CHANNEL_MESSAGE_PROVIDERS)[number],
          quietHours: member?.quietHours ?? null,
          timezone: member?.timezone ?? "UTC",
          identities: identities.map((row) => ({
            provider: row.provider,
            externalId: row.externalId,
            externalHandle: row.externalHandle,
            verifiedAt: row.verifiedAt?.toISOString() ?? null,
          })),
          connected: connections.map((row) => row.provider),
        };
      },
    );
  },
});

/**
 * Sends one message to the caller, to prove a connection works (P5-T02c).
 *
 * **Through the ordinary queue, not around it.** A test that called the driver
 * directly would prove the credential and nothing else: not the routing, not
 * the identity resolution, not the log. This writes the same row a nudge writes
 * and the relay delivers it the same way, so a test that arrives means a nudge
 * will arrive.
 *
 * The idempotency key carries a stamp the caller supplies, because pressing
 * the button twice is somebody deliberately asking twice.
 */
export const testSend = defineWriteAction({
  name: "channels.testSend",
  summary: "Queues a test message to the caller through the normal path.",
  input: z.object({
    /** Distinguishes one press from the next. Supplied, never read from a clock. */
    attempt: z.string().trim().min(1).max(60),
  }),
  output: z.object({ queued: z.boolean(), provider: messageProviderSchema }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = requireMember(actor);
      const provider = "email" as const;

      // openokr:allow-mutation: inside this operation's own transaction.
      const [row] = await tx
        .insert(channelMessages)
        .values({
          workspaceId,
          provider,
          direction: "out" as const,
          memberId,
          payload: {
            text: "This is a test from OpenOKR. Your channel works.",
            subject: "OpenOKR test message",
          },
          idempotencyKey: `channel.test:${memberId}:${input.attempt}`,
          status: "queued" as const,
        })
        .returning({ id: channelMessages.id });

      if (!row) {
        throw new OperationError(
          "not_found",
          "The test message could not be queued.",
        );
      }

      return {
        result: { queued: true, provider },
        activity: {
          kind: "channel.message_queued",
          subjectType: "member",
          subjectId: memberId,
          payload: { provider, duplicate: false },
        },
        audit: {
          action: "channels.testSend",
          targetType: "member",
          targetId: memberId,
          payload: { provider },
        },
        outbox: [
          {
            topic: CHANNEL_MESSAGE_TOPIC,
            payload: { workspaceId, messageId: row.id },
            idempotencyKey: `${CHANNEL_MESSAGE_TOPIC}:${row.id}`,
          },
        ],
      };
    },
  }),
});

/** One template, as the settings screen shows it. */
const templateOutput = z.object({
  id: z.uuid(),
  metaId: z.string(),
  name: z.string(),
  language: z.string(),
  status: z.string(),
  category: z.string().nullable(),
  bodyText: z.string().nullable(),
  variables: z.number().int(),
  syncedAt: z.string(),
});

/**
 * The templates this workspace has at Meta (P5-T04b-a).
 *
 * Every one of them, including the ones Meta has not approved: an administrator
 * looking at this wants to know that the template they submitted is pending
 * rather than that it does not exist.
 */
export const readTemplates = defineReadAction({
  name: "channels.templates",
  summary: "The WhatsApp templates this workspace has at Meta.",
  input: z.object({}),
  output: z.object({ templates: z.array(templateOutput) }),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => ({
      templates: [
        ...((await listTemplates(tx, context.workspaceId)) as StoredTemplate[]),
      ],
    }));
  },
});

/**
 * Records what a sync found (P5-T04b-a).
 *
 * **The fetch is not here, and that is the architecture rather than an
 * oversight.** `packages/core` may not import a vendor SDK or call a provider,
 * so the settings screen asks the driver for the list and hands it to this,
 * which is the same division the relay already uses. What this owns is the
 * write: one Operation, so a half-recorded list cannot leave a workspace
 * offering templates that no longer exist beside ones that do.
 *
 * **It replaces rather than merges.** Nothing here is authored in this product,
 * so there is no local edit for a sync to overwrite. A template Meta no longer
 * lists is marked withdrawn and stops being offered.
 */
export const syncTemplates = defineWriteAction({
  name: "channels.syncTemplates",
  summary: "Records the WhatsApp templates a sync read from Meta.",
  input: z.object({
    templates: z.array(
      z.object({
        metaId: z.string().min(1),
        name: z.string().min(1),
        language: z.string().min(1),
        status: z.string().min(1),
        category: z.string().nullable().optional(),
        bodyText: z.string().nullable().optional(),
        variables: z.number().int().min(0).max(50),
      }),
    ),
  }),
  output: z.object({
    recorded: z.number().int(),
    withdrawn: z.number().int(),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const now = new Date();
      const outcome = await recordTemplates(tx, {
        workspaceId,
        templates: input.templates,
        now,
      });

      return {
        result: outcome,
        activity: {
          kind: "channel.templatesSynced",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: {
            recorded: outcome.recorded,
            withdrawn: outcome.withdrawn,
          },
        },
        audit: {
          action: "channels.syncTemplates",
          targetType: "workspace",
          targetId: workspaceId,
          payload: {
            recorded: outcome.recorded,
            withdrawn: outcome.withdrawn,
          },
        },
      };
    },
  }),
});
