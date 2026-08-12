/**
 * Model catalogue, tier routing, feature settings and prompt registry
 * actions (AI-NATIVE-PLAN.md §3.4, §4, §7, P2-T15). All admin-only (`full`),
 * matching every other S-36/S-37 card — routing and prompts are governance,
 * not self-service the way a personal AI key is.
 */
import {
  AI_PROVIDER_KINDS,
  activeOnly,
  aiFeatureSettings,
  aiModelPolicies,
  aiModels,
  aiPrompts,
  MODEL_TIERS,
  withWorkspace,
} from "@openokr/db";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { SEEDED_MODELS } from "../ai/model-catalog.ts";
import { defaultPromptFor } from "../ai/prompts.ts";
import { resolveTierRoute } from "../ai/tier-routing.ts";
import { OperationError } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const providerSchema = z.enum(AI_PROVIDER_KINDS);
const tierSchema = z.enum(MODEL_TIERS);

const modelOutput = z.object({
  source: z.enum(["seeded", "custom"]),
  id: z.string().nullable(),
  provider: providerSchema,
  modelId: z.string(),
  displayName: z.string(),
  contextWindow: z.number().int(),
  costInPerMillion: z.number(),
  costOutPerMillion: z.number(),
  supportsTools: z.boolean(),
  supportsVision: z.boolean(),
  supportsJsonMode: z.boolean(),
  supportsStreaming: z.boolean(),
  embeddingDimensions: z.number().int().nullable(),
  tiers: z.array(tierSchema),
  active: z.boolean(),
});

export const readModelCatalog = defineReadAction({
  name: "ai.readModelCatalog",
  summary:
    "The seeded model catalogue plus this workspace's own custom entries.",
  input: z.object({}),
  output: z.array(modelOutput),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const db = drizzle(context.pool);
    const custom = await withWorkspace(db, context.workspaceId, (tx) =>
      tx
        .select()
        .from(aiModels)
        .where(
          activeOnly(aiModels, eq(aiModels.workspaceId, context.workspaceId)),
        ),
    );

    const seeded = SEEDED_MODELS.map((model) => ({
      source: "seeded" as const,
      id: null,
      provider: model.provider,
      modelId: model.modelId,
      displayName: model.displayName,
      contextWindow: model.contextWindow,
      costInPerMillion: model.costInPerMillion,
      costOutPerMillion: model.costOutPerMillion,
      supportsTools: model.supportsTools,
      supportsVision: model.supportsVision,
      supportsJsonMode: model.supportsJsonMode,
      supportsStreaming: model.supportsStreaming,
      embeddingDimensions: model.embeddingDimensions ?? null,
      tiers: [...model.tiers],
      active: true,
    }));

    const customRows = custom.map((row) => ({
      source: "custom" as const,
      id: row.id,
      provider: row.provider,
      modelId: row.modelId,
      displayName: row.displayName,
      contextWindow: row.contextWindow,
      costInPerMillion: Number(row.costInPerMillion),
      costOutPerMillion: Number(row.costOutPerMillion),
      supportsTools: row.supportsTools,
      supportsVision: row.supportsVision,
      supportsJsonMode: row.supportsJsonMode,
      supportsStreaming: row.supportsStreaming,
      embeddingDimensions: row.embeddingDimensions,
      tiers: row.tiers,
      active: row.active,
    }));

    return [...seeded, ...customRows];
  },
});

const customModelInput = z.object({
  provider: providerSchema,
  modelId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  contextWindow: z.number().int().positive(),
  costInPerMillion: z.number().min(0).default(0),
  costOutPerMillion: z.number().min(0).default(0),
  supportsTools: z.boolean().default(false),
  supportsVision: z.boolean().default(false),
  supportsJsonMode: z.boolean().default(false),
  supportsStreaming: z.boolean().default(false),
  embeddingDimensions: z.number().int().positive().nullable().default(null),
  tiers: z.array(tierSchema).default([]),
});

