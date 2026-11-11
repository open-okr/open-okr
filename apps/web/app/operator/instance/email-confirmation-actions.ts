"use server";

import {
  EMAIL_VERIFICATION_MODES,
  OperationError,
  setEmailVerificationModeAsOperator,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { readConfirmationRuleAgain } from "../../../lib/auth";
import { requireOperator } from "../../../lib/operator";
import { getPool } from "../../../lib/pool";
import { getKeyRing } from "../../../lib/secrets";

/**
 * The operator's choice on S-47 (plan 0.8.0 S4, Q12): on a cloud the accounts
 * are shared by every customer, so no customer's administrator makes it.
 */
export async function saveEmailConfirmationAsOperator(
  formData: FormData,
): Promise<void> {
  const operator = await requireOperator();
  const chosen = String(formData.get("emailVerification") ?? "");
  const mode = EMAIL_VERIFICATION_MODES.find((one) => one === chosen);
  if (mode === undefined) {
    return;
  }
  try {
    await setEmailVerificationModeAsOperator(getPool(), getKeyRing(), {
      mode,
      operatorUserId: operator.userId,
    });
  } catch (error) {
    if (!(error instanceof OperationError)) {
      throw error;
    }
  }
  readConfirmationRuleAgain();
  revalidatePath("/operator/instance");
}
