"use server";

/**
 * The Work Map's one write (S-01, P3-T11).
 *
 * Recording a value from the side panel. Five paths are revalidated because one
 * value moves all five: the map itself, the explorer's list, the goal page, the
 * alignment canvas and the cycle workspace's gates. That set is what P3-T10's
 * acceptance criterion means by "update live in both the list and the canvas".
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../lib/auth";
import { requireWorkspace } from "../lib/workspace";
import { NO_ERROR, type WriteState } from "./cycle/write-state.ts";

export async function recordFromMap(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const goalId = String(formData.get("goalId") ?? "");
  const keyResultId = String(formData.get("keyResultId") ?? "");
  const value = Number(formData.get("value"));
  if (!Number.isFinite(value)) {
    return { error: "A value has to be a number." };
  }

  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "goals.recordValue",
      { id: keyResultId, value },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath("/goals/studio");
  revalidatePath(`/goals/${goalId}`);
  revalidatePath("/cycle");
  return NO_ERROR;
}
