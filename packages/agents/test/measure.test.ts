import { MockAIProvider } from "@openokr/adapters";
import { describe, expect, it } from "vitest";
import { measureActions } from "../src/measure.ts";

/** The arithmetic behind `pnpm ai:measure`, with no real call made. */
describe("measureActions", () => {
  const measure = (model = "claude-haiku-5-5", creditValueUsd = 0.01) =>
    measureActions({
      provider: new MockAIProvider({
        chatResponse: {
          content: "{}",
          usage: { inputTokens: 1000, outputTokens: 100 },
        },
        streamChunks: ["An answer."],
      }),
      providerKind: "anthropic",
      model,
      creditValueUsd,
    });

  it("reports every action, priced from the catalogue", async () => {
    const rows = await measure();
    expect(rows.map((row) => row.action)).toEqual([
      "Rewrite a key result the Coach flagged",
      "Draft an objective from a sentence",
      "Word a check-in the Champion is chasing",
      "Summarise a comment thread",
      "Answer a copilot question",
    ]);
    const copilot = rows.at(-1);
    expect(copilot).toMatchObject({ inputTokens: 1000, outputTokens: 100 });
    // Haiku 5.5: 1,000 in at $0.10 and 100 out at $0.50 a million.
    expect(copilot?.costUsd).toBeCloseTo(0.00015);
    expect(copilot?.credits).toBeCloseTo(0.015);
    expect(copilot?.answer).toContain("An answer.");
  });

  it("takes a provider's own credit value", async () => {
    const rows = await measure("claude-haiku-5-5", 0.02);
    expect(rows.at(-1)?.credits).toBeCloseTo(0.0075);
  });

  it("refuses a model the catalogue cannot price", async () => {
    await expect(measure("no-such-model")).rejects.toThrow(/no price/);
  });
});
