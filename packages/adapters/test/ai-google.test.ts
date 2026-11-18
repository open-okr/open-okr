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
  it("parses a function call, synthesising an id", async () => {
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
      {
        id: expect.stringMatching(/^gemini-call-/),
        name: "get_weather",
        arguments: { city: "Paris" },
      },
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

describe("chatWithTools history", () => {
  it("sends functionCall then functionResponse parts, keeps thoughtSignature and maps names back", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "",
      functionCalls: [{ name: "goals_read", args: { id: 3 } }],
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: "goals_read", args: { id: 3 } },
                thoughtSignature: "sig-3",
              },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
    });
    const provider = new GoogleProvider({
      client: fakeClient({ generateContent }),
    });

    const response = await provider.chatWithTools({
      model: "gemini-2.5-flash",
      messages: [
        { role: "user", content: "how are we doing?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "a",
              name: "goals.read",
              arguments: { id: 1 },
              providerData: { thoughtSignature: "sig-1" },
            },
            { id: "b", name: "goals.read", arguments: { id: 2 } },
          ],
        },
        { role: "tool", content: "result a", toolCallId: "a" },
        { role: "tool", content: "result b", toolCallId: "b" },
      ],
      tools: [
        {
          name: "goals.read",
          description: "Read goals.",
          parameters: { type: "object", properties: {} },
        },
      ],
    });

    const call = generateContent.mock.calls[0]?.[0];
    expect(call.contents).toEqual([
      { role: "user", parts: [{ text: "how are we doing?" }] },
      {
        role: "model",
        parts: [
          {
            functionCall: { name: "goals_read", args: { id: 1 }, id: "a" },
            thoughtSignature: "sig-1",
          },
          { functionCall: { name: "goals_read", args: { id: 2 }, id: "b" } },
        ],
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "goals_read",
              id: "a",
              response: { content: "result a" },
            },
          },
          {
            functionResponse: {
              name: "goals_read",
              id: "b",
              response: { content: "result b" },
            },
          },
        ],
      },
    ]);
    expect(call.config.tools[0].functionDeclarations[0].name).toBe(
      "goals_read",
    );
    expect(response.toolCalls).toEqual([
      {
        id: expect.stringMatching(/^gemini-call-/),
        name: "goals.read",
        arguments: { id: 3 },
        providerData: { thoughtSignature: "sig-3" },
      },
    ]);
  });

  it("keeps the id Gemini gave a call, and never reuses one across rounds", async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: "",
      functionCalls: [{ name: "x", args: {} }],
    });
    const provider = new GoogleProvider({
      client: fakeClient({ generateContent }),
    });
    const request = {
      model: "gemini-2.5-flash",
      messages: [{ role: "user" as const, content: "hi" }],
      tools: [],
    };
    const first = await provider.chatWithTools(request);
    const second = await provider.chatWithTools(request);
    expect(first.toolCalls?.[0]?.id).not.toBe(second.toolCalls?.[0]?.id);

    generateContent.mockResolvedValueOnce({
      text: "",
      functionCalls: [{ id: "own-id", name: "x", args: {} }],
    });
    const third = await provider.chatWithTools(request);
    expect(third.toolCalls?.[0]?.id).toBe("own-id");
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

  it("reports the usage the stream's chunks carry", async () => {
    async function* chunks() {
      yield { text: "Hi" };
      yield {
        text: "",
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3 },
      };
    }
    const provider = new GoogleProvider({
      client: fakeClient({
        generateContentStream: vi.fn().mockResolvedValue(chunks()),
      }),
    });

    const usage: unknown[] = [];
    for await (const _chunk of provider.stream(
      {
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "hi" }],
      },
      (counted) => usage.push(counted),
    )) {
      // Read to the end.
    }

    expect(usage).toEqual([{ inputTokens: 9, outputTokens: 3 }]);
  });

  it("says how many input tokens came from the cache", async () => {
    async function* chunks() {
      yield {
        text: "Hi",
        usageMetadata: {
          promptTokenCount: 9,
          candidatesTokenCount: 3,
          cachedContentTokenCount: 5,
        },
      };
    }
    const provider = new GoogleProvider({
      client: fakeClient({
        generateContentStream: vi.fn().mockResolvedValue(chunks()),
      }),
    });

    const usage: unknown[] = [];
    for await (const _chunk of provider.stream(
      {
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "hi" }],
      },
      (counted) => usage.push(counted),
    )) {
      // Read to the end.
    }

    expect(usage).toEqual([
      { inputTokens: 9, outputTokens: 3, cachedInputTokens: 5 },
    ]);
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

describe("the real client", () => {
  /**
   * SDK 3.0 moved the Gemini API's default from `v1beta` to `v1` and lets
   * `GOOGLE_GENAI_API_VERSION` choose it. System instructions, function
   * tools and `responseJsonSchema` were built and shipped against `v1beta`,
   * so the driver names it, and an environment variable cannot move it.
   */
  it("calls v1beta on the Gemini API whatever the environment says", async () => {
    vi.stubEnv("GOOGLE_GENAI_API_VERSION", "v1");
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      const provider = new GoogleProvider({ apiKey: "test-key" });
      await provider.chat({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "hi" }],
      });

      const url = String(fetch.mock.calls[0]?.[0]);
      expect(url).toMatch(
        /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent/,
      );
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
