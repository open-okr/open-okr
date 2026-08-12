import { OpenAiCompatibleProvider } from "./openai-compatible.ts";
import type { TierModelMap } from "./tier-map.ts";

/** A seed, not a catalogue: refined per model once P2-T15's catalogue exists.
 * No `embed` entry — OpenRouter's own model list is chat-completion models;
 * an embedding call routes to a provider that actually has one instead. */
export const OPENROUTER_DEFAULT_TIER_MODELS: TierModelMap = {
  fast: "openai/gpt-4.1-mini",
  balanced: "anthropic/claude-sonnet-4",
  deep: "anthropic/claude-opus-4",
};

export interface OpenRouterProviderOptions {
  readonly apiKey: string;
  /** OpenRouter's attribution headers (its own convention, not OpenAI's):
   * which app is calling, shown on its leaderboards. Optional, but every
   * request without them is attributed to nobody. */
  readonly appUrl?: string;
  readonly appName?: string;
  readonly fetch?: typeof fetch;
}

export class OpenRouterProvider extends OpenAiCompatibleProvider {
  constructor(options: OpenRouterProviderOptions) {
    super({
      apiKey: options.apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        ...(options.appUrl ? { "HTTP-Referer": options.appUrl } : {}),
        ...(options.appName ? { "X-Title": options.appName } : {}),
      },
      fetch: options.fetch,
      defaultContextWindow: 128_000,
    });
  }
}
