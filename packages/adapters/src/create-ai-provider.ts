/**
 * The AIProvider composition seam (AI-NATIVE-PLAN §3.1-3.2, P2-T13).
 *
 * A per-port factory beside `createAdapters` and `createMailer`, for the
 * same reason `createMailer` has its own: which provider and key apply is
 * resolved by configuration that lives in the database and changes without
 * a restart (P2-T14's precedence resolver — user key, then workspace, then
 * deployment, then off), not something `createAdapters` can decide once at
 * process start. Every driver class stays private to this package; this
 * function and the `AIProvider` port are the only way anything outside
 * `packages/adapters` reaches one, which is also what makes "adding a
 * provider is a new driver behind the same port, never a change to feature
 * code" (AI-NATIVE-PLAN §3.2) true in practice and not just in wording.
 *
 * **It is also the one place egress is decided** (completeness review M-10).
 * Every provider it returns is wrapped in `EgressGuardedProvider`, and the
 * egress controls are a required argument rather than an option, so there is
 * no way to be handed a driver that skips them. A caller with no policy to
 * pass has no business reaching a provider.
 */

import {
  ANTHROPIC_BASE_URL,
  ANTHROPIC_DEFAULT_TIER_MODELS,
  AnthropicProvider,
} from "./drivers/ai/anthropic.ts";
import {
  GOOGLE_BASE_URL,
  GOOGLE_DEFAULT_TIER_MODELS,
  GoogleProvider,
} from "./drivers/ai/google.ts";
import { OffAIProvider } from "./drivers/ai/off.ts";
import {
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_TIER_MODELS,
  OllamaProvider,
} from "./drivers/ai/ollama.ts";
import {
  OPENAI_BASE_URL,
  OPENAI_DEFAULT_TIER_MODELS,
  OpenAiProvider,
} from "./drivers/ai/openai.ts";
import { OpenAiCompatibleProvider } from "./drivers/ai/openai-compatible.ts";
import {
  OPENROUTER_BASE_URL,
  OPENROUTER_DEFAULT_TIER_MODELS,
  OpenRouterProvider,
} from "./drivers/ai/openrouter.ts";
import type { TierModelMap } from "./drivers/ai/tier-map.ts";
import {
  type AIEgressEvent,
  type AIEgressPolicy,
  type AIEgressTarget,
  aiEgressTargetFromUrl,
  EgressGuardedProvider,
} from "./outbound/ai-egress.ts";
import { createGuardedFetch } from "./outbound/guard.ts";
import type { AIProvider, AIPurpose } from "./ports/ai.ts";

export type AIProviderConfig =
  | { readonly provider: "off" }
  | { readonly provider: "anthropic"; readonly apiKey: string }
  | { readonly provider: "openai"; readonly apiKey: string }
  | { readonly provider: "google"; readonly apiKey: string }
  | {
      readonly provider: "openrouter";
      readonly apiKey: string;
      readonly appUrl?: string;
      readonly appName?: string;
    }
  | {
      readonly provider: "ollama";
      readonly baseUrl?: string;
      /** Refuse private and reserved addresses (completeness review H-07). */
      readonly guardOutbound?: boolean;
    }
  | {
      readonly provider: "openai-compatible";
      readonly apiKey: string;
      readonly baseURL: string;
      /** Refuse private and reserved addresses (completeness review H-07). */
      readonly guardOutbound?: boolean;
    };

/** What every provider is built with: the workspace's egress controls. */
export interface AIEgressOptions {
  readonly policy: AIEgressPolicy;
  /** Told what a control withheld or replaced. Never given the text. */
  readonly onWithheld?: (event: AIEgressEvent) => void | Promise<void>;
}

/** A provider as `createAIProvider` returns it: guarded, and able to say so. */
export type GuardedAIProvider = AIProvider & {
  readonly target: AIEgressTarget;
  permits(purpose: AIPurpose): boolean;
};

