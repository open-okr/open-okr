"use server";

/**
 * The writes behind every comment thread (P3-T16, completeness review M-01).
 *
 * **Moved from the goal page, which was the only caller.** An initiative, a
 * task and a document carry a thread now, so the four writes live beside the
 * thread rather than inside one of the pages that shows it.
 *
 * **The whole tree is revalidated, not one page.** A comment is on a subject
 * and shows on that subject's page, and it is also a line in the feed of the
 * goal, the space and the workspace above it. `revalidatePath("/", "layout")`
 * is what the attachment writes beside this file already do for the same
 * reason.
 *
 * Nothing here decides who may write: `comments.*` and `reactions.*` ask
 * whether the caller reads the subject, and the refusal they return is shown.
 */
import {
  callAction,
  OperationError,
  type RichTextDocument,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { NO_ERROR, type WriteState } from "../app/cycle/write-state.ts";
import { getPool } from "./auth";
import { getTranslations } from "./translations";
import { requireWorkspace } from "./workspace";

/** What a thread can be about. The action's own enum is what refuses others. */
export type CommentSubjectType =
  | "goal"
  | "key_result"
  | "check_in"
  | "cycle"
  | "document"
  | "task"
  | "initiative";

async function run(
  write: (context: {
    pool: ReturnType<typeof getPool>;
    workspaceId: string;
    actor: { kind: "human"; userId: string };
  }) => Promise<unknown>,
  failedKey: string,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  try {
    await write({
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    });
  } catch (error) {
    const { t } = await getTranslations();
    return {
      error: error instanceof OperationError ? error.message : t(failedKey),
    };
  }
  revalidatePath("/", "layout");
  return NO_ERROR;
}

export async function postComment(input: {
  readonly subjectType: CommentSubjectType;
  readonly subjectId: string;
  // Typed rather than `unknown`, as the document action is: the composer
  // hands back editor JSON, and the action validates it again at the boundary.
  readonly body: RichTextDocument;
}): Promise<WriteState> {
  return run(
    (context) =>
      callAction(context, "comments.create", {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        body: input.body,
      }),
    "comments.actions.failedToPostComment",
  );
}

export async function editComment(
  commentId: string,
  body: RichTextDocument,
): Promise<WriteState> {
  return run(
    (context) => callAction(context, "comments.update", { commentId, body }),
    "comments.actions.failedToEditComment",
  );
}

export async function deleteCommentAction(
  commentId: string,
): Promise<WriteState> {
  return run(
    (context) => callAction(context, "comments.delete", { commentId }),
    "comments.actions.failedToDeleteComment",
  );
}

/**
 * Reacting, and taking it back (P6-G27).
 *
 * **It was named a toggle and only ever added.** `reactions.remove` shipped
 * with the reaction and had no browser caller, so pressing an emoji a second
 * time did nothing and a reaction given by mistake stayed for good. The read
 * now hands back the caller's own reaction id, which is the one thing this
 * needed.
 */
export async function toggleReaction(
  subjectType: string,
  subjectId: string,
  emoji: string,
  /** The caller's existing reaction with this emoji, when there is one. */
  ownReactionId?: string | null,
): Promise<WriteState> {
  return run(async (context) => {
    if (ownReactionId) {
      await callAction(context, "reactions.remove", {
        reactionId: ownReactionId,
      });
    } else {
      await callAction(context, "reactions.add", {
        subjectType,
        subjectId,
        emoji,
      });
    }
  }, "comments.actions.failedToChangeTheReaction");
}

/**
 * Who `@` offers in a comment, by name (docs/design/guided-inputs.md §4.7).
 *
 * People and guests who are active: a mention tells the person named, and
 * an agent, a placeholder or somebody suspended would be told nothing. Eight
 * at most, because a list longer than a glance is a search that has not
 * narrowed yet. The directory read is the one the people page uses, so it
 * shows nobody the reader could not already see.
 */
export async function searchMentionable(
  query: string,
): Promise<readonly { readonly id: string; readonly label: string }[]> {
  const { session, workspace } = await requireWorkspace();
  const people = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "people.directory",
    {},
  );
  const needle = query.trim().toLowerCase();
  return people
    .filter(
      (person) =>
        person.status === "active" &&
        (person.kind === "human" || person.kind === "guest") &&
        person.name.toLowerCase().includes(needle),
    )
    .slice(0, 8)
    .map((person) => ({ id: person.id, label: person.name }));
}
