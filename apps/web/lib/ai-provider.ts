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
 *
 * **Every provider carries the workspace's egress controls** (M-10). They are
 * read here, per build, and handed to `createAIProvider`, which will not build
 * a provider without them. What a control withholds or replaces is written to
 * the audit trail as counts and a host, never as text.
 */
import {
  type AIProviderConfig,
  createAIProvider,
  type GuardedAIProvider,
} from "@openokr/adapters";
import { loadEnv } from "@openokr/config";
import {
  findSeededModel,
  isCloudEnabled,
  type ResolvedAICredential,
  recordAIEgressWithheld,
  resolveAICredential,
  resolveAIPrivacySettings,
  resolveTierRoute,
} from "@openokr/core";
import type { ModelTier } from "@openokr/db";
import { getInstanceName } from "./instance-name";
import { getPool } from "./pool";
import { getKeyRing } from "./secrets";

export interface RoutedProvider {
  /**
   * Guarded: `permits` says whether a request of a given purpose would be let
   * through, so a host can leave a feature out rather than offer a button
   * that can only fail.
   */
  readonly provider: GuardedAIProvider;
  readonly modelId: string;
  readonly costInPerMillion: number;
  readonly costOutPerMillion: number;
}

type Resolved = Exclude<ResolvedAICredential, { source: "off" }>;

/** The adapter configuration for a resolved credential, or null. */
export function providerConfigFor(
  resolved: Resolved,
  options: {
    readonly guardOutbound: boolean;
    readonly appUrl: string;
    /** What the provider's dashboard lists this app as (M-33). */
    readonly appName: string;
  },
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
        appName: options.appName,
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
 *
 * **`forUser` is the signed-in person a request is for** (completeness review
 * M-36). Their own key for the routed provider answers it when they stored
 * one, which is AI-NATIVE-PLAN §3.3's "user key, then workspace". It changes
 * whose account pays and nothing else: the tier still picks the provider and
 * the model, and the egress controls below wrap the provider whichever key it
 * holds. Nothing an agent or the scheduler asks passes it, so the Coach and
 * the Champion always run on the workspace's key.
 */
export async function providerForTier(
  workspaceId: string,
  tier: ModelTier,
  forUser?: string,
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
    ...(forUser ? { userId: forUser } : {}),
  });
  if (resolved.source === "off") {
    return null;
  }
  const config = providerConfigFor(resolved, {
    guardOutbound: await isCloudEnabled(pool),
    appUrl: loadEnv().BETTER_AUTH_URL,
    appName: await getInstanceName(),
  });
  if (!config) {
    return null;
  }
  const policy = await resolveAIPrivacySettings(pool, workspaceId);
  return {
    provider: createAIProvider(config, {
      policy,
      onWithheld: (event) =>
        recordAIEgressWithheld(pool, { workspaceId, ...event }),
    }),
    modelId: route.modelId,
    costInPerMillion: priced.costInPerMillion,
    costOutPerMillion: priced.costOutPerMillion,
  };
}
