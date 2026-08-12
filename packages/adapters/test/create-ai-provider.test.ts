import { describe, expect, it } from "vitest";
import {
  type AIProviderConfig,
  createAIProvider,
  defaultTierModelsFor,
} from "../src/create-ai-provider.ts";
import { AIUnavailableError } from "../src/ports/ai.ts";

/**
 * The AIProvider composition seam (P2-T13). "Adding a provider is a new
 * driver behind the same port, never a change to feature code"
 * (AI-NATIVE-PLAN §3.2) is only true if this factory is the one place that
 * knows every provider's name — these tests are that contract, checked
 * against every branch rather than a couple of examples.
 */

describe("createAIProvider", () => {
  it("returns a refusing provider for 'off'", async () => {
    const provider = createAIProvider({ provider: "off" });
    await expect(
      provider.chat({
        model: "any",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toBeInstanceOf(AIUnavailableError);
  });

  const configs: readonly AIProviderConfig[] = [
    { provider: "off" },
    { provider: "anthropic", apiKey: "test" },
    { provider: "openai", apiKey: "test" },
    { provider: "google", apiKey: "test" },
    { provider: "openrouter", apiKey: "test" },
    { provider: "ollama" },
    {
      provider: "openai-compatible",
      apiKey: "test",
      baseURL: "https://example.invalid",
    },
  ];

  it.each(configs)(
    "constructs a provider satisfying the port for %o",
    (config) => {
      const provider = createAIProvider(config);
      expect(typeof provider.chat).toBe("function");
      expect(typeof provider.stream).toBe("function");
      expect(typeof provider.chatWithTools).toBe("function");
      expect(typeof provider.embed).toBe("function");
      expect(typeof provider.extract).toBe("function");
      expect(typeof provider.capabilities).toBe("function");
      expect(typeof provider.stop).toBe("function");
    },
  );
});

describe("defaultTierModelsFor", () => {
  it("gives every real driver a fast, balanced and deep model", () => {
    for (const provider of [
      "anthropic",
      "openai",
      "google",
      "openrouter",
      "ollama",
    ] as const) {
      const tiers = defaultTierModelsFor(provider);
      expect(tiers.fast, `${provider} has no fast tier`).toBeTruthy();
      expect(tiers.balanced, `${provider} has no balanced tier`).toBeTruthy();
      expect(tiers.deep, `${provider} has no deep tier`).toBeTruthy();
    }
  });

  it("gives every driver with an embedding model an embed tier, and no others", () => {
    expect(defaultTierModelsFor("openai").embed).toBeTruthy();
    expect(defaultTierModelsFor("google").embed).toBeTruthy();
    expect(defaultTierModelsFor("ollama").embed).toBeTruthy();
    // Anthropic has no embeddings endpoint at all (see ai-anthropic.test.ts);
    // OpenRouter's own catalogue is chat models. Both are absent on purpose.
    expect(defaultTierModelsFor("anthropic").embed).toBeUndefined();
    expect(defaultTierModelsFor("openrouter").embed).toBeUndefined();
  });

  it("seeds nothing for 'off' or the fully generic 'openai-compatible' driver", () => {
    expect(defaultTierModelsFor("off")).toEqual({});
    expect(defaultTierModelsFor("openai-compatible")).toEqual({});
  });
});
