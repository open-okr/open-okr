import { describe, expect, it } from "vitest";
import { OpenAiCompatibleProvider } from "../src/drivers/ai/openai-compatible.ts";

/**
 * Contract tests for the OpenAI-shaped driver (AI-NATIVE-PLAN §3.2, P2-T13).
 *
 * This is the shared implementation behind `openai.ts`, `openrouter.ts` and
 * `ollama.ts` as well: all four speak the identical chat-completions API,
 * so proving this class parses the vendor's real response shapes proves
 * all four at once. Against a fixture (a hand-authored response matching
 * the vendor's own documented shape, since this sandbox has no live key to
 * record one from) rather than a live call, injected through the client's
 * own documented `fetch` option — no network, no credentials.
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

function provider(fetchImpl: typeof fetch): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({
    apiKey: "test-key",
    baseURL: "https://example.invalid/v1",
    fetch: fetchImpl,
  });
}

describe("chat", () => {
  it("parses a completion into content and usage", async () => {
    const client = provider(
      fakeFetch({
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1_700_000_000,
        model: "gpt-4.1-mini",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hello there!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );

    const response = await client.chat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(response).toEqual({
      content: "Hello there!",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });
});

describe("chatWithTools", () => {
  it("parses a tool call, decoding its JSON arguments", async () => {
    const client = provider(
      fakeFetch({
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"city":"Paris"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      }),
    );

    const response = await client.chatWithTools({
      model: "gpt-4.1-mini",
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
      { id: "call_1", name: "get_weather", arguments: { city: "Paris" } },
    ]);
    expect(response.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
  });
});

describe("embed", () => {
  it("parses embedding vectors and their dimensions", async () => {
    const client = provider(
      fakeFetch({
        object: "list",
        data: [
          { object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] },
          { object: "embedding", index: 1, embedding: [0.4, 0.5, 0.6] },
        ],
        model: "text-embedding-3-large",
        usage: { prompt_tokens: 6, total_tokens: 6 },
      }),
    );

    const response = await client.embed({
      model: "text-embedding-3-large",
      input: ["cat", "dog"],
    });

    expect(response.vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(response.dimensions).toBe(3);
    expect(response.usage).toEqual({ inputTokens: 6, outputTokens: 0 });
  });
});

describe("extract", () => {
  it("returns the structured JSON content as a string for the caller to validate", async () => {
    const client = provider(
      fakeFetch({
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: '{"city":"Paris","country":"France"}',
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 15, completion_tokens: 10, total_tokens: 25 },
      }),
    );

    const response = await client.extract({
      model: "gpt-4.1-mini",
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

describe("stream", () => {
  it("yields the text delta from each streamed chunk", async () => {
    const events = [
      {
        choices: [
          { index: 0, delta: { role: "assistant" }, finish_reason: null },
        ],
      },
      {
        choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }],
      },
      {
        choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    const sse = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
    const client = provider(fakeFetch(sse, { sse: true }));

    const chunks: string[] = [];
    for await (const chunk of client.stream({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join("")).toBe("Hello");
  });
});

describe("capabilities and stop", () => {
  it("reports a reasonable default capability set with no live catalogue", () => {
    const client = provider(fakeFetch({}));
    expect(client.capabilities("gpt-4.1-mini")).toMatchObject({
      available: true,
      tools: true,
      streaming: true,
    });
  });

  it("stops cleanly", async () => {
    const client = provider(fakeFetch({}));
    await expect(client.stop()).resolves.toBeUndefined();
  });
});
