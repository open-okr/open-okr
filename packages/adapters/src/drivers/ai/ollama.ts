import { OpenAiCompatibleProvider } from "./openai-compatible.ts";
import type { TierModelMap } from "./tier-map.ts";

/** A seed, not a catalogue: refined per model once P2-T15's catalogue
 * exists. Named tags, not a live pull — an air-gapped install still needs to
 * have run `ollama pull` for whichever of these it maps a tier to. */
export const OLLAMA_DEFAULT_TIER_MODELS: TierModelMap = {
  fast: "llama3.2",
  balanced: "llama3.1",
  deep: "llama3.1:70b",
  embed: "nomic-embed-text",
};

export interface OllamaProviderOptions {
  /** Defaults to a local install's own default address. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

export class OllamaProvider extends OpenAiCompatibleProvider {
  constructor(options: OllamaProviderOptions = {}) {
    super({
      // Ollama's OpenAI-compatible endpoint does not check this value, but
      // the client requires a non-empty string to construct.
      apiKey: "ollama",
      baseURL: options.baseUrl ?? "http://localhost:11434/v1",
      fetch: options.fetch,
      defaultContextWindow: 128_000,
    });
  }
}
