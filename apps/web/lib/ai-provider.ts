/**
 * The model a workspace's tier routes to, built as the provider it names
 * (completeness review H-27, H-07).
 *
 * **Every model call went to OpenRouter.** The drafter and the embedder
 * resolved an OpenRouter credential and built an OpenRouter client, whatever
 * the workspace had configured. A workspace that set up Anthropic, OpenAI,
 * Google, a local Ollama or any OpenAI-compatible endpoint found no OpenRouter
 * key, and the product behaved as though AI were switched off: no assists, no
 * copilot, no drafting for the agents. REQUIREMENTS names all six providers,
 * and the air-gapped configuration it promises is the local one.
 *
 * Tier routing already answered the right question, which provider and which
 * model serve this tier for this workspace, and its answer was thrown away.
 * This uses it: the route names the provider, the credential is that
 * provider's own, and its base URL is the one the workspace configured.
 *
 * **On the managed cloud, an administrator's base URL is checked on every
 * request** (H-07). A workspace administrator there is not the operator, and
 * a base URL pointed at a metadata address or the database host would be a
 * request the server makes for them.
 */
import {
  type AIProvider,
  type AIProviderConfig,
  createAIProvider,
} from "@openokr/adapters";
import { loadEnv } from "@openokr/config";
import {
  findSeededModel,
  isCloudEnabled,
  type ResolvedAICredential,
  resolveAICredential,
  resolveTierRoute,
} from "@openokr/core";
import type { ModelTier } from "@openokr/db";
import { getPool } from "./pool";
import { getKeyRing } from "./secrets";

export interface RoutedProvider {
  readonly provider: AIProvider;
  readonly modelId: string;
  readonly costInPerMillion: number;
  readonly costOutPerMillion: number;
}

type Resolved = Exclude<ResolvedAICredential, { source: "off" }>;

/** The adapter configuration for a resolved credential, or null. */
export function providerConfigFor(
  resolved: Resolved,
  options: { readonly guardOutbound: boolean; readonly appUrl: string },
): AIProviderConfig | null {
  switch (resolved.provider) {
    case "anthropic":
    case "openai":
    case "google":
      return { provider: resolved.provider, apiKey: resolved.apiKey };
    case "openrouter":
      return {
        provider: "openrouter",
        apiKey: resolved.apiKey,
        appName: "OpenOKR",
        appUrl: options.appUrl,
      };
    case "ollama":
      return {
        provider: "ollama",
        ...(resolved.baseUrl ? { baseUrl: resolved.baseUrl } : {}),
        guardOutbound: options.guardOutbound,
      };
    case "openai-compatible":
      // An endpoint with no address is not configured, whatever its key.
      return resolved.baseUrl
        ? {
            provider: "openai-compatible",
            apiKey: resolved.apiKey,
            baseURL: resolved.baseUrl,
            guardOutbound: options.guardOutbound,
          }
        : null;
  }
}

/**
 * The provider and model a tier routes to for this workspace, or null when
 * nothing is configured for it.
 *
 * Null is an ordinary answer: every assist has a manual path, and every agent
 * has its deterministic form. An unpriced model is refused, as it always was,
 * because a model that meters as zero would make the run cap meaningless.
 */
export async function providerForTier(
  workspaceId: string,
  tier: ModelTier,
): Promise<RoutedProvider | null> {
  const pool = getPool();
  const route = await resolveTierRoute(pool, { workspaceId, tier });
  if (!route) {
    return null;
  }
  const priced = findSeededModel(route.provider, route.modelId);
  if (!priced) {
    return null;
  }
  const resolved = await resolveAICredential(pool, getKeyRing(), process.env, {
    workspaceId,
    provider: route.provider,
  });
  if (resolved.source === "off") {
    return null;
  }
  const config = providerConfigFor(resolved, {
    guardOutbound: await isCloudEnabled(pool),
    appUrl: loadEnv().BETTER_AUTH_URL,
  });
  if (!config) {
    return null;
  }
  return {
    provider: createAIProvider(config),
    modelId: route.modelId,
    costInPerMillion: priced.costInPerMillion,
    costOutPerMillion: priced.costOutPerMillion,
  };
}
