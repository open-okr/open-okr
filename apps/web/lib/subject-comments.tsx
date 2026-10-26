"use client";

import { useTranslations } from "@openokr/ui";
import { useState, useTransition } from "react";
import type { WriteState } from "../app/cycle/write-state.ts";
import {
  type CommentSubjectType,
  deleteCommentAction,
  editComment,
  postComment,
  searchMentionable,
  toggleReaction,
} from "./comment-actions.ts";
import {
  type CommentData,
  CommentThread,
  type ReactionGroupData,
  ReactionRow,
} from "./comments.tsx";

/**
 * A subject's discussion, wired (P3-T16, completeness review M-01).
 *
 * `CommentThread` takes its four writes as props so the thread itself stays a
 * plain component. This is the piece that binds them to the server actions,
 * and it exists because a client component cannot be handed a server action
 * whose return type is a `WriteState` where the prop expects nothing: the
 * adapters below are that one-line difference.
 *
 * **It was the goal's, and now it is any subject's.** It began as
 * `GoalComments` with "goal" written into every call, which is why the goal
 * page was the only page with a discussion. The subject is a prop now, and the
 * initiative, the task and the document mount the same thing.
 *
 * **Reactions on the subject itself sit above the thread** (TECHNICAL-PLAN
 * §4.10: "on every major subject, not only comments"). The demo seeded
 * reactions on goals that no screen ever drew.
 *
 * **A refusal is said, beside the thread.** The adapters used to drop what
 * the write returned, so a comment the action refused simply did not appear.
 */
export function SubjectComments({
  subjectType,
  subjectId,
  comments,
  reactions,
  currentMemberId,
}: {
  readonly subjectType: CommentSubjectType;
  readonly subjectId: string;
  readonly comments: readonly CommentData[];
  /** The reactions on the subject itself, not on any comment. */
  readonly reactions: readonly ReactionGroupData[];
  readonly currentMemberId: string;
}) {
  const { t } = useTranslations();
  const [, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const said = (result: WriteState) => setProblem(result.error);

  return (
    <div className="flex flex-col gap-4">
      {/* A named group, so a screen reader hears whose reactions these are
          before it hears "+1". A `fieldset` rather than a `div role="group"`,
          for the reason the goals page's filters give. */}
      <fieldset
        aria-label={t("comments.thread.reactions")}
        className="flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
        data-testid="subject-reactions"
      >
        <ReactionRow
          groups={reactions}
          onReact={(emoji, ownReactionId) =>
            start(async () => {
              said(
                await toggleReaction(
                  subjectType,
                  subjectId,
                  emoji,
                  ownReactionId,
                ),
              );
            })
          }
        />
      </fieldset>
      <CommentThread
        subjectType={subjectType}
        subjectId={subjectId}
        comments={comments}
        currentMemberId={currentMemberId}
        onPost={async (body) => {
          const result = await postComment({ subjectType, subjectId, body });
          said(result);
          return result.error === null;
        }}
        searchMembers={searchMentionable}
        onEdit={async (commentId, body) => {
          said(await editComment(commentId, body));
        }}
        onDelete={async (commentId) => {
          said(await deleteCommentAction(commentId));
        }}
        onReact={async (reactedType, reactedId, emoji, ownReactionId) => {
          said(
            await toggleReaction(reactedType, reactedId, emoji, ownReactionId),
          );
        }}
      />
      {problem ? (
        <span role="alert" className="text-xs text-bad">
          {problem}
        </span>
      ) : null}
    </div>
  );
}
