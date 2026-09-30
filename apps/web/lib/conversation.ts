import { type ActionCallContext, callAction } from "@openokr/core";
import type { CommentSubjectType } from "./comment-actions.ts";
import type { CommentData, ReactionGroupData } from "./comments.tsx";

/** What `SubjectComments` draws: the thread, and the subject's own reactions. */
interface Conversation {
  readonly comments: readonly CommentData[];
  readonly reactions: readonly ReactionGroupData[];
}

const groupsOf = (
  groups: readonly {
    emoji: string;
    count: number;
    own: boolean;
    ownReactionId: string | null;
  }[],
): ReactionGroupData[] =>
  groups.map((group) => ({
    emoji: group.emoji,
    count: group.count,
    own: group.own,
    ownReactionId: group.ownReactionId,
  }));

/**
 * A subject's discussion, read on the server (completeness review M-01).
 *
 * Every page that mounts `SubjectComments` needs the same three reads: the
 * comments, the reactions on each, and the reactions on the subject itself. It
 * was written out on the goal page when that was the only page with a
 * thread, and four copies of it would be four places to forget the reactions.
 *
 * **One read per comment.** A thread is small, and the alternative is a
 * batched read nobody has needed yet; if a subject ever carries hundreds of
 * comments, that is the moment to add one rather than now.
 *
 * Both actions ask whether the reader reads the subject, and refuse with
 * not-found when they do not. The page has already read the subject itself by
 * then, so a refusal here is not expected and is left to the page's error
 * boundary rather than drawn as an empty thread.
 */
export async function readConversation(
  context: ActionCallContext,
  subjectType: CommentSubjectType,
  subjectId: string,
): Promise<Conversation> {
  const [comments, onSubject] = await Promise.all([
    callAction(context, "comments.list", { subjectType, subjectId }),
    callAction(context, "reactions.list", { subjectType, subjectId }),
  ]);
  const withReactions: CommentData[] = [];
  for (const comment of comments) {
    const groups = await callAction(context, "reactions.list", {
      subjectType: "comment",
      subjectId: comment.id,
    });
    withReactions.push({ ...comment, reactions: groupsOf(groups) });
  }
  return { comments: withReactions, reactions: groupsOf(onSubject) };
}
