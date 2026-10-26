"use server";

/**
 * The Work Map's one write (S-01, P3-T11).
 *
 * Recording a value from the side panel. Five paths are revalidated because one
 * value moves all five: the map itself, the explorer's list, the goal page, the
 * alignment canvas and the cycle workspace's gates. That set is what P3-T10's
 * acceptance criterion means by "update live in both the list and the canvas".
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../lib/auth";
import { formNumber } from "../lib/form-number";
import { getTranslations } from "../lib/translations";
import { requireWorkspace } from "../lib/workspace";
import { NO_ERROR, type WriteState } from "./cycle/write-state.ts";

export async function recordFromMap(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const goalId = String(formData.get("goalId") ?? "");
  const keyResultId = String(formData.get("keyResultId") ?? "");
  // An empty box is asked about, not read: `Number("")` is 0, so a cleared
  // box used to write a real value of 0 into the key result's history. The
  // sentence says what to do; `formNumber` would refuse it too, as text that
  // is not a number.
  const typed = String(formData.get("value") ?? "").trim();
  if (typed === "") {
    const { t } = await getTranslations();
    return { error: t("quickCheckIn.typeAValueFirst") };
  }
  const value = formNumber(formData, "value");
  if (!Number.isFinite(value)) {
    const { t } = await getTranslations();
    return { error: t("cycle.actions.valueHasToBeANumber") };
  }

  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "goals.recordValue",
      { id: keyResultId, value },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath("/");
  revalidatePath("/goals");
  revalidatePath(`/goals/${goalId}`);
  revalidatePath("/cycle");
  return NO_ERROR;
}
