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
  it("reads the forced tool call's input as the structured result", async () => {
    const client = provider(
      fakeFetch({
        id: "msg_3",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [
          {
            type: "tool_use",
            id: "toolu_2",
            name: "extract",
            input: { city: "Paris", country: "France" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 15, output_tokens: 10 },
      }),
    );

    const response = await client.extract({
      model: "claude-sonnet-5",
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
    for await (const chunk of client.stream({
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("Hello");
  });
});

describe("capabilities and stop", () => {
  it("reports jsonMode as false: extract() works through a forced tool call instead", () => {
    const client = provider(fakeFetch({}));
    expect(client.capabilities("claude-sonnet-5")).toMatchObject({
      available: true,
      tools: true,
      jsonMode: false,
      streaming: true,
    });
  });

  it("stops cleanly", async () => {
    const client = provider(fakeFetch({}));
    await expect(client.stop()).resolves.toBeUndefined();
  });
});
