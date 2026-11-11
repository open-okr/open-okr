import { defaultTierModelsFor } from "@openokr/adapters";
import {
  findSeededModel,
  SEEDED_MODELS,
  seededModelsForProvider,
} from "@openokr/core";
import { describe, expect, it } from "vitest";

/**
 * The drivers' default tier map and the priced catalogue live in two packages,
 * and the second is what routes. They drifted: OpenAI's drivers said `gpt-4.1`
 * and `o3` while the catalogue said `gpt-5`, and a default with no price is a
 * workspace with no AI, because an unpriced model is refused.
 */
describe("the model catalogue", () => {
  it.each(["anthropic", "openai", "google", "openrouter"] as const)(
    "%s routes each chat tier to the model its driver names, and prices it",
    (provider) => {
      for (const tier of ["fast", "balanced", "deep"] as const) {
        const named = defaultTierModelsFor(provider)[tier];
        expect(named, `${provider} ${tier}`).toBeTruthy();
        const routed = seededModelsForProvider(provider).find((model) =>
          model.tiers.includes(tier),
        );
        expect(routed?.modelId, `${provider} ${tier}`).toBe(named);
        expect(findSeededModel(provider, named as string)).toBeDefined();
      }
    },
  );

  it("gives every tier one default per provider, so routing has one answer", () => {
    for (const provider of new Set(SEEDED_MODELS.map((m) => m.provider))) {
      for (const tier of ["fast", "balanced", "deep", "embed"] as const) {
        const models = seededModelsForProvider(provider).filter((model) =>
          model.tiers.includes(tier),
        );
        expect(models.length, `${provider} ${tier}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
