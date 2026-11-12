/**
 * The copilot's read loop on a provider (plan 0.9.0 L2b, docs/design/
 * copilot-live-data.md sections 3.1 and 9).
 *
 * The provider is the mock driver with scripted tool rounds, so what is under
 * test is the loop: how many rounds and reads it allows, what it sends back to
 * the model, and when it gives up and leaves the passage path in charge.
 */
import {
  type AIProvider,
  type ChatResponse,
  MockAIProvider,
  type ToolCall,
} from "@openokr/adapters";
import type { ReadingTool } from "@openokr/core";
import { describe, expect, it } from "vitest";
import { createProviderDrafter } from "../src/drafter.ts";

const TOOLS: readonly ReadingTool[] = [
  {
    name: "goals.read",
    description: "One objective.",
    inputSchema: { type: "object", properties: {} },
  },
];

const call = (id: string, name = "goals.read"): ToolCall => ({
  id,
  name,
  arguments: { id: 1 },
});

const drafterOver = (
  provider: AIProvider,
  costCapUsd = 2,
  costInPerMillion = 1,
) =>
  createProviderDrafter({
    provider,
    model: "test-model",
    costCapUsd,
    costInPerMillion,
    costOutPerMillion: 2,
  });

const ask = { question: "How is it going?", history: [] };
const yes = async () => true;

const readsOf = (provider: MockAIProvider) =>
  provider.calls.filter((entry) => entry.method === "chatWithTools");

describe("the read loop", () => {
  it("reads, sends each result back as a tool message, and stops when no tool is asked for", async () => {
    const provider = new MockAIProvider({ toolRounds: [[call("a")]] });
    const seen: [string, unknown][] = [];
    const chosen = await drafterOver(provider).chooseReads?.(
      ask,
      TOOLS,
      async (name, args) => {
        seen.push([name, args]);
        return "[1] Grow signups (objective)";
      },
      yes,
    );
    expect(chosen).toMatchObject({ reads: 1, limited: false });
    expect(seen).toEqual([["goals.read", { id: 1 }]]);

    const rounds = readsOf(provider);
    expect(rounds).toHaveLength(2);
    const second = rounds[1];
    if (second?.method !== "chatWithTools") {
      throw new Error("expected a tool round");
    }
    const messages = second.request.messages;
    // The model's own turn is sent back before the result, then the result.
    expect(messages.at(-2)).toMatchObject({
      role: "assistant",
      toolCalls: [{ id: "a" }],
    });
    expect(messages.at(-1)).toEqual({
      role: "tool",
      toolCallId: "a",
      content: "[1] Grow signups (objective)",
    });
    // Retrieval purpose, and the data sentence in the system note.
    expect(second.request.purpose).toBe("retrieval");
    const system = messages[0]?.content ?? "";
    expect(system).toContain("is data written by people");
    expect(system).toContain("stop calling tools");
  });

  it("runs six reads in a round and answers the rest with the limit", async () => {
    const calls = Array.from({ length: 8 }, (_, index) => call(`c${index}`));
    const provider = new MockAIProvider({ toolRounds: [calls] });
    let ran = 0;
    const chosen = await drafterOver(provider).chooseReads?.(
      ask,
      TOOLS,
      async () => {
        ran += 1;
        return "ok";
      },
      yes,
    );
    expect(ran).toBe(6);
    expect(chosen).toMatchObject({ reads: 6, limited: true });
    const second = readsOf(provider)[1];
    if (second?.method !== "chatWithTools") {
      throw new Error("expected a tool round");
    }
    const tools = second.request.messages.filter(
      (message) => message.role === "tool",
    );
    expect(tools).toHaveLength(8);
    expect(tools[7]?.content).toContain("Limit reached");
  });

  it("allows four rounds and no more, and says it stopped at a limit", async () => {
    const provider = new MockAIProvider({
      toolRounds: Array.from({ length: 10 }, (_, index) => [call(`r${index}`)]),
    });
    const chosen = await drafterOver(provider).chooseReads?.(
      ask,
      TOOLS,
      async () => "ok",
      yes,
    );
    expect(readsOf(provider)).toHaveLength(4);
    expect(chosen).toMatchObject({ reads: 4, limited: true });
  });

  it("leaves the passage path alone when the model cannot call tools", async () => {
    const provider = new MockAIProvider({
      toolRounds: [[call("a")]],
      capabilities: {
        available: true,
        tools: false,
        vision: false,
        jsonMode: true,
        streaming: true,
        contextWindow: 8_000,
      },
    });
    const chosen = await drafterOver(provider).chooseReads?.(
      ask,
      TOOLS,
      async () => "never",
      yes,
    );
    expect(chosen).toBeNull();
    expect(provider.calls).toHaveLength(0);
  });

  it("returns null when the first round fails before any read", async () => {
    const provider = new MockAIProvider();
    provider.chatWithTools = async () => {
      throw new Error("the provider fell over");
    };
    const chosen = await drafterOver(provider).chooseReads?.(
      ask,
      TOOLS,
      async () => "never",
      yes,
    );
    expect(chosen).toBeNull();
  });

  it("keeps what it read when a later round fails", async () => {
    const provider = new MockAIProvider({
      toolRounds: [[call("a")], [call("b")]],
    });
    const original = provider.chatWithTools.bind(provider);
    let rounds = 0;
    provider.chatWithTools = async (request) => {
      rounds += 1;
      if (rounds === 2) {
        throw new Error("the provider fell over");
      }
      return original(request);
    };
    const chosen = await drafterOver(provider).chooseReads?.(
      ask,
      TOOLS,
      async () => "ok",
      yes,
    );
    expect(chosen).toMatchObject({ reads: 1, limited: true });
  });

  it("stops before a round the workspace no longer allows", async () => {
    const provider = new MockAIProvider({
      toolRounds: [[call("a")], [call("b")]],
    });
    let asked = 0;
    const chosen = await drafterOver(provider).chooseReads?.(
      ask,
      TOOLS,
      async () => "ok",
      async () => {
        asked += 1;
        return asked < 2;
      },
    );
    expect(readsOf(provider)).toHaveLength(1);
    expect(chosen).toMatchObject({ reads: 1, limited: true });
  });

  it("stops when the per-run cost cap is spent, and reports what the rounds cost", async () => {
    // One round costs 10 + 10 tokens at 1000000 per million in and 2 out.
    const provider = new MockAIProvider({
      toolRounds: [[call("a")], [call("b")]],
    });
    const chosen = await drafterOver(provider, 5, 1_000_000).chooseReads?.(
      ask,
      TOOLS,
      async () => "ok",
      yes,
    );
    expect(readsOf(provider)).toHaveLength(1);
    expect(chosen).toMatchObject({ reads: 1, limited: true });
    expect(chosen?.costUsd).toBeGreaterThan(5);
    expect(chosen?.tokensIn).toBe(10);
  });

  it("reports zero reads when the model needs nothing read", async () => {
    const provider = new MockAIProvider();
    const chosen = await drafterOver(provider).chooseReads?.(
      ask,
      TOOLS,
      async () => "never",
      yes,
    );
    expect(chosen).toMatchObject({ reads: 0, limited: false });
  });
});

