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
import { z } from "zod";
import { OperationError } from "./errors.ts";
import type { OperationTx } from "./operation.ts";

/** One value as it is read: a milestone's done is a boolean. */
type ComparableScalar = string | number | boolean | null;

/**
 * What a field is compared as. A list is a cycle's levels or its session
 * dates, each date a small record.
 */
export type Comparable =
  | ComparableScalar
  | readonly (ComparableScalar | Readonly<Record<string, ComparableScalar>>)[];

const isList = (
  value: Comparable,
): value is Exclude<Comparable, ComparableScalar> => Array.isArray(value);

/** A list in one spelling: its order kept, each record's keys sorted. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Equal as the screen means it: numbers by value, blank text and an empty
 * list as nothing, a list by what it holds in the order it holds it.
 */
export function sameField(read: Comparable, stored: Comparable): boolean {
  const blank = (value: Comparable): Comparable =>
    (typeof value === "string" && value.trim() === "") ||
    (isList(value) && value.length === 0)
      ? null
      : value;
  const left = blank(read);
  const right = blank(stored);
  if (isList(left) || isList(right)) {
    return canonical(left) === canonical(right);
  }
  if (typeof left === "number" || typeof right === "number") {
    return Number(left) === Number(right);
  }
  return left === right;
}

/**
 * A value as the caller read it. Loose on purpose, as the OKR tree's are: it
 * is compared with what is stored, not validated as input, and a title read
 * before a length rule tightened must still be comparable.
 */
const readScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/**
 * A list as the caller read it: a cycle's levels, or its session dates.
 * Null is an empty list, as it compares.
 */
const readList = z
  .array(z.union([readScalar, z.record(z.string(), readScalar)]))
  .nullable();

/**
 * The optional `read` an update action takes (V1, V3): for each field it
 * can change, the value the caller read. `lists` names the fields that hold
 * a list rather than one value. Rich text is never one of them (V5): a body
 * two people edited is a merge question, not a comparison.
 */
export function readOf<const K extends string>(
  fields: readonly K[],
  lists: readonly K[] = [],
) {
  const shape = Object.fromEntries(
    fields.map((field) => [
      field,
      lists.includes(field) ? readList.optional() : readScalar.optional(),
    ]),
  ) as {
    [P in K]: z.ZodOptional<typeof readScalar> | z.ZodOptional<typeof readList>;
  };
  return z.object(shape).optional();
}

/**
 * The fields an update names, which is every key but its address and the
 * `read` it was made from. What the activity and the audit row record, and
 * what "an update has to change something" counts.
 */
export function changedFields(
  input: Readonly<Record<string, unknown>>,
  address = "id",
): string[] {
  return Object.keys(input).filter((key) => key !== address && key !== "read");
}

/**
 * A `read` that leaves out a field the call changes is refused, as the OKR
 * tree's is: that field could not be checked, and a caller who sent `read`
 * asked for every field it changes to be. Spread into `.refine`.
 */
export function readsEveryChange<K extends string>(
  fields: readonly K[],
): [
  (
    value: {
      readonly [P in K]?: unknown;
    } & { readonly read?: { readonly [P in K]?: Comparable | undefined } },
  ) => boolean,
  { message: string; path: string[] },
] {
  return [
    (value) =>
      value.read === undefined ||
      fields.every(
        (field) =>
          value[field] === undefined || value.read?.[field] !== undefined,
      ),
    {
      message:
        "Send the value you read for every field you change, so a change made since can be found.",
      path: ["read"],
    },
  ];
}

/**
 * Refuses an update made from a stale read (V2, V3), for the six update
 * actions that take an optional `read`.
 *
 * Nothing happens when the caller sent no `read`, so a call that never read
 * anything writes as it always has. Otherwise exactly the fields this call
 * changes are compared, against the row `stored` loads. That loader locks
 * the row, so a second save cannot pass the same comparison before this one
 * commits.
 */
export async function requireReadUnchanged<K extends string>(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly subjectType: string;
    readonly subjectId: string;
    readonly fields: readonly K[];
    readonly given: {
      readonly [P in K]?: unknown;
    } & { readonly read?: { readonly [P in K]?: Comparable | undefined } };
    readonly stored: () => Promise<Readonly<Record<K, Comparable>> | undefined>;
  },
): Promise<void> {
  const { read } = input.given;
  if (read === undefined) {
    return;
  }
  const changed = input.fields.filter(
    (field) => input.given[field] !== undefined,
  );
  if (changed.length === 0) {
    return;
  }
  const stored = await input.stored();
  if (stored === undefined) {
    // The write's own lookup says not-found in its own words.
    return;
  }
  await requireUnchanged(tx, {
    workspaceId: input.workspaceId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    read: Object.fromEntries(
      changed.map((field) => [field, read[field] ?? null]),
    ),
    stored,
  });
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
