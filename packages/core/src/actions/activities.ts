/**
 * Activity feed actions (TECHNICAL-PLAN §4.11, screen S-31, P2-T07).
 */
import {
  accessContexts,
  activeOnly,
  goals,
  initiatives,
  tasks,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { AGGREGATABLE_KINDS } from "../activities/catalogue.ts";
import { aggregateFeed, type FeedItem, queryFeed } from "../activities/feed.ts";
import { renderActivity } from "../activities/renderers.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { defineReadAction } from "./define.ts";

const feedItem = z.object({
  id: z.uuid(),
  kind: z.string(),
  rendered: z.string(),
  actorMemberId: z.uuid().nullable(),
  subjectType: z.string(),
  subjectId: z.string(),
  at: z.string(),
  aggregatedCount: z.number(),
});

export const workspaceFeed = defineReadAction({
  name: "activities.workspaceFeed",
  summary: "The workspace-scoped activity feed, newest first.",
  input: z.object({
    cursor: z.object({ at: z.string(), id: z.uuid() }).optional(),
  }),
  output: z.array(feedItem),
  access: ACCESS_LEVELS.view,
  /**
   * The one action in the registry that already paged (P5-T07a).
   *
   * The page size is the feed query's own, not the caller's: this action takes
   * no limit, so the public surface does not offer one. A caller who wants
   * smaller pages needs `queryFeed` to accept a limit first, and then it is an
   * ordinary input field.
   */
  page: { cursorFrom: ["at", "id"] },
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const userId = context.actor.userId;
      if (!userId) {
        return [];
      }
      const [member] = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, context.workspaceId),
            eq(workspaceMembers.userId, userId),
            eq(workspaceMembers.status, "active"),
          ),
        )
        .limit(1);
      if (!member) {
        throw new OperationError(
          "not_found",
          "No such workspace, or you are not a member of it.",
        );
      }

      const items = await queryFeed(tx, {
        workspaceId: context.workspaceId,
        memberId: member.id,
        cursor: input.cursor
          ? { at: new Date(input.cursor.at), id: input.cursor.id }
          : undefined,
      });
      const aggregated = aggregateFeed(items, AGGREGATABLE_KINDS);

      return aggregated.map((item) => ({
        id: item.id,
        kind: item.kind,
        rendered: renderActivity(item.kind, item.payload),
        actorMemberId: item.actorMemberId,
        subjectType: item.subjectType,
        subjectId: item.subjectId,
        at: item.at.toISOString(),
        aggregatedCount: item.aggregatedCount,
      }));
    });
  },
});

/**
 * The contexts a space's activity can hang off (P6-G11b).
 *
 * A space owns one, and so does every goal, initiative and task in it. There
 * is no parent chain on `access_contexts`, so "everything in this space" is
 * this set rather than a subtree walk.
 *
 * **Not `activities.space_id`.** That column exists and nine activity blocks
 * out of several hundred set it, so a space feed built on it would be empty
 * for almost everything that happens in a space, which is worse than no feed
 * at all. Recorded here rather than fixed: setting it on every write touches
 * hundreds of call sites and belongs in its own task.
 */
async function spaceContextIds(
  tx: OperationTx,
  workspaceId: string,
  spaceId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: accessContexts.id })
    // openokr:allow-raw-read: the caller has already been through
    // `getAccessScoped` on the space, which is what authorises this, and the
    // feed query below filters every row again at the reader's own level.
    .from(accessContexts)
    .where(
      and(
        activeOnly(accessContexts, eq(accessContexts.workspaceId, workspaceId)),
        or(
          and(
            eq(accessContexts.resourceType, "space"),
            eq(accessContexts.resourceId, spaceId),
          ),
          inArray(
            accessContexts.resourceId,
            tx
              .select({ id: goals.id })
              .from(goals)
              .where(activeOnly(goals, eq(goals.spaceId, spaceId))),
          ),
          inArray(
            accessContexts.resourceId,
            tx
              .select({ id: initiatives.id })
              .from(initiatives)
              .where(activeOnly(initiatives, eq(initiatives.spaceId, spaceId))),
          ),
          inArray(
            accessContexts.resourceId,
            tx
              .select({ id: tasks.id })
              .from(tasks)
              .where(activeOnly(tasks, eq(tasks.spaceId, spaceId))),
          ),
        ),
      ),
    );
  return rows.map((row) => row.id);
}

/** The reader as an active member, or the refusal every feed shares. */
async function feedReader(
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
    throw new OperationError(
      "not_found",
      "No such workspace, or you are not a member of it.",
    );
  }
  return member.id;
}

