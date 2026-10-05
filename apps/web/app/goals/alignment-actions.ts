"use server";

/**
 * The alignment writes (P3-T10, moved from the studio at P9-T09b).
 *
 * Four, and each is one click: the diagram's link mode connects two
 * objectives into a dependency, the drawer's alignment tab takes one apart
 * again (M-35), a finding can be dismissed, and a relink finding can be
 * applied (P4-T06c). The studio these were written for is the OKRs screen's
 * diagram now, and `/goals/studio` sends a reader there.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "../cycle/write-state.ts";

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
  // OKRs screen's header.
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

/**
 * Taking a dependency apart (completeness review M-35).
 *
 * Linking two goals was a click here and undoing it was nowhere: the action
 * existed and the coverage test excused it as "removed through the studio's
 * own canvas write", which no write did. Either end may remove it, the same as
 * either end may add it, and `goals.removeDependency` checks that.
 */
export async function unlinkGoals(dependencyId: string): Promise<WriteState> {
  return run((context) =>
    callAction(context, "goals.removeDependency", { id: dependencyId }),
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
