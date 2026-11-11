"use server";

import {
  ACCESS_LEVELS,
  EMAIL_VERIFICATION_MODES,
  isCloudEnabled,
  OperationError,
  setEmailVerificationMode,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { requireAccessLevel } from "../../../lib/access";
import { readConfirmationRuleAgain } from "../../../lib/auth";
import { getPool } from "../../../lib/pool";
import { getKeyRing } from "../../../lib/secrets";

/**
 * An administrator's choice on Admin, General (plan 0.8.0 S4). A self-hosted
 * or group instance only: on a cloud the operator decides (Q12), and the
 * action refuses it there as well, because a server action is reachable
 * whatever the page rendered.
 */
export async function saveEmailConfirmation(formData: FormData): Promise<void> {
  const access = await requireAccessLevel(ACCESS_LEVELS.full);
  const pool = getPool();
  if (await isCloudEnabled(pool)) {
    return;
  }
  const chosen = String(formData.get("emailVerification") ?? "");
  const mode = EMAIL_VERIFICATION_MODES.find((one) => one === chosen);
  if (mode === undefined) {
    return;
  }
  try {
    await setEmailVerificationMode(pool, getKeyRing(), {
      mode,
      userId: access.userId,
      workspaceId: access.workspaceId,
    });
  } catch (error) {
    // `off` under company domains: the card does not offer it.
    if (!(error instanceof OperationError)) {
      throw error;
    }
  }
  // This server follows it on the next sign-up; the others within seconds.
  readConfirmationRuleAgain();
  revalidatePath("/admin/general");
}
