/**
 * Delivering one webhook event (docs/design/outbound-webhooks.md W1, W4, W5,
 * W7, W9 and W10).
 *
 * The relay hands this a `webhooks.deliver` row. Everything the receiver gets
 * is built here, now, rather than when the row was written:
 *
 * 1. The hook is read. Removed, off or paused, nothing is sent and nothing is
 *    logged: the screen already says why. A test (`ping`) goes to a hook that
 *    is off, because checking a receiver before turning the hook back on is
 *    what a test is for.
 * 2. The subject is read **as the hook's owner**, through the same read the
 *    REST surface answers with (W1). One the owner cannot see is withheld and
 *    the log says so; it is never retried, because asking again does not
 *    change who may see what.
 * 3. The body is the subject's list summary in an envelope (W4), signed with
 *    the hook's secret, and the previous one for a day after a rotation (W5).
 * 4. It is posted through the outbound guard the host passes in (W7), which
 *    checks every address the name resolves to again, now. A refusal is
 *    logged and not sent.
 * 5. One row records the attempt (W10), and the hook's run of failures is
 *    counted. At fifty in a row the hook turns off, as an Operation, so the
 *    change is audited and its creator's mail rides the outbox (W9).
 *
 * **Never the body in a log**, and never what the receiver answered: the
 * status code, how long it took and a reason in our own words.
 */
import {
  activeOnly,
  checkInSnapshots,
  checkIns,
  keyResults,
  webhookDeliveries,
  webhooks,
  withWorkspace,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { eq, gte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { z } from "zod";
import { getAccessScoped } from "../access/reads.ts";
import type { ActionCallContext } from "../actions/define.ts";
import { callAction } from "../actions/registry.ts";
import { listTasks } from "../actions/tasks.ts";
import { OperationError, runOperation } from "../operations/operation.ts";
import { excerptRichText } from "../rich-text/excerpt.ts";
import type { RichTextDocument } from "../rich-text/schema.ts";
import { decryptSecret, type KeyRing } from "../secrets/key-ring.ts";
import { allowsPrivateWebhookTargets } from "../tenancy/settings.ts";
import { isDeletionEvent, PING_EVENT } from "./events.ts";
import {
  ANSWER_READ_BYTES,
  DELIVERY_TIMEOUT_MS,
  FAILURES_BEFORE_OFF,
  WEBHOOK_TURNED_OFF_TOPIC,
  type WebhookJob,
} from "./jobs.ts";
import { webhookHeaders } from "./signature.ts";

/**
 * Posts one signed body through the outbound guard. The host passes it,
 * because the guard lives in `packages/adapters` and this package may not
 * import it. A refusal is the guard's, before anything was sent.
 */
export type WebhookPost = (
  url: string,
  request: {
    readonly body: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly allowPrivate: boolean;
    readonly timeoutMs: number;
    readonly maxBytes: number;
  },
) => Promise<
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly refusal: string; readonly detail: string }
>;

/** What one attempt came to, for the outbox handler to act on. */
export type DeliveryResult =
  | { readonly kind: "delivered" }
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "withheld" }
  | { readonly kind: "refused"; readonly reason: string }
  | {
      readonly kind: "failed";
      readonly reason: string;
      /** False once the hook has turned off, when trying again is pointless. */
      readonly retry: boolean;
    };

/** The guard's refusals that mean the address itself is not allowed. */
const ADDRESS_REFUSALS: ReadonlySet<string> = new Set([
  "not_a_url",
  "scheme_not_allowed",
  "host_not_allowed",
  "address_not_allowed",
]);

const reasonFor = (refusal: string): string => {
  if (refusal === "timed_out") {
    return `The receiver did not answer within ${DELIVERY_TIMEOUT_MS / 1000} seconds.`;
  }
  if (refusal === "redirected") {
    return "The receiver answered with a redirect, and redirects are not followed.";
  }
  return "The receiver could not be reached.";
};

/** At most 300 characters, as the column holds. */
const clip = (text: string): string =>
  text.length <= 300 ? text : `${text.slice(0, 299)}…`;

interface LoadedHook {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly ownerMemberId: string;
  readonly ownerUserId: string | null;
  readonly ownerActive: boolean;
  readonly secrets: readonly string[];
  readonly workspaceSlug: string;
}

