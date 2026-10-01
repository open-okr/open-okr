import { MockAIProvider } from "@openokr/adapters";
import type { AgentRunModel } from "../src/run-executor.ts";

/**
 * A model a run may be handed: the deterministic mock driver, guarded the way
 * `createAIProvider` guards every real one (completeness review M-11).
 *
 * `permits` is the one part of the guard a run asks, so it is the one part a
 * test sets: `false` is a workspace whose AI privacy settings let nothing
 * reach the provider.
 */
export function mockRunModel(
  options: { readonly permits?: boolean } = {},
): AgentRunModel {
  const provider = Object.assign(new MockAIProvider(), {
    target: { host: null, local: true },
    permits: () => options.permits ?? true,
  });
  return { provider, modelId: "mock-model" };
}