export const addCustomModel = defineWriteAction({
  name: "ai.addCustomModel",
  summary:
    "Adds a custom or self-hosted model, with its own context window and cost figures.",
  input: customModelInput,
  output: modelOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const row = {
        workspaceId,
        provider: input.provider,
        modelId: input.modelId,
        displayName: input.displayName,
        contextWindow: input.contextWindow,
        costInPerMillion: String(input.costInPerMillion),
        costOutPerMillion: String(input.costOutPerMillion),
        supportsTools: input.supportsTools,
        supportsVision: input.supportsVision,
        supportsJsonMode: input.supportsJsonMode,
        supportsStreaming: input.supportsStreaming,
        embeddingDimensions: input.embeddingDimensions,
        tiers: input.tiers,
      };
      let inserted: typeof aiModels.$inferSelect | undefined;
      try {
        // openokr:allow-mutation: this is the operation's own execute, on
        // the transaction runOperation opened.
        [inserted] = await tx.insert(aiModels).values(row).returning();
      } catch (error) {
        throw new OperationError(
          "not_found",
          `${input.provider}/${input.modelId} is already catalogued for this workspace. ` +
            `${(error as Error).message}`,
        );
      }
      if (!inserted) {
        throw new OperationError("not_found", "Could not add the model.");
      }

      return {
        result: {
          source: "custom" as const,
          id: inserted.id,
          provider: inserted.provider,
          modelId: inserted.modelId,
          displayName: inserted.displayName,
          contextWindow: inserted.contextWindow,
          costInPerMillion: Number(inserted.costInPerMillion),
          costOutPerMillion: Number(inserted.costOutPerMillion),
          supportsTools: inserted.supportsTools,
          supportsVision: inserted.supportsVision,
          supportsJsonMode: inserted.supportsJsonMode,
          supportsStreaming: inserted.supportsStreaming,
          embeddingDimensions: inserted.embeddingDimensions,
          tiers: inserted.tiers,
          active: inserted.active,
        },
        activity: {
          kind: "ai.custom_model_added",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { provider: input.provider, modelId: input.modelId },
        },
        audit: {
          action: "ai.addCustomModel",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { provider: input.provider, modelId: input.modelId },
        },
      };
    },
  }),
});

export const updateCustomModel = defineWriteAction({
  name: "ai.updateCustomModel",
  summary: "Edits a custom model's context window, cost figures or tier tags.",
  input: customModelInput.partial().extend({ id: z.uuid() }),
  output: modelOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const [existing] = await tx
        .select()
        .from(aiModels)
        .where(
          activeOnly(
            aiModels,
            eq(aiModels.id, input.id),
            eq(aiModels.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new OperationError("not_found", "No such custom model.");
      }
      return existing;
    },
    async execute({ tx, workspaceId, loaded }) {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.displayName !== undefined)
        patch.displayName = input.displayName;
      if (input.contextWindow !== undefined)
        patch.contextWindow = input.contextWindow;
      if (input.costInPerMillion !== undefined)
        patch.costInPerMillion = String(input.costInPerMillion);
      if (input.costOutPerMillion !== undefined)
        patch.costOutPerMillion = String(input.costOutPerMillion);
      if (input.supportsTools !== undefined)
        patch.supportsTools = input.supportsTools;
      if (input.supportsVision !== undefined)
        patch.supportsVision = input.supportsVision;
      if (input.supportsJsonMode !== undefined)
        patch.supportsJsonMode = input.supportsJsonMode;
      if (input.supportsStreaming !== undefined)
        patch.supportsStreaming = input.supportsStreaming;
      if (input.embeddingDimensions !== undefined)
        patch.embeddingDimensions = input.embeddingDimensions;
      if (input.tiers !== undefined) patch.tiers = input.tiers;

      // openokr:allow-mutation: this is the operation's own execute.
      const [updated] = await tx
        .update(aiModels)
        .set(patch)
        .where(activeOnly(aiModels, eq(aiModels.id, loaded.id)))
        .returning();
      if (!updated) {
        throw new OperationError("not_found", "No such custom model.");
      }

      return {
        result: {
          source: "custom" as const,
          id: updated.id,
          provider: updated.provider,
          modelId: updated.modelId,
          displayName: updated.displayName,
          contextWindow: updated.contextWindow,
          costInPerMillion: Number(updated.costInPerMillion),
          costOutPerMillion: Number(updated.costOutPerMillion),
          supportsTools: updated.supportsTools,
          supportsVision: updated.supportsVision,
          supportsJsonMode: updated.supportsJsonMode,
          supportsStreaming: updated.supportsStreaming,
          embeddingDimensions: updated.embeddingDimensions,
          tiers: updated.tiers,
          active: updated.active,
        },
        activity: {
          kind: "ai.custom_model_updated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { provider: updated.provider, modelId: updated.modelId },
        },
        audit: {
          action: "ai.updateCustomModel",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { modelId: updated.modelId },
        },
      };
    },
  }),
});

