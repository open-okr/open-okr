/**
 * Outbound webhooks: the eight registry actions (docs/design/outbound-webhooks.md
 * W11 and W12, plan 0.7.0 D5, approved by Akmal on 10 November 2026).
 *
 * **An administrator's, at `full`**, the level the admin screens and the
 * channel connections ask for: a hook sends workspace events out, as a bot
 * token does.
 *
 * **None of them is an agent tool** (W12, Q3). An agent that could create a
 * hook could build its own way out of the workspace, and raising an agent's
 * reach is a decision for a person, not a side effect of this. REST and the
 * command line have all eight.
 *
 * **The secret is shown once** (W5, W6): in what `webhooks.create` and
 * `webhooks.rotateSecret` return, and nowhere else. It is sealed before it is
 * stored, and no read here selects a sealed column. The audit rows name the
 * hook and the address's host, never the address, which can carry a
 * receiver's own token, and never the secret.
 */
import {
  activeOnly,
  includeDeleted,
  spaces,
  WEBHOOK_DELIVERY_OUTCOMES,
  WEBHOOK_OFF_REASONS,
  webhookDeliveries,
  webhooks,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { encryptSecret, type KeyRing } from "../secrets/key-ring.ts";
import { allowsPrivateWebhookTargets } from "../tenancy/settings.ts";
import {
  type DeliveredEvent,
  PING_EVENT,
  WEBHOOK_EVENTS,
} from "../webhooks/events.ts";
import {
  DELIVERY_LOG_DAYS,
  newEventId,
  PREVIOUS_SECRET_HOURS,
  webhookDeliveryMessage,
} from "../webhooks/jobs.ts";
import { newWebhookSecret } from "../webhooks/signature.ts";
import {
  type ActionCallContext,
  defineReadAction,
  defineWriteAction,
} from "./define.ts";

const DELIVERY_PAGE = 50;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

const eventSchema = z.enum(WEBHOOK_EVENTS);

/**
 * One hook from outside. Declared rather than selected with a spread, so a
 * sealed column added later cannot leak through a read by accident.
 */
const webhookOutput = z.object({
  id: z.uuid(),
  name: z.string(),
  url: z.string(),
  /** The address's host, which is what a list shows. */
  host: z.string(),
  events: z.array(eventSchema),
  spaceId: z.uuid().nullable(),
  spaceName: z.string().nullable(),
  owner: z.object({
    id: z.uuid(),
    name: z.string(),
    /** False when the owner is suspended or removed, which pauses the hook. */
    active: z.boolean(),
  }),
  /** On, paused by its owner's suspension, or off. */
  state: z.enum(["on", "paused", "off"]),
  offReason: z.enum(WEBHOOK_OFF_REASONS).nullable(),
  turnedOffAt: z.string().nullable(),
  /** False for a hook an archive brought, until its secret is rotated (W14). */
  hasSecret: z.boolean(),
  /** Until when the previous secret signs beside the new one. */
  previousSecretUntil: z.string().nullable(),
  consecutiveFailures: z.number().int(),
  lastDelivery: z
    .object({
      outcome: z.enum(WEBHOOK_DELIVERY_OUTCOMES),
      statusCode: z.number().int().nullable(),
      at: z.string(),
    })
    .nullable(),
  createdAt: z.string(),
});

type WebhookOutput = z.infer<typeof webhookOutput>;

const nameSchema = z.string().trim().min(1).max(80);
const urlSchema = z.string().trim().min(1).max(2000);
const eventsSchema = z
  .array(eventSchema)
  .min(1, "Choose at least one event.")
  .max(WEBHOOK_EVENTS.length);

function requireRing(context: ActionCallContext): KeyRing {
  if (!context.ring) {
    throw new Error(
      "This host built an ActionCallContext with no key ring, but reached a " +
        "webhook action that needs one to seal a signing secret.",
    );
  }
  return context.ring;
}

function requireMember(actor: { readonly memberId: string | null }): string {
  if (!actor.memberId) {
    throw new OperationError(
      "forbidden",
      "A webhook belongs to a member of this workspace, whose access each delivery reads with.",
    );
  }
  return actor.memberId;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

/**
 * Refuses an address the outbound guard would refuse, under the field it was
 * typed in (W7). HTTPS only, unless this instance lets hooks reach its own
 * network, where an intranet receiver may speak plain http (Q1).
 */
async function requireTarget(
  context: ActionCallContext,
  url: string,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OperationError(
      "forbidden",
      "That is not a web address.",
      undefined,
      "url",
    );
  }
  const allowPrivate = await allowsPrivateWebhookTargets(context.pool);
  if (
    parsed.protocol !== "https:" &&
    !(allowPrivate && parsed.protocol === "http:")
  ) {
    throw new OperationError(
      "forbidden",
      "A webhook address has to start with https://.",
      undefined,
      "url",
    );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new OperationError(
      "forbidden",
      "Leave the user name and password out of the address. The signature is what proves a delivery came from here.",
      undefined,
      "url",
    );
  }
  if (!context.checkOutboundUrl) {
    throw new Error(
      "This host built an ActionCallContext with no outbound check, but reached a " +
        "webhook action that stores an address this server will send to.",
    );
  }
  const checked = await context.checkOutboundUrl(url, { allowPrivate });
  if (!checked.ok) {
    throw new OperationError("forbidden", checked.detail, undefined, "url");
  }
}

async function requireSpace(
  tx: OperationTx,
  workspaceId: string,
  spaceId: string,
): Promise<void> {
  const [space] = await tx
    .select({ id: spaces.id })
    // openokr:allow-raw-read: an administrator at `full` naming the space a hook is limited to; whether it exists, and nothing of it is returned.
    .from(spaces)
    .where(
      activeOnly(
        spaces,
        eq(spaces.workspaceId, workspaceId),
        eq(spaces.id, spaceId),
      ),
    )
    .limit(1);
  if (!space) {
    throw new OperationError(
      "not_found",
      "No such space.",
      undefined,
      "spaceId",
    );
  }
}

/** The hook's own row, with the facts the actions decide on. */
async function loadHook(tx: OperationTx, workspaceId: string, id: string) {
  const [hook] = await tx
    .select({
      id: webhooks.id,
      name: webhooks.name,
      url: webhooks.url,
      enabled: webhooks.enabled,
      ownerMemberId: webhooks.ownerMemberId,
      hasSecret: webhooks.secretCiphertext,
    })
    .from(webhooks)
    .where(
      activeOnly(
        webhooks,
        eq(webhooks.workspaceId, workspaceId),
        eq(webhooks.id, id),
      ),
    )
    .limit(1);
  if (!hook) {
    throw new OperationError("not_found", "No such webhook.");
  }
  return { ...hook, hasSecret: hook.hasSecret !== null };
}

/** Every listed hook in its outside shape, newest first. */
async function readHooks(
  tx: OperationTx,
  workspaceId: string,
  only?: string,
): Promise<WebhookOutput[]> {
  const rows = await tx
    .select({
      id: webhooks.id,
      name: webhooks.name,
      url: webhooks.url,
      events: webhooks.events,
      spaceId: webhooks.spaceId,
      ownerMemberId: webhooks.ownerMemberId,
      enabled: webhooks.enabled,
      offReason: webhooks.offReason,
      turnedOffAt: webhooks.turnedOffAt,
      secretKeyId: webhooks.secretKeyId,
      previousSecretExpiresAt: webhooks.previousSecretExpiresAt,
      consecutiveFailures: webhooks.consecutiveFailures,
      createdAt: webhooks.createdAt,
    })
    .from(webhooks)
    .where(
      activeOnly(
        webhooks,
        eq(webhooks.workspaceId, workspaceId),
        only ? eq(webhooks.id, only) : undefined,
      ),
    )
    .orderBy(desc(webhooks.createdAt));
  if (rows.length === 0) {
    return [];
  }

  const memberIds = [...new Set(rows.map((row) => row.ownerMemberId))];
  const owners = await tx
    .select({
      id: workspaceMembers.id,
      name: workspaceMembers.name,
      status: workspaceMembers.status,
      deletedAt: workspaceMembers.deletedAt,
    })
    .from(workspaceMembers)
    // Removed members included on purpose: a hook whose owner was removed is
    // paused, and the list has to say whose it was.
    .where(
      includeDeleted(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.id, memberIds),
      ),
    );
  const ownerById = new Map(owners.map((owner) => [owner.id, owner]));

  const spaceIds = [
    ...new Set(rows.flatMap((row) => (row.spaceId ? [row.spaceId] : []))),
  ];
  const spaceNames = new Map(
    spaceIds.length === 0
      ? []
      : (
          await tx
            .select({ id: spaces.id, name: spaces.name })
            // openokr:allow-raw-read: the name of the space a hook is limited to, on a list only an administrator at `full` reads.
            .from(spaces)
            // An archived space still names the hook limited to it.
            .where(
              includeDeleted(
                spaces,
                eq(spaces.workspaceId, workspaceId),
                inArray(spaces.id, spaceIds),
              ),
            )
        ).map((space) => [space.id, space.name] as const),
  );

  const now = Date.now();
  const result: WebhookOutput[] = [];
  for (const row of rows) {
    const [last] = await tx
      .select({
        outcome: webhookDeliveries.outcome,
        statusCode: webhookDeliveries.statusCode,
        at: webhookDeliveries.attemptedAt,
      })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.workspaceId, workspaceId),
          eq(webhookDeliveries.webhookId, row.id),
        ),
      )
      .orderBy(desc(webhookDeliveries.attemptedAt))
      .limit(1);
    const owner = ownerById.get(row.ownerMemberId);
    const ownerActive =
      owner !== undefined &&
      owner.status === "active" &&
      owner.deletedAt === null;
    const previousUntil =
      row.previousSecretExpiresAt && row.previousSecretExpiresAt.getTime() > now
        ? row.previousSecretExpiresAt.toISOString()
        : null;
    result.push({
      id: row.id,
      name: row.name,
      url: row.url,
      host: hostOf(row.url),
      events: row.events.filter(
        (event): event is (typeof WEBHOOK_EVENTS)[number] =>
          (WEBHOOK_EVENTS as readonly string[]).includes(event),
      ),
      spaceId: row.spaceId,
      spaceName: row.spaceId ? (spaceNames.get(row.spaceId) ?? null) : null,
      owner: {
        id: row.ownerMemberId,
        name: owner?.name ?? "Unknown",
        active: ownerActive,
      },
      state: !row.enabled ? "off" : ownerActive ? "on" : "paused",
      offReason: row.enabled ? null : (row.offReason ?? "manual"),
      turnedOffAt: iso(row.turnedOffAt),
      hasSecret: row.secretKeyId !== null,
      previousSecretUntil: previousUntil,
      consecutiveFailures: row.consecutiveFailures,
      lastDelivery: last
        ? {
            outcome: last.outcome,
            statusCode: last.statusCode,
            at: last.at.toISOString(),
          }
        : null,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return result;
}

/** The hook as `readHooks` shapes it, or not-found. */
async function readHook(
  tx: OperationTx,
  workspaceId: string,
  id: string,
): Promise<WebhookOutput> {
  const [hook] = await readHooks(tx, workspaceId, id);
  if (!hook) {
    throw new OperationError("not_found", "No such webhook.");
  }
  return hook;
}

export const listWebhooks = defineReadAction({
  name: "webhooks.list",
  agentSurface: false,
  summary:
    "Every webhook in this workspace: its address, events, owner and state, and how its last delivery went. Never a secret.",
  input: z.object({}),
  output: z.object({ webhooks: z.array(webhookOutput) }),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    return withWorkspace(
      drizzle(context.pool),
      context.workspaceId,
      async (tx) => ({
        webhooks: await readHooks(tx as OperationTx, context.workspaceId),
      }),
    );
  },
});

