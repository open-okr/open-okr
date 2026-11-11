/**
 * The seeded model catalogue (AI-NATIVE-PLAN.md §3.4, P2-T15).
 *
 * Code, not a table — the same "registry plus database overrides" shape
 * `INSTANCE_SETTINGS`/`SETTINGS_REGISTRY` already use, and for the same
 * reason: seeding a `FORCE ROW LEVEL SECURITY` table (`ai_models`, migration
 * 0016) with rows that belong to no workspace has no clean owner to write
 * them as. `ai_models` holds only what an admin adds themselves; a
 * workspace's real catalogue is this list plus their own custom rows.
 *
 * Cost and context-window figures here are a working seed an admin is
 * expected to confirm or refresh (§3.4: "ships seeded and is refreshable
 * from the provider"), not a pricing guarantee this codebase makes. The
 * Anthropic, OpenAI and Google prices were read from each vendor's own pricing
 * page on 7 November 2026. Every
 * driver from P2-T13 is represented except `off` (nothing to seed) and
 * `openai-compatible` (fully generic — nobody but its own operator can name
 * a model for it, the same reason `defaultTierModelsFor` seeds it empty).
 */
import type { AIProviderKind, ModelTier } from "@openokr/db";

export interface SeededModel {
  readonly provider: AIProviderKind;
  readonly modelId: string;
  readonly displayName: string;
  readonly contextWindow: number;
  readonly costInPerMillion: number;
  readonly costOutPerMillion: number;
  /** What a token served from the provider's cache costs. Absent: the input rate. */
  readonly costCachedInPerMillion?: number;
  readonly supportsTools: boolean;
  readonly supportsVision: boolean;
  readonly supportsJsonMode: boolean;
  readonly supportsStreaming: boolean;
  readonly embeddingDimensions?: number;
  readonly tiers: readonly ModelTier[];
}

/** What it takes to price a call. */
export type ModelRates = Pick<
  SeededModel,
  "costInPerMillion" | "costOutPerMillion" | "costCachedInPerMillion"
>;

