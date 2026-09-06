/**
 * Feed queries (TECHNICAL-PLAN §4.11, screen S-31, P2-T07).
 *
 * Access-filtered: an activity with a live context is visible only through
 * `accessScopeFilter`, at the reader's own level; an activity with no
 * context (a workspace-level event — a rename, a membership change) is
 * workspace-public by construction, the same way TECHNICAL-PLAN §4.1 treats
 * the workspace's own context. Paginated by key, `(at, id)` descending, not
 * offset: an offset page shifts under concurrent inserts, and a feed is
 * exactly the kind of list new rows land in constantly.
 *
 * "Hiding soft-deleted subjects" only applies where this package already
 * knows the subject's own table: `workspace_member` and `blob` today.
 * Every other `subjectType` is unfiltered on this axis, because there is no
 * table yet to check against — the same "ahead of its consumers" gap
 * `resolveSubjectContext`'s catalogue has, and for the same reason.
 */
import {
  activeOnly,
  activities,
  blobs,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { and, desc, eq, isNull, lt, notInArray, or } from "drizzle-orm";
import { ACCESS_LEVELS, type AccessLevel } from "../access/levels.ts";
import { accessScopeFilter } from "../access/reads.ts";
import { PRIVATE_ACTIVITY_KINDS } from "./catalogue.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

export interface FeedItem {
  readonly id: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly actorMemberId: string | null;
  readonly actorKind: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly at: Date;
}

export interface QueryFeedInput {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly minLevel?: AccessLevel;
  /** Restricts to one subject, for the profile scope ("everything about this person"). */
  readonly subjectType?: string;
  readonly subjectId?: string;
  /** The last item of the previous page, for key pagination. */
  readonly cursor?: { readonly at: Date; readonly id: string };
  readonly limit?: number;
}

const DEFAULT_LIMIT = 50;

async function isSubjectLive<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  subjectType: string,
  subjectId: string,
): Promise<boolean> {
  if (subjectType === "workspace_member") {
    const [row] = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.id, subjectId),
          eq(workspaceMembers.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }
  if (subjectType === "blob") {
    const [row] = await tx
      .select({ id: blobs.id })
      .from(blobs)
      .where(
        activeOnly(
          blobs,
          eq(blobs.id, subjectId),
          eq(blobs.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }
  // No table known yet for this subject type: nothing to hide, so nothing
  // is filtered out on this axis.
  return true;
}

export async function queryFeed<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: QueryFeedInput): Promise<FeedItem[]> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const minLevel = input.minLevel ?? ACCESS_LEVELS.view;

  const conditions = [
    eq(activities.workspaceId, input.workspaceId),
    // A member's own copilot conversation is not the workspace's reading
    // (P4-T14a-a). Excluded here rather than at each caller, so a feed added
    // later cannot forget it.
    notInArray(activities.kind, [...PRIVATE_ACTIVITY_KINDS]),
    // Workspace-public by construction when no context was resolvable;
    // otherwise gated at the reader's own level, exactly like a single read.
    or(
      isNull(activities.contextId),
      accessScopeFilter(activities.contextId, {
        workspaceId: input.workspaceId,
        memberId: input.memberId,
        minLevel,
      }),
    ),
  ];
  if (input.subjectType) {
    conditions.push(eq(activities.subjectType, input.subjectType));
  }
  if (input.subjectId) {
    conditions.push(eq(activities.subjectId, input.subjectId));
  }
  if (input.cursor) {
    conditions.push(lt(activities.at, input.cursor.at));
  }

  // Over-fetches by a fixed factor rather than looping to exactly `limit`:
  // the liveness filter below can drop rows, and a feed page that quietly
  // shrinks under filtering is a worse trade than occasionally returning a
  // few more or fewer than asked, given how rare a deleted subject is.
  const rows = await tx
    .select({
      id: activities.id,
      kind: activities.kind,
      payload: activities.payload,
      actorMemberId: activities.actorMemberId,
      actorKind: activities.actorKind,
      subjectType: activities.subjectType,
      subjectId: activities.subjectId,
      at: activities.at,
    })
    .from(activities)
    .where(and(...conditions))
    .orderBy(desc(activities.at), desc(activities.id))
    .limit(limit * 2);

  const live: FeedItem[] = [];
  for (const row of rows) {
    if (
      await isSubjectLive(tx, input.workspaceId, row.subjectType, row.subjectId)
    ) {
      live.push(row as FeedItem);
    }
    if (live.length >= limit) {
      break;
    }
  }
  return live;
}

/**
 * Collapses consecutive same-actor, same-subject rows of an aggregatable
 * kind into one, keeping the newest and recording how many it absorbed.
 * Never reaches across a differently-kinded or narrative row: aggregation
 * only ever merges a run of the exact same story repeated, not a sequence of
 * different ones.
 */
export interface AggregatedFeedItem extends FeedItem {
  readonly aggregatedCount: number;
}

export function aggregateFeed(
  items: readonly FeedItem[],
  aggregatableKinds: ReadonlySet<string>,
): AggregatedFeedItem[] {
  const result: AggregatedFeedItem[] = [];
  for (const item of items) {
    const last = result.at(-1);
    if (
      last &&
      aggregatableKinds.has(item.kind) &&
      last.kind === item.kind &&
      last.actorMemberId === item.actorMemberId &&
      last.subjectType === item.subjectType &&
      last.subjectId === item.subjectId
    ) {
      // `items` is newest-first; the row already in `result` is newer, so it
      // stays as the visible one and only the count grows.
      result[result.length - 1] = {
        ...last,
        aggregatedCount: last.aggregatedCount + 1,
      };
      continue;
    }
    result.push({ ...item, aggregatedCount: 1 });
  }
  return result;
}
