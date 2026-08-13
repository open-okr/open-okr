/**
 * Check-in writes, as helpers an Operation's `execute` calls (TECHNICAL-PLAN
 * §4.4, METHOD.md §7.2, P3-T07).
 *
 * **A draft is completely silent.** Not quiet, not batched: no activity row, no
 * notification, no outbox side effect, no cadence movement, no value history. The
 * whole point of a draft is that a champion can think out loud without the
 * organisation reading it.
 *
 * **Publication is one transaction in a fixed order** (§6.2): refuse without a
 * narrative, a status and a confidence; stamp the snapshot; write the value
 * history; move the goal's pointer and recompute; advance the cadence; create the
 * reviewer's obligation. Every step after the first depends on the one before it,
 * which is why the order is written down rather than left to whoever edits next.
 *
 * **The snapshot is immutable.** An edit inside the window writes a new snapshot
 * row and moves the pointer. The difference a reviewer already read cannot change
 * under them, which is the difference between a record and a rumour.
 */
import {
  activeOnly,
  type CheckInStatus,
  checkInSnapshots,
  checkIns,
  goals,
  keyResults,
  keyResultValues,
  newId,
  notifications,
  type SnapshotEntry,
  type WorkspaceTx,
} from "@openokr/db";
import type { ResolvedThresholds } from "@openokr/method";
import { desc, eq, inArray, ne, sql } from "drizzle-orm";
import { cadence, dueInstant, firstDue } from "../cadence/engine.ts";
import { localDateIn } from "../cycles/generation.ts";
import { workspaceTimeZone } from "../cycles/service.ts";
import { OperationError } from "../operations/operation.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

const asNumber = (value: string | number | null): number | null => {
  if (value === null) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** One key result's new value, as the composer submits it. */
interface ComposerValue {
  readonly keyResultId: string;
  readonly value?: number;
  readonly confidence?: number;
}

export interface PublishInput {
  readonly workspaceId: string;
  readonly checkInId: string;
  readonly authorMemberId: string;
  readonly status: CheckInStatus;
  readonly confidence: number;
  readonly narrative: unknown;
  readonly values: readonly ComposerValue[];
  readonly thresholds: ResolvedThresholds;
  readonly now: Date;
}

/**
 * Builds the snapshot from the key results' live state, after the composer's
 * values have been applied.
 *
 * `previousValue` is the value the key result held before this check-in, read from
 * the history rather than recomputed, because the history is what a reviewer will
 * be shown the difference against.
 */
async function buildSnapshot<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  goalId: string,
  previous: ReadonlyMap<
    string,
    { value: number | null; confidence: number | null }
  >,
): Promise<SnapshotEntry[]> {
  const rows = await tx
    .select({
      id: keyResults.id,
      title: keyResults.title,
      currentValue: keyResults.currentValue,
      progressPct: keyResults.progressPct,
      confidence: keyResults.confidence,
    })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        eq(keyResults.goalId, goalId),
      ),
    )
    .orderBy(keyResults.position);

  return rows.map((row) => {
    const before = previous.get(row.id);
    return {
      keyResultId: row.id,
      title: row.title,
      value: asNumber(row.currentValue) ?? 0,
      previousValue: before?.value ?? null,
      progressPct: asNumber(row.progressPct) ?? 0,
      confidence: asNumber(row.confidence),
      previousConfidence: before?.confidence ?? null,
    };
  });
}

/** What every key result held before this publication touched it. */
async function readPrevious<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  goalId: string,
): Promise<Map<string, { value: number | null; confidence: number | null }>> {
  const rows = await tx
    .select({
      id: keyResults.id,
      currentValue: keyResults.currentValue,
      confidence: keyResults.confidence,
    })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        eq(keyResults.goalId, goalId),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        value: asNumber(row.currentValue),
        confidence: asNumber(row.confidence),
      },
    ]),
  );
}

/**
 * Applies the composer's values, writing one history row per key result whose
 * value actually changed (§6.2 step 3).
 *
 * Unchanged values write nothing. A sparkline should show movement, not the
 * heartbeat of somebody opening a form.
 */
