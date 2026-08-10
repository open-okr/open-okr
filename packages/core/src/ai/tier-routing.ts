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
  aiProviders,
  type ModelTier,
  withWorkspace,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { seededModelsForProvider } from "./model-catalog.ts";

export interface ResolvedTierRoute {
  readonly tier: ModelTier;
  readonly provider: AIProviderKind;
  readonly modelId: string;
  readonly temperature: number | null;
  readonly maxTokens: number | null;
  readonly source: "policy" | "seeded-default";
}

export async function resolveTierRoute(
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
