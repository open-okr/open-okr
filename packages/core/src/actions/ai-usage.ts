/**
 * Budget and usage admin actions (AI-NATIVE-PLAN.md §4, screen S-37,
 * P2-T16). `full`-access, matching every other admin card here — setting a
 * budget is governance, not something a member does to themselves.
 * Recording a usage event itself is a separate, unregistered function
 * (`packages/core/src/ai/usage.ts`, `recordUsageEvent`) for reasons that
 * module's own header explains: only trusted server-side code that made a
 * real call may write one, never a public action any caller could invoke
 * with self-reported numbers.
 */
import {
  activeOnly,
  aiBudgets,
  BUDGET_METRICS,
  BUDGET_PERIODS,
  BUDGET_SCOPES,
  withWorkspace,
} from "@openokr/db";
import { eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { summariseUsage } from "../ai/usage.ts";
import { OperationError } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const scopeSchema = z.enum(BUDGET_SCOPES);
const metricSchema = z.enum(BUDGET_METRICS);
const periodSchema = z.enum(BUDGET_PERIODS);

const budgetOutput = z.object({
  id: z.uuid(),
  scope: scopeSchema,
  scopeRef: z.uuid().nullable(),
  metric: metricSchema,
  period: periodSchema,
  limitValue: z.number(),
});

export const readBudgets = defineReadAction({
  name: "ai.readBudgets",
  summary:
    "Every configured budget for this workspace, per user, per agent and workspace-wide.",
  input: z.object({}),
  output: z.array(budgetOutput),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const db = drizzle(context.pool);
    const rows = await withWorkspace(db, context.workspaceId, (tx) =>
      tx
        .select()
        .from(aiBudgets)
        .where(
          activeOnly(aiBudgets, eq(aiBudgets.workspaceId, context.workspaceId)),
        ),
    );
    return rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      scopeRef: row.scopeRef,
      metric: row.metric,
      period: row.period,
      limitValue: Number(row.limitValue),
    }));
  },
});

export const setBudget = defineWriteAction({
  name: "ai.setBudget",
  summary: "Sets or replaces a budget: per user, per agent or workspace-wide.",
  input: z.object({
    scope: scopeSchema,
    scopeRef: z.uuid().nullable(),
    metric: metricSchema,
    period: periodSchema,
    limitValue: z.number().positive(),
  }),
  output: budgetOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const [existing] = await tx
        .select({ id: aiBudgets.id })
        .from(aiBudgets)
        .where(
          activeOnly(
            aiBudgets,
            eq(aiBudgets.workspaceId, workspaceId),
            eq(aiBudgets.scope, input.scope),
            input.scopeRef === null
              ? isNull(aiBudgets.scopeRef)
              : eq(aiBudgets.scopeRef, input.scopeRef),
            eq(aiBudgets.metric, input.metric),
          ),
        )
        .limit(1);
      return existing;
    },
    async execute({ tx, workspaceId, loaded }) {
      const row = {
        workspaceId,
        scope: input.scope,
        scopeRef: input.scopeRef,
        metric: input.metric,
        period: input.period,
        limitValue: String(input.limitValue),
        updatedAt: new Date(),
      };
      let saved: typeof aiBudgets.$inferSelect | undefined;
      if (loaded) {
        // openokr:allow-mutation: this is the operation's own execute.
        [saved] = await tx
          .update(aiBudgets)
          .set(row)
          .where(activeOnly(aiBudgets, eq(aiBudgets.id, loaded.id)))
          .returning();
      } else {
        // openokr:allow-mutation: same reason as the update above.
        [saved] = await tx.insert(aiBudgets).values(row).returning();
      }
      if (!saved) {
        throw new OperationError("not_found", "Could not save the budget.");
      }

      return {
        result: {
          id: saved.id,
          scope: saved.scope,
          scopeRef: saved.scopeRef,
          metric: saved.metric,
          period: saved.period,
          limitValue: Number(saved.limitValue),
        },
        activity: {
          kind: "ai.budget_set",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { scope: input.scope, metric: input.metric },
        },
        audit: {
          action: "ai.setBudget",
          targetType: "workspace",
          targetId: workspaceId,
          payload: {
            scope: input.scope,
            scopeRef: input.scopeRef,
            metric: input.metric,
            period: input.period,
            limitValue: input.limitValue,
          },
        },
      };
    },
  }),
});

export const removeBudget = defineWriteAction({
  name: "ai.removeBudget",
  summary: "Removes a budget.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [existing] = await tx
        .select({ id: aiBudgets.id })
        .from(aiBudgets)
        .where(
          activeOnly(
            aiBudgets,
            eq(aiBudgets.id, input.id),
            eq(aiBudgets.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new OperationError("not_found", "No such budget.");
      }
      // openokr:allow-mutation: this is the operation's own execute.
      await tx
        .update(aiBudgets)
        .set({ deletedAt: new Date() })
        .where(activeOnly(aiBudgets, eq(aiBudgets.id, existing.id)));

      return {
        result: { id: existing.id },
        activity: {
          kind: "ai.budget_removed",
          subjectType: "workspace",
          subjectId: workspaceId,
        },
        audit: {
          action: "ai.removeBudget",
          targetType: "workspace",
          targetId: workspaceId,
        },
      };
    },
  }),
});

export const readUsageSummary = defineReadAction({
  name: "ai.readUsageSummary",
  summary:
    "Total calls, tokens, cost and flagged calls for this workspace since a given date.",
  input: z.object({ since: z.iso.datetime() }),
  output: z.object({
    totalCalls: z.number().int(),
    totalInputTokens: z.number().int(),
    totalOutputTokens: z.number().int(),
    totalCost: z.number(),
    flaggedCalls: z.number().int(),
  }),
  access: ACCESS_LEVELS.full,
  async handler(context, input) {
    return summariseUsage(context.pool, {
      workspaceId: context.workspaceId,
      since: new Date(input.since),
    });
  },
});
