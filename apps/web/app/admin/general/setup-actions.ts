"use server";

import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import type { WriteState } from "../../cycle/write-state.ts";

/**
 * Opens S-34 again and goes there (UIUX-PLAN S-34, completeness review L-08).
 *
 * A refusal comes back as words for the card to show, which is the case a
 * frozen workspace meets: this write is not on the freeze overlay's recovery
 * list, because setting a workspace up is not recovering it.
 */
export async function reopenSetup(
  _previous: WriteState,
  _formData: FormData,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "workspace.reopenOnboarding",
      {},
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  // The whole tree: the Work Map's redirect reads the flag this just changed.
  revalidatePath("/", "layout");
  redirect("/welcome");
}
