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
 * from the provider"), not a pricing guarantee this codebase makes. Every
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
  readonly supportsTools: boolean;
  readonly supportsVision: boolean;
  readonly supportsJsonMode: boolean;
  readonly supportsStreaming: boolean;
  readonly embeddingDimensions?: number;
  readonly tiers: readonly ModelTier[];
}

export const SEEDED_MODELS: readonly SeededModel[] = [
  // Anthropic — no embedding model, per tier-map.ts's own note.
  {
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    contextWindow: 200_000,
    costInPerMillion: 0.8,
    costOutPerMillion: 4,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["fast"],
  },
  {
    provider: "anthropic",
    modelId: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    contextWindow: 200_000,
    costInPerMillion: 3,
    costOutPerMillion: 15,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["balanced"],
  },
  {
    provider: "anthropic",
    modelId: "claude-opus-5",
    displayName: "Claude Opus 5",
    contextWindow: 200_000,
    costInPerMillion: 15,
    costOutPerMillion: 75,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["deep"],
  },
  // OpenAI
  {
    provider: "openai",
    modelId: "gpt-5-mini",
    displayName: "GPT-5 Mini",
    contextWindow: 128_000,
    costInPerMillion: 0.15,
    costOutPerMillion: 0.6,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["fast"],
  },
  {
    provider: "openai",
    modelId: "gpt-5",
    displayName: "GPT-5",
    contextWindow: 128_000,
    costInPerMillion: 2.5,
    costOutPerMillion: 10,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["balanced", "deep"],
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
  // Google
  {
    provider: "google",
    modelId: "gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash Lite",
    contextWindow: 1_000_000,
    costInPerMillion: 0.1,
    costOutPerMillion: 0.4,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["fast"],
  },
  {
    provider: "google",
    modelId: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    contextWindow: 1_000_000,
    costInPerMillion: 0.3,
    costOutPerMillion: 1.2,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["balanced"],
  },
  {
    provider: "google",
    modelId: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    contextWindow: 1_000_000,
    costInPerMillion: 1.25,
    costOutPerMillion: 5,
    supportsTools: true,
    supportsVision: true,
    supportsJsonMode: true,
    supportsStreaming: true,
    tiers: ["deep"],
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
  // OpenRouter — routes to any model behind one key; these three are a
  // starting point, not an exhaustive list of what it actually offers.
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
    tiers: ["fast"],
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
    tiers: ["balanced", "deep"],
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

export function findSeededModel(
  provider: AIProviderKind,
  modelId: string,
): SeededModel | undefined {
  return SEEDED_MODELS.find(
    (model) => model.provider === provider && model.modelId === modelId,
  );
}
