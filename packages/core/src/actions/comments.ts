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
import { assertLegacyKeyFree, legacyKey } from "../imports/legacy.ts";
import { OperationError } from "../operations/operation.ts";
import { excerptRichText } from "../rich-text/excerpt.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";
import { isValidRichText } from "../rich-text/validate.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

/** The same validator every other rich-text write uses: an imported body is
 * held to the schema exactly as a typed one is. */
const richText = z
  .unknown()
  .refine((value) => isValidRichText(value, RICH_TEXT_SCHEMA_VERSION), {
    message: "not valid editor JSON for the current rich text schema",
  });

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
      /**
       * ISO strings, not `Date` objects (P5-T07b).
       *
       * They were `z.date()`, which no JSON surface can carry: the REST
       * response has always sent a string here and the schema said otherwise,
       * and the OpenAPI generator refused to describe it, which is how this was
       * found. Every other action in the registry already declares an ISO
       * string, and the goal page was calling `.toISOString()` on the way into
       * its own component, so this moves that one line to where the contract is
       * declared instead of past it.
       */
      editedAt: z.string().nullable(),
      createdAt: z.string(),
      /** The comment this one answers, or null. Returned so the relationship
       * an import preserved is addressable; no surface renders a thread yet
       * (P6-T04b). */
      parentId: z.string().uuid().nullable(),
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
      const rows = await listComments(
        tx,
        ctx.workspaceId,
        input.subjectType,
        input.subjectId,
      );
      return rows.map((row) => ({
        ...row,
        editedAt: row.editedAt ? row.editedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      }));
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

/**
 * A comment an import found, kept as its author wrote it (P6-T04b).
 *
 * The same trade `goals.importCheckIn` made at P6-T03c and `people
 * .importMember` made at P6-T03a. A task comment from 2023 was written by
 * somebody who may have left, on a day that is not today, sometimes in answer
 * to another comment. `comments.create` posts as the signed-in member, now,
 * answering nothing, which is correct for the product and useless for a
 * migration: the imported conversation would be a wall of remarks by whoever
 * ran the import, all dated the day they ran it.
 *
 * Adding an author and a date to `comments.create` would be worse than a
 * second action: it would let any member post under somebody else's name on
 * any date they chose, which is an impersonation hole opened for a migration's
 * benefit.
 *
 * **`full`, and a legacy key is required.** There is no call to this that is
 * not part of a recorded import run. The body is validated and sanitised the
 * same as any other: `richText` here is the same schema the ordinary write
 * boundary uses, and the HTML the source held was converted before it arrived.
 */
export const importCommentAction = defineWriteAction({
  name: "comments.importComment",
  summary:
    "Records a comment an import found, keeping its author and its date.",
  input: z.object({
    subjectType: subjectTypeSchema,
    subjectId: z.uuid(),
    /** The member who wrote it in the source, not the one running the import. */
    authorMemberId: z.uuid(),
    body: richText,
    /** When the source says it was written. */
    createdAt: z.string(),
    /** Set when the source records that it was edited afterwards. */
    editedAt: z.string().optional(),
    /**
     * The comment this one answers, already imported. The source threads one
     * level deep and so does this: a parent that is itself a reply is the
     * caller's problem, not this action's.
     */
    parentId: z.uuid().optional(),
    /** Required: this action exists for imports and for nothing else. */
    legacy: legacyKey,
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      await assertLegacyKeyFree(
        tx,
        workspaceId,
        comments,
        input.legacy,
        "comment",
      );

      const createdAt = new Date(input.createdAt);
      if (Number.isNaN(createdAt.getTime())) {
        throw new OperationError(
          "forbidden",
          `"${input.createdAt}" is not a date this comment could have been written on.`,
        );
      }
      const editedAt = input.editedAt ? new Date(input.editedAt) : undefined;
      if (editedAt && Number.isNaN(editedAt.getTime())) {
        throw new OperationError(
          "forbidden",
          `"${input.editedAt}" is not a date this comment could have been edited on.`,
        );
      }

      // The author has to be a member of this workspace. Without the check a
      // mistyped id would write a comment nobody can attribute, and the
      // foreign key's error says nothing a person could act on.
      const [author] = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.authorMemberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!author) {
        throw new OperationError(
          "forbidden",
          "No such member to attribute this to.",
        );
      }

      const result = await createComment(tx, {
        workspaceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        authorMemberId: input.authorMemberId,
        body: input.body,
        parentId: input.parentId,
        createdAt,
        editedAt,
        legacy: { type: input.legacy.type, id: input.legacy.id },
      });

      return {
        result: { id: result.id },
        activity: {
          kind: "comment.created" as const,
          subjectType: "comment",
          subjectId: result.id,
          payload: {
            subjectType: input.subjectType,
            imported: true,
            excerpt: excerptRichText(
              input.body as Parameters<typeof excerptRichText>[0],
              120,
            ),
          },
        },
        audit: {
          action: "comments.importComment",
          targetType: "comment",
          targetId: result.id,
          payload: {
            subjectType: input.subjectType,
            legacyType: input.legacy.type,
            legacyId: input.legacy.id,
          },
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
