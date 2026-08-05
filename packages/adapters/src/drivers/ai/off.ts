/**
 * The "AI is off" provider: the default until someone configures a key.
 *
 * This driver is what proves the product is whole without AI. Continuous
 * integration runs a full leg with it in place, and every P0 flow must pass:
 * AI adds drafting, rewriting and semantic judgement, never a decision.
 *
 * Features check `capabilities()` and hide or disable their AI affordances.
 * Reaching a method here means a feature skipped that check, so these throw
 * rather than returning something empty that would look like a real answer.
 */
import {
  type AIProvider,
  AIUnavailableError,
  type ChatRequest,
  type ChatResponse,
  type EmbedRequest,
  type EmbedResponse,
  type ExtractRequest,
  type ModelCapabilities,
  type ToolDefinition,
} from "../../ports/ai.ts";

const UNAVAILABLE: ModelCapabilities = {
  available: false,
  tools: false,
  vision: false,
  jsonMode: false,
  streaming: false,
  contextWindow: 0,
};

export class OffAIProvider implements AIProvider {
  async chat(_request: ChatRequest): Promise<ChatResponse> {
    throw new AIUnavailableError();
  }

  /** Deliberately not a generator: there is nothing to yield, and iterating
   * raises exactly as the other methods do. */
  stream(_request: ChatRequest): AsyncIterable<string> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new AIUnavailableError()),
      }),
    };
  }

  async chatWithTools(
    _request: ChatRequest & { readonly tools: readonly ToolDefinition[] },
  ): Promise<ChatResponse> {
    throw new AIUnavailableError();
  }

  async embed(_request: EmbedRequest): Promise<EmbedResponse> {
    throw new AIUnavailableError();
  }

  async extract(_request: ExtractRequest): Promise<ChatResponse> {
    throw new AIUnavailableError();
  }

  capabilities(_model: string): ModelCapabilities {
    return UNAVAILABLE;
  }
}
