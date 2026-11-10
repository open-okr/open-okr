"use server";

import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../lib/auth";
import { requireWorkspace } from "../lib/workspace";

/**
 * Ends the first-visit tour for the signed-in member, on every machine
 * (UIUX-PLAN S-34, completeness review L-08).
 *
 * Finishing the last stop and ending it early are the same write: the tour
 * has been offered, and either way it should not be offered again.
 */
export async function finishTour(): Promise<{ error: string | null }> {
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "people.finishOwnTour",
      {},
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  // The shell offers the tour on every screen (plan 0.8.0 T1), so every copy
  // the router holds is stale once it ends. The browser also remembers, so a
  // stale copy would not offer it again in any case.
  revalidatePath("/", "layout");
  return { error: null };
}