export const removeCustomModel = defineWriteAction({
  name: "ai.removeCustomModel",
  summary: "Removes a custom model from the catalogue.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [existing] = await tx
        .select({ id: aiModels.id })
        .from(aiModels)
        .where(
          activeOnly(
            aiModels,
            eq(aiModels.id, input.id),
            eq(aiModels.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new OperationError("not_found", "No such custom model.");
      }
      // openokr:allow-mutation: this is the operation's own execute.
      await tx
        .update(aiModels)
        .set({ deletedAt: new Date() })
        .where(activeOnly(aiModels, eq(aiModels.id, existing.id)));

      return {
        result: { id: existing.id },
        activity: {
          kind: "ai.custom_model_removed",
          subjectType: "workspace",
          subjectId: workspaceId,
        },
        audit: {
          action: "ai.removeCustomModel",
          targetType: "workspace",
          targetId: workspaceId,
        },
      };
    },
  }),
});

const tierRouteOutput = z.object({
  tier: tierSchema,
  provider: providerSchema.nullable(),
  modelId: z.string().nullable(),
  temperature: z.number().nullable(),
  maxTokens: z.number().int().nullable(),
  source: z.enum(["policy", "seeded-default", "unresolved"]),
});

export const readTierRouting = defineReadAction({
  name: "ai.readTierRouting",
  summary:
    "Every tier's effective route: an explicit policy, or the seeded default for whatever this workspace has enabled.",
  input: z.object({}),
  output: z.array(tierRouteOutput),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const routes = await Promise.all(
      MODEL_TIERS.map((tier) =>
        resolveTierRoute(context.pool, {
          workspaceId: context.workspaceId,
          tier,
        }),
      ),
    );
    return MODEL_TIERS.map((tier, index) => {
      const route = routes[index];
      if (!route) {
        return {
          tier,
          provider: null,
          modelId: null,
          temperature: null,
          maxTokens: null,
          source: "unresolved" as const,
        };
      }
      return route;
    });
  },
});

export const setTierPolicy = defineWriteAction({
  name: "ai.setTierPolicy",
  summary:
    "Maps a tier to a specific provider, model and sampling settings for this workspace.",
  input: z.object({
    tier: tierSchema,
    provider: providerSchema,
    modelId: z.string().trim().min(1),
    temperature: z.number().min(0).max(2).nullable().optional(),
    maxTokens: z.number().int().positive().nullable().optional(),
  }),
  output: tierRouteOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const [existing] = await tx
        .select({ id: aiModelPolicies.id })
        .from(aiModelPolicies)
        .where(
          activeOnly(
            aiModelPolicies,
            eq(aiModelPolicies.workspaceId, workspaceId),
            eq(aiModelPolicies.tier, input.tier),
          ),
        )
        .limit(1);
      return existing;
    },
    async execute({ tx, workspaceId, loaded }) {
      const row = {
        workspaceId,
        tier: input.tier,
        provider: input.provider,
        modelId: input.modelId,
        temperature:
          input.temperature === undefined || input.temperature === null
            ? null
            : String(input.temperature),
        maxTokens: input.maxTokens ?? null,
        updatedAt: new Date(),
      };
      let saved: typeof aiModelPolicies.$inferSelect | undefined;
      if (loaded) {
        // openokr:allow-mutation: this is the operation's own execute.
        [saved] = await tx
          .update(aiModelPolicies)
          .set(row)
          .where(activeOnly(aiModelPolicies, eq(aiModelPolicies.id, loaded.id)))
          .returning();
      } else {
        // openokr:allow-mutation: same reason as the update above.
        [saved] = await tx.insert(aiModelPolicies).values(row).returning();
      }
      if (!saved) {
        throw new OperationError(
          "not_found",
          "Could not save the tier policy.",
        );
      }

      return {
        result: {
          tier: saved.tier,
          provider: saved.provider,
          modelId: saved.modelId,
          temperature:
            saved.temperature === null ? null : Number(saved.temperature),
          maxTokens: saved.maxTokens,
          source: "policy" as const,
        },
        activity: {
          kind: "ai.tier_policy_set",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: {
            tier: input.tier,
            provider: input.provider,
            modelId: input.modelId,
          },
        },
        audit: {
          action: "ai.setTierPolicy",
          targetType: "workspace",
          targetId: workspaceId,
          payload: {
            tier: input.tier,
            provider: input.provider,
            modelId: input.modelId,
          },
        },
      };
    },
  }),
});

