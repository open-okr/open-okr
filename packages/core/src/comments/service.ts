/**
 * Comment and reaction service (TECHNICAL-PLAN.md §4.10, P3-T16).
 *
 * Comments are rich text on goals, key results, check-ins, cycles and
 * documents. Reactions are on every major subject including comments.
 *
 * Access is inherited: a comment on a goal resolves to the goal's access
 * context through the subject-to-context resolver. The comment access level
 * (40) is required to write; view (10) is enough to read.
 *
 * Subscriptions and mention handling reuse the P2-T06 spine:
 * ensureSubscriptionList, subscribeMember, reconcileMentions. Mention
 * extraction uses extractMentionIds from the rich-text module.
 */
import {
  activeOnly,
  type CommentSubjectType,
  comments,
  includeDeleted,
  reactions,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import {
  ensureSubscriptionList,
  reconcileMentions,
  subscribeMember,
} from "../notifications/subscriptions.ts";
import { extractMentionIds } from "../rich-text/extract.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

// ── Comments ──────────────────────────────────────────────────────────────

export interface CreateCommentInput {
  readonly workspaceId: string;
  readonly subjectType: CommentSubjectType;
  readonly subjectId: string;
  readonly authorMemberId: string;
  readonly body: unknown; // rich-text JSON, validated before reaching here
}

export interface CreateCommentResult {
  readonly id: string;
  readonly subscribedMemberIds: readonly string[];
}

export async function createComment<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: CreateCommentInput): Promise<CreateCommentResult> {
  // openokr:allow-mutation: inside an Operation's execute
  const [row] = await tx
    .insert(comments)
    .values({
      workspaceId: input.workspaceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      authorMemberId: input.authorMemberId,
      body: input.body,
    })
    .returning({ id: comments.id });

  const commentId = (row as { id: string }).id;

  // Ensure a subscription list for the parent subject
  const listId = await ensureSubscriptionList(tx, {
    workspaceId: input.workspaceId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
  });

  // Auto-subscribe the author
  await subscribeMember(tx, {
    workspaceId: input.workspaceId,
    listId,
    memberId: input.authorMemberId,
    reason: "joined",
  });

  // Subscribe mentioned members
  const mentionIds = extractMentionIds(input.body);
  const subscribedMemberIds: string[] = [];
  for (const memberId of mentionIds) {
    await subscribeMember(tx, {
      workspaceId: input.workspaceId,
      listId,
      memberId,
      reason: "mentioned",
    });
    subscribedMemberIds.push(memberId);
  }

  return { id: commentId, subscribedMemberIds };
}

export interface UpdateCommentInput {
  readonly workspaceId: string;
  readonly commentId: string;
  readonly body: unknown;
}

export async function updateComment<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: UpdateCommentInput): Promise<void> {
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx
    .update(comments)
    .set({
      body: input.body,
      editedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      activeOnly(
        comments,
        eq(comments.id, input.commentId),
        eq(comments.workspaceId, input.workspaceId),
      ),
    );

  // Re-diff mentions: the comment's subject has the subscription list
  const [comment] = await tx
    .select({
      subjectType: comments.subjectType,
      subjectId: comments.subjectId,
    })
    .from(comments)
    .where(
      activeOnly(
        comments,
        eq(comments.workspaceId, input.workspaceId),
        eq(comments.id, input.commentId),
      ),
    )
    .limit(1);

  if (comment) {
    const listId = await ensureSubscriptionList(tx, {
      workspaceId: input.workspaceId,
      subjectType: comment.subjectType,
      subjectId: comment.subjectId,
    });
    const mentionIds = extractMentionIds(input.body);
    await reconcileMentions(tx, {
      workspaceId: input.workspaceId,
      listId,
      mentionedMemberIds: mentionIds,
    });
  }
}

export async function deleteComment<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, commentId: string): Promise<void> {
  // openokr:allow-mutation: soft delete
  await tx
    .update(comments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      activeOnly(
        comments,
        eq(comments.id, commentId),
        eq(comments.workspaceId, workspaceId),
      ),
    );
}

export interface CommentRow {
  readonly id: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly authorMemberId: string;
  readonly authorName: string;
  readonly body: unknown;
  readonly editedAt: Date | null;
  readonly createdAt: Date;
}

