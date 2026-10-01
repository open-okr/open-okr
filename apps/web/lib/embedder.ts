/**
 * The workspace's embedding function, or nothing (P4-T13a, completeness review
 * M-21).
 *
 * **Two callers now, which is why it left the relay.** The relay embeds what is
 * written, and the command palette embeds what is typed so the semantic half of
 * search can answer it. Both have to reach the same provider and the same
 * model, or a query vector and the vectors it is compared with would come from
 * two different models and mean nothing to each other.
 *
 * **The provider is `providerForTier`'s, and nothing here builds one.** That is
 * the one place a provider is made, and since M-10 it comes wrapped in the
 * workspace's egress controls. An embedding is always retrieval to that guard,
 * whether it is an item being indexed or a phrase being searched for.
 *
 * **Resolved per call rather than once at start.** A provider key is a setting
 * somebody can add at three in the afternoon, and a process that resolved its
 * provider at boot would ignore it until the next restart.
 *
 * Undefined is an ordinary answer, not a failure: the provider is off for this
 * tier, or the workspace keeps retrieval here. The relay then stores chunks
 * with no vector, the palette asks for no Related group, and search is
 * Postgres full text alone, which is AI-NATIVE-PLAN §2.4's own degradation.
 */
import type { ActionCallContext } from "@openokr/core";
import { providerForTier } from "./ai-provider";

type EmbedFunction = NonNullable<ActionCallContext["embed"]>;

export async function embedFor(
  workspaceId: string,
): Promise<EmbedFunction | undefined> {
  // Whichever provider the workspace routes the embed tier to, rather than
  // OpenRouter always (completeness review H-27). An unpriced model is still
  // refused: an unmetered embedding loop is the one place a runaway cost would
  // not show until the bill.
  const routed = await providerForTier(workspaceId, "embed");
  if (!routed) {
    return undefined;
  }
  // Asked before the first call rather than refused on every one (M-10). A
  // workspace whose egress level withholds retrieval gets no embedding
  // function, exactly as one with no provider gets none: the relay stores no
  // vector, and the palette never offers a Related group whose every request
  // the guard would refuse.
  if (!routed.provider.permits("retrieval")) {
    return undefined;
  }
  return async (inputs: readonly string[]) => {
    const result = await routed.provider.embed({
      model: routed.modelId,
      input: [...inputs],
    });
    return {
      vectors: result.vectors,
      dimensions: result.dimensions,
      model: routed.modelId,
    };
  };
}
