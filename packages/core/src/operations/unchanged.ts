/**
 * Optimistic concurrency by field (docs/design/optimistic-concurrency.md,
 * plan 0.7.0 D3, approved 10 November 2026; first built for the OKR tree at
 * P9-T06a).
 *
 * A caller sends the values it read for the fields it changes. A field whose
 * stored value has moved since is a conflict; a field nobody else touched is
 * not, so two people editing a task's title and its due date do not refuse
 * each other. No version column, no backfill, and a caller that sends nothing
 * writes as before (V1, V3).
 */
import { activities, workspaceMembers } from "@openokr/db";
import { and, desc, eq } from "drizzle-orm";
import { OperationError } from "./errors.ts";
import type { OperationTx } from "./operation.ts";

/** What a field is compared as: a milestone's done is a boolean. */
export type Comparable = string | number | boolean | null;

/** Equal as the screen means it: numbers by value, blank text as nothing. */
export function sameField(read: Comparable, stored: Comparable): boolean {
  if (typeof read === "number" || typeof stored === "number") {
    return Number(read) === Number(stored);
  }
  const blank = (value: Comparable) =>
    typeof value === "string" && value.trim() === "" ? null : value;
  return blank(read) === blank(stored);
}

/** Who last changed a subject, from its activity, for a conflict's answer. */
async function lastChange(
  tx: OperationTx,
  workspaceId: string,
  subjectType: string,
  subjectId: string,
): Promise<{ changedBy: string | null; changedAt: string | null }> {
  const [row] = await tx
    .select({ at: activities.at, name: workspaceMembers.name })
    .from(activities)
    .leftJoin(
      workspaceMembers,
      eq(workspaceMembers.id, activities.actorMemberId),
    )
    .where(
      and(
        eq(activities.workspaceId, workspaceId),
        eq(activities.subjectType, subjectType),
        eq(activities.subjectId, subjectId),
      ),
    )
    .orderBy(desc(activities.at))
    .limit(1);
  return {
    changedBy: row?.name ?? null,
    changedAt: row?.at ? new Date(row.at).toISOString() : null,
  };
}

/**
 * Refuses when any field the caller changes has moved since it read it (V2).
 *
 * Only the fields in `read` are compared. The answer is `conflict` with the
 * stored values and who changed the subject last, which is what the screen's
 * keep-mine and take-theirs read.
 */
export async function requireUnchanged(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    /** The subject whose activity names its last writer. */
    readonly subjectType: string;
    readonly subjectId: string;
    readonly read: Readonly<Record<string, Comparable>>;
    readonly stored: Readonly<Record<string, Comparable>>;
  },
): Promise<void> {
  const moved = Object.keys(input.read).filter(
    (key) => !sameField(input.read[key] ?? null, input.stored[key] ?? null),
  );
  if (moved.length === 0) {
    return;
  }
  const { changedBy, changedAt } = await lastChange(
    tx,
    input.workspaceId,
    input.subjectType,
    input.subjectId,
  );
  const current = Object.fromEntries(
    moved.map((key) => [key, input.stored[key]]),
  );
  const now = moved
    .map((key) => `${key} is now ${JSON.stringify(input.stored[key])}`)
    .join(", ");
  throw new OperationError(
    "conflict",
    `${changedBy ?? "Somebody"} changed this since you read it: ${now}. Nothing was saved; keep yours by sending it again with the current value.`,
    { current, changedBy, changedAt },
  );
}
