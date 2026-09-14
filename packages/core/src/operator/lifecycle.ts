/**
 * What an operator does to a workspace, and how the customer sees it
 * (P8-T03b).
 *
 * Design: `docs/design/p8-t01b-operator-console.md` §4 and §6.
 *
 * **An operator's action is recorded twice, and the second one is the point.**
 * The instance chain is the vendor's own trail. The workspace's own
 * `audit_events` is what lets the customer see, in their own audit log and
 * without asking anybody, that somebody outside their organisation suspended
 * them and why. A suspension a customer cannot see attributed is one they
 * have to take on trust.
 */

import type { TenantState } from "@openokr/db";
import type { Pool } from "pg";
import { z } from "zod";
import { OperationError, runOperation } from "../operations/operation.ts";
import { setTenantStateInTx } from "../tenancy/index.ts";
import { isLiveOperator } from "./store.ts";

/**
 * A reason is required and is not allowed to be blank. The workspace's own
 * members are shown it, so an empty one is a suspension nobody can act on.
 */
const reasonSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "A lifecycle change needs a reason.")
    .max(500),
});

export interface OperatorLifecycleInput {
  readonly workspaceId: string;
  readonly operatorUserId: string;
  readonly state: TenantState;
  /**
   * Shown to the workspace's own members, so it is written as something a
   * customer reads rather than as an internal note. Required: a suspension
   * with no stated reason is one nobody can act on.
   */
  readonly reason: string;
}

/**
 * Moves a tenant's lifecycle as an operator.
 *
 * **The grant is checked here, before the Operation opens.**
 * `instance_operators` sits above the tenant floor and is reached with
 * `app.operator_user_id`, which a tenant-scoped transaction deliberately
 * never sets, so the pipeline cannot check it from the inside without
 * loosening something. This is the door, and it is the only way in.
 */
export async function setLifecycleAsOperator(
  pool: Pool,
  input: OperatorLifecycleInput,
): Promise<{ readonly state: TenantState }> {
  if (!(await isLiveOperator(pool, input.operatorUserId))) {
    // Not-found rather than forbidden, matching what the access getter does
    // everywhere else: a caller who is not an operator learns nothing about
    // whether the workspace exists.
    throw new OperationError("not_found", "No such workspace.");
  }

  // Validated with Zod rather than thrown as an `OperationError`, which
  // carries only `forbidden` and `not_found`. Widening that shared type for
  // one caller would be the wrong repair: a bad input is not a refusal, and
  // `api/errors.ts` already maps a `ZodError` to 422 `invalid_input` naming
  // the field.
  const { reason } = reasonSchema.parse({ reason: input.reason });

  return runOperation(
    { pool },
    {
      action: "workspace.setLifecycle",
      workspaceId: input.workspaceId,
      // The operator branch in `resolveActor`, which carries the user id on
      // to the audit row. No member id, because an operator is a member of
      // nothing.
      actor: { kind: "operator", userId: input.operatorUserId },
      async execute({ tx, workspaceId }) {
        const moved = await setTenantStateInTx(tx, {
          workspaceId,
          state: input.state,
        });
        if (!moved) {
          throw new OperationError(
            "not_found",
            "This workspace has no tenant record, so it has no lifecycle to move.",
          );
        }

        return {
          result: { state: input.state },
          activity: {
            kind: "workspace.lifecycle_changed",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { state: input.state },
          },
          audit: {
            action: "workspace.setLifecycle",
            targetType: "workspace",
            targetId: workspaceId,
            // The reason travels with the audit row rather than only with the
            // banner, so it survives a reactivation. A customer asking six
            // months later why they were suspended reads it here.
            payload: { state: input.state, reason, by: "operator" },
          },
        };
      },
    },
  );
}
