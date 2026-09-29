"use server";

import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * The administrator's plan change on S-49 (completeness review H-21).
 *
 * The action declares `full` and the admin layout checks it too. A refusal,
 * which is a plan with fewer seats than are in use, comes back as the
 * sentence the domain wrote, naming both numbers.
 */
export interface PlanChangeState {
  readonly error?: string;
  readonly done?: boolean;
}

export async function changePlan(formData: FormData): Promise<PlanChangeState> {
  const { session, workspace } = await requireWorkspace();
  const raw = String(formData.get("planKey") ?? "");
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "workspace.changePlan",
      { planKey: raw === "" ? null : raw },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/admin/plan");
  return { done: true };
}
