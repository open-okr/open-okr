/**
 * The Anthropic driver (AI-NATIVE-PLAN §3.2, P2-T13).
 *
 * Its Messages API has no `system`-role message the way OpenAI's does:
 * system text is a separate top-level parameter, and every system-role
 * message in the port's own `ChatMessage[]` is folded into that parameter
 * before anything reaches the SDK. There is no embeddings endpoint at all,
 * so `embed()` refuses rather than guessing. `extract()` asks for structured
 * output, `output_config` with the caller's JSON schema, which every current
 * model supports. The older models in `FORCED_TOOL_ONLY` lack it and get one
 * forced tool call whose `input_schema` is the caller's schema instead, since
 * a forced tool call's only legal output is that tool's arguments.
 *
 * `temperature` is never sent. The SDK speaks API version 2026-10-21, which
 * refuses `temperature`, `top_p` and `top_k` on every model, and Claude 4.7
 * and later refused them before that. So a request's `temperature`, and the
 * sampling a workspace sets per tier, do not reach Anthropic models.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  type AIProvider,
  AIUnavailableError,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type EmbedRequest,
  type EmbedResponse,
  type ExtractRequest,
  type ModelCapabilities,
  type TokenUsage,
  type ToolDefinition,
} from "../../ports/ai.ts";
import type { TierModelMap } from "./tier-map.ts";

/** A seed, not a catalogue: refined per model once P2-T15's catalogue exists. */
export const ANTHROPIC_DEFAULT_TIER_MODELS: TierModelMap = {
  fast: "claude-haiku-5-5",
  balanced: "claude-sonnet-5-5",
  deep: "claude-opus-5-5",
};

/**
 * The port's usage from Anthropic's.
 *
 * Anthropic counts cache reads and writes apart from `input_tokens`, where the
 * port's `inputTokens` is every input token, as the other providers report it.
 * A cache write is counted at the input rate: this driver sends no `cache_control`.
 */
const usageOf = (usage: Anthropic.Usage): TokenUsage => {
  const cached = usage.cache_read_input_tokens ?? 0;
  return {
    inputTokens:
      usage.input_tokens + cached + (usage.cache_creation_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
    ...(cached > 0 ? { cachedInputTokens: cached } : {}),
  };
};

/** The Messages API requires `max_tokens`; there is no server-side default. */
const DEFAULT_MAX_TOKENS = 4096;

/** The JSON-Schema-shaped object Anthropic's `input_schema` and this port's
 * own `ToolDefinition.parameters` both already are; named locally so a cast
 * has one place to point at rather than reaching into the SDK's own nested
 * type names. */
interface AnthropicInputSchema {
  readonly type: "object";
  readonly [key: string]: unknown;
}

interface SplitMessages {
  readonly system: string | undefined;
  readonly rest: readonly ChatMessage[];
}

function splitSystem(messages: readonly ChatMessage[]): SplitMessages {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  return {
    system: system === "" ? undefined : system,
    rest: messages.filter((message) => message.role !== "system"),
  };
}

function toMessages(
  messages: readonly ChatMessage[],
): Anthropic.MessageParam[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId ?? "",
            content: message.content,
          },
        ],
      };
    }
    // "system" is already filtered out by splitSystem before this runs.
    return {
      role: message.role as "user" | "assistant",
      content: message.content,
    };
  });
}

function fromMessage(message: Anthropic.Message): ChatResponse {
  const textBlocks = message.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  const toolBlocks = message.content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );

  return {
    content: textBlocks.map((block) => block.text).join(""),
    usage: usageOf(message.usage),
    ...(toolBlocks.length > 0
      ? {
          toolCalls: toolBlocks.map((block) => ({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          })),
        }
      : {}),
  };
}

/**
 * Where every request goes: the SDK's own default, written down (M-10).
 *
 * Passed explicitly rather than left to the SDK, which otherwise reads
 * `ANTHROPIC_BASE_URL` from the process environment. The egress guard checks
 * the host this names, and a host chosen by an environment variable nobody
 * set on purpose would be a request the allow-list never saw.
 */
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly defaultContextWindow?: number;
}

/**
 * The older models with no structured output, which still take a forced tool
 * call. Every current model has structured output, and Claude Sonnet 5.5, Opus 5.5
 * and Fable 5.1 refuse a forced tool with a 400, so structured output is the
 * default and this list only shrinks. From Anthropic's own model table, October
 * 2026: Opus 4.0, 4.6 and 4.7, Sonnet 4.0, 4.5 and 4.6, and every Claude 3 model.
 */
