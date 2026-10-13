"use server";

import { setLifecycleAsOperator } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { requireOperator } from "../../../lib/operator";
import { getPool } from "../../../lib/pool";
import { refusalOf } from "../../../lib/refusal";
import { getTranslations } from "../../../lib/translations";

/**
 * The lifecycle change on S-46 (P8-T03b), as a server action.
 *
 * A server action, so the grant is re-checked on the write rather than
 * trusted from the page that rendered the form: a page rendered ten minutes
 * ago is not evidence that the person is still an operator, and a revoked
 * grant has to stop a write it never saw coming. `setLifecycleAsOperator`
 * checks it a third time at the domain door, and the database policies
 * underneath check it on every query. Each one is the only check at its own
 * layer.
 *
 * **A refusal is returned, not swallowed** (guided-inputs §5, F5). A reason of
 * only spaces used to leave the form exactly as it was, which read as a
 * suspension that had not finished yet rather than one that never started.
 */
export interface OperatorLifecycleState {
  readonly error?: string;
  readonly done?: boolean;
}

export async function moveLifecycle(
  formData: FormData,
): Promise<OperatorLifecycleState> {
  const operator = await requireOperator();
  const { t } = await getTranslations();
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const state = String(formData.get("state") ?? "");
  const reason = String(formData.get("reason") ?? "");

  // Validated here rather than trusted from a select element, because a form
  // post is external input like any other.
  if (state !== "active" && state !== "suspended" && state !== "closed") {
    return { error: t("operator.lifecycle.notAState") };
  }

  try {
    await setLifecycleAsOperator(getPool(), {
      workspaceId,
      operatorUserId: operator.userId,
      state,
      reason,
    });
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === null) {
      throw error;
    }
    return { error: refusal };
  }
  revalidatePath(`/operator/${workspaceId}`);
  revalidatePath("/operator");
  return { done: true };
}
