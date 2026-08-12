/**
 * The Anthropic driver (AI-NATIVE-PLAN §3.2, P2-T13).
 *
 * Its Messages API has no `system`-role message the way OpenAI's does:
 * system text is a separate top-level parameter, and every system-role
 * message in the port's own `ChatMessage[]` is folded into that parameter
 * before anything reaches the SDK. There is no embeddings endpoint at all,
 * so `embed()` refuses rather than guessing. There is no JSON-schema
 * response format either; `extract()` gets the same effect by forcing
 * exactly one tool call whose `input_schema` is the caller's schema, since a
 * forced tool call's only legal output is that tool's arguments.
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
  type ToolDefinition,
} from "../../ports/ai.ts";
import type { TierModelMap } from "./tier-map.ts";

/** A seed, not a catalogue: refined per model once P2-T15's catalogue exists. */
export const ANTHROPIC_DEFAULT_TIER_MODELS: TierModelMap = {
  fast: "claude-haiku-4-5",
  balanced: "claude-sonnet-5",
  deep: "claude-opus-5",
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
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
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

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly defaultContextWindow?: number;
}

export class AnthropicProvider implements AIProvider {
  readonly #client: Anthropic;
  readonly #defaultContextWindow: number;

  constructor(options: AnthropicProviderOptions) {
    this.#client = new Anthropic({
      apiKey: options.apiKey,
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
      temperature: request.temperature,
    });
    return fromMessage(message);
  }

  async *stream(request: ChatRequest): AsyncIterable<string> {
    const { system, rest } = splitSystem(request.messages);
    const stream = await this.#client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system,
      messages: toMessages(rest),
      temperature: request.temperature,
      stream: true,
    });
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
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
      temperature: request.temperature,
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
    const message = await this.#client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system,
      messages: toMessages(rest),
      temperature: request.temperature,
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
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
    };
  }

  capabilities(_model: string): ModelCapabilities {
    // No live model catalogue yet (P2-T15); a reasonable default every
    // current Claude model satisfies. `jsonMode` is false because there is
    // no response_format switch — `extract()` reaches the same result
    // through a forced tool call instead, which every model with `tools`
    // already supports.
    return {
      available: true,
      tools: true,
      vision: true,
      jsonMode: false,
      streaming: true,
      contextWindow: this.#defaultContextWindow,
    };
  }

  async stop(): Promise<void> {
    // The client makes one HTTP call per request; nothing is held open
    // between them for this to release.
  }
}
