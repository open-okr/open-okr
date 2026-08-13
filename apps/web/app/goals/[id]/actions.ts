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
