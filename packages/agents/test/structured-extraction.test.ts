import type {
  AIProvider,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ExtractRequest,
  ModelCapabilities,
} from "@openokr/adapters";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  extractStructured,
  StructuredExtractionError,
} from "../src/structured-extraction.ts";

/**
 * Structured extraction with one repair attempt (P2-T15 test plan,
 * AI-NATIVE-PLAN.md §1.8, §3.4): malformed output repairs once then fails
 * cleanly, and a first-attempt success never triggers a repair call at all.
 *
 * A small stub rather than `MockAIProvider` from `@openokr/adapters`: that
 * mock always returns the same fixed response, and this needs a different
 * one on the second call to prove the repair path actually runs.
 */
class QueuedExtractProvider implements AIProvider {
  #responses: ChatResponse[];
  readonly requests: ExtractRequest[] = [];

  constructor(responses: readonly ChatResponse[]) {
    this.#responses = [...responses];
  }

  async extract(request: ExtractRequest): Promise<ChatResponse> {
    this.requests.push(request);
    const next = this.#responses.shift();
    if (!next) {
      throw new Error("QueuedExtractProvider ran out of queued responses.");
    }
    return next;
  }

  chat(): Promise<ChatResponse> {
    throw new Error("not used in this test");
  }
  stream(): AsyncIterable<string> {
    throw new Error("not used in this test");
  }
  chatWithTools(): Promise<ChatResponse> {
    throw new Error("not used in this test");
  }
  embed(_request: EmbedRequest): Promise<EmbedResponse> {
    throw new Error("not used in this test");
  }
  capabilities(): ModelCapabilities {
    throw new Error("not used in this test");
  }
  async stop(): Promise<void> {}
}

const schema = z.object({ title: z.string(), score: z.number() });
const jsonSchema = {
  type: "object",
  properties: { title: { type: "string" }, score: { type: "number" } },
  required: ["title", "score"],
};
const usage = { inputTokens: 10, outputTokens: 10 };

describe("extractStructured", () => {
  it("returns the first attempt's result without repairing when it already validates", async () => {
    const provider = new QueuedExtractProvider([
      { content: JSON.stringify({ title: "Q3 growth", score: 4 }), usage },
    ]);

    const result = await extractStructured({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "extract this" }],
      schema,
      jsonSchema,
    });

    expect(result).toEqual({ title: "Q3 growth", score: 4 });
    expect(provider.requests).toHaveLength(1);
  });

  it("repairs once when the first attempt is malformed JSON, then succeeds", async () => {
    const provider = new QueuedExtractProvider([
      { content: "not json at all", usage },
      { content: JSON.stringify({ title: "Fixed", score: 1 }), usage },
    ]);

    const result = await extractStructured({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "extract this" }],
      schema,
      jsonSchema,
    });

    expect(result).toEqual({ title: "Fixed", score: 1 });
    expect(provider.requests).toHaveLength(2);
    // The repair call carries the first (bad) reply and a correction
    // instruction, not just a repeat of the original request.
    const repairMessages = provider.requests[1]?.messages ?? [];
    expect(repairMessages.some((m) => m.content === "not json at all")).toBe(
      true,
    );
  });

  it("repairs once when the first attempt is valid JSON but the wrong shape", async () => {
    const provider = new QueuedExtractProvider([
      { content: JSON.stringify({ wrongField: true }), usage },
      { content: JSON.stringify({ title: "Fixed", score: 2 }), usage },
    ]);

    const result = await extractStructured({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "extract this" }],
      schema,
      jsonSchema,
    });

    expect(result).toEqual({ title: "Fixed", score: 2 });
    expect(provider.requests).toHaveLength(2);
  });

  it("fails cleanly after the repair attempt also fails, never returning unvalidated output", async () => {
    const provider = new QueuedExtractProvider([
      { content: "still not json", usage },
      { content: "still not json either", usage },
    ]);

    await expect(
      extractStructured({
        provider,
        model: "test-model",
        messages: [{ role: "user", content: "extract this" }],
        schema,
        jsonSchema,
      }),
    ).rejects.toBeInstanceOf(StructuredExtractionError);
    expect(provider.requests).toHaveLength(2);
  });
});
