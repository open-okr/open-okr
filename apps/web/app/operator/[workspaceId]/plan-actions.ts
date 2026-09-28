"use server";

import { OperationError, setPlanAsOperator } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { requireOperator } from "../../../lib/operator";
import { getPool } from "../../../lib/pool";

/**
 * The operator's plan change on S-46 (completeness review H-21).
 *
 * The grant is re-checked here and again at the domain door, for the reason
 * the lifecycle form gives. Unlike that form, a refusal is returned rather
 * than swallowed: "12 seats are in use" is what the operator has to tell the
 * customer, so the screen has to say it.
 */
export interface OperatorPlanState {
  readonly error?: string;
  readonly done?: boolean;
}

export async function setPlan(formData: FormData): Promise<OperatorPlanState> {
  const operator = await requireOperator();
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const planKey = String(formData.get("planKey") ?? "");
  const seatsRaw = String(formData.get("seats") ?? "").trim();
  const seats = seatsRaw === "" ? undefined : Number(seatsRaw);
  const reason = String(formData.get("reason") ?? "").trim();
  // Checked here so the operator reads a sentence rather than an error page.
  // The domain door validates both again.
  if (seats !== undefined && !(Number.isInteger(seats) && seats >= 1)) {
    return { error: "Seats must be a whole number of at least 1." };
  }
  if (reason === "") {
    return { error: "A plan change needs a reason." };
  }
  try {
    await setPlanAsOperator(getPool(), {
      workspaceId,
      operatorUserId: operator.userId,
      planKey: planKey === "" ? null : planKey,
      ...(seats === undefined ? {} : { seats }),
      reason,
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath(`/operator/${workspaceId}`);
  revalidatePath("/operator");
  return { done: true };
}