export const createWebhook = defineWriteAction({
  name: "webhooks.create",
  agentSurface: false,
  summary:
    "Adds a webhook: an HTTPS address, the events it receives and, optionally, one space it is limited to. Answers with the signing secret, once.",
  input: z.object({
    name: nameSchema,
    url: urlSchema,
    events: eventsSchema,
    spaceId: z.uuid().nullable().optional(),
  }),
  output: webhookOutput.extend({
    /** The signing secret. Shown here and never again. */
    secret: z.string(),
  }),
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = requireMember(actor);
      await requireTarget(context, input.url);
      if (input.spaceId) {
        await requireSpace(tx, workspaceId, input.spaceId);
      }
      const secret = newWebhookSecret();
      const sealed = encryptSecret(requireRing(context), secret);
      const events = [...new Set(input.events)];

      const [inserted] = await tx
        .insert(webhooks)
        .values({
          workspaceId,
          name: input.name,
          url: input.url,
          events,
          spaceId: input.spaceId ?? null,
          ownerMemberId: memberId,
          createdByMemberId: memberId,
          enabled: true,
          secretCiphertext: sealed.ciphertext,
          secretDataKey: sealed.dataKey,
          secretKeyId: sealed.keyId,
        })
        .returning({ id: webhooks.id });
      const id = (inserted as { id: string }).id;

      return {
        result: { ...(await readHook(tx, workspaceId, id)), secret },
        activity: {
          kind: "webhook.created",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { name: input.name },
        },
        audit: {
          action: "webhooks.create",
          targetType: "webhook",
          targetId: id,
          payload: {
            name: input.name,
            host: hostOf(input.url),
            events,
            spaceId: input.spaceId ?? null,
          },
        },
      };
    },
  }),
});

