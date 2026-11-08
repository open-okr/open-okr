import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "../src/drivers/ai/anthropic.ts";
import { AIUnavailableError } from "../src/ports/ai.ts";

/**
 * Contract tests for the Anthropic driver (AI-NATIVE-PLAN §3.2, P2-T13),
 * against a fixture matching the Messages API's own documented shape,
 * injected through the client's own `fetch` option — no network, no key.
 */

function fakeFetch(
  body: unknown,
  init: { readonly status?: number; readonly sse?: boolean } = {},
): typeof fetch {
  return async () =>
    new Response(init.sse ? (body as string) : JSON.stringify(body), {
      status: init.status ?? 200,
      headers: {
        "content-type": init.sse ? "text/event-stream" : "application/json",
      },
    });
}

function provider(fetchImpl: typeof fetch): AnthropicProvider {
  return new AnthropicProvider({ apiKey: "test-key", fetch: fetchImpl });
}

describe("chat", () => {
  it("parses a text response, folding a system message into the top-level parameter", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const client = new AnthropicProvider({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5",
            content: [{ type: "text", text: "Hello there!", citations: null }],
            stop_reason: "end_turn",
            usage: { input_tokens: 12, output_tokens: 6 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const response = await client.chat({
      model: "claude-sonnet-5",
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "hi" },
      ],
    });

    expect(response).toEqual({
      content: "Hello there!",
      usage: { inputTokens: 12, outputTokens: 6 },
    });
    expect(capturedBody?.system).toBe("Be terse.");
    expect(capturedBody?.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("sends no temperature, which API version 2026-10-21 refuses on every model", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const client = new AnthropicProvider({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            id: "msg_5",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5",
            content: [{ type: "text", text: "ok", citations: null }],
            stop_reason: "end_turn",
            usage: { input_tokens: 3, output_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await client.chat({
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
    });

    expect(capturedBody).toBeDefined();
    expect(capturedBody).not.toHaveProperty("temperature");
  });
});

describe("chatWithTools", () => {
  it("parses a tool_use content block", async () => {
    const client = provider(
      fakeFetch({
        id: "msg_2",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "get_weather",
            input: { city: "Paris" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 8 },
      }),
    );

    const response = await client.chatWithTools({
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "weather in paris?" }],
      tools: [
        {
          name: "get_weather",
          description: "Get the weather for a city.",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
    });

    expect(response.toolCalls).toEqual([
      { id: "toolu_1", name: "get_weather", arguments: { city: "Paris" } },
    ]);
  });
});

describe("extract", () => {
  /** Captures the request body the driver sent, and answers with `body`. */
  function capturing(body: unknown) {
    const sent: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      sent.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    return { sent, client: provider(fetchImpl) };
  }

  /** The schema the first request asked for, or undefined if it asked for none. */
  const sentSchema = (sent: Record<string, unknown>[]) =>
    (sent[0]?.output_config as { format?: { schema?: unknown } } | undefined)
      ?.format?.schema;

  const answer = (model: string, content: unknown[]) => ({
    id: "msg_3",
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: "end_turn",
    usage: { input_tokens: 15, output_tokens: 10 },
  });

  it("asks a current model for structured output, never a forced tool, which Claude Sonnet 5.5 refuses", async () => {
    const { sent, client } = capturing(
      answer("claude-sonnet-5-5", [
        { type: "text", text: '{"city":"Paris","country":"France"}' },
      ]),
    );
    const response = await client.extract({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "extract the city" }],
      schema: {
        type: "object",
        properties: { city: { type: "string" }, country: { type: "string" } },
      },
    });
    expect(JSON.parse(response.content)).toEqual({
      city: "Paris",
      country: "France",
    });
    const body = sent[0] ?? {};
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.output_config).toMatchObject({
      format: {
        type: "json_schema",
        schema: { type: "object", additionalProperties: false },
      },
    });
  });

  it("closes every object and drops the limits the API cannot enforce, which the caller still validates", async () => {
    const { sent, client } = capturing(
      answer("claude-haiku-5-5", [{ type: "text", text: "{}" }]),
    );
    await client.extract({
      model: "claude-haiku-5-5",
      messages: [{ role: "user", content: "x" }],
      schema: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 120 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          keyResults: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: {
              type: "object",
              properties: { target: { type: "number", multipleOf: 1 } },
            },
          },
        },
      },
    });
    const schema = sentSchema(sent);
    expect(schema).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        confidence: { type: "number" },
        keyResults: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { target: { type: "number" } },
          },
        },
      },
    });
  });

  it("keeps a field whose name is also a schema keyword", async () => {
    const { sent, client } = capturing(
      answer("claude-haiku-5-5", [{ type: "text", text: "{}" }]),
    );
    await client.extract({
      model: "claude-haiku-5-5",
      messages: [{ role: "user", content: "x" }],
      schema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          minimum: { type: "number" },
        },
      },
    });
    expect(sentSchema(sent)).toEqual({
      type: "object",
      additionalProperties: false,
      properties: { pattern: { type: "string" }, minimum: { type: "number" } },
    });
  });

  it("keeps the forced tool for an older model that has no structured output", async () => {
    const { sent, client } = capturing(
      answer("claude-sonnet-4-6", [
        {
          type: "tool_use",
          id: "toolu_2",
          name: "extract",
          input: { city: "Paris", country: "France" },
        },
      ]),
    );
    const response = await client.extract({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "extract the city" }],
      schema: {
        type: "object",
        properties: { city: { type: "string" }, country: { type: "string" } },
      },
    });
    expect(JSON.parse(response.content)).toEqual({
      city: "Paris",
      country: "France",
    });
    expect(sent[0]?.tool_choice).toEqual({ type: "tool", name: "extract" });
    expect(sent[0]?.output_config).toBeUndefined();
  });
});

