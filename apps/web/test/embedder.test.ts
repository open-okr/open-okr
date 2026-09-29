import { beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The embedding function the relay and the command palette share
 * (completeness review M-21, with M-10's egress controls).
 *
 * **What matters is when there is none.** The palette asks for a Related group
 * only when this answers, so every way the workspace can say no has to answer
 * undefined: no provider for the embed tier, and a provider whose egress
 * controls withhold retrieval. The provider itself comes from `providerForTier`
 * and nothing else, so this is the one seam replaced.
 */

const providerForTier = vi.fn();
vi.mock("../lib/ai-provider", () => ({
  providerForTier: (...args: unknown[]) => providerForTier(...args),
}));

const { embedFor } = await import("../lib/embedder.ts");

const routed = (permitsRetrieval: boolean) => {
  const embed = vi.fn(async (request: { input: readonly string[] }) => ({
    vectors: request.input.map(() => [0.1, 0.2]),
    dimensions: 2,
  }));
  const permits = vi.fn(
    (purpose: string) => purpose !== "retrieval" || permitsRetrieval,
  );
  return {
    provider: { embed, permits },
    modelId: "text-embedding-test",
    costInPerMillion: 0.02,
    costOutPerMillion: 0,
  };
};

beforeEach(() => {
  providerForTier.mockReset();
});

describe("the embedding function", () => {
  test("is absent with no provider for the embed tier", async () => {
    providerForTier.mockResolvedValue(null);
    expect(await embedFor("workspace-1")).toBeUndefined();
    expect(providerForTier).toHaveBeenCalledWith("workspace-1", "embed");
  });

  test("is absent when the workspace keeps retrieval here, and nothing is sent", async () => {
    const withheld = routed(false);
    providerForTier.mockResolvedValue(withheld);

    expect(await embedFor("workspace-1")).toBeUndefined();
    expect(withheld.provider.permits).toHaveBeenCalledWith("retrieval");
    expect(withheld.provider.embed).not.toHaveBeenCalled();
  });

  test("embeds through the routed provider and names the model it used", async () => {
    const allowed = routed(true);
    providerForTier.mockResolvedValue(allowed);

    const embed = await embedFor("workspace-1");
    expect(embed).toBeDefined();
    const result = await embed?.(["retention for returning customers"]);

    expect(allowed.provider.embed).toHaveBeenCalledWith({
      model: "text-embedding-test",
      input: ["retention for returning customers"],
    });
    expect(result).toEqual({
      vectors: [[0.1, 0.2]],
      dimensions: 2,
      model: "text-embedding-test",
    });
  });
});
