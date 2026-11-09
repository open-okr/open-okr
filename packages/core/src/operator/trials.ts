/**
 * An operator starts, extends or removes a trial (docs/design/
 * tenant-lifecycle.md §11 T2, plan 0.7.0 P4).
 *
 * Nothing wrote `trial_ends_at` before this, so a sweep alone would have had
 * nothing to sweep. Recorded like every operator action: on the instance
 * chain, and in the workspace's own audit log with the reason the customer
 * reads.
 *
 * - **Starting** names the plan the trial runs on and the date it ends. The
 *   plan goes through `applyPlanInTx`, so the headcount rule holds.
 * - **Extending** moves the date. A date in the future lifts a read-only mode
 *   the trial itself caused, and never an operator's own suspension.
 * - **Removing** clears the date and leaves the plan where it is.
 */
import { activeOnly, tenants } from "@openokr/db";
import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { z } from "zod";
import { OperationError, runOperation } from "../operations/operation.ts";
import {
  applyPlanInTx,
  planByKey,
  setTenantStateInTx,
} from "../tenancy/index.ts";
import { isLiveOperator } from "./store.ts";

const inputSchema = z.object({
  /** Absent keeps the plan; a key starts the trial on that plan. */
  planKey: z.string().trim().min(1).max(50).optional(),
  /** Null removes the trial. */
  endsAt: z.date().nullable(),
  reason: z.string().trim().min(1, "A trial change needs a reason.").max(500),
});

export interface OperatorTrialInput {
  readonly workspaceId: string;
  readonly operatorUserId: string;
  readonly planKey?: string;
  readonly endsAt: Date | null;
  /** Shown in the customer's own audit log, like a lifecycle reason. */
  readonly reason: string;
}

export async function setTrialAsOperator(
  pool: Pool,
  input: OperatorTrialInput,
): Promise<{ readonly planKey: string | null; readonly endsAt: Date | null }> {
  if (!(await isLiveOperator(pool, input.operatorUserId))) {
    // The same not-found every operator door gives a caller who is not one.
    throw new OperationError("not_found", "No such workspace.");
  }
  const parsed = inputSchema.parse({
    planKey: input.planKey,
    endsAt: input.endsAt,
    reason: input.reason,
  });
  const plan =
    parsed.planKey === undefined
      ? undefined
      : await planByKey(pool, parsed.planKey);
  if (parsed.planKey !== undefined && !plan) {
    throw new OperationError(
      "not_found",
      "The catalogue has no plan with that key, so a trial cannot run on it.",
    );
  }

  return runOperation(
    { pool },
    {
      action: "workspace.setTrial",
      workspaceId: input.workspaceId,
      actor: { kind: "operator", userId: input.operatorUserId },
      async execute({ tx, workspaceId }) {
        const now = new Date();
        const [tenant] = await tx
          .select({
            state: tenants.state,
            planKey: tenants.planKey,
            suspendedByTrial: tenants.suspendedByTrial,
          })
          .from(tenants)
          .where(activeOnly(tenants, eq(tenants.workspaceId, workspaceId)))
          .for("update")
          .limit(1);
        if (!tenant) {
          throw new OperationError(
            "not_found",
            "This workspace has no tenant record, so it has no trial to set.",
          );
        }
        if (plan) {
          await applyPlanInTx(tx, { workspaceId, plan });
        }
        // Extending past now ends a read-only mode the trial caused (T2).
        // An operator's own suspension carries no trial flag and stays.
        const lifting =
          tenant.state === "suspended" &&
          tenant.suspendedByTrial &&
          parsed.endsAt !== null &&
          parsed.endsAt.getTime() > now.getTime();
        if (lifting) {
          await setTenantStateInTx(tx, { workspaceId, state: "active", now });
        }
        // openokr:allow-mutation: this Operation's own transaction. A moved
        // date is reminded afresh (§11 Q2).
        await tx
          .update(tenants)
          .set({
            trialEndsAt: parsed.endsAt,
            trialRemindedAt: null,
            updatedAt: now,
          })
          .where(activeOnly(tenants, eq(tenants.workspaceId, workspaceId)));

        const planKey = plan ? plan.key : tenant.planKey;
        const endsAt = parsed.endsAt ? parsed.endsAt.toISOString() : null;
        return {
          result: { planKey, endsAt: parsed.endsAt },
          activity: {
            kind: "workspace.trial_set",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { endsAt, plan: plan?.name ?? null },
          },
          audit: {
            action: "workspace.setTrial",
            targetType: "workspace",
            targetId: workspaceId,
            payload: {
              endsAt,
              planKey,
              lifted: lifting,
              reason: parsed.reason,
              by: "operator",
            },
          },
        };
      },
    },
  );
}