describe("embed", () => {
  it("refuses: Anthropic has no embeddings endpoint", async () => {
    const client = provider(fakeFetch({}));
    await expect(
      client.embed({ model: "claude-sonnet-5", input: ["hi"] }),
    ).rejects.toBeInstanceOf(AIUnavailableError);
  });
});

describe("stream", () => {
  it("yields the text delta from each content_block_delta event", async () => {
    const events = [
      {
        type: "message_start",
        message: { id: "msg_4", usage: { input_tokens: 5, output_tokens: 0 } },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hel" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "lo" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 2 },
      },
      { type: "message_stop" },
    ];
    const sse = `${events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("")}`;
    const client = provider(fakeFetch(sse, { sse: true }));

    const chunks: string[] = [];
    const usage: unknown[] = [];
    for await (const chunk of client.stream(
      {
        model: "claude-sonnet-5",
        messages: [{ role: "user", content: "hi" }],
      },
      (counted) => usage.push(counted),
    )) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("Hello");
    // Input arrives on the first event and output on the last.
    expect(usage).toEqual([{ inputTokens: 5, outputTokens: 2 }]);
  });
});

describe("usage", () => {
  it("counts every input token, and says which came from the cache", async () => {
    const client = provider(
      fakeFetch({
        id: "msg_9",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: "Hi", citations: null }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 50,
          output_tokens: 6,
        },
      }),
    );
    const response = await client.chat({
      model: "claude-sonnet-5-5",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(response.usage).toEqual({
      inputTokens: 1050,
      cachedInputTokens: 900,
      outputTokens: 6,
    });
  });
});

describe("capabilities and stop", () => {
  it("reports structured output where the model has it, and not on an older one", () => {
    const client = provider(fakeFetch({}));
    expect(client.capabilities("claude-sonnet-5-5")).toMatchObject({
      available: true,
      tools: true,
      jsonMode: true,
      streaming: true,
    });
    expect(client.capabilities("claude-opus-4-7")).toMatchObject({
      jsonMode: false,
    });
  });

  it("stops cleanly", async () => {
    const client = provider(fakeFetch({}));
    await expect(client.stop()).resolves.toBeUndefined();
  });
});