export const removeTierPolicy = defineWriteAction({
  name: "ai.removeTierPolicy",
  summary:
    "Removes a tier's explicit policy, reverting it to the seeded default.",
  input: z.object({ tier: tierSchema }),
  output: z.object({ tier: tierSchema }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [existing] = await tx
        .select({ id: aiModelPolicies.id })
        .from(aiModelPolicies)
        .where(
          activeOnly(
            aiModelPolicies,
            eq(aiModelPolicies.workspaceId, workspaceId),
            eq(aiModelPolicies.tier, input.tier),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new OperationError(
          "not_found",
          `${input.tier} has no explicit policy to remove.`,
        );
      }
      // openokr:allow-mutation: this is the operation's own execute.
      await tx
        .update(aiModelPolicies)
        .set({ deletedAt: new Date() })
        .where(
          activeOnly(aiModelPolicies, eq(aiModelPolicies.id, existing.id)),
        );

      return {
        result: { tier: input.tier },
        activity: {
          kind: "ai.tier_policy_removed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { tier: input.tier },
        },
        audit: {
          action: "ai.removeTierPolicy",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { tier: input.tier },
        },
      };
    },
  }),
});

const featureSettingOutput = z.object({
  featureKey: z.string(),
  enabled: z.boolean(),
  tierOverride: tierSchema.nullable(),
});

export const readFeatureSettings = defineReadAction({
  name: "ai.readFeatureSettings",
  summary: "Every feature's admin-configured switch and tier override.",
  input: z.object({}),
  output: z.array(featureSettingOutput),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, (tx) =>
      tx
        .select({
          featureKey: aiFeatureSettings.featureKey,
          enabled: aiFeatureSettings.enabled,
          tierOverride: aiFeatureSettings.tierOverride,
        })
        .from(aiFeatureSettings)
        .where(
          activeOnly(
            aiFeatureSettings,
            eq(aiFeatureSettings.workspaceId, context.workspaceId),
          ),
        ),
    );
  },
});

export const updateFeatureSetting = defineWriteAction({
  name: "ai.updateFeatureSetting",
  summary:
    "Turns one AI feature on or off, and optionally pins it to a different tier.",
  input: z.object({
    featureKey: z.string().trim().min(1),
    enabled: z.boolean().optional(),
    tierOverride: tierSchema.nullable().optional(),
  }),
  output: featureSettingOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const [existing] = await tx
        .select()
        .from(aiFeatureSettings)
        .where(
          activeOnly(
            aiFeatureSettings,
            eq(aiFeatureSettings.workspaceId, workspaceId),
            eq(aiFeatureSettings.featureKey, input.featureKey),
          ),
        )
        .limit(1);
      return existing;
    },
    async execute({ tx, workspaceId, loaded }) {
      const row = {
        workspaceId,
        featureKey: input.featureKey,
        enabled: input.enabled ?? loaded?.enabled ?? true,
        tierOverride:
          input.tierOverride === undefined
            ? (loaded?.tierOverride ?? null)
            : input.tierOverride,
        updatedAt: new Date(),
      };
      let saved: typeof aiFeatureSettings.$inferSelect | undefined;
      if (loaded) {
        // openokr:allow-mutation: this is the operation's own execute.
        [saved] = await tx
          .update(aiFeatureSettings)
          .set(row)
          .where(
            activeOnly(aiFeatureSettings, eq(aiFeatureSettings.id, loaded.id)),
          )
          .returning();
      } else {
        // openokr:allow-mutation: same reason as the update above.
        [saved] = await tx.insert(aiFeatureSettings).values(row).returning();
      }
      if (!saved) {
        throw new OperationError(
          "not_found",
          "Could not save the feature setting.",
        );
      }

      return {
        result: {
          featureKey: saved.featureKey,
          enabled: saved.enabled,
          tierOverride: saved.tierOverride,
        },
        activity: {
          kind: "ai.feature_setting_updated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { featureKey: input.featureKey },
        },
        audit: {
          action: "ai.updateFeatureSetting",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { featureKey: input.featureKey },
        },
      };
    },
  }),
});

