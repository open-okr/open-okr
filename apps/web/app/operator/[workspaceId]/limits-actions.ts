"use server";

import { setWorkspaceLimitsAsOperator } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { requireOperator } from "../../../lib/operator";
import { getPool } from "../../../lib/pool";
import { refusedState } from "../../../lib/refusal";
import { getTranslations } from "../../../lib/translations";

/**
 * The operator's limits change on S-46 (plan 0.7.0 B10): the storage quota
 * and the agent cost cap, which on a cloud are the provider's to set.
 *
 * The grant is re-checked here and again at the domain door, as the plan
 * form does, and a refusal is returned as a sentence rather than an error
 * page. The quota is posted in gigabytes and stored in bytes.
 */
export interface OperatorLimitsState {
  readonly error?: string;
  /** A refused field's message, shown under it (guided-inputs §4.2). */
  readonly fields?: Readonly<Record<string, string>>;
  readonly done?: boolean;
}

const GIGABYTE = 1024 ** 3;

export async function setLimits(
  formData: FormData,
): Promise<OperatorLimitsState> {
  const operator = await requireOperator();
  const { t } = await getTranslations();
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const gigabytesRaw = String(
    formData.get("storageQuotaGigabytes") ?? "",
  ).trim();
  const capRaw = String(formData.get("agentRunCostCapUsd") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason === "") {
    return { fields: { reason: t("operator.limits.needsReason") } };
  }
  try {
    await setWorkspaceLimitsAsOperator(getPool(), {
      workspaceId,
      operatorUserId: operator.userId,
      ...(gigabytesRaw === ""
        ? {}
        : { storageQuotaBytes: Math.round(Number(gigabytesRaw) * GIGABYTE) }),
      ...(capRaw === "" ? {} : { agentRunCostCapUsd: Number(capRaw) }),
      reason,
    });
  } catch (error) {
    const refused = refusedState(error, t, [
      "storageQuotaGigabytes",
      "agentRunCostCapUsd",
      "reason",
    ]);
    if (refused === null) {
      throw error;
    }
    return refused;
  }
  revalidatePath(`/operator/${workspaceId}`);
  return { done: true };
}