async function loadHook(
  pool: Pool,
  ring: KeyRing,
  job: WebhookJob,
  now: Date,
): Promise<LoadedHook | null> {
  return withWorkspace(drizzle(pool), job.workspaceId, async (tx) => {
    const [row] = await tx
      .select({
        id: webhooks.id,
        name: webhooks.name,
        url: webhooks.url,
        enabled: webhooks.enabled,
        ownerMemberId: webhooks.ownerMemberId,
        ciphertext: webhooks.secretCiphertext,
        dataKey: webhooks.secretDataKey,
        keyId: webhooks.secretKeyId,
        previousCiphertext: webhooks.previousSecretCiphertext,
        previousDataKey: webhooks.previousSecretDataKey,
        previousKeyId: webhooks.previousSecretKeyId,
        previousExpiresAt: webhooks.previousSecretExpiresAt,
      })
      .from(webhooks)
      .where(
        activeOnly(
          webhooks,
          eq(webhooks.workspaceId, job.workspaceId),
          eq(webhooks.id, job.webhookId),
        ),
      )
      .limit(1);
    if (!row) {
      return null;
    }
    const [owner] = await tx
      .select({
        userId: workspaceMembers.userId,
        status: workspaceMembers.status,
      })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.workspaceId, job.workspaceId),
          eq(workspaceMembers.id, row.ownerMemberId),
        ),
      )
      .limit(1);
    const [workspace] = await tx
      .select({ slug: workspaces.slug })
      // openokr:allow-raw-read: the workspace's own slug, for the envelope a receiver reads it by.
      .from(workspaces)
      .where(activeOnly(workspaces, eq(workspaces.id, job.workspaceId)))
      .limit(1);

    // Opened at the moment of signing and never held (W6).
    const secrets: string[] = [];
    if (row.ciphertext && row.dataKey && row.keyId) {
      secrets.push(
        decryptSecret(ring, {
          ciphertext: row.ciphertext,
          dataKey: row.dataKey,
          keyId: row.keyId,
        }),
      );
    }
    if (
      row.previousCiphertext &&
      row.previousDataKey &&
      row.previousKeyId &&
      row.previousExpiresAt &&
      row.previousExpiresAt.getTime() > now.getTime()
    ) {
      secrets.push(
        decryptSecret(ring, {
          ciphertext: row.previousCiphertext,
          dataKey: row.previousDataKey,
          keyId: row.previousKeyId,
        }),
      );
    }
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      enabled: row.enabled,
      ownerMemberId: row.ownerMemberId,
      ownerUserId: owner?.userId ?? null,
      ownerActive: owner?.status === "active",
      secrets,
      workspaceSlug: workspace?.slug ?? "",
    };
  });
}

/**
 * The subject as the owner sees it now, in its list summary, or null when the
 * owner cannot see it (W1). Every read goes through the registry, so the
 * access getter decides exactly as it does for the owner's own REST call.
 */
async function readData(
  pool: Pool,
  job: WebhookJob,
  hook: LoadedHook,
): Promise<{ readonly data: unknown; readonly deleted: boolean } | null> {
  if (job.event === PING_EVENT) {
    return { data: {}, deleted: false };
  }
  if (!job.subjectType || !job.subjectId || !hook.ownerUserId) {
    return null;
  }
  const subjectId = job.subjectId;

  if (isDeletionEvent(job.event)) {
    // The row is gone; the context it was read through is not. The owner
    // is told only of a deletion they could have seen (W1, W4).
    const visible = await withWorkspace(drizzle(pool), job.workspaceId, (tx) =>
      getAccessScoped(tx, {
        workspaceId: job.workspaceId,
        memberId: hook.ownerMemberId,
        resourceType: "goal",
        resourceId: subjectId,
      }).then(
        () => true,
        (error: unknown) => {
          if (error instanceof OperationError) {
            return false;
          }
          throw error;
        },
      ),
    );
    return visible ? { data: null, deleted: true } : null;
  }

  const context: ActionCallContext = {
    pool,
    workspaceId: job.workspaceId,
    actor: { kind: "human", userId: hook.ownerUserId },
  };
  try {
    const data = await summaryOf(context, job, subjectId);
    return data === null ? null : { data, deleted: false };
  } catch (error) {
    // Not found and forbidden are both "the owner cannot see this now".
    if (error instanceof OperationError) {
      return null;
    }
    throw error;
  }
}

