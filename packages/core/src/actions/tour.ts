/**
 * The first-visit tour (UIUX-PLAN S-34, completeness review L-08).
 *
 * S-34 ends: "Per user on first visit: a five-stop tour covering the Work Map,
 * the review inbox, a check-in, the cycle strip and ⌘K." The stops themselves
 * are words on a screen and live in `apps/web`. What lives here is the one fact
 * the product has to remember, which is whether this member has finished it.
 *
 * **Per member, never per workspace.** The tour is about finding your way
 * around, and a colleague finishing theirs tells you nothing. Both actions
 * therefore act on the caller's own member row and take no member id, so there
 * is no way to ask about, or close, anybody else's.
 */
import { activeOnly, withContext, workspaceMembers } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { OperationError } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const tourState = z.object({
  /** True once this member finished or ended the tour, on any machine. */
  finished: z.boolean(),
});

export const readOwnTour = defineReadAction({
  name: "people.readOwnTour",
  summary: "Whether the signed-in member has finished the first-visit tour.",
  input: z.object({}),
  output: tourState,
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such member.");
    }
    const db = drizzle(context.pool);
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        // The caller's own row and nothing else, which is the whole of the
        // authorisation: a member may always read their own.
        const [me] = await tx
          .select({ finishedAt: workspaceMembers.tourFinishedAt })
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
        if (!me) {
          throw new OperationError("not_found", "No such member.");
        }
        return { finished: me.finishedAt !== null };
      },
    );
  },
});

export const finishOwnTour = defineWriteAction({
  name: "people.finishOwnTour",
  summary:
    "Mark the first-visit tour as finished for the signed-in member, on every machine.",
  input: z.object({}),
  output: tourState,
  // A write, so `edit` (a write declared `view` would be a silent
  // escalation). Every active member holds it through workspace_standard, and
  // `people.` is on the freeze overlay's recovery list, so the tour can be
  // closed in a frozen workspace too.
  access: ACCESS_LEVELS.edit,
  operation: () => ({
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("forbidden", "No member to update.");
      }
      // Finishing twice keeps the first moment. A second press from another
      // tab is the same answer, not a later one.
      const [current] = await tx
        .select({ finishedAt: workspaceMembers.tourFinishedAt })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, actor.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!current) {
        throw new OperationError("not_found", "No such member.");
      }
      if (current.finishedAt === null) {
        // `updated_at` is left alone: closing a tour changes nothing about the
        // person, and the column records its own moment.
        await tx
          .update(workspaceMembers)
          .set({ tourFinishedAt: new Date() })
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.id, actor.memberId),
              eq(workspaceMembers.workspaceId, workspaceId),
            ),
          );
      }

      return {
        result: { finished: true },
        activity: {
          kind: "member.tour_finished",
          subjectType: "workspace_member",
          subjectId: actor.memberId,
          payload: {},
        },
        audit: {
          action: "people.finishOwnTour",
          targetType: "workspace_member",
          targetId: actor.memberId,
        },
      };
    },
  }),
});