const promptOutput = z.object({
  promptKey: z.string(),
  version: z.number().int(),
  systemPrompt: z.string(),
  isDefault: z.boolean(),
  history: z.array(
    z.object({
      version: z.number().int(),
      systemPrompt: z.string(),
      createdAt: z.string(),
    }),
  ),
});

export const readPrompt = defineReadAction({
  name: "ai.readPrompt",
  summary:
    "The current system prompt for a feature or agent phase, and every prior version.",
  input: z.object({ promptKey: z.string().trim().min(1) }),
  output: promptOutput,
  access: ACCESS_LEVELS.full,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const rows = await withWorkspace(db, context.workspaceId, (tx) =>
      tx
        .select()
        .from(aiPrompts)
        .where(
          activeOnly(
            aiPrompts,
            eq(aiPrompts.workspaceId, context.workspaceId),
            eq(aiPrompts.promptKey, input.promptKey),
          ),
        )
        .orderBy(desc(aiPrompts.version)),
    );

    const current = rows[0];
    const fallback = defaultPromptFor(input.promptKey);

    return {
      promptKey: input.promptKey,
      version: current?.version ?? 0,
      systemPrompt: current?.systemPrompt ?? fallback ?? "",
      isDefault: !current,
      history: rows.map((row) => ({
        version: row.version,
        systemPrompt: row.systemPrompt,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  },
});

export const updatePrompt = defineWriteAction({
  name: "ai.updatePrompt",
  summary: "Records a new version of a feature or agent phase's system prompt.",
  input: z.object({
    promptKey: z.string().trim().min(1),
    systemPrompt: z.string().trim().min(1),
  }),
  output: promptOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const [latest] = await tx
        .select({ version: aiPrompts.version })
        .from(aiPrompts)
        .where(
          activeOnly(
            aiPrompts,
            eq(aiPrompts.workspaceId, workspaceId),
            eq(aiPrompts.promptKey, input.promptKey),
          ),
        )
        .orderBy(desc(aiPrompts.version))
        .limit(1);
      return latest?.version ?? 0;
    },
    async execute({ tx, workspaceId, actor, loaded }) {
      const nextVersion = loaded + 1;
      // openokr:allow-mutation: this is the operation's own execute. A new
      // row, never an update to one already written — the old text has to
      // survive for "restore" and for the history this action itself
      // returns.
      const [inserted] = await tx
        .insert(aiPrompts)
        .values({
          workspaceId,
          promptKey: input.promptKey,
          version: nextVersion,
          systemPrompt: input.systemPrompt,
          createdByMemberId: actor.memberId,
        })
        .returning();
      if (!inserted) {
        throw new OperationError(
          "not_found",
          "Could not save the prompt version.",
        );
      }

      const rows = await tx
        .select()
        .from(aiPrompts)
        .where(
          activeOnly(
            aiPrompts,
            eq(aiPrompts.workspaceId, workspaceId),
            eq(aiPrompts.promptKey, input.promptKey),
          ),
        )
        .orderBy(desc(aiPrompts.version));

      return {
        result: {
          promptKey: input.promptKey,
          version: inserted.version,
          systemPrompt: inserted.systemPrompt,
          isDefault: false,
          history: rows.map((row) => ({
            version: row.version,
            systemPrompt: row.systemPrompt,
            createdAt: row.createdAt.toISOString(),
          })),
        },
        activity: {
          kind: "ai.prompt_updated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { promptKey: input.promptKey, version: nextVersion },
        },
        audit: {
          action: "ai.updatePrompt",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { promptKey: input.promptKey, version: nextVersion },
        },
      };
    },
  }),
});

export const restorePrompt = defineWriteAction({
  name: "ai.restorePrompt",
  summary:
    "Removes every stored version for a prompt key, so the built-in default serves again.",
  input: z.object({ promptKey: z.string().trim().min(1) }),
  output: z.object({ promptKey: z.string() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      // openokr:allow-mutation: this is the operation's own execute.
      await tx
        .update(aiPrompts)
        .set({ deletedAt: new Date() })
        .where(
          activeOnly(
            aiPrompts,
            eq(aiPrompts.workspaceId, workspaceId),
            eq(aiPrompts.promptKey, input.promptKey),
          ),
        );

      return {
        result: { promptKey: input.promptKey },
        activity: {
          kind: "ai.prompt_restored",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { promptKey: input.promptKey },
        },
        audit: {
          action: "ai.restorePrompt",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { promptKey: input.promptKey },
        },
      };
    },
  }),
});
