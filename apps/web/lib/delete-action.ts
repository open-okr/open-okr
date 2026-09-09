"use server";

/**
 * The one delete path, for the four things that have one (P6-G27).
 *
 * **`goals.delete`, `initiatives.delete`, `tasks.delete` and
 * `documents.delete` all shipped with their entities and none of them had a
 * browser caller**, which the gap audit recorded in §5. The only way to remove
 * anything was the command line or the API.
 *
 * **One server action rather than four**, because the four are the same shape:
 * one id, `full` access, and a soft delete. What differs is the word on the
 * screen and where the reader goes afterwards, and both of those belong to the
 * page rather than to the write.
 *
 * **The allow-list is the point.** A server action takes whatever the browser
 * sends, so a switch over four literals is what stops this becoming a way to
 * call any action in the registry with any id.
 */

import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "./auth";
import { requireWorkspace } from "./workspace";

export type DeletableSubject = "goal" | "initiative" | "task" | "document";

const ACTION = {
  goal: "goals.delete",
  initiative: "initiatives.delete",
  task: "tasks.delete",
  document: "documents.delete",
} as const;

export interface DeleteResult {
  readonly error: string | null;
}

export async function deleteSubject(input: {
  subject: DeletableSubject;
  id: string;
}): Promise<DeleteResult> {
  const action = ACTION[input.subject];
  if (!action) {
    return { error: "That is not something this control deletes." };
  }

  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      action,
      { id: input.id },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  // The whole tree: a deleted goal leaves the Work Map, the board, the feeds
  // and whatever else was listing it, and none of those are this page.
  revalidatePath("/", "layout");
  return { error: null };
}
