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
 */
import {
  ANTHROPIC_DEFAULT_TIER_MODELS,
  AnthropicProvider,
} from "./drivers/ai/anthropic.ts";
import {
  GOOGLE_DEFAULT_TIER_MODELS,
  GoogleProvider,
} from "./drivers/ai/google.ts";
import { OffAIProvider } from "./drivers/ai/off.ts";
import {
  OLLAMA_DEFAULT_TIER_MODELS,
  OllamaProvider,
} from "./drivers/ai/ollama.ts";
import {
  OPENAI_DEFAULT_TIER_MODELS,
  OpenAiProvider,
} from "./drivers/ai/openai.ts";
import { OpenAiCompatibleProvider } from "./drivers/ai/openai-compatible.ts";
import {
  OPENROUTER_DEFAULT_TIER_MODELS,
  OpenRouterProvider,
} from "./drivers/ai/openrouter.ts";
import type { TierModelMap } from "./drivers/ai/tier-map.ts";
import type { AIProvider } from "./ports/ai.ts";

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
  | { readonly provider: "ollama"; readonly baseUrl?: string }
  | {
      readonly provider: "openai-compatible";
      readonly apiKey: string;
      readonly baseURL: string;
    };

export function createAIProvider(config: AIProviderConfig): AIProvider {
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
      });
    case "ollama":
      return new OllamaProvider({ baseUrl: config.baseUrl });
    case "openai-compatible":
      return new OpenAiCompatibleProvider({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });
  }
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
