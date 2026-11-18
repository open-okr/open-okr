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
import { randomUUID } from "node:crypto";
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
  TokenUsage,
  ToolDefinition,
} from "../../ports/ai.ts";
import type { TierModelMap } from "./tier-map.ts";
import { fromWireName, toWireName } from "./tool-names.ts";

/** A seed, not a catalogue: refined per model once P2-T15's catalogue exists. */
export const GOOGLE_DEFAULT_TIER_MODELS: TierModelMap = {
  fast: "gemini-2.5-flash-lite",
  balanced: "gemini-3.5-flash-lite",
  deep: "gemini-3.8-flash",
  embed: "gemini-embedding-001",
};

interface GenerateContentResult {
  readonly text?: string;
  readonly functionCalls?: readonly {
    readonly name?: string;
    readonly args?: Record<string, unknown>;
    readonly id?: string;
  }[];
  /** Read for `thoughtSignature`, which `functionCalls` drops. */
  readonly candidates?: readonly {
    readonly content?: {
      readonly parts?: readonly {
        readonly functionCall?: {
          readonly name?: string;
          readonly args?: Record<string, unknown>;
          readonly id?: string;
        };
        readonly thoughtSignature?: string;
      }[];
    };
  }[];
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly candidatesTokenCount?: number;
    readonly cachedContentTokenCount?: number;
  };
}

const usageOf = (usage: GenerateContentResult["usageMetadata"]): TokenUsage => {
  const cached = usage?.cachedContentTokenCount ?? 0;
  return {
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    ...(cached > 0 ? { cachedInputTokens: cached } : {}),
  };
};

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

/**
 * Where every request goes: the Gemini API, the SDK's own default (M-10).
 *
 * Passed explicitly, with Vertex turned off, because the SDK otherwise reads
 * `GOOGLE_GEMINI_BASE_URL` and `GOOGLE_GENAI_USE_VERTEXAI` from the process
 * environment. The egress guard checks the host this names, and a host an
 * environment variable chose would be one the allow-list never saw.
 */
export const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/";

/**
 * The Gemini API version every request uses, named for the same reason as
 * the base URL. SDK 3.0 moved its default from `v1beta` to `v1` and reads
 * `GOOGLE_GENAI_API_VERSION` from the environment. System instructions,
 * function tools and `responseJsonSchema` were built and shipped against
 * `v1beta`, so moving off it is a change of its own, not a side effect of
 * an SDK upgrade.
 */
const GOOGLE_API_VERSION = "v1beta";

export interface GoogleProviderOptions {
  readonly apiKey?: string;
  /** Injected for contract tests in place of a real client. */
  readonly client?: GoogleGenAIClient;
  readonly defaultContextWindow?: number;
}

interface GooglePart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
    id?: string;
  };
  functionResponse?: {
    name: string;
    id?: string;
    response: Record<string, unknown>;
  };
  thoughtSignature?: string;
}

interface GoogleContent {
  role: string;
  parts: GooglePart[];
}

function toContents(messages: readonly ChatMessage[]): GoogleContent[] {
  const out: GoogleContent[] = [];
  // Which function a tool message answers: Gemini wants the name, the port
  // only carries the call id.
  const nameById = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "tool") {
      const id = message.toolCallId;
      const name = (id !== undefined ? nameById.get(id) : undefined) ?? "";
      const part: GooglePart = {
        functionResponse: {
          name: toWireName(name),
          ...(id !== undefined ? { id } : {}),
          response: { content: message.content },
        },
      };
      const last = out[out.length - 1];
      if (
        last?.role === "user" &&
        last.parts.every((p) => p.functionResponse)
      ) {
        last.parts.push(part);
      } else {
        out.push({ role: "user", parts: [part] });
      }
      continue;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      const parts: GooglePart[] = message.content
        ? [{ text: message.content }]
        : [];
      for (const call of message.toolCalls) {
        nameById.set(call.id, call.name);
        const signature = call.providerData?.thoughtSignature;
        parts.push({
          functionCall: {
            name: toWireName(call.name),
            args: call.arguments,
            id: call.id,
          },
          ...(typeof signature === "string"
            ? { thoughtSignature: signature }
            : {}),
        });
      }
      out.push({ role: "model", parts });
      continue;
    }
    out.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    });
  }
  return out;
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

function fromResult(
  result: GenerateContentResult,
  tools: readonly ToolDefinition[] = [],
): ChatResponse {
  // Parts carry the thoughtSignature that `functionCalls` drops. Fall back to
  // `functionCalls` when a response has no candidates.
  const partCalls = (result.candidates?.[0]?.content?.parts ?? []).flatMap(
    (part) =>
      part.functionCall
        ? [{ call: part.functionCall, signature: part.thoughtSignature }]
        : [],
  );
  const calls =
    partCalls.length > 0
      ? partCalls
      : (result.functionCalls ?? []).map((call) => ({
          call,
          signature: undefined,
        }));
  const toolCalls = calls.map(({ call, signature }) => ({
    // Gemini's own id is optional. A synthetic one must be unique across
    // rounds, because results are matched to calls by id over the whole
    // history; an index would repeat in every round.
    id: call.id ?? `gemini-call-${randomUUID()}`,
    name: fromWireName(call.name ?? "", tools),
    arguments: call.args ?? {},
    ...(signature !== undefined
      ? { providerData: { thoughtSignature: signature } }
      : {}),
  }));

  return {
    content: result.text ?? "",
    usage: usageOf(result.usageMetadata),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

export class GoogleProvider implements AIProvider {
  readonly #client: GoogleGenAIClient;
  readonly #defaultContextWindow: number;

  constructor(options: GoogleProviderOptions) {
    this.#client =
      options.client ??
      new GoogleGenAI({
        apiKey: options.apiKey,
        vertexai: false,
        apiVersion: GOOGLE_API_VERSION,
        httpOptions: { baseUrl: GOOGLE_BASE_URL },
      });
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

  async *stream(
    request: ChatRequest,
    onUsage?: (usage: TokenUsage) => void,
  ): AsyncIterable<string> {
    const stream = await this.#client.models.generateContentStream({
      model: request.model,
      contents: toContents(request.messages),
      config: {
        systemInstruction: systemInstruction(request.messages),
        temperature: request.temperature,
        maxOutputTokens: request.maxTokens,
      },
    });
    // Each chunk carries the running total, so the last one seen is the answer.
    let usage: TokenUsage | undefined;
    for await (const chunk of stream) {
      if (chunk.usageMetadata) {
        usage = usageOf(chunk.usageMetadata);
      }
      if (chunk.text) {
        yield chunk.text;
      }
    }
    if (usage) {
      onUsage?.(usage);
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
              name: toWireName(tool.name),
              description: tool.description,
              parametersJsonSchema: tool.parameters,
            })),
          },
        ],
      },
    });
    return fromResult(result, request.tools);
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
