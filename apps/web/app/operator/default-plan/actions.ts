"use server";

import { fillDefaultPlanAsOperator, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { requireOperator } from "../../../lib/operator";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";

/**
 * The confirm on the review of workspaces with no plan
 * (docs/design/workspaces-without-a-plan.md §3, plan 0.8.0 O2).
 *
 * The grant is checked here and again at the domain door. The workspaces
 * moved are exactly the ones the review listed, sent back as hidden fields,
 * so a workspace that appeared since is not moved without being seen.
 */
export interface DefaultPlanFillState {
  readonly error?: string;
  readonly fields?: Readonly<Record<string, string>>;
  readonly done?: {
    readonly moved: number;
    readonly refused: readonly {
      readonly name: string;
      readonly reason: string;
    }[];
    readonly skipped: readonly {
      readonly name: string;
      readonly reason: string;
    }[];
  };
}

export async function fillDefaultPlan(
  formData: FormData,
): Promise<DefaultPlanFillState> {
  const operator = await requireOperator();
  const { t } = await getTranslations();
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason === "") {
    return { fields: { reason: t("operator.plan.needsReason") } };
  }
  const workspaceIds = formData.getAll("workspaceId").map(String);
  const names = new Map(
    workspaceIds.map((id, index) => [
      id,
      String(formData.getAll("workspaceName")[index] ?? id),
    ]),
  );
  try {
    const result = await fillDefaultPlanAsOperator(getPool(), {
      operatorUserId: operator.userId,
      reason,
      workspaceIds,
    });
    revalidatePath("/operator");
    revalidatePath("/operator/default-plan");
    const named = (rows: readonly { workspaceId: string; reason: string }[]) =>
      rows.map((row) => ({
        name: names.get(row.workspaceId) ?? row.workspaceId,
        reason: row.reason,
      }));
    return {
      done: {
        moved: result.moved.length,
        refused: named(result.refused),
        skipped: named(result.skipped),
      },
    };
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
}