export const updateWebhook = defineWriteAction({
  name: "webhooks.update",
  agentSurface: false,
  summary:
    "Changes a webhook's name, address, events or space, turns it on or off, or makes the caller its owner when its owner can no longer act.",
  input: z
    .object({
      id: z.uuid(),
      name: nameSchema.optional(),
      url: urlSchema.optional(),
      events: eventsSchema.optional(),
      spaceId: z.uuid().nullable().optional(),
      enabled: z.boolean().optional(),
      /** The caller becomes the owner, whose access deliveries read with. */
      takeOwnership: z.literal(true).optional(),
    })
    .refine((value) => Object.keys(value).length > 1, {
      message: "An update has to change something.",
    }),
  output: webhookOutput,
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = requireMember(actor);
      const hook = await loadHook(tx, workspaceId, input.id);
      if (input.url !== undefined && input.url !== hook.url) {
        await requireTarget(context, input.url);
      }
      if (input.spaceId) {
        await requireSpace(tx, workspaceId, input.spaceId);
      }
      if (input.enabled === true && !hook.hasSecret) {
        throw new OperationError(
          "conflict",
          "This webhook came from a workspace archive without its secret. Rotate the secret, give the new one to the receiver, then turn it on.",
          undefined,
          "enabled",
        );
      }

      const now = new Date();
      const turning =
        input.enabled === undefined || input.enabled === hook.enabled
          ? null
          : input.enabled;
      const ownerFrom = hook.ownerMemberId;
      const ownerTo = input.takeOwnership ? memberId : ownerFrom;

      // openokr:allow-mutation: this Operation's own transaction.
      await tx
        .update(webhooks)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.url === undefined ? {} : { url: input.url }),
          ...(input.events === undefined
            ? {}
            : { events: [...new Set(input.events)] }),
          ...(input.spaceId === undefined ? {} : { spaceId: input.spaceId }),
          ...(turning === true
            ? {
                enabled: true,
                offReason: null,
                turnedOffAt: null,
                // A hook turned back on starts its count again (W9).
                consecutiveFailures: 0,
              }
            : turning === false
              ? {
                  enabled: false,
                  offReason: "manual" as const,
                  turnedOffAt: now,
                }
              : {}),
          ...(ownerTo === ownerFrom ? {} : { ownerMemberId: ownerTo }),
          updatedAt: now,
        })
        .where(activeOnly(webhooks, eq(webhooks.id, input.id)));

      const fields = Object.keys(input).filter((key) => key !== "id");
      const name = input.name ?? hook.name;
      return {
        result: await readHook(tx, workspaceId, input.id),
        activity: {
          kind: "webhook.updated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { name, fields },
        },
        audit: {
          action: "webhooks.update",
          targetType: "webhook",
          targetId: input.id,
          payload: {
            name,
            fields,
            ...(input.url === undefined ? {} : { host: hostOf(input.url) }),
            ...(turning === null ? {} : { enabled: turning }),
            // A takeover is the one change that moves whose access a
            // delivery reads with, so both members are on the row (W2).
            ...(ownerTo === ownerFrom ? {} : { ownerFrom, ownerTo }),
          },
        },
      };
    },
  }),
});