/** One page of feed rows, rendered. Shared by every scope. */
function renderFeed(items: readonly FeedItem[]) {
  return aggregateFeed(items, AGGREGATABLE_KINDS).map((item) => ({
    id: item.id,
    kind: item.kind,
    rendered: renderActivity(item.kind, item.payload),
    actorMemberId: item.actorMemberId,
    subjectType: item.subjectType,
    subjectId: item.subjectId,
    at: item.at.toISOString(),
    aggregatedCount: item.aggregatedCount,
  }));
}

/**
 * One space's feed (S-31, P6-G11b).
 *
 * **Refused before it is filtered.** The acceptance sentence is that a member
 * without access to a space gets not-found rather than an empty feed, and
 * those are different answers: an empty feed says the space exists and is
 * quiet. `getAccessScoped` is the same call `spaces.read` makes.
 */
export const spaceFeed = defineReadAction({
  name: "activities.spaceFeed",
  summary: "One space's activity feed, newest first.",
  input: z.object({
    spaceId: z.uuid(),
    cursor: z.object({ at: z.string(), id: z.uuid() }).optional(),
  }),
  output: z.array(feedItem),
  access: ACCESS_LEVELS.view,
  page: { cursorFrom: ["at", "id"] },
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (rawTx) => {
      const tx = rawTx as OperationTx;
      const memberId = await feedReader(
        tx,
        context.workspaceId,
        context.actor.userId,
      );
      await getAccessScoped(tx, {
        workspaceId: context.workspaceId,
        memberId,
        resourceType: "space",
        resourceId: input.spaceId,
        requires: ACCESS_LEVELS.view,
      });

      const items = await queryFeed(tx, {
        workspaceId: context.workspaceId,
        memberId,
        contextIds: await spaceContextIds(
          tx,
          context.workspaceId,
          input.spaceId,
        ),
        cursor: input.cursor
          ? { at: new Date(input.cursor.at), id: input.cursor.id }
          : undefined,
      });
      return renderFeed(items);
    });
  },
});

/**
 * One goal's feed (S-31, P6-G11b).
 *
 * **One context id is the whole answer.** A key result and a check-in resolve
 * to the goal's own context, which is why the test plan's "carries its key
 * results and check-ins and not its siblings" needs no list of ids: a sibling
 * goal owns a different context.
 */
export const goalFeed = defineReadAction({
  name: "activities.goalFeed",
  summary: "One goal's activity feed, with its key results and check-ins.",
  input: z.object({
    goalId: z.uuid(),
    cursor: z.object({ at: z.string(), id: z.uuid() }).optional(),
  }),
  output: z.array(feedItem),
  access: ACCESS_LEVELS.view,
  page: { cursorFrom: ["at", "id"] },
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (rawTx) => {
      const tx = rawTx as OperationTx;
      const memberId = await feedReader(
        tx,
        context.workspaceId,
        context.actor.userId,
      );
      const scoped = await getAccessScoped(tx, {
        workspaceId: context.workspaceId,
        memberId,
        resourceType: "goal",
        resourceId: input.goalId,
        requires: ACCESS_LEVELS.view,
      });

      const items = await queryFeed(tx, {
        workspaceId: context.workspaceId,
        memberId,
        contextIds: [scoped.contextId],
        cursor: input.cursor
          ? { at: new Date(input.cursor.at), id: input.cursor.id }
          : undefined,
      });
      return renderFeed(items);
    });
  },
});

/**
 * One member's feed (S-31, P6-G11b).
 *
 * **What they did, not what was done to them.** §6's profile feed is about the
 * actor: a member who was assigned a task is the subject of that row and did
 * nothing at all. Every row is still filtered at the reader's own level, so
 * reading somebody's profile never widens what you can see.
 */
export const profileFeed = defineReadAction({
  name: "activities.profileFeed",
  summary: "What one member did, newest first.",
  input: z.object({
    memberId: z.uuid(),
    cursor: z.object({ at: z.string(), id: z.uuid() }).optional(),
  }),
  output: z.array(feedItem),
  access: ACCESS_LEVELS.view,
  page: { cursorFrom: ["at", "id"] },
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (rawTx) => {
      const tx = rawTx as OperationTx;
      const reader = await feedReader(
        tx,
        context.workspaceId,
        context.actor.userId,
      );

      // The subject has to be a member of this workspace, or a bare uuid would
      // answer "nothing happened" for somebody who does not exist.
      const [subject] = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, context.workspaceId),
            eq(workspaceMembers.id, input.memberId),
          ),
        )
        .limit(1);
      if (!subject) {
        throw new OperationError("not_found", "No such member.");
      }

      const items = await queryFeed(tx, {
        workspaceId: context.workspaceId,
        memberId: reader,
        actorMemberId: input.memberId,
        cursor: input.cursor
          ? { at: new Date(input.cursor.at), id: input.cursor.id }
          : undefined,
      });
      return renderFeed(items);
    });
  },
});