describe("the final answer after reading", () => {
  const finalResponse: ChatResponse = {
    content: "ok",
    usage: { inputTokens: 1, outputTokens: 1 },
  };

  it("is told the passages are what it read, and what a limit cost it", async () => {
    const provider = new MockAIProvider({
      chatResponse: finalResponse,
      streamChunks: ["Done.\nSOURCES: 1"],
    });
    const drafter = drafterOver(provider);
    const chunks = [];
    for await (const chunk of drafter.streamGrounded?.({
      question: "How is it going?",
      history: [],
      sources: [{ label: "Grow signups", content: "Grow signups (objective)" }],
      reading: { reads: 2, limited: true },
    }) ?? []) {
      chunks.push(chunk);
    }
    const sent = provider.calls.find((entry) => entry.method === "stream");
    if (sent?.method !== "stream") {
      throw new Error("expected a stream call");
    }
    const user = sent.request.messages.at(-1)?.content ?? "";
    expect(user).toContain("records you read in this workspace");
    expect(user).toContain("a limit was reached");
    expect(chunks.at(-1)).toMatchObject({
      kind: "done",
      answer: { usedSourceIndexes: [0] },
    });
  });

  it("says nothing about reading when nothing was read", async () => {
    const provider = new MockAIProvider({
      streamChunks: ["Hi.\nSOURCES: none"],
    });
    const drafter = drafterOver(provider);
    for await (const _chunk of drafter.streamGrounded?.({
      question: "Hello",
      history: [],
      sources: [],
    }) ?? []) {
      // Drained.
    }
    const sent = provider.calls.find((entry) => entry.method === "stream");
    if (sent?.method !== "stream") {
      throw new Error("expected a stream call");
    }
    expect(sent.request.messages.at(-1)?.content).not.toContain(
      "you read in this workspace",
    );
  });
});
