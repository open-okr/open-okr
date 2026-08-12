/**
 * The Google (Gemini) driver (AI-NATIVE-PLAN §3.2, P2-T13).
 *
 * `contents` roles are `user`/`model`, not `user`/`assistant`; system text
 * is `config.systemInstruction`, not a role. Structured output uses
 * `responseJsonSchema` rather than Google's own `Schema` type
 * (`responseSchema`): the latter is an OpenAPI-3.0 subset with its own
 * `Type` enum and no `additionalProperties`, and translating this port's
 * plain JSON Schema into it would be a second schema language for every
 * caller to think about. `responseJsonSchema` accepts the plain shape
 * directly, at the cost of a documented, smaller feature subset (no
 * `patternProperties`, no `if`/`then`/`else`) — acceptable here, since
 * `extract()`'s callers already write schemas simple enough for every
 * provider's structured-output mode to satisfy.
 *
 * The SDK has no `fetch` injection point at all (only `httpOptions.baseUrl`,
 * which redirects the whole client rather than swapping one call), so
 * `GoogleProviderOptions.client` accepts a pre-built stand-in for contract
 * tests instead of trying to intercept the network layer.
 */
import { GoogleGenAI } from "@google/genai";
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
import type { TierModelMap } from "./tier-map.ts";

/** A seed, not a catalogue: refined per model once P2-T15's catalogue exists. */
export const GOOGLE_DEFAULT_TIER_MODELS: TierModelMap = {
  fast: "gemini-2.5-flash-lite",
  balanced: "gemini-2.5-flash",
  deep: "gemini-2.5-pro",
  embed: "gemini-embedding-001",
};

interface GenerateContentResult {
  readonly text?: string;
  readonly functionCalls?: readonly {
    readonly name?: string;
    readonly args?: Record<string, unknown>;
  }[];
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
  };
}

type GenerateContentStreamResult = AsyncIterable<GenerateContentResult>;

interface EmbedContentResult {
  readonly embeddings?: readonly { readonly values?: readonly number[] }[];
}

/**
 * The slice of the real SDK client this driver actually calls, small enough
 * to fake directly in a contract test. Parameters are typed `any` rather
 * than a narrower shape on purpose: the real `GoogleGenAI` class's own
 * parameter types are what this driver actually builds and passes, and
 * typing this seam any more precisely would mean re-deriving those types
 * here just to satisfy the assignability check between "the real client"
 * and "this interface" — the fixture-injected fake below is what carries
 * the real type safety, by matching this interface exactly.
 */
export interface GoogleGenAIClient {
  readonly models: {
    // biome-ignore lint/suspicious/noExplicitAny: see the interface comment above.
    generateContent(params: any): Promise<GenerateContentResult>;
    // biome-ignore lint/suspicious/noExplicitAny: see the interface comment above.
    generateContentStream(params: any): Promise<GenerateContentStreamResult>;
    // biome-ignore lint/suspicious/noExplicitAny: see the interface comment above.
    embedContent(params: any): Promise<EmbedContentResult>;
  };
}

export interface GoogleProviderOptions {
  readonly apiKey?: string;
  /** Injected for contract tests in place of a real client. */
  readonly client?: GoogleGenAIClient;
  readonly defaultContextWindow?: number;
}

function toContents(
  messages: readonly ChatMessage[],
): { role: string; parts: { text: string }[] }[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
}

function systemInstruction(
  messages: readonly ChatMessage[],
): string | undefined {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  return system === "" ? undefined : system;
}

function fromResult(result: GenerateContentResult): ChatResponse {
  const toolCalls = result.functionCalls?.map((call, index) => ({
    // Gemini's own function-call id is optional; a stable synthetic one is
    // still needed for the port's own ToolCall shape, and index is stable
    // within one response.
    id: String(index),
    name: call.name ?? "",
    arguments: call.args ?? {},
  }));

  return {
    content: result.text ?? "",
    usage: {
      inputTokens: result.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: result.usageMetadata?.candidatesTokenCount ?? 0,
    },
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

export class GoogleProvider implements AIProvider {
  readonly #client: GoogleGenAIClient;
  readonly #defaultContextWindow: number;

  constructor(options: GoogleProviderOptions) {
    this.#client =
      options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
    this.#defaultContextWindow = options.defaultContextWindow ?? 1_000_000;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const result = await this.#client.models.generateContent({
      model: request.model,
      contents: toContents(request.messages),
      config: {
        systemInstruction: systemInstruction(request.messages),
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
      },
    });
    return fromResult(result);
  }

  async *stream(request: ChatRequest): AsyncIterable<string> {
    const stream = await this.#client.models.generateContentStream({
      model: request.model,
      contents: toContents(request.messages),
      config: {
        systemInstruction: systemInstruction(request.messages),
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
      },
    });
    for await (const chunk of stream) {
      if (chunk.text) {
        yield chunk.text;
      }
    }
  }

  async chatWithTools(
    request: ChatRequest & { readonly tools: readonly ToolDefinition[] },
  ): Promise<ChatResponse> {
    const result = await this.#client.models.generateContent({
      model: request.model,
      contents: toContents(request.messages),
      config: {
        systemInstruction: systemInstruction(request.messages),
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
        tools: [
          {
            functionDeclarations: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.parameters,
            })),
          },
        ],
      },
    });
    return fromResult(result);
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    const response = await this.#client.models.embedContent({
      model: request.model,
      contents: [...request.input],
    });
    const vectors = (response.embeddings ?? []).map((embedding) => [
      ...(embedding.values ?? []),
    ]);
    return {
      vectors,
      dimensions: vectors[0]?.length ?? 0,
      // The Gemini embedding response carries no token-usage field at all,
      // unlike every chat response from the same API.
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  async extract(request: ExtractRequest): Promise<ChatResponse> {
    const result = await this.#client.models.generateContent({
      model: request.model,
      contents: toContents(request.messages),
      config: {
        systemInstruction: systemInstruction(request.messages),
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
        responseMimeType: "application/json",
        responseJsonSchema: request.schema,
      },
    });
    return fromResult(result);
  }

  capabilities(_model: string): ModelCapabilities {
    // No live model catalogue yet (P2-T15); a reasonable default every
    // current Gemini model satisfies.
    return {
      available: true,
      tools: true,
      vision: true,
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
