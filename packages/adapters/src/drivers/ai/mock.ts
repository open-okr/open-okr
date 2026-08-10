/**
 * The deterministic mock driver (AI-NATIVE-PLAN §3.2, P2-T13).
 *
 * Distinct from `OffAIProvider`: `off` is the product's own "no key
 * configured" state and every method refuses. This one is for a feature's
 * own test suite, elsewhere in the codebase, to exercise the AIProvider
 * contract without a network call or a real key — every method succeeds
 * with a canned, overridable answer, and every call is recorded so a test
 * can assert what a feature actually sent.
 */
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ExtractRequest,
  ModelCapabilities,
  ToolCall,
  ToolDefinition,
} from "../../ports/ai.ts";

export interface MockAIProviderOptions {
  readonly chatResponse?: ChatResponse;
  readonly toolCalls?: readonly ToolCall[];
  readonly streamChunks?: readonly string[];
  readonly embedDimensions?: number;
  readonly capabilities?: ModelCapabilities;
}

export type RecordedCall =
  | { readonly method: "chat"; readonly request: ChatRequest }
  | { readonly method: "stream"; readonly request: ChatRequest }
  | {
      readonly method: "chatWithTools";
      readonly request: ChatRequest & {
        readonly tools: readonly ToolDefinition[];
      };
    }
  | { readonly method: "embed"; readonly request: EmbedRequest }
  | { readonly method: "extract"; readonly request: ExtractRequest };

const DEFAULT_CHAT_RESPONSE: ChatResponse = {
  content: "This is a mock response.",
  usage: { inputTokens: 10, outputTokens: 10 },
};

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  available: true,
  tools: true,
  vision: true,
  jsonMode: true,
  streaming: true,
  contextWindow: 128_000,
  embeddingDimensions: 1536,
};

export class MockAIProvider implements AIProvider {
  readonly #chatResponse: ChatResponse;
  readonly #toolCalls: readonly ToolCall[] | undefined;
  readonly #streamChunks: readonly string[];
  readonly #embedDimensions: number;
  readonly #capabilities: ModelCapabilities;
  readonly calls: RecordedCall[] = [];

  constructor(options: MockAIProviderOptions = {}) {
    this.#chatResponse = options.chatResponse ?? DEFAULT_CHAT_RESPONSE;
    this.#toolCalls = options.toolCalls;
    this.#streamChunks = options.streamChunks ?? [
      "This ",
      "is ",
      "a ",
      "mock ",
      "stream.",
    ];
    this.#embedDimensions = options.embedDimensions ?? 8;
    this.#capabilities = options.capabilities ?? DEFAULT_CAPABILITIES;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.calls.push({ method: "chat", request });
    return this.#chatResponse;
  }

  async *stream(request: ChatRequest): AsyncIterable<string> {
    this.calls.push({ method: "stream", request });
    for (const chunk of this.#streamChunks) {
      yield chunk;
    }
  }

  async chatWithTools(
    request: ChatRequest & { readonly tools: readonly ToolDefinition[] },
  ): Promise<ChatResponse> {
    this.calls.push({ method: "chatWithTools", request });
    return this.#toolCalls
      ? { ...this.#chatResponse, toolCalls: this.#toolCalls }
      : this.#chatResponse;
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    this.calls.push({ method: "embed", request });
    // Deterministic per input string, not random, so a test asserting on a
    // vector's shape never flakes: each dimension is the input's own length
    // at that index modulo 7, which is enough to make two different inputs
    // produce two different vectors without any real embedding model.
    const vectors = request.input.map((text) =>
      Array.from(
        { length: this.#embedDimensions },
        (_, index) => (text.length + index) % 7,
      ),
    );
    return {
      vectors,
      dimensions: this.#embedDimensions,
      usage: { inputTokens: request.input.length * 4, outputTokens: 0 },
    };
  }

  async extract(request: ExtractRequest): Promise<ChatResponse> {
    this.calls.push({ method: "extract", request });
    return this.#chatResponse;
  }

  capabilities(_model: string): ModelCapabilities {
    return this.#capabilities;
  }

  async stop(): Promise<void> {
    // Nothing was ever opened.
  }
}
