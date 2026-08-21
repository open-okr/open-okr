"use server";

/**
 * The studio's writes (P3-T10).
 *
 * Three, and each is one click: link mode connects two goals into a dependency,
 * a finding can be dismissed, and a relink finding can be applied (P4-T06c).
 * Everything else on the panel is a link to the goal page, because editing a
 * goal properly belongs on the screen built for it rather than in a side panel
 * that would drift from it.
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

/**
 * Applying a relink finding (METHOD.md §5.3, P4-T06c).
 *
 * §5.3 offers a one-click apply "where the fix is mechanical", and the action
 * refuses any kind whose fix is not. The re-parent runs through `goals.update`
 * in its own transaction, so the tree, the §5.2 score and the level-skip and
 * silo findings all move together.
 */
export async function applyFinding(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("findingId") ?? "");
  return run((context) =>
    callAction(context, "alignment.applyFinding", { id }),
  );
}