async function applyValues<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: PublishInput,
  previous: ReadonlyMap<
    string,
    { value: number | null; confidence: number | null }
  >,
): Promise<number> {
  let written = 0;
  for (const entry of input.values) {
    const before = previous.get(entry.keyResultId);
    if (!before) {
      // A key result that is not on this goal, or was deleted while the draft
      // was open. Skipping beats writing a value onto somebody else's goal.
      continue;
    }

    if (entry.confidence !== undefined) {
      // openokr:allow-mutation: runs on the calling Operation's transaction.
      await tx
        .update(keyResults)
        .set({ confidence: String(entry.confidence), updatedAt: input.now })
        .where(activeOnly(keyResults, eq(keyResults.id, entry.keyResultId)));
    }

    if (entry.value === undefined || entry.value === before.value) {
      continue;
    }

    // openokr:allow-mutation: same transaction.
    await tx.insert(keyResultValues).values({
      workspaceId: input.workspaceId,
      keyResultId: entry.keyResultId,
      value: String(entry.value),
      at: input.now,
      authorMemberId: input.authorMemberId,
      checkInId: input.checkInId,
      source: "check_in",
    });
    // openokr:allow-mutation: same transaction.
    await tx
      .update(keyResults)
      .set({ currentValue: String(entry.value), updatedAt: input.now })
      .where(activeOnly(keyResults, eq(keyResults.id, entry.keyResultId)));
    written += 1;
  }
  return written;
}

export interface PublishResult {
  readonly goalId: string;
  readonly snapshotId: string;
  readonly valuesWritten: number;
  readonly reviewerMemberId: string;
}

/** Publication, in §6.2's order. */
export async function publishCheckInInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: PublishInput): Promise<PublishResult> {
  const [checkIn] = await tx
    .select({
      id: checkIns.id,
      state: checkIns.state,
      subjectId: checkIns.subjectId,
      authorMemberId: checkIns.authorMemberId,
    })
    .from(checkIns)
    .where(
      activeOnly(
        checkIns,
        eq(checkIns.workspaceId, input.workspaceId),
        eq(checkIns.id, input.checkInId),
      ),
    )
    .limit(1);
  if (!checkIn) {
    throw new OperationError("not_found", "No such check-in.");
  }
  if (checkIn.state === "published") {
    throw new OperationError(
      "forbidden",
      "This check-in is already published. Edit it inside its window, or post a new one.",
    );
  }
  // §6.2 step 1. The database refuses this too; saying it in words first is what
  // makes it a message rather than a constraint violation.
  if (input.narrative === null || input.narrative === undefined) {
    throw new OperationError(
      "forbidden",
      "A check-in needs a narrative. What moved, what is in the way, and what happens next?",
    );
  }

  const [goal] = await tx
    .select({
      id: goals.id,
      reviewerId: goals.reviewerId,
      championId: goals.championId,
      checkInFrequency: goals.checkInFrequency,
      nextCheckInAt: goals.nextCheckInAt,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, input.workspaceId),
        eq(goals.id, checkIn.subjectId),
      ),
    )
    .limit(1);
  if (!goal) {
    throw new OperationError("not_found", "No such goal.");
  }

  const previous = await readPrevious(tx, input.workspaceId, goal.id);
  const valuesWritten = await applyValues(tx, input, previous);

  // Step 2: the snapshot, from the live state after the values landed.
  const entries = await buildSnapshot(tx, input.workspaceId, goal.id, previous);
  const snapshotId = newId();
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx.insert(checkInSnapshots).values({
    id: snapshotId,
    workspaceId: input.workspaceId,
    checkInId: input.checkInId,
    entries,
    at: input.now,
  });

  // openokr:allow-mutation: same transaction.
  await tx
    .update(checkIns)
    .set({
      state: "published",
      publishedAt: input.now,
      status: input.status,
      confidence: String(input.confidence),
      narrative: input.narrative as never,
      narrativeVersion: RICH_TEXT_SCHEMA_VERSION,
      snapshotId,
      // The reviewer of record (P3-T08). Stamped here rather than read from the
      // goal later, because publication is the moment the obligation is created
      // and the goal's reviewer can change afterwards. An edit inside the window
      // re-publishes through this same path, so it never orphans the obligation.
      reviewerMemberId: goal.reviewerId,
      updatedAt: input.now,
    })
    .where(activeOnly(checkIns, eq(checkIns.id, input.checkInId)));

  // Steps 4 and 5: the goal's pointer, then the cadence. Health and progress are
  // recomputed by the caller through the one recompute entry point, which reads
  // the pointer this sets.
  const timeZone = await workspaceTimeZone(tx, input.workspaceId);
  const frequency =
    goal.checkInFrequency ?? input.thresholds["cadence.checkInFrequency"];
  const anchor = input.thresholds["cadence.anchorDay"];
  const publishedOn = localDateIn(input.now, timeZone);

  const nextDue = goal.nextCheckInAt
    ? cadence.nextAfterPublication(
        formatDate(localDateIn(new Date(goal.nextCheckInAt), timeZone)),
        formatDate(publishedOn),
        frequency,
        anchor,
        input.thresholds["cadence.toleranceDays"],
      ).next
    : formatDate(firstDue(publishedOn, frequency, anchor));

  // openokr:allow-mutation: same transaction.
  await tx
    .update(goals)
    .set({
      lastCheckInId: input.checkInId,
      nextCheckInAt: dueInstant(parseDate(nextDue), timeZone),
      updatedAt: input.now,
    })
    .where(activeOnly(goals, eq(goals.id, goal.id)));

  // Step 6: the reviewer's obligation. Derived state, not a table of its own
  // (§6.5), so the notification is what tells them rather than what records it.
  if (goal.reviewerId !== checkIn.authorMemberId) {
    // openokr:allow-mutation: same transaction.
    await tx.insert(notifications).values({
      workspaceId: input.workspaceId,
      recipientMemberId: goal.reviewerId,
      reason: "review",
      channel: "app",
    });
  }

  return {
    goalId: goal.id,
    snapshotId,
    valuesWritten,
    reviewerMemberId: goal.reviewerId,
  };
}