/** The list summary of one subject (W4), read as the owner. */
async function summaryOf(
  context: ActionCallContext,
  job: WebhookJob,
  subjectId: string,
): Promise<unknown> {
  switch (job.subjectType) {
    case "goal":
      return callAction(context, "goals.read", { id: subjectId });
    case "key_result":
      return keyResultSummary(context, job, subjectId);
    case "kpi": {
      const { kpis } = await callAction(context, "kpis.list", {});
      return kpis.find((kpi) => kpi.id === subjectId) ?? null;
    }
    case "initiative":
      return callAction(context, "initiatives.read", { id: subjectId });
    case "task": {
      // The read carries more than the board's card does; the card is the
      // summary every other surface returns.
      const read = await callAction(context, "tasks.read", { id: subjectId });
      return (
        listTasks.output as unknown as z.ZodArray<z.ZodType>
      ).element.parse(read);
    }
    case "cycle": {
      const cycles = await callAction(context, "cycles.list", {});
      return cycles.find((cycle) => cycle.id === subjectId) ?? null;
    }
    default:
      return null;
  }
}

/**
 * A key result as its goal's list row carries it, with what the check-in
 * reported about it: the value, the confidence and an excerpt of the note.
 */
async function keyResultSummary(
  context: ActionCallContext,
  job: WebhookJob,
  keyResultId: string,
): Promise<unknown> {
  const facts = await withWorkspace(
    drizzle(context.pool),
    job.workspaceId,
    async (tx) => {
      const [keyResult] = await tx
        .select({ goalId: keyResults.goalId })
        .from(keyResults)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, job.workspaceId),
            eq(keyResults.id, keyResultId),
          ),
        )
        .limit(1);
      if (!keyResult || !job.checkInId) {
        return null;
      }
      const [checkIn] = await tx
        .select({
          status: checkIns.status,
          publishedAt: checkIns.publishedAt,
          narrative: checkIns.narrative,
          entries: checkInSnapshots.entries,
        })
        .from(checkIns)
        .innerJoin(
          checkInSnapshots,
          activeOnly(
            checkInSnapshots,
            eq(checkInSnapshots.id, checkIns.snapshotId),
          ),
        )
        .where(
          activeOnly(
            checkIns,
            eq(checkIns.workspaceId, job.workspaceId),
            eq(checkIns.id, job.checkInId),
            eq(checkIns.state, "published"),
          ),
        )
        .limit(1);
      return checkIn ? { goalId: keyResult.goalId, checkIn } : null;
    },
  );
  if (!facts) {
    return null;
  }
  // The goal read is the access check: a key result is seen through its goal.
  const goal = await callAction(context, "goals.read", { id: facts.goalId });
  const keyResult = goal.keyResults.find((one) => one.id === keyResultId);
  const entry = facts.checkIn.entries.find(
    (one) => one.keyResultId === keyResultId,
  );
  if (!keyResult || !entry) {
    return null;
  }
  return {
    ...keyResult,
    checkIn: {
      id: job.checkInId,
      status: facts.checkIn.status,
      publishedAt: facts.checkIn.publishedAt?.toISOString() ?? null,
      value: entry.value,
      previousValue: entry.previousValue,
      confidence: entry.confidence,
      note: facts.checkIn.narrative
        ? excerptRichText(facts.checkIn.narrative as RichTextDocument, 280)
        : "",
    },
  };
}

/**
 * One attempt at one event. The attempt number is the relay's, so a retry
 * logs as attempt two and a redelivery starts again at one.
 */