export const rotateWebhookSecret = defineWriteAction({
  name: "webhooks.rotateSecret",
  agentSurface: false,
  summary:
    "Gives a webhook a new signing secret, answered once. The old one keeps signing beside it for a day, so the receiver can change over without losing a delivery.",
  input: z.object({ id: z.uuid() }),
  output: z.object({
    id: z.uuid(),
    /** The new signing secret. Shown here and never again. */
    secret: z.string(),
    previousSecretUntil: z.string().nullable(),
  }),
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const hook = await loadHook(tx, workspaceId, input.id);
      const [current] = await tx
        .select({
          ciphertext: webhooks.secretCiphertext,
          dataKey: webhooks.secretDataKey,
          keyId: webhooks.secretKeyId,
        })
        .from(webhooks)
        .where(activeOnly(webhooks, eq(webhooks.id, input.id)))
        .limit(1);
      const secret = newWebhookSecret();
      const sealed = encryptSecret(requireRing(context), secret);
      const now = new Date();
      // The old secret moves across still sealed: it is never opened here.
      // An archive's hook has none, so nothing signs beside the new one.
      const previous =
        current?.ciphertext && current.dataKey && current.keyId
          ? {
              ciphertext: current.ciphertext,
              dataKey: current.dataKey,
              keyId: current.keyId,
              until: new Date(
                now.getTime() + PREVIOUS_SECRET_HOURS * 3_600_000,
              ),
            }
          : null;
      const previousUntil = previous?.until ?? null;

      // openokr:allow-mutation: this Operation's own transaction.
      await tx
        .update(webhooks)
        .set({
          secretCiphertext: sealed.ciphertext,
          secretDataKey: sealed.dataKey,
          secretKeyId: sealed.keyId,
          previousSecretCiphertext: previous?.ciphertext ?? null,
          previousSecretDataKey: previous?.dataKey ?? null,
          previousSecretKeyId: previous?.keyId ?? null,
          previousSecretExpiresAt: previousUntil,
          secretRotatedAt: now,
          updatedAt: now,
        })
        .where(activeOnly(webhooks, eq(webhooks.id, input.id)));

      return {
        result: {
          id: input.id,
          secret,
          previousSecretUntil: iso(previousUntil),
        },
        activity: {
          kind: "webhook.secret_rotated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { name: hook.name },
        },
        audit: {
          action: "webhooks.rotateSecret",
          targetType: "webhook",
          targetId: input.id,
          payload: { name: hook.name, overlap: previousUntil !== null },
        },
      };
    },
  }),
});

