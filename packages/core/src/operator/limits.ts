/**
 * A cloud operator setting the two limits that are the provider's levers
 * (plan 0.7.0 B10, Akmal's choice of 9 November 2026).
 *
 * The storage quota and the agent cost cap are what a plan sells on a cloud,
 * so a workspace's own administrator may not change them there
 * (`settings.updateWorkspaceLimits` refuses). This is the operator's door, on
 * the workspace's console page, the same shape as `setPlanAsOperator`: the
 * grant is checked first, the values by the registry's own schemas, and the
 * change commits with the workspace's activity and audit row, which names the
 * operator and the reason the customer will read.
 */
import {
  activeOnly,
  type WorkspaceSettings,
  withOperator,
  workspaces,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { OperationError, runOperation } from "../operations/operation.ts";
import {
  agentRunCostCapSchema,
  findWorkspaceSetting,
  storageQuotaBytesSchema,
} from "../settings/registry.ts";
import { isLiveOperator } from "./store.ts";

const inputSchema = z
  .object({
    storageQuotaBytes: storageQuotaBytesSchema.optional(),
    agentRunCostCapUsd: agentRunCostCapSchema.optional(),
    reason: z.string().trim().min(1, "A limit change needs a reason.").max(500),
  })
  .refine(
    (value) =>
      value.storageQuotaBytes !== undefined ||
      value.agentRunCostCapUsd !== undefined,
    { message: "nothing to update" },
  );

export interface OperatorLimitsInput {
  readonly workspaceId: string;
  readonly operatorUserId: string;
  readonly storageQuotaBytes?: number;
  readonly agentRunCostCapUsd?: number;
  /** Shown in the customer's own audit log, like a plan change's reason. */
  readonly reason: string;
}

export async function setWorkspaceLimitsAsOperator(
  pool: Pool,
  input: OperatorLimitsInput,
): Promise<void> {
  if (!(await isLiveOperator(pool, input.operatorUserId))) {
    // The same not-found `setPlanAsOperator` gives, for the same reason.
    throw new OperationError("not_found", "No such workspace.");
  }
  const parsed = inputSchema.parse({
    storageQuotaBytes: input.storageQuotaBytes,
    agentRunCostCapUsd: input.agentRunCostCapUsd,
    reason: input.reason,
  });
  const patch: Record<string, number> = {};
  if (parsed.storageQuotaBytes !== undefined) {
    patch.storageQuotaBytes = parsed.storageQuotaBytes;
  }
  if (parsed.agentRunCostCapUsd !== undefined) {
    patch.agentRunCostCapUsd = parsed.agentRunCostCapUsd;
  }

  await runOperation(
    { pool },
    {
      action: "settings.updateWorkspaceLimits",
      workspaceId: input.workspaceId,
      actor: { kind: "operator", userId: input.operatorUserId },
      async execute({ tx, workspaceId }) {
        const [current] = await tx
          .select({ settings: workspaces.settings })
          .from(workspaces)
          .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
          .limit(1);
        if (!current) {
          throw new OperationError("not_found", "No such workspace.");
        }
        const nextSettings: WorkspaceSettings = {
          ...current.settings,
          ...patch,
        };
        // openokr:allow-mutation: the operation's own execute, on the
        // transaction runOperation opened.
        await tx
          .update(workspaces)
          .set({ settings: nextSettings, updatedAt: new Date() })
          .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)));
        return {
          result: undefined,
          activity: {
            kind: "workspace.limits_updated",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { keys: Object.keys(patch) },
          },
          audit: {
            action: "settings.update_workspace_limits",
            targetType: "workspace",
            targetId: workspaceId,
            payload: { ...patch, reason: parsed.reason, by: "operator" },
          },
        };
      },
    },
  );
}

/** The two provider limits as stored, or as the registry defaults them. */
export interface WorkspaceProviderLimits {
  readonly storageQuotaBytes: number;
  readonly agentRunCostCapUsd: number;
}

const resolved = (
  settings: Record<string, unknown>,
  key: "storageQuotaBytes" | "agentRunCostCapUsd",
): number => {
  const stored = settings[key];
  if (typeof stored === "number") {
    return stored;
  }
  return findWorkspaceSetting(key)?.resolve({}) as number;
};

/**
 * What the operator's limits form shows on S-46, read under the operator's
 * own policy like the plan and the billing status beside it.
 */
export async function readWorkspaceLimitsAsOperator(
  pool: Pool,
  operatorUserId: string,
  workspaceId: string,
): Promise<WorkspaceProviderLimits> {
  const db = drizzle(pool);
  const [row] = await withOperator(db, operatorUserId, (tx) =>
    tx
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
      .limit(1),
  );
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  return {
    storageQuotaBytes: resolved(settings, "storageQuotaBytes"),
    agentRunCostCapUsd: resolved(settings, "agentRunCostCapUsd"),
  };
}
