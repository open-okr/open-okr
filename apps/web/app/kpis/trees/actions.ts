"use server";

/**
 * Naming a driver tree (S-18, METHOD.md §6.3, P3-T14).
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { NO_ERROR, type WriteState } from "../../cycle/write-state.ts";

export async function addTree(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const name = String(formData.get("name") ?? "").trim();
  if (name === "") {
    return { error: "A tree needs a name. What does its root measure?" };
  }
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "kpis.createTree",
      { name },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/kpis/trees");
  return NO_ERROR;
}