export const SEEDED_MODELS: readonly SeededModel[] = [
  // Anthropic — no embedding model, per tier-map.ts's own note.
  {
    provider: "anthropic",
    modelId: "claude-haiku-5-5",
    displayName: "Claude Haiku 5.5",
    contextWindow: 200_000,
    costInPerMillion: 0.1,
    costOutPerMillion: 0.5,
    costCachedInPerMillion: 0.01,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["fast"],
  },
  {
    provider: "anthropic",
    modelId: "claude-sonnet-5-5",
    displayName: "Claude Sonnet 5.5",
    contextWindow: 200_000,
    costInPerMillion: 2,
    costOutPerMillion: 10,
    costCachedInPerMillion: 0.1,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["balanced"],
  },
  {
    provider: "anthropic",
    modelId: "claude-opus-5-5",
    displayName: "Claude Opus 5.5",
    contextWindow: 200_000,
    costInPerMillion: 4,
    costOutPerMillion: 20,
    costCachedInPerMillion: 0.2,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["deep"],
  },
  // Earlier models carry no tier, so nothing new routes to them, and stay priced
  // because a workspace's own tier policy may still name one: an unpriced model
  // is refused, and that would switch its AI off on upgrade.
  {
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    contextWindow: 200_000,
    costInPerMillion: 1,
    costOutPerMillion: 5,
    costCachedInPerMillion: 0.1,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: [],
  },
  {
    provider: "anthropic",
    modelId: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    contextWindow: 200_000,
    costInPerMillion: 2,
    costOutPerMillion: 10,
    costCachedInPerMillion: 0.2,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: [],
  },
  {
    provider: "anthropic",
    modelId: "claude-opus-5",
    displayName: "Claude Opus 5",
    contextWindow: 200_000,
    costInPerMillion: 5,
    costOutPerMillion: 25,
    costCachedInPerMillion: 0.5,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: [],
  },
  // OpenAI
  {
    provider: "openai",
    modelId: "gpt-6-luna",
    displayName: "GPT-6 Luna",
    contextWindow: 128_000,
    costInPerMillion: 0.1,
    costOutPerMillion: 0.5,
    costCachedInPerMillion: 0.01,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["fast"],
  },
  {
    provider: "openai",
    modelId: "gpt-6.1-terra",
    displayName: "GPT-6.1 Terra",
    contextWindow: 128_000,
    costInPerMillion: 1,
    costOutPerMillion: 5,
    costCachedInPerMillion: 0.05,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["balanced"],
  },
  {
    provider: "openai",
    modelId: "gpt-6.1-sol",
    displayName: "GPT-6.1 Sol",
    contextWindow: 128_000,
    costInPerMillion: 2,
    costOutPerMillion: 10,
    costCachedInPerMillion: 0.1,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["deep"],
  },
  {
    provider: "openai",
    modelId: "gpt-5-mini",
    displayName: "GPT-5 Mini",
    contextWindow: 128_000,
    costInPerMillion: 0.25,
    costOutPerMillion: 2,
    costCachedInPerMillion: 0.025,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: [],
  },
  {
    provider: "openai",
    modelId: "gpt-5",
    displayName: "GPT-5",
    contextWindow: 128_000,
    costInPerMillion: 1.25,
    costOutPerMillion: 10,
    costCachedInPerMillion: 0.125,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: [],
  },
  {
    provider: "openai",
    modelId: "text-embedding-3-small",
    displayName: "Text Embedding 3 Small",
    contextWindow: 8_191,
    costInPerMillion: 0.02,
    costOutPerMillion: 0,
    supportsTools: false,
    supportsVision: false,
    supportsJsonMode: false,
    supportsStreaming: false,
    embeddingDimensions: 1536,
    tiers: ["embed"],
  },
  // Google. Gemini 2.5 Flash and 2.5 Pro stop being served as themselves on
  // 1 December 2026, so neither is a default any more.
  {
    provider: "google",
    modelId: "gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash Lite",
    contextWindow: 1_000_000,
    costInPerMillion: 0.1,
    costOutPerMillion: 0.4,
    costCachedInPerMillion: 0.01,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["fast"],
  },
  {
    provider: "google",
    modelId: "gemini-3.5-flash-lite",
    displayName: "Gemini 3.5 Flash Lite",
    contextWindow: 1_000_000,
    costInPerMillion: 0.3,
    costOutPerMillion: 2.5,
    costCachedInPerMillion: 0.03,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["balanced"],
  },
  // Google's price from 1 January 2027, which it has already published. Half that
  // until then, and metering low would have a workspace spend more than it sees.
  {
    provider: "google",
    modelId: "gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    contextWindow: 1_000_000,
    costInPerMillion: 1.5,
    costOutPerMillion: 7.5,
    costCachedInPerMillion: 0.15,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["deep"],
  },
  {
    provider: "google",
    modelId: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    contextWindow: 1_000_000,
    costInPerMillion: 0.3,
    costOutPerMillion: 2.5,
    costCachedInPerMillion: 0.03,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: [],
  },
  {
    provider: "google",
    modelId: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    contextWindow: 1_000_000,
    costInPerMillion: 1.25,
    costOutPerMillion: 10,
    costCachedInPerMillion: 0.125,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: [],
  },
  {
    provider: "google",
    modelId: "text-embedding-004",
    displayName: "Text Embedding 004",
    contextWindow: 2_048,
    costInPerMillion: 0.01,
    costOutPerMillion: 0,
    supportsTools: false,
    supportsVision: false,
    supportsJsonMode: false,
    supportsStreaming: false,
    embeddingDimensions: 768,
    tiers: ["embed"],
  },
  // OpenRouter — routes to any model behind one key; these are a starting
  // point, not an exhaustive list of what it actually offers. Each tier has
  // one default here (apps/web/test/ai-catalogue.test.ts); a model listing no
  // tier is still one an administrator can choose.
  //
  // GPT-6 Luna is the default for `fast` and `balanced` (Akmal, 11 November
  // 2026). Live on that day, through OpenRouter, it filled every copilot
  // proposal and passed 23 of the 24 evaluation sets, the 24th since mended,
  // at about a thirtieth of Sonnet 4.5's price: fifteen copilot questions cost
  // $0.004 against $0.126. Prices read from OpenRouter's model list that day.
  {
    provider: "openrouter",
    modelId: "openai/gpt-6-luna",
    displayName: "GPT-6 Luna (via OpenRouter)",
    // Its window is 1,050,000, but OpenRouter charges about double above
    // 272,000 input tokens, so the window the product plans for is the one
    // these prices hold for.
    contextWindow: 272_000,
    costInPerMillion: 0.1,
    costOutPerMillion: 0.5,
    costCachedInPerMillion: 0.01,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["fast", "balanced"],
  },
  {
    provider: "openrouter",
    modelId: "meta-llama/llama-3.1-8b-instruct",
    displayName: "Llama 3.1 8B (via OpenRouter)",
    contextWindow: 128_000,
    costInPerMillion: 0.05,
    costOutPerMillion: 0.05,
    supportsTools: true,
    supportsVision: false,
    supportsJsonMode: true,
    supportsStreaming: true,
    // The `fast` default until GPT-6 Luna, and still a choice on the AI page.
    tiers: [],
  },
  {
    provider: "openrouter",
    modelId: "anthropic/claude-sonnet-4.5",
    displayName: "Claude Sonnet 4.5 (via OpenRouter)",
    contextWindow: 200_000,
    costInPerMillion: 3,
    costOutPerMillion: 15,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    // Still the `deep` default, for the few assists that ask for it. An
    // administrator can route `balanced` back here on the AI page.
    tiers: ["deep"],
  },
  // Ollama — local, the air-gap default. Cost is zero because there is no
  // metered vendor call; context windows vary by how the model was pulled
  // and quantised, so these are the common defaults, not a guarantee.
  {
    provider: "ollama",
    modelId: "llama3.2:3b",
    displayName: "Llama 3.2 3B (local)",
    contextWindow: 128_000,
    costInPerMillion: 0,
    costOutPerMillion: 0,
    supportsTools: true,
    supportsVision: false,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["fast"],
  },
  {
    provider: "ollama",
    modelId: "llama3.1:8b",
    displayName: "Llama 3.1 8B (local)",
    contextWindow: 128_000,
    costInPerMillion: 0,
    costOutPerMillion: 0,
    supportsTools: true,
    supportsVision: false,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["balanced", "deep"],
  },
  {
    provider: "ollama",
    modelId: "nomic-embed-text",
    displayName: "Nomic Embed Text (local)",
    contextWindow: 8_192,
    costInPerMillion: 0,
    costOutPerMillion: 0,
    supportsTools: false,
    supportsVision: false,
    supportsJsonMode: false,
    supportsStreaming: false,
    embeddingDimensions: 768,
    tiers: ["embed"],
  },
] as const;

export function seededModelsForProvider(
  provider: AIProviderKind,
): readonly SeededModel[] {
  return SEEDED_MODELS.filter((model) => model.provider === provider);
}

/**
 * What a call cost, at a model's list price.
 *
 * One function, so the budget and the run cap cannot disagree about the price
 * of the same call.
 */
export function costOfUsage(
  rates: ModelRates,
  usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cachedInputTokens?: number;
  },
): number {
  const cached = usage.cachedInputTokens ?? 0;
  return (
    ((usage.inputTokens - cached) * rates.costInPerMillion +
      cached * (rates.costCachedInPerMillion ?? rates.costInPerMillion) +
      usage.outputTokens * rates.costOutPerMillion) /
    1_000_000
  );
}

export function findSeededModel(
  provider: AIProviderKind,
  modelId: string,
): SeededModel | undefined {
  return SEEDED_MODELS.find(
    (model) => model.provider === provider && model.modelId === modelId,
  );
}
