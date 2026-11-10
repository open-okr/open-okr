/**
 * Enqueueing a write's webhook deliveries, inside the write's own transaction
 * (docs/design/outbound-webhooks.md W8).
 *
 * The Operation pipeline calls this once per activity, beside the feed's own
 * live event, so no action has to remember. Side effects leave only as outbox
 * rows, and these are inserted in the transaction that made the change, so a
 * write that rolls back sends nothing.
 *
 * **What a write pays.** A kind that maps to no event returns before touching
 * the database. A mapped kind asks one question of a small partial index: the
 * switched-on hooks of this workspace whose owner is still active and whose
 * events include this one. A workspace with no hooks gets an empty answer and
 * nothing else happens. Only when a hook is waiting does anything more get
 * read: the check-in's key results, and the subject's space when a hook is
 * limited to one.
 *
 * **A suspended owner writes no row** (W2). The hook shows paused on its
 * screen, and nothing queues behind it to arrive all at once later.
 */
import {
  activeOnly,
  checkInSnapshots,
  checkIns,
  enqueueOutbox,
  goals,
  includeDeleted,
  initiatives,
  keyResults,
  kpis,
  tasks,
  webhooks,
  workspaceMembers,
} from "@openokr/db";
import { and, eq, sql } from "drizzle-orm";
import type { OperationTx } from "../operations/operation.ts";
import { eventFor, subjectTypeOf, type WebhookEvent } from "./events.ts";
import { newEventId, webhookDeliveryMessage } from "./jobs.ts";

/** One subject an event reports on. A check-in reports on several. */
interface Occurrence {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly checkInId: string | null;
}

/**
 * Inserts one `webhooks.deliver` outbox row per waiting hook and subject.
 * Returns how many it inserted, which is zero for nearly every write.
 */
export async function enqueueWebhookDeliveries(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly kind: string;
    readonly subjectId: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly at: Date;
  },
): Promise<number> {
  const event = eventFor(input.kind, input.payload);
  if (!event) {
    return 0;
  }

  const waiting = await tx
    .select({ id: webhooks.id, spaceId: webhooks.spaceId })
    .from(webhooks)
    .innerJoin(
      workspaceMembers,
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.id, webhooks.ownerMemberId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .where(
      activeOnly(
        webhooks,
        eq(webhooks.workspaceId, input.workspaceId),
        eq(webhooks.enabled, true),
        sql`${event} = any(${webhooks.events})`,
      ),
    );
  if (waiting.length === 0) {
    return 0;
  }

  const occurrences = await occurrencesOf(tx, input, event);
  let inserted = 0;
  for (const occurrence of occurrences) {
    // One id per event, shared by every hook that receives it: the same
    // thing happened once, whoever is told.
    const eventId = newEventId();
    let space: string | null | undefined;
    for (const hook of waiting) {
      if (hook.spaceId) {
        space ??= await spaceOf(tx, input.workspaceId, occurrence);
        if (space !== hook.spaceId) {
          continue;
        }
      }
      await enqueueOutbox(
        tx,
        webhookDeliveryMessage({
          workspaceId: input.workspaceId,
          webhookId: hook.id,
          event,
          eventId,
          occurredAt: input.at.toISOString(),
          subjectType: occurrence.subjectType,
          subjectId: occurrence.subjectId,
          checkInId: occurrence.checkInId,
        }),
      );
      inserted += 1;
    }
  }
  return inserted;
}

/**
 * The subjects one activity reports on.
 *
 * Every event but one is about the activity's own subject. A check-in is
 * written against its objective and reports on each of its key results, so it
 * becomes one `key_result.checked_in` per key result in its snapshot, which is
 * the record of what it reported.
 */
async function occurrencesOf(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly subjectId: string;
    readonly payload: Readonly<Record<string, unknown>>;
  },
  event: WebhookEvent,
): Promise<readonly Occurrence[]> {
  if (event !== "key_result.checked_in") {
    return [
      {
        subjectType: subjectTypeOf(event),
        subjectId: input.subjectId,
        checkInId: null,
      },
    ];
  }
  const checkInId =
    typeof input.payload.checkInId === "string" ? input.payload.checkInId : "";
  if (checkInId === "") {
    return [];
  }
  const [row] = await tx
    .select({ entries: checkInSnapshots.entries })
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
        eq(checkIns.workspaceId, input.workspaceId),
        eq(checkIns.id, checkInId),
      ),
    )
    .limit(1);
  return (row?.entries ?? []).map((entry) => ({
    subjectType: "key_result",
    subjectId: entry.keyResultId,
    checkInId,
  }));
}

/**
 * The space a subject belongs to, or null for one that belongs to none: a
 * company objective, a cycle. Deleted rows included, because a deletion is
 * reported after the row is gone.
 */
async function spaceOf(
  tx: OperationTx,
  workspaceId: string,
  occurrence: Occurrence,
): Promise<string | null> {
  const id = occurrence.subjectId;
  if (occurrence.subjectType === "goal") {
    const [row] = await tx
      .select({ spaceId: goals.spaceId })
      .from(goals)
      .where(
        includeDeleted(
          goals,
          and(eq(goals.workspaceId, workspaceId), eq(goals.id, id)),
        ),
      )
      .limit(1);
    return row?.spaceId ?? null;
  }
  if (occurrence.subjectType === "key_result") {
    const [row] = await tx
      .select({ spaceId: goals.spaceId })
      .from(keyResults)
      .innerJoin(goals, includeDeleted(goals, eq(goals.id, keyResults.goalId)))
      .where(
        includeDeleted(
          keyResults,
          and(eq(keyResults.workspaceId, workspaceId), eq(keyResults.id, id)),
        ),
      )
      .limit(1);
    return row?.spaceId ?? null;
  }
  if (occurrence.subjectType === "kpi") {
    const [row] = await tx
      .select({ spaceId: kpis.spaceId })
      .from(kpis)
      .where(
        includeDeleted(
          kpis,
          and(eq(kpis.workspaceId, workspaceId), eq(kpis.id, id)),
        ),
      )
      .limit(1);
    return row?.spaceId ?? null;
  }
  if (occurrence.subjectType === "initiative") {
    const [row] = await tx
      .select({ spaceId: initiatives.spaceId })
      .from(initiatives)
      .where(
        includeDeleted(
          initiatives,
          and(eq(initiatives.workspaceId, workspaceId), eq(initiatives.id, id)),
        ),
      )
      .limit(1);
    return row?.spaceId ?? null;
  }
  if (occurrence.subjectType === "task") {
    const [row] = await tx
      .select({ spaceId: tasks.spaceId })
      .from(tasks)
      .where(
        includeDeleted(
          tasks,
          and(eq(tasks.workspaceId, workspaceId), eq(tasks.id, id)),
        ),
      )
      .limit(1);
    return row?.spaceId ?? null;
  }
  return null;
}
