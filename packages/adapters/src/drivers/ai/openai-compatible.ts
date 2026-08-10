/**
 * The generic OpenAI-shaped driver (AI-NATIVE-PLAN §3.2, P2-T13).
 *
 * This class *is* the `openai-compatible` driver from the plan's own table:
 * a bare base URL and key, for a self-hosted inference server, a gateway,
 * or any vendor exposing an OpenAI-shaped endpoint. `openai.ts`,
 * `openrouter.ts` and `ollama.ts` are thin presets of this same
 * implementation with their own base URL, headers and default tier map,
 * because all four speak the identical chat-completions API — only the
 * address, the key and which models exist differ.
 */
import OpenAI from "openai";
import type {
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ExtractRequest,
  ModelCapabilities,
  ToolDefinition,
} from "../../ports/ai.ts";

export interface OpenAiCompatibleOptions {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly defaultHeaders?: Record<string, string>;
  /** Injected for contract tests; a real client reaches `baseURL` over the network otherwise. */
  readonly fetch?: typeof fetch;
  readonly defaultContextWindow?: number;
}

/** `max_tokens` is deprecated in this SDK version in favour of
 * `max_completion_tokens`; both still work against most OpenAI-shaped
 * servers, but only the new name is guaranteed for future models. */
const DEFAULT_MAX_COMPLETION_TOKENS = 4096;

function toMessages(
  messages: readonly ChatMessage[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content,
        tool_call_id: message.toolCallId ?? "",
      };
    }
    return { role: message.role, content: message.content };
  });
}

function toTool(tool: ToolDefinition): OpenAI.Chat.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function fromCompletion(completion: OpenAI.Chat.ChatCompletion): ChatResponse {
  const message = completion.choices[0]?.message;
  const usage = completion.usage;
  const toolCalls = message?.tool_calls
    ?.filter(
      (
        call,
      ): call is Extract<
        NonNullable<typeof message.tool_calls>[number],
        { type: "function" }
      > => call.type === "function",
    )
    .map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: JSON.parse(call.function.arguments) as Record<string, unknown>,
    }));

  return {
    content: message?.content ?? "",
    usage: {
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
    },
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

export class OpenAiCompatibleProvider implements AIProvider {
  readonly #client: OpenAI;
  readonly #defaultContextWindow: number;

  constructor(options: OpenAiCompatibleOptions) {
    this.#client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      defaultHeaders: options.defaultHeaders,
      fetch: options.fetch,
    });
    this.#defaultContextWindow = options.defaultContextWindow ?? 128_000;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const completion = await this.#client.chat.completions.create({
      model: request.model,
      messages: toMessages(request.messages),
      temperature: request.temperature,
      max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
    });
    return fromCompletion(completion);
  }

  async *stream(request: ChatRequest): AsyncIterable<string> {
    const stream = await this.#client.chat.completions.create({
      model: request.model,
      messages: toMessages(request.messages),
      temperature: request.temperature,
      max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }

  async chatWithTools(
    request: ChatRequest & { readonly tools: readonly ToolDefinition[] },
  ): Promise<ChatResponse> {
    const completion = await this.#client.chat.completions.create({
      model: request.model,
      messages: toMessages(request.messages),
      temperature: request.temperature,
      max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
      tools: request.tools.map(toTool),
    });
    return fromCompletion(completion);
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    const response = await this.#client.embeddings.create({
      model: request.model,
      input: [...request.input],
    });
    const vectors = response.data.map((item) => item.embedding);
    return {
      vectors,
      dimensions: vectors[0]?.length ?? 0,
      // The embeddings endpoint reports prompt_tokens only; there is no
      // output side to an embedding call.
      usage: { inputTokens: response.usage.prompt_tokens, outputTokens: 0 },
    };
  }

  async extract(request: ExtractRequest): Promise<ChatResponse> {
    const completion = await this.#client.chat.completions.create({
      model: request.model,
      messages: toMessages(request.messages),
      temperature: request.temperature,
      max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
      response_format: {
        type: "json_schema",
        json_schema: { name: "extract", schema: request.schema, strict: true },
      },
    });
    return fromCompletion(completion);
  }

  capabilities(_model: string): ModelCapabilities {
    // No live model catalogue exists yet (P2-T15 builds it); this is the
    // reasonable default every OpenAI-shaped endpoint that accepts a key
    // satisfies, refined per model once the catalogue does.
    return {
      available: true,
      tools: true,
      vision: false,
      jsonMode: true,
      streaming: true,
      contextWindow: this.#defaultContextWindow,
    };
  }

  async stop(): Promise<void> {
    // The client makes one HTTP call per request; nothing is held open
    // between them for this to release.
  }
}
