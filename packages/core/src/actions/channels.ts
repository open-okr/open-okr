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
  channelMessages,
  // The dedupe read below is the one query in this file that must see a
  // soft-deleted row: the unique index is not partial on `deleted_at`, so a
  // deleted log row still blocks the key and a scoped read would miss it and
  // then fail on the insert.
  includeDeleted,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
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
