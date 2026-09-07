/**
 * Activity feed actions (TECHNICAL-PLAN §4.11, screen S-31, P2-T07).
 */
import { activeOnly, withWorkspace, workspaceMembers } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { AGGREGATABLE_KINDS } from "../activities/catalogue.ts";
import { aggregateFeed, queryFeed } from "../activities/feed.ts";
import { renderActivity } from "../activities/renderers.ts";
import { OperationError } from "../operations/operation.ts";
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
