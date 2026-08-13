"use server";

/**
 * The review inbox's one write (P3-T08).
 *
 * S-02 promises "a one-click action" on every row, and for an acknowledgement
 * that is the whole interaction: there is nothing to type. The refusal still
 * comes from the action rather than from this file, so a member who lost the
 * reviewer role between the page rendering and the button being pressed is told
 * why instead of silently succeeding.
 *
 * Three paths are revalidated because one acknowledgement changes all three: the
 * inbox loses a row, the goal's timeline gains an acknowledged stamp, and the
 * sidebar badge counts one fewer.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "../cycle/write-state.ts";

export async function acknowledge(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("checkInId") ?? "");
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "goals.acknowledgeCheckIn",
      { id },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/review");
  revalidatePath("/check-in");
  revalidatePath("/");
  return NO_ERROR;
}
