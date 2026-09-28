/**
 * An operator puts a workspace on a plan (completeness review H-21).
 *
 * The design gave the operator console a plan control and nothing wrote
 * `plan_key` or `seats` after a tenant was created. This is the operator's
 * door, and `workspace.changePlan` is the administrator's: both go through
 * `applyPlanInTx`, so the headcount rule is the same on either side.
 *
 * An operator may also set a seat count of their own, for a contract that
 * does not match a catalogue row. An administrator may not.
 */
import type { Pool } from "pg";
import { z } from "zod";
import { OperationError, runOperation } from "../operations/operation.ts";
import { applyPlanInTx, planByKey } from "../tenancy/index.ts";
import { isLiveOperator } from "./store.ts";

const inputSchema = z.object({
  planKey: z.string().trim().min(1).max(50).nullable(),
  /** Absent: the plan's own. Null: unlimited. */
  seats: z.number().int().min(1).nullable().optional(),
  reason: z.string().trim().min(1, "A plan change needs a reason.").max(500),
});

export interface OperatorPlanInput {
  readonly workspaceId: string;
  readonly operatorUserId: string;
  readonly planKey: string | null;
  readonly seats?: number | null;
  /** Shown in the customer's own audit log, like a lifecycle reason. */
  readonly reason: string;
}

export async function setPlanAsOperator(
  pool: Pool,
  input: OperatorPlanInput,
): Promise<{ readonly planKey: string | null; readonly seats: number | null }> {
  if (!(await isLiveOperator(pool, input.operatorUserId))) {
    // The same not-found `setLifecycleAsOperator` gives, for the same reason.
    throw new OperationError("not_found", "No such workspace.");
  }
  const parsed = inputSchema.parse({
    planKey: input.planKey,
    seats: input.seats,
    reason: input.reason,
  });
  const plan = await planByKey(pool, parsed.planKey);
  const seats =
    parsed.seats !== undefined ? parsed.seats : (plan?.seats ?? null);

  return runOperation(
    { pool },
    {
      action: "workspace.changePlan",
      workspaceId: input.workspaceId,
      actor: { kind: "operator", userId: input.operatorUserId },
      async execute({ tx, workspaceId }) {
        const moved = await applyPlanInTx(tx, { workspaceId, plan, seats });
        if (!moved) {
          throw new OperationError(
            "not_found",
            "This workspace has no tenant record, so it has no plan to change.",
          );
        }
        return {
          result: { planKey: plan?.key ?? null, seats },
          activity: {
            kind: "workspace.plan_changed",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { plan: plan?.name ?? "Free", seats },
          },
          audit: {
            action: "workspace.changePlan",
            targetType: "workspace",
            targetId: workspaceId,
            payload: {
              planKey: plan?.key ?? null,
              seats,
              reason: parsed.reason,
              by: "operator",
            },
          },
        };
      },
    },
  );
}
