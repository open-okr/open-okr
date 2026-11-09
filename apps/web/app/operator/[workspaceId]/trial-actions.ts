"use server";

import { setTrialAsOperator } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { requireOperator } from "../../../lib/operator";
import { getPool } from "../../../lib/pool";
import { refusedState } from "../../../lib/refusal";
import { getTranslations } from "../../../lib/translations";

/**
 * The operator's trial control on S-46 (docs/design/tenant-lifecycle.md §11
 * T2, plan 0.7.0 P4): start one on a plan, move its end date, or remove it.
 *
 * The grant is re-checked here and again at the domain door, as the plan
 * control does. A refusal comes back as a sentence the operator can pass on.
 */
export interface OperatorTrialState {
  readonly error?: string;
  /** A refused field's message, shown under it (guided-inputs §4.2). */
  readonly fields?: Readonly<Record<string, string>>;
  readonly done?: boolean;
}

export async function setTrial(
  formData: FormData,
): Promise<OperatorTrialState> {
  const operator = await requireOperator();
  const { t } = await getTranslations();
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const planKey = String(formData.get("planKey") ?? "");
  const endsOn = String(formData.get("endsOn") ?? "").trim();
  const remove = formData.get("remove") !== null;
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason === "") {
    return { fields: { reason: t("operator.trial.needsReason") } };
  }
  if (!remove && endsOn === "") {
    return { fields: { endsOn: t("operator.trial.needsDate") } };
  }
  // The end of the chosen day in UTC, so a trial "until the 30th" runs the
  // whole of the 30th wherever the customer is.
  const endsAt = remove ? null : new Date(`${endsOn}T23:59:59Z`);
  if (endsAt !== null && Number.isNaN(endsAt.getTime())) {
    return { fields: { endsOn: t("operator.trial.needsDate") } };
  }
  try {
    await setTrialAsOperator(getPool(), {
      workspaceId,
      operatorUserId: operator.userId,
      ...(planKey === "" ? {} : { planKey }),
      endsAt,
      reason,
    });
  } catch (error) {
    const refused = refusedState(error, t, ["planKey", "endsOn", "reason"]);
    if (refused === null) {
      throw error;
    }
    return refused;
  }
  revalidatePath(`/operator/${workspaceId}`);
  revalidatePath("/operator");
  return { done: true };
}
