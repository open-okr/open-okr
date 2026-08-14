/**
 * Comment and reaction actions (TECHNICAL-PLAN.md §4.10, P3-T16).
 *
 * Comments require the `comment` access level (40) to write. Reactions
 * require `view` (10) to add and can only be removed by their owner.
 * Reading both requires `view`.
 */
import { COMMENT_SUBJECT_TYPES } from "@openokr/db";
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

const subjectType = z.enum(COMMENT_SUBJECT_TYPES);

// ── Reads ─────────────────────────────────────────────────────────────

export const listCommentsAction = defineReadAction({
  name: "comments.list",
  summary: "List comments on a subject",
  input: z.object({
    subjectType,
    subjectId: z.uuid(),
  }),
  output: z.array(
    z.object({
      id: z.uuid(),
      subjectType: z.string(),
      subjectId: z.uuid(),
      authorMemberId: z.uuid(),
      authorName: z.string(),
      body: z.unknown(),
      editedAt: z.date().nullable(),
      createdAt: z.date(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(ctx, input) {
    const { pool, workspaceId, actor } = ctx;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { withWorkspace } = await import("@openokr/db");
    const db = drizzle(pool);
    return withWorkspace(db, workspaceId, async (tx) => {
      // Access check on the parent subject
      await getAccessScoped(tx, {
        workspaceId,
        memberId: actor.memberId,
        resourceType: input.subjectType,
        resourceId: input.subjectId,
      });
      return listComments(tx, workspaceId, input.subjectType, input.subjectId);
    });
  },
});

export const listReactionsAction = defineReadAction({
  name: "reactions.list",
  summary: "List reactions on a subject, grouped by emoji",
  input: z.object({
    subjectType: z.string(),
    subjectId: z.uuid(),
  }),
  output: z.array(
    z.object({
      emoji: z.string(),
      count: z.number().int(),
      memberIds: z.array(z.uuid()),
      own: z.boolean(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(ctx, input) {
    const { pool, workspaceId, actor } = ctx;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { withWorkspace } = await import("@openokr/db");
    const db = drizzle(pool);
    return withWorkspace(db, workspaceId, async (tx) => {
      return listReactions(
        tx,
        workspaceId,
        input.subjectType,
        input.subjectId,
        actor.memberId,
      );
    });
  },
});

export const previewNotifyAction = defineReadAction({
  name: "comments.previewNotify",
  summary:
    "Preview who would be notified by a comment with this body on this subject",
  input: z.object({
    subjectType,
    subjectId: z.uuid(),
    body: z.unknown(),
  }),
  output: z.array(z.uuid()),
  access: ACCESS_LEVELS.view,
  async handler(ctx, input) {
    const { pool, workspaceId } = ctx;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { withWorkspace } = await import("@openokr/db");
    const db = drizzle(pool);
    return withWorkspace(db, workspaceId, async (tx) => {
      return [
        ...(await previewNotify(
          tx,
          workspaceId,
          input.subjectType,
          input.subjectId,
          input.body,
        )),
      ];
    });
  },
});

// ── Writes ────────────────────────────────────────────────────────────

export const createCommentAction = defineWriteAction({
  name: "comments.create",
  summary: "Post a comment on a goal, key result, check-in, cycle or document",
  input: z.object({
    subjectType,
    subjectId: z.uuid(),
    body: z.unknown(),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.comment,
  spec: {
    subjectType: "comment",
    subjectIdFrom: "result",
    async execute(tx, input, actor, workspaceId) {
      const result = await createComment(tx, {
        workspaceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        authorMemberId: actor.memberId,
        body: input.body,
      });
      return {
        result: { id: result.id },
        subjectId: result.id,
        activity: {
          kind: "comment.created" as const,
          payload: {
            subjectType: input.subjectType,
            excerpt: excerptRichText(input.body, 120),
          },
        },
      };
    },
  },
});

export const updateCommentAction = defineWriteAction({
  name: "comments.update",
  summary: "Edit a comment (author only)",
  input: z.object({
    commentId: z.uuid(),
    body: z.unknown(),
  }),
  output: z.object({}),
  access: ACCESS_LEVELS.comment,
  spec: {
    subjectType: "comment",
    subjectIdFrom: "input",
    subjectIdField: "commentId",
    async execute(tx, input, actor, workspaceId) {
      // Author-only check
      const { comments: commentsTable } = await import("@openokr/db");
      const { activeOnly } = await import("@openokr/db");
      const { eq } = await import("drizzle-orm");
      const [comment] = await tx
        .select({ authorMemberId: commentsTable.authorMemberId, subjectType: commentsTable.subjectType })
        .from(commentsTable)
        .where(
          activeOnly(
            commentsTable,
            eq(commentsTable.id, input.commentId),
            eq(commentsTable.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!comment || comment.authorMemberId !== actor.memberId) {
        throw new OperationError("forbidden", "Only the author can edit a comment.");
      }
      await updateComment(tx, {
        workspaceId,
        commentId: input.commentId,
        body: input.body,
      });
      return {
        result: {},
        subjectId: input.commentId,
        activity: {
          kind: "comment.updated" as const,
          payload: {
            subjectType: comment.subjectType,
            excerpt: excerptRichText(input.body, 120),
          },
        },
      };
    },
  },
});

export const deleteCommentAction = defineWriteAction({
  name: "comments.delete",
  summary: "Delete a comment (author or moderator with edit access)",
  input: z.object({ commentId: z.uuid() }),
  output: z.object({}),
  access: ACCESS_LEVELS.comment,
  spec: {
    subjectType: "comment",
    subjectIdFrom: "input",
    subjectIdField: "commentId",
    safety: "destructive",
    async execute(tx, input, actor, workspaceId) {
      const { comments: commentsTable } = await import("@openokr/db");
      const { activeOnly } = await import("@openokr/db");
      const { eq } = await import("drizzle-orm");
      const [comment] = await tx
        .select({ authorMemberId: commentsTable.authorMemberId, subjectType: commentsTable.subjectType })
        .from(commentsTable)
        .where(
          activeOnly(
            commentsTable,
            eq(commentsTable.id, input.commentId),
            eq(commentsTable.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!comment) {
        throw new OperationError("not_found", "Comment not found.");
      }
      await deleteComment(tx, workspaceId, input.commentId);
      return {
        result: {},
        subjectId: input.commentId,
        activity: {
          kind: "comment.deleted" as const,
          payload: { subjectType: comment.subjectType },
        },
      };
    },
  },
});

export const addReactionAction = defineWriteAction({
  name: "reactions.add",
  summary: "Add a reaction to any subject",
  input: z.object({
    subjectType: z.string(),
    subjectId: z.uuid(),
    emoji: z.string().min(1).max(32),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.view,
  spec: {
    subjectType: "reaction",
    subjectIdFrom: "result",
    async execute(tx, input, actor, workspaceId) {
      const result = await addReaction(tx, {
        workspaceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        memberId: actor.memberId,
        emoji: input.emoji,
      });
      return {
        result: { id: result.id },
        subjectId: result.id,
        activity: {
          kind: "reaction.added" as const,
          payload: {
            emoji: input.emoji,
            subjectType: input.subjectType,
          },
        },
      };
    },
  },
});

export const removeReactionAction = defineWriteAction({
  name: "reactions.remove",
  summary: "Remove your own reaction",
  input: z.object({ reactionId: z.uuid() }),
  output: z.object({}),
  access: ACCESS_LEVELS.view,
  spec: {
    subjectType: "reaction",
    subjectIdFrom: "input",
    subjectIdField: "reactionId",
    safety: "destructive",
    async execute(tx, input, actor, workspaceId) {
      // Own-only check
      const { reactions: reactionsTable } = await import("@openokr/db");
      const { activeOnly } = await import("@openokr/db");
      const { eq } = await import("drizzle-orm");
      const [reaction] = await tx
        .select({ memberId: reactionsTable.memberId, emoji: reactionsTable.emoji, subjectType: reactionsTable.subjectType })
        .from(reactionsTable)
        .where(
          activeOnly(
            reactionsTable,
            eq(reactionsTable.id, input.reactionId),
            eq(reactionsTable.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!reaction || reaction.memberId !== actor.memberId) {
        throw new OperationError("forbidden", "You can only remove your own reaction.");
      }
      await removeReaction(tx, workspaceId, input.reactionId);
      return {
        result: {},
        subjectId: input.reactionId,
        activity: {
          kind: "reaction.removed" as const,
          payload: {
            emoji: reaction.emoji,
            subjectType: reaction.subjectType,
          },
        },
      };
    },
  },
});
