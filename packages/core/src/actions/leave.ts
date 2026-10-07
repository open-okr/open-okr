/**
 * A member's leave, with a delegate (METHOD.md §7.4, P9-T19b-b, the
 * Northwind year's gap G-2).
 *
 * "A member marks their own leave, with a delegate." Two writes, the way the
 * profile has two: a member sets their own at the edit level, and an
 * administrator sets anybody's at the full level. One action deciding which
 * by comparing ids would be an access rule written beside `can()` rather than
 * through it.
 *
 * The list is written whole, as each screen edits it, and the rows it
 * replaces are soft-deleted so the audit trail still says what the calendar
 * held. A leave changes nobody's roles: the nudge run and a check-in's
 * reviewer of record ask who stands in on the day.
 */
import {
  activeOnly,
  memberLeave,
  type WorkspaceTx,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { OperationError } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const leaveSpan = z
  .object({
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    /** Who stands in while they are away. */
    delegateId: z.uuid(),
  })
  .refine((span) => span.endsOn >= span.startsOn, {
    message: "Leave ends on or after the day it starts.",
  });

const leaveRow = z.object({
  startsOn: z.string(),
  endsOn: z.string(),
  delegateId: z.uuid(),
  delegateName: z.string(),
});

type LeaveSpan = z.infer<typeof leaveSpan>;

/**
 * Replaces one member's leave, inside the calling operation. Every delegate
 * is somebody else, and an active member of this workspace: leave handed to
 * a suspended colleague is leave handed to nobody.
 */
async function replaceLeaveInTx(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly leave: readonly LeaveSpan[];
  },
): Promise<string> {
  const [member] = await tx
    .select({ name: workspaceMembers.name })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, input.workspaceId),
        eq(workspaceMembers.id, input.memberId),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError("not_found", "No such member.");
  }

  const delegates = [...new Set(input.leave.map((span) => span.delegateId))];
  if (delegates.includes(input.memberId)) {
    throw new OperationError(
      "forbidden",
      "Somebody else stands in while you are away. Choose a delegate who is not you.",
    );
  }
  if (delegates.length > 0) {
    const found = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.workspaceId, input.workspaceId),
          inArray(workspaceMembers.id, delegates),
          eq(workspaceMembers.status, "active"),
        ),
      );
    if (found.length !== delegates.length) {
      throw new OperationError(
        "forbidden",
        "A delegate has to be an active member of this workspace.",
      );
    }
  }

  const now = new Date();
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(memberLeave)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      activeOnly(
        memberLeave,
        eq(memberLeave.workspaceId, input.workspaceId),
        eq(memberLeave.memberId, input.memberId),
      ),
    );
  if (input.leave.length > 0) {
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx.insert(memberLeave).values(
      input.leave.map((span) => ({
        workspaceId: input.workspaceId,
        memberId: input.memberId,
        startsOn: span.startsOn,
        endsOn: span.endsOn,
        delegateMemberId: span.delegateId,
      })),
    );
  }
  return member.name;
}

const sorted = (leave: readonly LeaveSpan[]) =>
  [...leave].sort((a, b) => a.startsOn.localeCompare(b.startsOn));

export const setOwnLeave = defineWriteAction({
  name: "people.setLeave",
  summary:
    "Sets the signed-in member's own leave, each span with the delegate who stands in (METHOD.md §7.4).",
  input: z.object({ leave: z.array(leaveSpan).max(20) }),
  output: z.object({ memberId: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("not_found", "No such member.");
      }
      const leave = sorted(input.leave);
      const name = await replaceLeaveInTx(tx, {
        workspaceId,
        memberId: actor.memberId,
        leave,
      });
      return {
        result: { memberId: actor.memberId },
        activity: {
          kind: "member.leaveSet",
          subjectType: "workspace_member",
          subjectId: actor.memberId,
          payload: { name, count: leave.length },
        },
        audit: {
          action: "people.setLeave",
          targetType: "workspace_member",
          targetId: actor.memberId,
          payload: { leave },
        },
      };
    },
  }),
});

export const setMemberLeave = defineWriteAction({
  name: "people.setMemberLeave",
  summary:
    "Sets another member's leave, each span with the delegate who stands in (METHOD.md §7.4). For an administrator.",
  input: z.object({
    memberId: z.uuid(),
    leave: z.array(leaveSpan).max(20),
  }),
  output: z.object({ memberId: z.uuid() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const leave = sorted(input.leave);
      const name = await replaceLeaveInTx(tx, {
        workspaceId,
        memberId: input.memberId,
        leave,
      });
      return {
        result: { memberId: input.memberId },
        activity: {
          kind: "member.leaveSet",
          subjectType: "workspace_member",
          subjectId: input.memberId,
          payload: { name, count: leave.length },
        },
        audit: {
          action: "people.setMemberLeave",
          targetType: "workspace_member",
          targetId: input.memberId,
          payload: { leave },
        },
      };
    },
  }),
});

export const readLeave = defineReadAction({
  name: "people.leave",
  summary:
    "One member's leave, oldest first, with who stands in for each span (METHOD.md §7.4).",
  input: z.object({ memberId: z.uuid() }),
  output: z.array(leaveRow),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such member.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        // The reader is an active member; a suspended one reads nothing.
        const [reader] = await tx
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
        if (!reader) {
          throw new OperationError("not_found", "No such member.");
        }
        return tx
          .select({
            startsOn: memberLeave.startsOn,
            endsOn: memberLeave.endsOn,
            delegateId: memberLeave.delegateMemberId,
            delegateName: workspaceMembers.name,
          })
          .from(memberLeave)
          .innerJoin(
            workspaceMembers,
            eq(workspaceMembers.id, memberLeave.delegateMemberId),
          )
          .where(
            activeOnly(
              memberLeave,
              and(
                eq(memberLeave.workspaceId, context.workspaceId),
                eq(memberLeave.memberId, input.memberId),
              ),
            ),
          )
          .orderBy(asc(memberLeave.startsOn));
      },
    );
  },
});