export async function deliverWebhook(
  job: WebhookJob,
  deps: {
    readonly pool: Pool;
    readonly ring?: KeyRing;
    readonly post?: WebhookPost;
    readonly attempt: number;
    /** The relay's last attempt for this topic, after which it gives up. */
    readonly lastAttempt: number;
    readonly now?: () => Date;
  },
): Promise<DeliveryResult> {
  const now = deps.now ?? (() => new Date());
  if (!deps.ring || !deps.post) {
    // Not a skip: a skip marks the row delivered, and this relay simply
    // cannot sign or send. Another one, or this one configured, can.
    throw new Error(
      "A webhook is waiting to be sent and this relay has no key ring or no outbound guard to send it with.",
    );
  }

  const hook = await loadHook(deps.pool, deps.ring, job, now());
  if (!hook) {
    return { kind: "skipped", reason: "the webhook was removed" };
  }
  if (job.event !== PING_EVENT) {
    if (!hook.enabled) {
      return { kind: "skipped", reason: "the webhook is off" };
    }
    if (!hook.ownerActive) {
      return {
        kind: "skipped",
        reason: "the webhook's owner is suspended, so it is paused",
      };
    }
  }
  if (hook.secrets.length === 0) {
    return { kind: "skipped", reason: "the webhook has no signing secret" };
  }

  const read = await readData(deps.pool, job, hook);
  if (!read) {
    await record(deps.pool, job, deps.attempt, {
      outcome: "withheld",
      reason: "The webhook's owner cannot see this, so nothing was sent.",
      counts: false,
    });
    return { kind: "withheld" };
  }

  const body = JSON.stringify({
    id: job.eventId,
    type: job.event,
    occurredAt: job.occurredAt,
    workspace: { id: job.workspaceId, slug: hook.workspaceSlug },
    data: read.data,
    ...(read.deleted ? { deleted: true } : {}),
  });
  const headers = webhookHeaders({
    secrets: hook.secrets,
    id: job.eventId,
    timestamp: Math.floor(now().getTime() / 1000),
    body,
  });
  const allowPrivate = await allowsPrivateWebhookTargets(deps.pool);

  const started = performance.now();
  const answer = await deps.post(hook.url, {
    body,
    headers,
    allowPrivate,
    timeoutMs: DELIVERY_TIMEOUT_MS,
    maxBytes: ANSWER_READ_BYTES,
  });
  const durationMs = Math.max(0, Math.round(performance.now() - started));

  if (answer.ok && answer.status >= 200 && answer.status < 300) {
    await record(deps.pool, job, deps.attempt, {
      outcome: "delivered",
      statusCode: answer.status,
      durationMs,
      counts: false,
    });
    return { kind: "delivered" };
  }

  const refused = !answer.ok && ADDRESS_REFUSALS.has(answer.refusal);
  const reason = answer.ok
    ? `The receiver answered ${answer.status}.`
    : refused
      ? answer.detail
      : reasonFor(answer.refusal);
  const failures = await record(deps.pool, job, deps.attempt, {
    outcome: refused ? "refused" : "failed",
    ...(answer.ok ? { statusCode: answer.status } : {}),
    ...(refused ? {} : { durationMs }),
    reason,
    counts: true,
  });
  const turnedOff =
    failures >= FAILURES_BEFORE_OFF &&
    (await turnOffFailingHook(deps.pool, job.workspaceId, hook.id, failures));
  if (refused) {
    // The address is not allowed now; trying again in a minute will not
    // make it allowed. An administrator changes the address or the name.
    return { kind: "refused", reason };
  }
  return {
    kind: "failed",
    reason,
    retry: !turnedOff && deps.attempt < deps.lastAttempt,
  };
}

/**
 * Writes the attempt and keeps the hook's count of failures in a row,
 * returning it. A delivery resets it; a withheld subject is nobody's failure.
 */