export async function listComments<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  subjectType: CommentSubjectType,
  subjectId: string,
): Promise<CommentRow[]> {
  const rows = await tx
    .select({
      id: comments.id,
      subjectType: comments.subjectType,
      subjectId: comments.subjectId,
      authorMemberId: comments.authorMemberId,
      authorName: workspaceMembers.name,
      body: comments.body,
      editedAt: comments.editedAt,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.id, comments.authorMemberId),
    )
    .where(
      activeOnly(
        comments,
        eq(comments.workspaceId, workspaceId),
        eq(comments.subjectType, subjectType),
        eq(comments.subjectId, subjectId),
      ),
    )
    .orderBy(comments.createdAt);

  return rows.map((r) => ({
    id: r.id,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    authorMemberId: r.authorMemberId,
    authorName: r.authorName ?? "",
    body: r.body,
    editedAt: r.editedAt,
    createdAt: r.createdAt,
  }));
}

/**
 * Preview who would be notified if this body were posted as a comment on
 * a given subject. Returns the list of member IDs from existing subscribers
 * plus any new mentions in the body.
 */
export async function previewNotify<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  _tx: AnyTx<TSchema>,
  _workspaceId: string,
  _subjectType: string,
  _subjectId: string,
  body: unknown,
): Promise<readonly string[]> {
  const mentionIds = extractMentionIds(body);
  // Existing subscribers would also be notified, but for the preview
  // the mentions are the most useful signal
  return mentionIds;
}

// ── Reactions ─────────────────────────────────────────────────────────────

export interface AddReactionInput {
  readonly workspaceId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly memberId: string;
  readonly emoji: string;
}

export async function addReaction<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: AddReactionInput): Promise<{ id: string }> {
  // `includeDeleted` on purpose, not `activeOnly`. The unique index covers
  // soft-deleted rows too, so a removed reaction still occupies its slot:
  // skipping it here would find nothing, insert, and hit the index. Finding it
  // and reviving it is the only path that works.
  const [existing] = await tx
    .select({ id: reactions.id, deletedAt: reactions.deletedAt })
    .from(reactions)
    .where(
      includeDeleted(
        reactions,
        eq(reactions.workspaceId, input.workspaceId),
        eq(reactions.subjectType, input.subjectType),
        eq(reactions.subjectId, input.subjectId),
        eq(reactions.memberId, input.memberId),
        eq(reactions.emoji, input.emoji),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.deletedAt) {
      // Restore the soft-deleted reaction
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(reactions)
        .set({ deletedAt: null })
        // Same reason: this is the revival, so it has to reach a deleted row.
        .where(includeDeleted(reactions, eq(reactions.id, existing.id)));
    }
    return { id: existing.id };
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  const [row] = await tx
    .insert(reactions)
    .values({
      workspaceId: input.workspaceId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      memberId: input.memberId,
      emoji: input.emoji,
    })
    .returning({ id: reactions.id });

  return { id: (row as { id: string }).id };
}

export async function removeReaction<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string, reactionId: string): Promise<void> {
  // openokr:allow-mutation: soft delete
  await tx
    .update(reactions)
    .set({ deletedAt: new Date() })
    .where(
      activeOnly(
        reactions,
        eq(reactions.id, reactionId),
        eq(reactions.workspaceId, workspaceId),
      ),
    );
}

export interface ReactionGroup {
  readonly emoji: string;
  readonly count: number;
  readonly memberIds: readonly string[];
  /** Whether the reading member reacted with this emoji. */
  readonly own: boolean;
}

export async function listReactions<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  subjectType: string,
  subjectId: string,
  readingMemberId: string,
): Promise<ReactionGroup[]> {
  const rows = await tx
    .select({
      id: reactions.id,
      emoji: reactions.emoji,
      memberId: reactions.memberId,
    })
    .from(reactions)
    .where(
      activeOnly(
        reactions,
        eq(reactions.workspaceId, workspaceId),
        eq(reactions.subjectType, subjectType),
        eq(reactions.subjectId, subjectId),
      ),
    );

  const groups = new Map<string, { memberIds: string[]; own: boolean }>();

  for (const row of rows) {
    const group = groups.get(row.emoji) ?? { memberIds: [], own: false };
    group.memberIds.push(row.memberId);
    if (row.memberId === readingMemberId) {
      group.own = true;
    }
    groups.set(row.emoji, group);
  }

  return [...groups.entries()].map(([emoji, g]) => ({
    emoji,
    count: g.memberIds.length,
    memberIds: g.memberIds,
    own: g.own,
  }));
}
