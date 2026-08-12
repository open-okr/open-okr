import { OpenAiCompatibleProvider } from "./openai-compatible.ts";
import type { TierModelMap } from "./tier-map.ts";

/** A seed, not a catalogue: refined per model once P2-T15's catalogue exists. */
export const OPENAI_DEFAULT_TIER_MODELS: TierModelMap = {
  fast: "gpt-4.1-mini",
  balanced: "gpt-4.1",
  deep: "o3",
  embed: "text-embedding-3-large",
};

export interface OpenAiProviderOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
}

export class OpenAiProvider extends OpenAiCompatibleProvider {
  constructor(options: OpenAiProviderOptions) {
    super({
      apiKey: options.apiKey,
      baseURL: "https://api.openai.com/v1",
      fetch: options.fetch,
      defaultContextWindow: 128_000,
    });
  }
}