const FORCED_TOOL_ONLY =
  /^claude-(3|opus-4-(0|6|7)(?!\d)|opus-4-20|sonnet-4-(0|5|6)(?!\d)|sonnet-4-20)/;

const forcedToolOnly = (model: string): boolean => FORCED_TOOL_ONLY.test(model);

/** What structured output refuses in a schema. Zod checks them on the answer. */
const UNSUPPORTED_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

/**
 * The schema as structured output takes it: every object closed with
 * `additionalProperties: false`, and the limits it cannot enforce left out. The
 * caller validates the answer against its own schema anyway, so nothing that was
 * checked before goes unchecked now.
 */
function structuredSchema(schema: unknown): Record<string, unknown> {
  /** A map whose keys are names the schema chose, such as `properties`. */
  const NAMED = new Set(["properties", "$defs", "definitions"]);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node === null || typeof node !== "object") {
      return node;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (UNSUPPORTED_KEYWORDS.has(key)) {
        continue;
      }
      out[key] =
        NAMED.has(key) && value !== null && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([name, child]) => [name, walk(child)]),
            )
          : walk(value);
    }
    if (out.type === "object" || "properties" in out) {
      out.additionalProperties = false;
    }
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

export class AnthropicProvider implements AIProvider {
  readonly #client: Anthropic;
  readonly #defaultContextWindow: number;

  constructor(options: AnthropicProviderOptions) {
    this.#client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: ANTHROPIC_BASE_URL,
      fetch: options.fetch,
    });
    this.#defaultContextWindow = options.defaultContextWindow ?? 200_000;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { system, rest } = splitSystem(request.messages);
    const message = await this.#client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system,
      messages: toMessages(rest),
    });
    return fromMessage(message);
  }

  async *stream(
    request: ChatRequest,
    onUsage?: (usage: TokenUsage) => void,
  ): AsyncIterable<string> {
    const { system, rest } = splitSystem(request.messages);
    const stream = await this.#client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system,
      messages: toMessages(rest),
      stream: true,
    });
    let started: Anthropic.Usage | undefined;
    let outputTokens = 0;
    for await (const event of stream) {
      if (event.type === "message_start") {
        started = event.message.usage;
      } else if (event.type === "message_delta") {
        outputTokens = event.usage.output_tokens;
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
    if (started) {
      onUsage?.({ ...usageOf(started), outputTokens });
    }
  }

  async chatWithTools(
    request: ChatRequest & { readonly tools: readonly ToolDefinition[] },
  ): Promise<ChatResponse> {
    const { system, rest } = splitSystem(request.messages);
    const message = await this.#client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system,
      messages: toMessages(rest),
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters as AnthropicInputSchema,
      })),
    });
    return fromMessage(message);
  }

  async embed(_request: EmbedRequest): Promise<EmbedResponse> {
    throw new AIUnavailableError(
      "Anthropic has no embeddings endpoint. Map the embed tier to a different provider.",
    );
  }

  async extract(request: ExtractRequest): Promise<ChatResponse> {
    const { system, rest } = splitSystem(request.messages);
    if (forcedToolOnly(request.model)) {
      const message = await this.#client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        system,
        messages: toMessages(rest),
        tools: [
          {
            name: "extract",
            description:
              "Extract the requested structure from the conversation above.",
            input_schema: request.schema as AnthropicInputSchema,
          },
        ],
        tool_choice: { type: "tool", name: "extract" },
      });
      const toolUse = message.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );
      return {
        content: toolUse ? JSON.stringify(toolUse.input) : "",
        usage: usageOf(message.usage),
      };
    }
    // Structured output: the answer itself is the JSON. A refusal or a reply cut
    // off at max_tokens may not match, which the caller's own validation catches.
    const message = await this.#client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system,
      messages: toMessages(rest),
      output_config: {
        format: {
          type: "json_schema",
          schema: structuredSchema(request.schema),
        },
      },
    });
    return {
      content: message.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join(""),
      usage: usageOf(message.usage),
    };
  }

  capabilities(model: string): ModelCapabilities {
    // No live model catalogue yet (P2-T15); a reasonable default every
    // current Claude model satisfies. `jsonMode` is structured output, which
    // `extract()` uses wherever the model has it.
    return {
      available: true,
      tools: true,
      vision: true,
      jsonMode: !forcedToolOnly(model),
      streaming: true,
      contextWindow: this.#defaultContextWindow,
    };
  }

  async stop(): Promise<void> {
    // The client makes one HTTP call per request; nothing is held open
    // between them for this to release.
  }
}
