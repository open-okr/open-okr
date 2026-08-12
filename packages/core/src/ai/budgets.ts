/**
 * Budgets, quotas and the hard cap (AI-NATIVE-PLAN.md §4 "Budgets and
 * limits", P2-T16).
 *
 * The workspace's own scope doubles as the hard cap the task card names:
 * crossing a `scope: "workspace"` budget is what disables every AI feature
 * and, once P2-T17's agent runtime exists, is what it checks to halt a run
 * mid-flight. Crossing a `"user"` or `"agent"` budget disables only that
 * one member's or agent's own calls — a lighter consequence for a smaller
 * scope, not a second hard cap.
 */
import {
  activeOnly,
  aiBudgets,
  type BudgetMetric,
  type BudgetPeriod,
  type BudgetScope,
  withWorkspace,
} from "@openokr/db";
import { eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { resolveFeatureTier } from "./tier-routing.ts";
import { summariseUsage } from "./usage.ts";

function periodStart(period: BudgetPeriod, now: Date): Date {
  if (period === "day") {
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface BudgetCheckResult {
  readonly configured: boolean;
  readonly withinLimit: boolean;
  readonly current: number;
  readonly limit: number | null;
  readonly metric: BudgetMetric;
  readonly period: BudgetPeriod | null;
}

const usageValue = (
  metric: BudgetMetric,
  summary: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
  },
): number => {
  switch (metric) {
    case "calls":
      return summary.totalCalls;
    case "tokens":
      return summary.totalInputTokens + summary.totalOutputTokens;
    case "cost":
      return summary.totalCost;
  }
};

/**
 * Checks one scope's budget for one metric. A workspace with no budget row
 * for this scope and metric is `configured: false, withinLimit: true` —
 * "nothing must be configured before the product works" applies to a
 * budget the same way it applies to every other setting.
 */
export async function checkBudget(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly scope: BudgetScope;
    readonly scopeRef: string | null;
    readonly metric: BudgetMetric;
    readonly now?: Date;
  },
): Promise<BudgetCheckResult> {
  const db = drizzle(pool);
  const now = input.now ?? new Date();

  return withWorkspace(db, input.workspaceId, async (tx) => {
    const [budget] = await tx
      .select()
      .from(aiBudgets)
      .where(
        activeOnly(
          aiBudgets,
          eq(aiBudgets.workspaceId, input.workspaceId),
          eq(aiBudgets.scope, input.scope),
          input.scopeRef === null
            ? isNull(aiBudgets.scopeRef)
            : eq(aiBudgets.scopeRef, input.scopeRef),
          eq(aiBudgets.metric, input.metric),
        ),
      )
      .limit(1);

    if (!budget) {
      return {
        configured: false,
        withinLimit: true,
        current: 0,
        limit: null,
        metric: input.metric,
        period: null,
      };
    }

    const since = periodStart(budget.period, now);
    const summary = await summariseUsage(pool, {
      workspaceId: input.workspaceId,
      since,
      memberId:
        input.scope === "user" ? (input.scopeRef ?? undefined) : undefined,
      agentId:
        input.scope === "agent" ? (input.scopeRef ?? undefined) : undefined,
    });
    const current = usageValue(input.metric, summary);
    const limit = Number(budget.limitValue);

    return {
      configured: true,
      withinLimit: current < limit,
      current,
      limit,
      metric: input.metric,
      period: budget.period,
    };
  });
}

export interface FeatureAvailability {
  readonly available: boolean;
  readonly reason?: string;
}

/**
 * Whether a feature may run right now, combining P2-T15's own switch and
 * tier override with every budget scope that applies to this call. The
 * first budget that is over its limit is the one named in the refusal — a
 * feature disabled by its own switch never even reaches the budget check.
 */
export async function checkFeatureAvailability(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly featureKey: string;
    readonly defaultTier: import("@openokr/db").ModelTier;
    readonly memberId?: string;
    readonly agentId?: string;
  },
): Promise<FeatureAvailability> {
  const feature = await resolveFeatureTier(pool, {
    workspaceId: input.workspaceId,
    featureKey: input.featureKey,
    defaultTier: input.defaultTier,
  });
  if (!feature.enabled) {
    return {
      available: false,
      reason: `"${input.featureKey}" is turned off for this workspace.`,
    };
  }

  const workspaceCap = await checkBudget(pool, {
    workspaceId: input.workspaceId,
    scope: "workspace",
    scopeRef: null,
    metric: "cost",
  });
  if (workspaceCap.configured && !workspaceCap.withinLimit) {
    return {
      available: false,
      reason: `This workspace has reached its AI budget (${workspaceCap.current} of ${workspaceCap.limit}).`,
    };
  }

  if (input.memberId) {
    const userCap = await checkBudget(pool, {
      workspaceId: input.workspaceId,
      scope: "user",
      scopeRef: input.memberId,
      metric: "cost",
    });
    if (userCap.configured && !userCap.withinLimit) {
      return {
        available: false,
        reason: `You have reached your own AI budget (${userCap.current} of ${userCap.limit}).`,
      };
    }
  }

  if (input.agentId) {
    const agentCap = await checkBudget(pool, {
      workspaceId: input.workspaceId,
      scope: "agent",
      scopeRef: input.agentId,
      metric: "cost",
    });
    if (agentCap.configured && !agentCap.withinLimit) {
      return {
        available: false,
        reason: `This agent has reached its own AI budget (${agentCap.current} of ${agentCap.limit}).`,
      };
    }
  }

  return { available: true };
}

/**
 * The hard cap specifically: is this workspace over its own budget, on any
 * metric it has configured. P2-T17's agent runtime calls this between tool
 * calls to decide whether to halt a run mid-flight — checking here rather
 * than duplicating the workspace-scope logic above.
 */
export async function isOverHardCap(
  pool: Pool,
  input: { readonly workspaceId: string; readonly now?: Date },
): Promise<{ readonly over: boolean; readonly reason?: string }> {
  const metrics: BudgetMetric[] = ["cost", "tokens", "calls"];
  for (const metric of metrics) {
    const result = await checkBudget(pool, {
      workspaceId: input.workspaceId,
      scope: "workspace",
      scopeRef: null,
      metric,
      now: input.now,
    });
    if (result.configured && !result.withinLimit) {
      return {
        over: true,
        reason: `This workspace's ${metric} budget is at ${result.current} of ${result.limit} for the current ${result.period}.`,
      };
    }
  }
  return { over: false };
}
