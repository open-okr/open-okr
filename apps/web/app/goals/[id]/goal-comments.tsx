"use client";

import {
  deleteCommentAction,
  editComment,
  postComment,
  toggleReaction,
} from "./actions.ts";
/**
 * The goal page's discussion, wired (P3-T16).
 *
 * `CommentThread` takes its four writes as props so the thread itself stays a
 * plain component. This is the piece that binds them to the server actions,
 * and it exists because a client component cannot be handed a server action
 * whose return type is a `WriteState` where the prop expects nothing: the
 * adapters below are that one-line difference.
 *
 * Until this file existed the actions were written and nothing called them,
 * which `pnpm dead-code` reported and which meant the whole discussion surface
 * was unreachable rather than merely incomplete.
 */
import { type CommentData, CommentThread } from "./comments.tsx";

export function GoalComments({
  goalId,
  comments,
  currentMemberId,
}: {
  readonly goalId: string;
  readonly comments: readonly CommentData[];
  readonly currentMemberId: string;
}) {
  return (
    <CommentThread
      subjectType="goal"
      subjectId={goalId}
      comments={comments}
      currentMemberId={currentMemberId}
      onPost={async (body) => {
        await postComment({ subjectType: "goal", subjectId: goalId, body });
      }}
      onEdit={async (commentId, body) => {
        await editComment(commentId, body);
      }}
      onDelete={async (commentId) => {
        await deleteCommentAction(commentId);
      }}
      onReact={async (subjectType, subjectId, emoji) => {
        await toggleReaction(subjectType, subjectId, emoji);
      }}
    />
  );
}