export const removeWebhook = defineWriteAction({
  name: "webhooks.remove",
  agentSurface: false,
  summary:
    "Removes a webhook. Nothing more is sent to it, including deliveries already waiting.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  safety: "destructive",
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const hook = await loadHook(tx, workspaceId, input.id);
      const now = new Date();
      // openokr:allow-mutation: this Operation's own transaction.
      await tx
        .update(webhooks)
        .set({ deletedAt: now, updatedAt: now })
        .where(activeOnly(webhooks, eq(webhooks.id, input.id)));
      return {
        result: { id: input.id },
        activity: {
          kind: "webhook.removed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { name: hook.name },
        },
        audit: {
          action: "webhooks.remove",
          targetType: "webhook",
          targetId: input.id,
          payload: { name: hook.name, host: hostOf(hook.url) },
        },
      };
    },
  }),
});

export const testWebhook = defineWriteAction({
  name: "webhooks.test",
  agentSurface: false,
  summary:
    "Sends a signed `ping` event with an empty body to a webhook, so its receiver can be checked. The result is in its deliveries.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid(), eventId: z.string() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const hook = await loadHook(tx, workspaceId, input.id);
      if (!hook.hasSecret) {
        throw new OperationError(
          "conflict",
          "This webhook has no signing secret yet. Rotate the secret first.",
        );
      }
      const eventId = newEventId();
      return {
        result: { id: input.id, eventId },
        outbox: [
          webhookDeliveryMessage({
            workspaceId,
            webhookId: input.id,
            event: PING_EVENT,
            eventId,
            occurredAt: new Date().toISOString(),
            subjectType: null,
            subjectId: null,
            checkInId: null,
          }),
        ],
        activity: {
          kind: "webhook.tested",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { name: hook.name },
        },
        audit: {
          action: "webhooks.test",
          targetType: "webhook",
          targetId: input.id,
          payload: { name: hook.name, eventId },
        },
      };
    },
  }),
});

const deliveryOutput = z.object({
  id: z.uuid(),
  event: z.string(),
  eventId: z.string(),
  subjectType: z.string().nullable(),
  subjectId: z.uuid().nullable(),
  outcome: z.enum(WEBHOOK_DELIVERY_OUTCOMES),
  statusCode: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  attempt: z.number().int(),
  /** Why it failed, was refused or was withheld, in our words. */
  reason: z.string().nullable(),
  attemptedAt: z.string(),
});

