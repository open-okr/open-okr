import { describe, expect, it, vi } from "vitest";
import {
  type GoogleGenAIClient,
  GoogleProvider,
} from "../src/drivers/ai/google.ts";

/**
 * Contract tests for the Google driver (AI-NATIVE-PLAN §3.2, P2-T13),
 * against a fake client matching the real SDK's own response shapes. The
 * real `GoogleGenAI` class has no `fetch` injection point (only
 * `httpOptions.baseUrl`, which redirects the whole client rather than one
 * call), so `GoogleProviderOptions.client` — this driver's own seam for
 * exactly this case — stands in instead.
 */

function fakeClient(
  overrides: Partial<GoogleGenAIClient["models"]> = {},
): GoogleGenAIClient {
  return {
    models: {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      embedContent: vi.fn(),
      ...overrides,
    },
  };
}

describe("chat", () => {
  it("parses text and usage, folding a system message into systemInstruction", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "Hello there!",
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 6 },
    });
    const client = fakeClient({ generateContent });
    const provider = new GoogleProvider({ client });

    const response = await provider.chat({
      model: "gemini-2.5-flash",
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "hi" },
      ],
    });

    expect(response).toEqual({
      content: "Hello there!",
      usage: { inputTokens: 12, outputTokens: 6 },
    });
    const call = generateContent.mock.calls[0]?.[0];
    expect(call.config.systemInstruction).toBe("Be terse.");
    expect(call.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
  });
});

describe("chatWithTools", () => {
  it("parses a function call, synthesising a stable id", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "",
      functionCalls: [{ name: "get_weather", args: { city: "Paris" } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8 },
    });
    const provider = new GoogleProvider({
      client: fakeClient({ generateContent }),
    });

    const response = await provider.chatWithTools({
      model: "gemini-2.5-flash",
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
      { id: "0", name: "get_weather", arguments: { city: "Paris" } },
    ]);
    const call = generateContent.mock.calls[0]?.[0];
    expect(call.config.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "get_weather",
            description: "Get the weather for a city.",
            parametersJsonSchema: {
              type: "object",
              properties: { city: { type: "string" } },
            },
          },
        ],
      },
    ]);
  });
});

describe("extract", () => {
  it("requests a plain-JSON-Schema structured response via responseJsonSchema", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: '{"city":"Paris","country":"France"}',
      usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 10 },
    });
    const provider = new GoogleProvider({
      client: fakeClient({ generateContent }),
    });

    const schema = {
      type: "object",
      properties: { city: { type: "string" }, country: { type: "string" } },
    };
    const response = await provider.extract({
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "extract the city" }],
      schema,
    });

    expect(JSON.parse(response.content)).toEqual({
      city: "Paris",
      country: "France",
    });
    const call = generateContent.mock.calls[0]?.[0];
    expect(call.config.responseMimeType).toBe("application/json");
    expect(call.config.responseJsonSchema).toBe(schema);
  });
});

describe("embed", () => {
  it("parses embedding vectors, with no usage to report", async () => {
    const embedContent = vi.fn().mockResolvedValue({
      embeddings: [{ values: [0.1, 0.2, 0.3] }, { values: [0.4, 0.5, 0.6] }],
    });
    const provider = new GoogleProvider({
      client: fakeClient({ embedContent }),
    });

    const response = await provider.embed({
      model: "gemini-embedding-001",
      input: ["cat", "dog"],
    });

    expect(response.vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(response.dimensions).toBe(3);
    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("stream", () => {
  it("yields the text from each streamed response, awaiting the stream itself first", async () => {
    async function* chunks() {
      yield { text: "Hel" };
      yield { text: "lo" };
    }
    const generateContentStream = vi.fn().mockResolvedValue(chunks());
    const provider = new GoogleProvider({
      client: fakeClient({ generateContentStream }),
    });

    const received: string[] = [];
    for await (const chunk of provider.stream({
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "hi" }],
    })) {
      received.push(chunk);
    }

    expect(received.join("")).toBe("Hello");
  });
});

describe("capabilities and stop", () => {
  it("reports a reasonable default capability set with no live catalogue", () => {
    const provider = new GoogleProvider({ client: fakeClient() });
    expect(provider.capabilities("gemini-2.5-flash")).toMatchObject({
      available: true,
      tools: true,
      jsonMode: true,
      streaming: true,
    });
  });

  it("stops cleanly", async () => {
    const provider = new GoogleProvider({ client: fakeClient() });
    await expect(provider.stop()).resolves.toBeUndefined();
  });
});
