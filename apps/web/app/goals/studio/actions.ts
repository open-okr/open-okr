"use server";

/**
 * The studio's writes (P3-T10).
 *
 * Two, and both are one click: link mode connects two goals into a dependency,
 * and a gap in the health tab can be dismissed. Everything else on the panel is
 * a link to the goal page, because editing a goal properly belongs on the screen
 * built for it rather than in a side panel that would drift from it.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { NO_ERROR, type WriteState } from "../../cycle/write-state.ts";

async function run(
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
  // The score and the findings both move on a structural write, and so does the
  // explorer's header.
  revalidatePath("/goals/studio");
  revalidatePath("/goals");
  revalidatePath("/cycle");
  return NO_ERROR;
}

export async function linkGoals(
  fromGoalId: string,
  toGoalId: string,
): Promise<WriteState> {
  return run((context) =>
    callAction(context, "goals.addDependency", { fromGoalId, toGoalId }),
  );
}

export async function dismissFinding(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("findingId") ?? "");
  return run((context) =>
    callAction(context, "alignment.dismissFinding", { id }),
  );
}