export const listWebhookDeliveries = defineReadAction({
  name: "webhooks.deliveries",
  agentSurface: false,
  summary: `A webhook's delivery attempts from the last ${DELIVERY_LOG_DAYS} days, newest first: the event, the subject, the status, how long it took and the attempt. Never a body.`,
  input: z.object({
    id: z.uuid(),
    page: z.number().int().min(0).max(1000).optional(),
  }),
  output: z.object({
    items: z.array(deliveryOutput),
    hasMore: z.boolean(),
  }),
  access: ACCESS_LEVELS.full,
  async handler(context, input) {
    const page = input.page ?? 0;
    return withWorkspace(
      drizzle(context.pool),
      context.workspaceId,
      async (raw) => {
        const tx = raw as OperationTx;
        await loadHook(tx, context.workspaceId, input.id);
        const since = new Date(Date.now() - DELIVERY_LOG_DAYS * 86_400_000);
        const rows = await tx
          .select({
            id: webhookDeliveries.id,
            event: webhookDeliveries.event,
            eventId: webhookDeliveries.eventId,
            subjectType: webhookDeliveries.subjectType,
            subjectId: webhookDeliveries.subjectId,
            outcome: webhookDeliveries.outcome,
            statusCode: webhookDeliveries.statusCode,
            durationMs: webhookDeliveries.durationMs,
            attempt: webhookDeliveries.attempt,
            reason: webhookDeliveries.reason,
            attemptedAt: webhookDeliveries.attemptedAt,
          })
          .from(webhookDeliveries)
          .where(
            and(
              eq(webhookDeliveries.workspaceId, context.workspaceId),
              eq(webhookDeliveries.webhookId, input.id),
              gt(webhookDeliveries.attemptedAt, since),
            ),
          )
          .orderBy(
            desc(webhookDeliveries.attemptedAt),
            desc(webhookDeliveries.id),
          )
          .limit(DELIVERY_PAGE + 1)
          .offset(page * DELIVERY_PAGE);
        return {
          items: rows.slice(0, DELIVERY_PAGE).map((row) => ({
            ...row,
            attemptedAt: row.attemptedAt.toISOString(),
          })),
          hasMore: rows.length > DELIVERY_PAGE,
        };
      },
    );
  },
});

export const redeliverWebhook = defineWriteAction({
  name: "webhooks.redeliver",
  agentSurface: false,
  summary:
    "Sends a failed delivery's event again. The subject is read afresh, as the owner sees it now, and the event keeps its id.",
  input: z.object({ deliveryId: z.uuid() }),
  output: z.object({ id: z.uuid(), eventId: z.string() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [delivery] = await tx
        .select({
          webhookId: webhookDeliveries.webhookId,
          event: webhookDeliveries.event,
          eventId: webhookDeliveries.eventId,
          subjectType: webhookDeliveries.subjectType,
          subjectId: webhookDeliveries.subjectId,
          checkInId: webhookDeliveries.checkInId,
          occurredAt: webhookDeliveries.occurredAt,
          outcome: webhookDeliveries.outcome,
        })
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.workspaceId, workspaceId),
            eq(webhookDeliveries.id, input.deliveryId),
          ),
        )
        .limit(1);
      if (!delivery) {
        throw new OperationError("not_found", "No such delivery.");
      }
      const hook = await loadHook(tx, workspaceId, delivery.webhookId);
      if (delivery.outcome !== "failed" && delivery.outcome !== "refused") {
        throw new OperationError(
          "conflict",
          "Only a delivery that failed can be sent again.",
        );
      }
      if (!hook.enabled) {
        throw new OperationError(
          "conflict",
          "This webhook is off. Turn it on before sending anything again.",
        );
      }
      return {
        result: { id: delivery.webhookId, eventId: delivery.eventId },
        outbox: [
          webhookDeliveryMessage({
            workspaceId,
            webhookId: delivery.webhookId,
            event: delivery.event as DeliveredEvent,
            eventId: delivery.eventId,
            occurredAt: delivery.occurredAt.toISOString(),
            subjectType: delivery.subjectType,
            subjectId: delivery.subjectId,
            checkInId: delivery.checkInId,
          }),
        ],
        activity: {
          kind: "webhook.redelivered",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { name: hook.name, event: delivery.event },
        },
        audit: {
          action: "webhooks.redeliver",
          targetType: "webhook",
          targetId: delivery.webhookId,
          payload: {
            name: hook.name,
            event: delivery.event,
            eventId: delivery.eventId,
          },
        },
      };
    },
  }),
});