/**
 * Where a provider's requests go, from its kind and the base URL configured
 * for it.
 *
 * Only Ollama and an OpenAI-compatible endpoint take an address; the other
 * drivers always call their vendor's own host, whatever a stored base URL
 * says, so that is the host checked. Exported for the console, which greys
 * the privacy card out when every tier is answered locally.
 */
export function aiEgressTargetOf(
  provider: AIProviderConfig["provider"],
  baseUrl: string | null,
): AIEgressTarget {
  switch (provider) {
    case "off":
      // Nothing is ever sent, which is as local as anything gets.
      return { host: null, local: true };
    case "anthropic":
      return aiEgressTargetFromUrl(ANTHROPIC_BASE_URL);
    case "openai":
      return aiEgressTargetFromUrl(OPENAI_BASE_URL);
    case "google":
      return aiEgressTargetFromUrl(GOOGLE_BASE_URL);
    case "openrouter":
      return aiEgressTargetFromUrl(OPENROUTER_BASE_URL);
    case "ollama":
      return aiEgressTargetFromUrl(baseUrl ?? OLLAMA_DEFAULT_BASE_URL);
    case "openai-compatible":
      return aiEgressTargetFromUrl(baseUrl);
  }
}

function baseUrlOf(config: AIProviderConfig): string | null {
  switch (config.provider) {
    case "ollama":
      return config.baseUrl ?? null;
    case "openai-compatible":
      return config.baseURL;
    default:
      return null;
  }
}

function driverFor(config: AIProviderConfig, noTraining: boolean): AIProvider {
  switch (config.provider) {
    case "off":
      return new OffAIProvider();
    case "anthropic":
      return new AnthropicProvider({ apiKey: config.apiKey });
    case "openai":
      return new OpenAiProvider({ apiKey: config.apiKey });
    case "google":
      return new GoogleProvider({ apiKey: config.apiKey });
    case "openrouter":
      return new OpenRouterProvider({
        apiKey: config.apiKey,
        appUrl: config.appUrl,
        appName: config.appName,
        noTraining,
      });
    case "ollama":
      return new OllamaProvider({
        baseUrl: config.baseUrl,
        ...(config.guardOutbound ? { fetch: createGuardedFetch() } : {}),
      });
    case "openai-compatible":
      return new OpenAiCompatibleProvider({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        ...(config.guardOutbound ? { fetch: createGuardedFetch() } : {}),
      });
  }
}

export function createAIProvider(
  config: AIProviderConfig,
  egress: AIEgressOptions,
): GuardedAIProvider {
  const target = aiEgressTargetOf(config.provider, baseUrlOf(config));
  // A no-training instruction to a provider on this machine would be an
  // instruction to nobody, so it rides only on a request that leaves.
  const noTraining = egress.policy.noTraining && !target.local;
  return new EgressGuardedProvider(driverFor(config, noTraining), {
    provider: config.provider,
    target,
    policy: egress.policy,
    ...(egress.onWithheld ? { onWithheld: egress.onWithheld } : {}),
  });
}

/** Every driver's own seed (AI-NATIVE-PLAN §3.4): "a driver added without a
 * default tier map is incomplete." `off` and the fully generic
 * `openai-compatible` driver have none — there is nothing to seed for a
 * provider with no capability, or one whose models nobody but its own
 * operator can name. */
export function defaultTierModelsFor(
  provider: AIProviderConfig["provider"],
): TierModelMap {
  switch (provider) {
    case "off":
    case "openai-compatible":
      return {};
    case "anthropic":
      return ANTHROPIC_DEFAULT_TIER_MODELS;
    case "openai":
      return OPENAI_DEFAULT_TIER_MODELS;
    case "google":
      return GOOGLE_DEFAULT_TIER_MODELS;
    case "openrouter":
      return OPENROUTER_DEFAULT_TIER_MODELS;
    case "ollama":
      return OLLAMA_DEFAULT_TIER_MODELS;
  }
}
