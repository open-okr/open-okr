"use server";

import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";

export interface CloseActionState {
  readonly failed: boolean;
}

/**
 * Closes or reopens the workspace (docs/design/workspace-erasure.md §3).
 *
 * The server decides who may, and checks the address typed: the card only offers
 * what it allows, and this is the same action REST and the command line reach.
 */
async function move(
  state: "closed" | "active",
  confirmSlug?: string,
): Promise<CloseActionState> {
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "workspace.setLifecycle",
      { state, ...(confirmSlug === undefined ? {} : { confirmSlug }) },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { failed: true };
    }
    throw error;
  }
  // The whole tree: the banner on every screen changes with it.
  revalidatePath("/", "layout");
  return { failed: false };
}

export async function closeWorkspace(
  _previous: CloseActionState | null,
  formData: FormData,
): Promise<CloseActionState> {
  return move("closed", String(formData.get("slug") ?? "").trim());
}

export async function reopenWorkspace(
  _previous: CloseActionState | null,
): Promise<CloseActionState> {
  return move("active");
}
