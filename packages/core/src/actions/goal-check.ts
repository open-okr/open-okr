/**
 * Checks an objective that has not been saved against METHOD.md §4.
 *
 * An external agent drafts with its own model; the AI assists that drafted on
 * the server left the agent surface because the agent path carries no
 * provider. What the agent still needs is the product's verdict on a draft
 * before it becomes real, and `goals.create` cannot give it: by default
 * (§2.9) a mid-cycle objective goes live once it passes the block checks, so
 * creating it to check it publishes it (mcp-audit-2026-10-29, §10.2 Q16).
 *
 * Deterministic and AI-free. Every verdict carries the check id, the
 * condition that matched and the coaching prompt, verbatim from
 * `packages/method`.
 */
import {
  GOAL_KINDS,
  GOAL_LEVELS,
  INDICATOR_TYPES,
  KEY_RESULT_DIRECTIONS,
  KEY_RESULT_KINDS,
  withContext,
} from "@openokr/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { evaluateDraftInTx } from "../quality/service.ts";
import { actingMemberId } from "./api-tokens.ts";
import { defineReadAction } from "./define.ts";

const verdict = z.object({
  id: z.string(),
  status: z.enum(["pass", "info", "warn", "fail", "todo"]),
  condition: z.string(),
  prompt: z.string(),
});

export const checkDraft = defineReadAction({
  name: "goals.checkDraft",
  summary:
    "Checks an unsaved objective and its key results against the quality checks, with each check's condition and coaching prompt. Saves nothing.",
  input: z.object({
    title: z.string().trim().min(1).max(500),
    level: z.enum(GOAL_LEVELS),
    kind: z.enum(GOAL_KINDS).optional(),
    cycleId: z.uuid().optional(),
    spaceId: z.uuid().optional(),
    reviewerId: z.uuid().optional(),
    keyResults: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(500),
          kind: z.enum(KEY_RESULT_KINDS).optional(),
          direction: z.enum(KEY_RESULT_DIRECTIONS).optional(),
          indicatorType: z.enum(INDICATOR_TYPES).optional(),
          baselineValue: z.number().optional(),
          targetValue: z.number().optional(),
          dueOn: z.iso.date().optional(),
          ownerId: z.uuid().optional(),
        }),
      )
      .max(20)
      .default([]),
  }),
  output: z.object({
    score: z.number().nullable(),
    objective: z.array(verdict),
    keyResults: z.array(
      verdict.extend({
        /** Indexes into the input's key results that this check is about. */
        keyResults: z.array(z.number().int()),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const memberId = await actingMemberId(tx, context.workspaceId, userId);
        if (input.spaceId) {
          // The space's strictness decides how harshly to judge, so the
          // caller must be able to see the space.
          await getAccessScoped(tx, {
            workspaceId: context.workspaceId,
            memberId,
            resourceType: "space",
            resourceId: input.spaceId,
            requires: ACCESS_LEVELS.view as never,
          });
        }
        const judged = await evaluateDraftInTx(tx, {
          workspaceId: context.workspaceId,
          spaceId: input.spaceId ?? null,
          objective: {
            title: input.title,
            hasCycle: input.cycleId !== undefined,
            hasTimeframe: input.cycleId !== undefined,
            // The caller drafts it, so the caller is its champion until they
            // say otherwise.
            championId: memberId,
            reviewerId: input.reviewerId ?? null,
            level: input.level,
          },
          keyResults: input.keyResults.map((row) => ({
            text: row.title,
            baseline: row.baselineValue ?? null,
            target: row.targetValue ?? null,
            dueOn: row.dueOn ?? null,
            ownerId: row.ownerId ?? null,
            indicatorType: row.indicatorType ?? null,
            direction: row.direction ?? null,
            confidence: null,
            ...(input.kind ? { kind: input.kind } : {}),
            ...(row.kind ? { keyResultKind: row.kind } : {}),
          })),
        });
        const shape = (entry: {
          id: string;
          status: z.infer<typeof verdict>["status"];
          condition: string;
          prompt: string;
        }) => ({
          id: entry.id,
          status: entry.status,
          condition: entry.condition,
          prompt: entry.prompt,
        });
        return {
          score: judged.score,
          objective: judged.objective.map(shape),
          keyResults: judged.keyResults.map((entry) => ({
            ...shape(entry),
            keyResults: [...entry.keyResults],
          })),
        };
      },
    );
  },
});