const formatDate = (date: {
  year: number;
  month: number;
  day: number;
}): string =>
  `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;

const parseDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return { year: year as number, month: month as number, day: day as number };
};

/**
 * Whether a published check-in is still editable (§6.3, decision D-6).
 *
 * The window closes on whichever comes first: a newer check-in published on the
 * same goal, because the period has moved on, or the next due date passing,
 * because the check-in now describes a finished period. Both are quantities the
 * product already has, so no new duration enters §11.
 */
export async function editWindowOpen<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  checkInId: string,
  now: Date,
): Promise<{ open: boolean; because: string | null }> {
  const [checkIn] = await tx
    .select({
      id: checkIns.id,
      state: checkIns.state,
      subjectId: checkIns.subjectId,
      publishedAt: checkIns.publishedAt,
    })
    .from(checkIns)
    .where(
      activeOnly(
        checkIns,
        eq(checkIns.workspaceId, workspaceId),
        eq(checkIns.id, checkInId),
      ),
    )
    .limit(1);
  if (!checkIn) {
    return { open: false, because: "No such check-in." };
  }
  if (checkIn.state === "draft") {
    // A draft has no window: it is not a record yet.
    return { open: true, because: null };
  }

  const [newer] = await tx
    .select({ id: checkIns.id })
    .from(checkIns)
    .where(
      activeOnly(
        checkIns,
        eq(checkIns.workspaceId, workspaceId),
        eq(checkIns.subjectId, checkIn.subjectId),
        eq(checkIns.state, "published"),
        ne(checkIns.id, checkInId),
        sql`${checkIns.publishedAt} > ${checkIn.publishedAt}`,
      ),
    )
    .limit(1);
  if (newer) {
    return {
      open: false,
      because:
        "A newer check-in has been published on this goal, so the period has moved on. Post a new one instead.",
    };
  }

  const [goal] = await tx
    .select({ nextCheckInAt: goals.nextCheckInAt })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.id, checkIn.subjectId),
      ),
    )
    .limit(1);
  if (goal?.nextCheckInAt && new Date(goal.nextCheckInAt) < now) {
    return {
      open: false,
      because:
        "The next check-in is already due, so this one describes a finished period. Post a new one instead.",
    };
  }

  return { open: true, because: null };
}

/**
 * Deleting a check-in leaves the goal exactly as it was before it (§6.4).
 *
 * Only the latest published check-in rolls anything back. Deleting an older one
 * removes its own rows and leaves the pointers alone, because the pointers do not
 * describe it.
 */
export async function deleteCheckInInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  checkInId: string,
  thresholds: ResolvedThresholds,
  now: Date,
): Promise<{ goalId: string; rolledBack: boolean }> {
  const [checkIn] = await tx
    .select({
      id: checkIns.id,
      state: checkIns.state,
      subjectId: checkIns.subjectId,
      publishedAt: checkIns.publishedAt,
    })
    .from(checkIns)
    .where(
      activeOnly(
        checkIns,
        eq(checkIns.workspaceId, workspaceId),
        eq(checkIns.id, checkInId),
      ),
    )
    .limit(1);
  if (!checkIn) {
    throw new OperationError("not_found", "No such check-in.");
  }

  const [goal] = await tx
    .select({
      id: goals.id,
      lastCheckInId: goals.lastCheckInId,
      checkInFrequency: goals.checkInFrequency,
      createdAt: goals.createdAt,
    })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.id, checkIn.subjectId),
      ),
    )
    .limit(1);
  if (!goal) {
    throw new OperationError("not_found", "No such goal.");
  }

  const isLatest = goal.lastCheckInId === checkInId;

  // The value rows this check-in wrote go first, so each key result can be walked
  // back to the value the row before it recorded.
  const written = await tx
    .select({
      id: keyResultValues.id,
      keyResultId: keyResultValues.keyResultId,
    })
    .from(keyResultValues)
    .where(
      activeOnly(
        keyResultValues,
        eq(keyResultValues.workspaceId, workspaceId),
        eq(keyResultValues.checkInId, checkInId),
      ),
    );

  if (written.length > 0) {
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .update(keyResultValues)
      .set({ deletedAt: now })
      .where(
        activeOnly(
          keyResultValues,
          eq(keyResultValues.workspaceId, workspaceId),
          eq(keyResultValues.checkInId, checkInId),
        ),
      );

    for (const row of new Set(written.map((entry) => entry.keyResultId))) {
      const [previous] = await tx
        .select({ value: keyResultValues.value })
        .from(keyResultValues)
        .where(
          activeOnly(
            keyResultValues,
            eq(keyResultValues.workspaceId, workspaceId),
            eq(keyResultValues.keyResultId, row),
          ),
        )
        .orderBy(desc(keyResultValues.at))
        .limit(1);
      if (previous) {
        // openokr:allow-mutation: same transaction.
        await tx
          .update(keyResults)
          .set({ currentValue: previous.value, updatedAt: now })
          .where(activeOnly(keyResults, eq(keyResults.id, row)));
      }
    }
  }

  // openokr:allow-mutation: same transaction.
  await tx
    .update(checkIns)
    .set({ deletedAt: now, updatedAt: now })
    .where(activeOnly(checkIns, eq(checkIns.id, checkInId)));

  if (!isLatest) {
    return { goalId: goal.id, rolledBack: false };
  }

  // The pointer goes back to the previous published check-in, and the cadence is
  // recomputed from its publication date rather than from today: the rhythm this
  // check-in advanced was never earned.
  const [previous] = await tx
    .select({ id: checkIns.id, publishedAt: checkIns.publishedAt })
    .from(checkIns)
    .where(
      activeOnly(
        checkIns,
        eq(checkIns.workspaceId, workspaceId),
        eq(checkIns.subjectId, goal.id),
        eq(checkIns.state, "published"),
        ne(checkIns.id, checkInId),
      ),
    )
    .orderBy(desc(checkIns.publishedAt))
    .limit(1);

  const timeZone = await workspaceTimeZone(tx, workspaceId);
  const frequency =
    goal.checkInFrequency ?? thresholds["cadence.checkInFrequency"];
  const anchor = thresholds["cadence.anchorDay"];
  const from = localDateIn(
    new Date(previous?.publishedAt ?? goal.createdAt),
    timeZone,
  );

  // openokr:allow-mutation: same transaction.
  await tx
    .update(goals)
    .set({
      lastCheckInId: previous?.id ?? null,
      nextCheckInAt: dueInstant(firstDue(from, frequency, anchor), timeZone),
      updatedAt: now,
    })
    .where(activeOnly(goals, eq(goals.id, goal.id)));

  return { goalId: goal.id, rolledBack: true };
}

/** The latest published check-in's status, which is health rule 3 (§3.5). */
export async function latestPublishedStatus<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  goalIds: readonly string[],
): Promise<Map<string, CheckInStatus>> {
  if (goalIds.length === 0) {
    return new Map();
  }
  const rows = await tx
    .select({
      subjectId: checkIns.subjectId,
      status: checkIns.status,
      publishedAt: checkIns.publishedAt,
    })
    .from(checkIns)
    .where(
      activeOnly(
        checkIns,
        eq(checkIns.workspaceId, workspaceId),
        eq(checkIns.state, "published"),
        inArray(checkIns.subjectId, [...goalIds]),
      ),
    )
    .orderBy(desc(checkIns.publishedAt));

  const latest = new Map<string, CheckInStatus>();
  for (const row of rows) {
    // Ordered newest first, so the first row per goal wins.
    if (!latest.has(row.subjectId) && row.status) {
      latest.set(row.subjectId, row.status);
    }
  }
  return latest;
}
