/**
 * Comment and reaction actions (TECHNICAL-PLAN.md §4.10, P3-T16).
 *
 * Comments require the `comment` access level (40) to write. Reactions
 * require `view` (10) to add and can only be removed by their owner.
 * Reading both requires `view`.
 */
import {
  activeOnly,
  COMMENT_SUBJECT_TYPES,
  comments,
  reactions,
  type WorkspaceTx,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import {
  addReaction,
  createComment,
  deleteComment,
  listComments,
  listReactions,
  previewNotify,
  removeReaction,
  updateComment,
} from "../comments/service.ts";
import { OperationError } from "../operations/operation.ts";
import { excerptRichText } from "../rich-text/excerpt.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

function requireMemberId(memberId: string | null | undefined): string {
  if (!memberId) {
    throw new OperationError("forbidden", "A system actor cannot do this.");
  }
  return memberId;
}

/**
 * The acting member, for a **read**.
 *
 * A write gets its member from `runOperation`, which resolves the actor against
 * rows loaded inside the writing transaction. A read never goes through that,
 * so its context carries the user id and nothing else: reading
 * `context.actor.memberId` there is always undefined, and every read here
 * refused with "a system actor cannot do this" until this existed.
 */
async function readingMember<TSchema extends Record<string, unknown>>(
  tx: WorkspaceTx<TSchema>,
  workspaceId: string,
  actor: { readonly memberId?: string | null; readonly userId?: string | null },
): Promise<string> {
  if (actor.memberId) {
    return actor.memberId;
  }
  if (!actor.userId) {
    throw new OperationError("forbidden", "A system actor cannot do this.");
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, actor.userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    // The same answer an outsider gets, so membership is not disclosed.
    throw new OperationError("not_found", "No such workspace.");
  }
  return member.id;
}

const subjectTypeSchema = z.enum(COMMENT_SUBJECT_TYPES);

// ── Reads ─────────────────────────────────────────────────────────────

export const listCommentsAction = defineReadAction({
  name: "comments.list",
  summary: "List comments on a subject",
  input: z.object({
    subjectType: subjectTypeSchema,
    subjectId: z.string().uuid(),
  }),
  output: z.array(
    z.object({
      id: z.string().uuid(),
      subjectType: z.string(),
      subjectId: z.string().uuid(),
      authorMemberId: z.string().uuid(),
      authorName: z.string(),
      body: z.unknown(),
      editedAt: z.date().nullable(),
      createdAt: z.date(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(ctx, input) {
    const db = drizzle(ctx.pool);
    return withWorkspace(db, ctx.workspaceId, async (tx) => {
      await getAccessScoped(tx, {
        workspaceId: ctx.workspaceId,
        memberId: await readingMember(tx, ctx.workspaceId, ctx.actor),
        resourceType: input.subjectType,
        resourceId: input.subjectId,
      });
      return listComments(
        tx,
        ctx.workspaceId,
        input.subjectType,
        input.subjectId,
      );
    });
  },
});

export const listReactionsAction = defineReadAction({
  name: "reactions.list",
  summary: "List reactions on a subject, grouped by emoji",
  input: z.object({
    subjectType: z.string(),
    subjectId: z.string().uuid(),
  }),
  output: z.array(
    z.object({
      emoji: z.string(),
      count: z.number().int(),
      memberIds: z.array(z.string().uuid()),
      own: z.boolean(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(ctx, input) {
    const db = drizzle(ctx.pool);
    return withWorkspace(db, ctx.workspaceId, async (tx) => {
      return listReactions(
        tx,
        ctx.workspaceId,
        input.subjectType,
        input.subjectId,
        await readingMember(tx, ctx.workspaceId, ctx.actor),
      );
    });
  },
});

export const previewNotifyAction = defineReadAction({
  name: "comments.previewNotify",
  summary:
    "Preview who would be notified by a comment with this body on this subject",
  input: z.object({
    subjectType: subjectTypeSchema,
    subjectId: z.string().uuid(),
    body: z.unknown(),
  }),
  output: z.array(z.string().uuid()),
  access: ACCESS_LEVELS.view,
  async handler(ctx, input) {
    const db = drizzle(ctx.pool);
    return withWorkspace(db, ctx.workspaceId, async (tx) => {
      const ids = await previewNotify(
        tx,
        ctx.workspaceId,
        input.subjectType,
        input.subjectId,
        input.body,
      );
      return [...ids];
    });
  },
});

// ── Writes ────────────────────────────────────────────────────────────

export const createCommentAction = defineWriteAction({
  name: "comments.create",
  summary: "Post a comment on a goal, key result, check-in, cycle or document",
  input: z.object({
    subjectType: subjectTypeSchema,
    subjectId: z.string().uuid(),
    body: z.unknown(),
  }),
  output: z.object({ id: z.string().uuid() }),
  access: ACCESS_LEVELS.comment,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const result = await createComment(tx, {
        workspaceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        authorMemberId: requireMemberId(actor.memberId),
        body: input.body,
      });
      return {
        result: { id: result.id },
        activity: {
          kind: "comment.created" as const,
          subjectType: "comment",
          subjectId: result.id,
          payload: {
            subjectType: input.subjectType,
            excerpt: excerptRichText(
              input.body as Parameters<typeof excerptRichText>[0],
              120,
            ),
          },
        },
        audit: {
          action: "comments.create",
          targetType: "comment",
          targetId: result.id,
          payload: { subjectType: input.subjectType },
        },
      };
    },
  }),
});

export const updateCommentAction = defineWriteAction({
  name: "comments.update",
  summary: "Edit a comment (author only)",
  input: z.object({
    commentId: z.string().uuid(),
    body: z.unknown(),
  }),
  output: z.object({}),
  access: ACCESS_LEVELS.comment,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const [comment] = await tx
        .select({
          authorMemberId: comments.authorMemberId,
          subjectType: comments.subjectType,
        })
        .from(comments)
        .where(
          activeOnly(
            comments,
            eq(comments.id, input.commentId),
            eq(comments.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!comment || comment.authorMemberId !== actor.memberId) {
        throw new OperationError(
          "forbidden",
          "Only the author can edit a comment.",
        );
      }
      await updateComment(tx, {
        workspaceId,
        commentId: input.commentId,
        body: input.body,
      });
      return {
        result: {},
        activity: {
          kind: "comment.updated" as const,
          subjectType: "comment",
          subjectId: input.commentId,
          payload: {
            subjectType: comment.subjectType,
            excerpt: excerptRichText(
              input.body as Parameters<typeof excerptRichText>[0],
              120,
            ),
          },
        },
        audit: {
          action: "comments.update",
          targetType: "comment",
          targetId: input.commentId,
          payload: {},
        },
      };
    },
  }),
});

export const deleteCommentAction = defineWriteAction({
  name: "comments.delete",
  summary: "Delete a comment (author or moderator with edit access)",
  input: z.object({ commentId: z.string().uuid() }),
  output: z.object({}),
  access: ACCESS_LEVELS.comment,
  safety: "destructive",
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [comment] = await tx
        .select({
          authorMemberId: comments.authorMemberId,
          subjectType: comments.subjectType,
        })
        .from(comments)
        .where(
          activeOnly(
            comments,
            eq(comments.id, input.commentId),
            eq(comments.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!comment) {
        throw new OperationError("not_found", "Comment not found.");
      }
      await deleteComment(tx, workspaceId, input.commentId);
      return {
        result: {},
        activity: {
          kind: "comment.deleted" as const,
          subjectType: "comment",
          subjectId: input.commentId,
          payload: { subjectType: comment.subjectType },
        },
        audit: {
          action: "comments.delete",
          targetType: "comment",
          targetId: input.commentId,
          payload: {},
        },
      };
    },
  }),
});

export const addReactionAction = defineWriteAction({
  name: "reactions.add",
  summary: "Add a reaction to any subject",
  input: z.object({
    subjectType: z.string(),
    subjectId: z.string().uuid(),
    emoji: z.string().min(1).max(32),
  }),
  output: z.object({ id: z.string().uuid() }),
  // `comment`, not `view`. Reacting is a write, and a write reachable at view
  // is the silent escalation the registry's own invariant exists to stop:
  // anyone who could merely read a goal could attach something to it.
  access: ACCESS_LEVELS.comment,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const result = await addReaction(tx, {
        workspaceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        memberId: requireMemberId(actor.memberId),
        emoji: input.emoji,
      });
      return {
        result: { id: result.id },
        activity: {
          kind: "reaction.added" as const,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          payload: {
            emoji: input.emoji,
            subjectType: input.subjectType,
          },
        },
        audit: {
          action: "reactions.add",
          targetType: input.subjectType,
          targetId: input.subjectId,
          payload: { emoji: input.emoji },
        },
      };
    },
  }),
});

export const removeReactionAction = defineWriteAction({
  name: "reactions.remove",
  summary: "Remove your own reaction",
  input: z.object({ reactionId: z.string().uuid() }),
  output: z.object({}),
  // `comment` for the same reason as adding one. The action refuses anybody
  // but the reaction's own author besides.
  access: ACCESS_LEVELS.comment,
  safety: "destructive",
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const [reaction] = await tx
        .select({
          memberId: reactions.memberId,
          emoji: reactions.emoji,
          subjectType: reactions.subjectType,
          subjectId: reactions.subjectId,
        })
        .from(reactions)
        .where(
          activeOnly(
            reactions,
            eq(reactions.id, input.reactionId),
            eq(reactions.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!reaction || reaction.memberId !== actor.memberId) {
        throw new OperationError(
          "forbidden",
          "You can only remove your own reaction.",
        );
      }
      await removeReaction(tx, workspaceId, input.reactionId);
      return {
        result: {},
        activity: {
          kind: "reaction.removed" as const,
          subjectType: reaction.subjectType,
          subjectId: reaction.subjectId,
          payload: {
            emoji: reaction.emoji,
            subjectType: reaction.subjectType,
          },
        },
        audit: {
          action: "reactions.remove",
          targetType: reaction.subjectType,
          targetId: reaction.subjectId,
          payload: { emoji: reaction.emoji },
        },
      };
    },
  }),
});
