import { describe, expect, it } from "vitest";
import { MockAIProvider } from "../src/drivers/ai/mock.ts";

/**
 * The deterministic mock driver (P2-T13) — for another package's own test
 * suite to exercise the AIProvider contract without a network call. Every
 * method succeeds with a canned, overridable answer, distinct from
 * `OffAIProvider`, whose every method refuses.
 */

describe("MockAIProvider", () => {
  it("answers chat with a default response and records the call", async () => {
    const provider = new MockAIProvider();
    const request = {
      model: "any",
      messages: [{ role: "user" as const, content: "hi" }],
    };
    const response = await provider.chat(request);

    expect(response.content).toBe("This is a mock response.");
    expect(provider.calls).toEqual([{ method: "chat", request }]);
  });

  it("answers with an overridden response when given one", async () => {
    const provider = new MockAIProvider({
      chatResponse: {
        content: "custom",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    });
    const response = await provider.chat({
      model: "any",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(response.content).toBe("custom");
  });

  it("streams the configured chunks in order", async () => {
    const provider = new MockAIProvider({ streamChunks: ["a", "b", "c"] });
    const chunks: string[] = [];
    for await (const chunk of provider.stream({
      model: "any",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["a", "b", "c"]);
  });

  it("attaches configured tool calls to chatWithTools", async () => {
    const toolCalls = [
      { id: "1", name: "get_weather", arguments: { city: "Paris" } },
    ];
    const provider = new MockAIProvider({ toolCalls });
    const response = await provider.chatWithTools({
      model: "any",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });
    expect(response.toolCalls).toEqual(toolCalls);
  });

  it("embeds deterministically: the same input always produces the same vector", async () => {
    const provider = new MockAIProvider();
    const first = await provider.embed({ model: "any", input: ["hello"] });
    const second = await provider.embed({ model: "any", input: ["hello"] });
    expect(first.vectors).toEqual(second.vectors);
  });

  it("embeds two different inputs into two different vectors", async () => {
    const provider = new MockAIProvider();
    const response = await provider.embed({
      model: "any",
      input: ["hello", "goodbye"],
    });
    expect(response.vectors[0]).not.toEqual(response.vectors[1]);
  });

  it("reports the configured capabilities", () => {
    const provider = new MockAIProvider({
      capabilities: {
        available: true,
        tools: false,
        vision: false,
        jsonMode: false,
        streaming: false,
        contextWindow: 4096,
      },
    });
    expect(provider.capabilities("any")).toMatchObject({
      tools: false,
      contextWindow: 4096,
    });
  });

  it("stops cleanly", async () => {
    await expect(new MockAIProvider().stop()).resolves.toBeUndefined();
  });
});
