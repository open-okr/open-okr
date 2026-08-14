"use server";

/**
 * The recovery board's one write (S-19, METHOD.md §6.5, P3-T14).
 *
 * Launching is one click by design: the draft is computed from the tree, so
 * there is nothing to fill in. What the click cannot decide is which cycle the
 * objective belongs to, and that is resolved here rather than in the browser.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { NO_ERROR, type WriteState } from "../../cycle/write-state.ts";

export async function launchRecovery(kpiId: string): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  try {
    const cycle = await callAction(context, "cycles.current", {
      mode: "quarterly",
    });
    if (!cycle) {
      // §4.1 gives a goal a cycle or a stated timeframe and never neither.
      // Inventing a window here would put dates on the team's behalf.
      return {
        error:
          "There is no current cycle to put the recovery objective in. Open one first.",
      };
    }
    await callAction(context, "kpis.launchRecovery", {
      kpiId,
      cycleId: cycle.id,
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/kpis/recovery");
  revalidatePath("/kpis/trees");
  revalidatePath("/kpis");
  revalidatePath("/goals");
  return NO_ERROR;
}
