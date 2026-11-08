/**
 * Tier routing (AI-NATIVE-PLAN.md §3.4, P2-T15): "features request a tier,
 * never a model." Resolves a workspace's own explicit policy for a tier
 * first, then falls back to the seeded catalogue's own default for
 * whichever provider the workspace has actually enabled — "a workspace
 * that has supplied only a key resolves every tier through the driver's
 * seeded map" (this task's own test plan), without needing a policy row at
 * all until an admin wants to change something.
 */
import {
  type AIProviderKind,
  activeOnly,
  aiFeatureSettings,
  aiModelPolicies,
  aiModels,
  aiProviders,
  type ModelTier,
  withWorkspace,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import {
  environmentValue,
  getInstanceSetting,
} from "../secrets/instance-registry.ts";
import { readSetting } from "../secrets/instance-settings.ts";
import {
  findSeededModel,
  type ModelRates,
  seededModelsForProvider,
} from "./model-catalog.ts";

const pricesSchema = z.object({
  costInPerMillion: z.number().min(0),
  costOutPerMillion: z.number().min(0),
  costCachedInPerMillion: z.number().min(0).optional(),
});

const stripAbsent = (rates: z.infer<typeof pricesSchema>): ModelRates => ({
  costInPerMillion: rates.costInPerMillion,
  costOutPerMillion: rates.costOutPerMillion,
  ...(rates.costCachedInPerMillion === undefined
    ? {}
    : { costCachedInPerMillion: rates.costCachedInPerMillion }),
});

export interface ResolvedTierRoute {
  readonly tier: ModelTier;
  readonly provider: AIProviderKind;
  readonly modelId: string;
  readonly temperature: number | null;
  readonly maxTokens: number | null;
  readonly source: "policy" | "seeded-default" | "deployment";
}

/** A JSON instance setting, or nothing when it is absent or does not parse. */
async function jsonSetting(pool: Pool, key: string): Promise<unknown> {
  const definition = getInstanceSetting(key);
  const stored = await readSetting(pool, key);
  const raw =
    stored ??
    (definition ? environmentValue(definition, process.env) : undefined);
  if (typeof raw !== "string") {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * The provider's own key, for a workspace with no provider of its own
 * (docs/design/ai-credits.md §3).
 *
 * The credential resolver has always fallen back to the deployment's key, and nothing
 * routed to it, so it did nothing unless a workspace had enabled a provider of its
 * own. A deployment that names a provider now serves every workspace that has none.
 */
async function deploymentRoute(
  pool: Pool,
  tier: ModelTier,
): Promise<ResolvedTierRoute | undefined> {
  const definition = getInstanceSetting("ai.deployment.provider");
  const stored = await readSetting(pool, "ai.deployment.provider");
  const provider = (stored ??
    (definition ? environmentValue(definition, process.env) : undefined)) as
    | AIProviderKind
    | ""
    | undefined;
  if (!provider) {
    return undefined;
  }
  const chosen = await jsonSetting(pool, "ai.deployment.tierModels");
  const named =
    chosen && typeof chosen === "object"
      ? (chosen as Record<string, unknown>)[tier]
      : undefined;
  const modelId =
    typeof named === "string" && findSeededModel(provider, named)
      ? named
      : seededModelsForProvider(provider).find((model) =>
          model.tiers.includes(tier),
        )?.modelId;
  return modelId
    ? {
        tier,
        provider,
        modelId,
        temperature: null,
        maxTokens: null,
        source: "deployment",
      }
    : undefined;
}

export async function resolveTierRoute(
  pool: Pool,
  input: { readonly workspaceId: string; readonly tier: ModelTier },
): Promise<ResolvedTierRoute | undefined> {
  const own = await workspaceRoute(pool, input);
  return own ?? deploymentRoute(pool, input.tier);
}

async function workspaceRoute(
  pool: Pool,
  input: { readonly workspaceId: string; readonly tier: ModelTier },
): Promise<ResolvedTierRoute | undefined> {
  const db = drizzle(pool);
  return withWorkspace(db, input.workspaceId, async (tx) => {
    const [policy] = await tx
      .select()
      .from(aiModelPolicies)
      .where(
        activeOnly(
          aiModelPolicies,
          eq(aiModelPolicies.workspaceId, input.workspaceId),
          eq(aiModelPolicies.tier, input.tier),
        ),
      )
      .limit(1);
    if (policy) {
      return {
        tier: input.tier,
        provider: policy.provider,
        modelId: policy.modelId,
        temperature:
          policy.temperature === null ? null : Number(policy.temperature),
        maxTokens: policy.maxTokens,
        source: "policy",
      };
    }

    const enabledProviders = await tx
      .select({ provider: aiProviders.provider })
      .from(aiProviders)
      .where(
        activeOnly(
          aiProviders,
          eq(aiProviders.workspaceId, input.workspaceId),
          eq(aiProviders.enabled, true),
        ),
      )
      .orderBy(aiProviders.createdAt);

    for (const { provider } of enabledProviders) {
      const seeded = seededModelsForProvider(provider).find((model) =>
        model.tiers.includes(input.tier),
      );
      if (seeded) {
        return {
          tier: input.tier,
          provider,
          modelId: seeded.modelId,
          temperature: null,
          maxTokens: null,
          source: "seeded-default",
        };
      }
    }

    return undefined;
  });
}

/**
 * What this model costs this workspace, or nothing when nobody has priced it.
 *
 * **An administrator's own row comes first**, then the seeded catalogue: the
 * "registry plus database overrides" the catalogue describes. Reading only the
 * seed left every model an administrator added unpriced, and an unpriced model
 * is refused, so no OpenAI-compatible endpoint could ever answer and Ollama
 * answered only for the seeded names.
 */
export async function resolveModelRates(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly provider: AIProviderKind;
    readonly modelId: string;
  },
): Promise<ModelRates | undefined> {
  const db = drizzle(pool);
  const [own] = await withWorkspace(db, input.workspaceId, (tx) =>
    tx
      .select({
        costInPerMillion: aiModels.costInPerMillion,
        costOutPerMillion: aiModels.costOutPerMillion,
      })
      .from(aiModels)
      .where(
        activeOnly(
          aiModels,
          eq(aiModels.workspaceId, input.workspaceId),
          eq(aiModels.provider, input.provider),
          eq(aiModels.modelId, input.modelId),
        ),
      )
      .limit(1),
  );
  if (own) {
    return {
      costInPerMillion: Number(own.costInPerMillion),
      costOutPerMillion: Number(own.costOutPerMillion),
    };
  }
  return findSeededModel(input.provider, input.modelId);
}

/**
 * What a model costs on the provider's own key.
 *
 * **From the catalogue, never from a workspace's own row**, which an administrator
 * writes: they could otherwise price the provider's model at nothing. A deployment can
 * correct a price without a release, because prices move.
 */
export async function resolveDeploymentRates(
  pool: Pool,
  provider: AIProviderKind,
  modelId: string,
): Promise<ModelRates | undefined> {
  const corrected = await jsonSetting(pool, "ai.deployment.prices");
  const entry =
    corrected && typeof corrected === "object"
      ? (corrected as Record<string, unknown>)[modelId]
      : undefined;
  const parsed = pricesSchema.safeParse(entry);
  return parsed.success
    ? stripAbsent(parsed.data)
    : findSeededModel(provider, modelId);
}

export interface ResolvedFeatureTier {
  readonly enabled: boolean;
  readonly tier: ModelTier;
}

/**
 * A feature's effective tier: its own admin-set override if one exists,
 * otherwise the tier the feature's own code asked for. Also whether the
 * feature is switched on at all — off by default is wrong (AI-NATIVE-PLAN
 * §4: "on by default where a provider is configured"), so a missing row
 * means enabled, not disabled.
 */
export async function resolveFeatureTier(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly featureKey: string;
    readonly defaultTier: ModelTier;
  },
): Promise<ResolvedFeatureTier> {
  const db = drizzle(pool);
  return withWorkspace(db, input.workspaceId, async (tx) => {
    const [setting] = await tx
      .select()
      .from(aiFeatureSettings)
      .where(
        activeOnly(
          aiFeatureSettings,
          eq(aiFeatureSettings.workspaceId, input.workspaceId),
          eq(aiFeatureSettings.featureKey, input.featureKey),
        ),
      )
      .limit(1);
    if (!setting) {
      return { enabled: true, tier: input.defaultTier };
    }
    return {
      enabled: setting.enabled,
      tier: setting.tierOverride ?? input.defaultTier,
    };
  });
}