async function record(
  pool: Pool,
  job: WebhookJob,
  attempt: number,
  row: {
    readonly outcome: "delivered" | "failed" | "refused" | "withheld";
    readonly statusCode?: number;
    readonly durationMs?: number;
    readonly reason?: string;
    readonly counts: boolean;
  },
): Promise<number> {
  return withWorkspace(drizzle(pool), job.workspaceId, async (tx) => {
    // openokr:allow-mutation: the delivery side of the outbox, recording what
    // this attempt did. Not a domain write: nothing about the workspace
    // changed, only the record of a delivery, as channel messages are marked.
    await tx.insert(webhookDeliveries).values({
      workspaceId: job.workspaceId,
      webhookId: job.webhookId,
      event: job.event,
      eventId: job.eventId,
      subjectType: job.subjectType,
      subjectId: job.subjectId,
      checkInId: job.checkInId,
      occurredAt: new Date(job.occurredAt),
      attempt,
      outcome: row.outcome,
      statusCode: row.statusCode ?? null,
      durationMs: row.durationMs ?? null,
      reason: row.reason ? clip(row.reason) : null,
    });
    if (row.outcome === "withheld") {
      return 0;
    }
    // openokr:allow-mutation: the same delivery bookkeeping, the run of
    // failures W9 counts. Turning the hook off is an Operation, below.
    const [counted] = await tx
      .update(webhooks)
      .set({
        consecutiveFailures: row.counts
          ? sql`${webhooks.consecutiveFailures} + 1`
          : 0,
      })
      .where(
        activeOnly(
          webhooks,
          eq(webhooks.workspaceId, job.workspaceId),
          eq(webhooks.id, job.webhookId),
        ),
      )
      .returning({ failures: webhooks.consecutiveFailures });
    return counted?.failures ?? 0;
  });
}

/**
 * Turns a hook off after its run of failures (W9), as the system, through the
 * pipeline: the change, its audit row and the outbox row for its creator's
 * mail commit together. True when this call turned it off; false when it was
 * already off, or somebody turned it back on in between.
 */
async function turnOffFailingHook(
  pool: Pool,
  workspaceId: string,
  webhookId: string,
  failures: number,
): Promise<boolean> {
  try {
    return await runOperation(
      { pool },
      {
        action: "webhooks.turnOffAfterFailures",
        workspaceId,
        actor: { kind: "system" },
        async execute({ tx }) {
          const now = new Date();
          // openokr:allow-mutation: this Operation's own transaction.
          const [off] = await tx
            .update(webhooks)
            .set({
              enabled: false,
              offReason: "failures",
              turnedOffAt: now,
              updatedAt: now,
            })
            .where(
              activeOnly(
                webhooks,
                eq(webhooks.workspaceId, workspaceId),
                eq(webhooks.id, webhookId),
                eq(webhooks.enabled, true),
                gte(webhooks.consecutiveFailures, FAILURES_BEFORE_OFF),
              ),
            )
            .returning({ name: webhooks.name });
          if (!off) {
            throw new OperationError("conflict", "The webhook is already off.");
          }
          return {
            result: true,
            activity: {
              kind: "webhook.turned_off",
              subjectType: "workspace",
              subjectId: workspaceId,
              payload: { name: off.name, failures },
            },
            audit: {
              action: "webhooks.turnOffAfterFailures",
              targetType: "webhook",
              targetId: webhookId,
              payload: { name: off.name, failures },
            },
            outbox: [
              {
                topic: WEBHOOK_TURNED_OFF_TOPIC,
                payload: { workspaceId, webhookId, failures },
                idempotencyKey: `${WEBHOOK_TURNED_OFF_TOPIC}:${webhookId}:${now.toISOString()}`,
              },
            ],
          };
        },
      },
    );
  } catch (error) {
    if (error instanceof OperationError && error.code === "conflict") {
      return false;
    }
    throw error;
  }
}

/** What the turned-off mail needs, or null when it should not be sent. */
export async function readTurnedOff(
  pool: Pool,
  workspaceId: string,
  webhookId: string,
): Promise<{
  readonly name: string;
  readonly url: string;
  readonly creatorMemberId: string;
} | null> {
  return withWorkspace(drizzle(pool), workspaceId, async (tx) => {
    const [row] = await tx
      .select({
        name: webhooks.name,
        url: webhooks.url,
        enabled: webhooks.enabled,
        offReason: webhooks.offReason,
        creatorMemberId: webhooks.createdByMemberId,
      })
      .from(webhooks)
      .where(
        activeOnly(
          webhooks,
          eq(webhooks.workspaceId, workspaceId),
          eq(webhooks.id, webhookId),
        ),
      )
      .limit(1);
    // Turned back on, or removed, before the mail went: there is nothing
    // left to tell anybody.
    if (!row || row.enabled || row.offReason !== "failures") {
      return null;
    }
    return {
      name: row.name,
      url: row.url,
      creatorMemberId: row.creatorMemberId,
    };
  });
}
