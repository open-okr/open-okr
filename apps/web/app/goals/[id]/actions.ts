"use server";

/**
 * A goal's own writes (P3-T04).
 *
 * The close form collects the retrospective as plain text and it becomes editor
 * JSON through the one shared constructor. Storage is always editor JSON, never
 * Markdown, and a textarea is still a reasonable way to collect prose before the
 * TipTap editor is wired into this screen at P3-T10.
 */
import {
  callAction,
  isBlankText,
  OperationError,
  richTextFromPlainText,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { NO_ERROR, type WriteState } from "../../cycle/write-state.ts";

async function run(
  goalId: string,
  fn: (context: {
    pool: ReturnType<typeof getPool>;
    workspaceId: string;
    actor: { kind: "human"; userId: string };
  }) => Promise<unknown>,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  try {
    await fn({
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath(`/goals/${goalId}`);
  revalidatePath("/cycle");
  // The explorer and the canvas read the same numbers, and S-14's acceptance
  // criterion is that a value recorded here moves both (P3-T10).
  revalidatePath("/goals");
  revalidatePath("/goals/studio");
  return NO_ERROR;
}

export async function editGoal(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const contributionStatement = String(
    formData.get("contributionStatement") ?? "",
  ).trim();
  const weight = Number(formData.get("weight"));

  if (title === "") {
    return { error: "An objective needs a title." };
  }

  return run(id, (context) =>
    callAction(context, "goals.update", {
      id,
      title,
      contributionStatement:
        contributionStatement === "" ? null : contributionStatement,
      ...(Number.isFinite(weight) ? { weight } : {}),
    }),
  );
}

export async function closeGoal(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("retrospective") ?? "");

  if (isBlankText(body)) {
    // The same refusal the action makes, said before the round trip so the
    // person reads it beside the field they left empty.
    return {
      error:
        "Closing a goal needs a retrospective. What happened, and what would you do differently?",
    };
  }

  return run(id, (context) =>
    callAction(context, "goals.close", {
      id,
      successStatus: String(formData.get("successStatus") ?? "achieved") as
        | "achieved"
        | "missed",
      closeDecision: String(formData.get("closeDecision") ?? "keep") as
        | "keep"
        | "modify"
        | "abandon",
      closeReason:
        String(formData.get("closeReason") ?? "").trim() || undefined,
      retrospectiveBody: richTextFromPlainText(body),
    }),
  );
}

export async function reopenGoal(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  return run(id, (context) => callAction(context, "goals.reopen", { id }));
}

export async function reassignRole(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  return run(id, (context) =>
    callAction(context, "goals.reassignRole", {
      id,
      role: String(formData.get("role") ?? "champion") as
        | "champion"
        | "reviewer",
      memberId: String(formData.get("memberId") ?? ""),
    }),
  );
}

/**
 * Records a new value and confidence for one key result (S-14, P3-T10).
 *
 * The one write on this page that moves a number, and it goes through
 * `goals.recordValue` so the value history, the cascade and the goal's health
 * all follow from it. §5.2 measures structure, so the alignment score
 * deliberately does not move.
 *
 * **Confidence is not settable here, and that is the method rather than a
 * missing parameter.** §3.2 puts confidence on the check-in, where it arrives
 * with a narrative and a status. An input that let somebody drop a key result to
 * 0.2 with no sentence attached would be the one number in the product that can
 * change without anybody saying why.
 */
export async function recordValue(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const goalId = String(formData.get("goalId") ?? "");
  const keyResultId = String(formData.get("keyResultId") ?? "");
  const value = Number(formData.get("value"));
  if (!Number.isFinite(value)) {
    return { error: "A value has to be a number." };
  }
  return run(goalId, async (context) => {
    await callAction(context, "goals.recordValue", { id: keyResultId, value });
  });
}

// ── Comments (P3-T16) ─────────────────────────────────────────────────

export async function postComment(body: unknown): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  try {
    // The goalId comes from the page, passed via a hidden field or closure.
    // For now, the body includes the subjectType and subjectId.
    const input = body as {
      subjectType: "goal" | "key_result" | "check_in" | "cycle" | "document";
      subjectId: string;
      body: unknown;
    };
    await callAction(context, "comments.create", input);
    revalidatePath("/goals/[id]", "page");
    return NO_ERROR;
  } catch (error) {
    return {
      error:
        error instanceof OperationError
          ? error.message
          : "Failed to post comment.",
    };
  }
}

export async function editComment(
  commentId: string,
  body: unknown,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  try {
    await callAction(context, "comments.update", { commentId, body });
    revalidatePath("/goals/[id]", "page");
    return NO_ERROR;
  } catch (error) {
    return {
      error:
        error instanceof OperationError
          ? error.message
          : "Failed to edit comment.",
    };
  }
}

export async function deleteCommentAction(
  commentId: string,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  try {
    await callAction(context, "comments.delete", { commentId });
    revalidatePath("/goals/[id]", "page");
    return NO_ERROR;
  } catch (error) {
    return {
      error:
        error instanceof OperationError
          ? error.message
          : "Failed to delete comment.",
    };
  }
}

export async function toggleReaction(
  subjectType: string,
  subjectId: string,
  emoji: string,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  try {
    await callAction(context, "reactions.add", {
      subjectType,
      subjectId,
      emoji,
    });
    revalidatePath("/goals/[id]", "page");
    return NO_ERROR;
  } catch (error) {
    return {
      error:
        error instanceof OperationError
          ? error.message
          : "Failed to add reaction.",
    };
  }
}
