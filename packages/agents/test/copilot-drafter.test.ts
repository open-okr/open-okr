/**
 * The copilot on a real provider (AI-NATIVE-PLAN.md §2.4, P4-T14a-b).
 *
 * What this file is about is the sentinel line. A streamed answer has to tell the
 * caller which passages it used, and a JSON reply cannot be streamed to a reader
 * without them watching a string being escaped. So the model ends with a line the
 * product reads and the reader never sees, and **the reader never seeing it is
 * the part that needs a test**: a naive implementation emits every piece as it
 * arrives and the words "SOURCES: 1, 3" appear on screen and then vanish.
 *
 * The pieces here are split at deliberately awkward places, mid-word and mid
 * sentinel, because that is what a token stream does.
 */
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ModelCapabilities,
} from "@openokr/adapters";
import type {
  AgentDrafter,
  GroundedChunk,
  GroundedQuestionContext,
} from "@openokr/core";
import { describe, expect, it } from "vitest";
import { createProviderDrafter } from "../src/drafter.ts";

/** A provider that replays fixed pieces, and records what it was asked. */
class ScriptedProvider implements AIProvider {
  readonly requests: ChatRequest[] = [];
  #pieces: string[];
  #whole: string;

  constructor(pieces: readonly string[]) {
    this.#pieces = [...pieces];
    this.#whole = pieces.join("");
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    return {
      content: this.#whole,
      usage: { inputTokens: 400, outputTokens: 60 },
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<string> {
    this.requests.push(request);
    for (const piece of this.#pieces) {
      yield piece;
    }
  }

  chatWithTools(): Promise<ChatResponse> {
    throw new Error("not used in this test");
  }
  embed(_request: EmbedRequest): Promise<EmbedResponse> {
    throw new Error("not used in this test");
  }
  extract(): Promise<ChatResponse> {
    throw new Error("not used in this test");
  }
  capabilities(): ModelCapabilities {
    throw new Error("not used in this test");
  }
  async stop(): Promise<void> {}
}

const drafterOver = (pieces: readonly string[], costCapUsd = 2) => {
  const provider = new ScriptedProvider(pieces);
  return {
    provider,
    drafter: createProviderDrafter({
      provider,
      model: "test-model",
      costCapUsd,
      costInPerMillion: 1,
      costOutPerMillion: 2,
    }),
  };
};

const question: GroundedQuestionContext = {
  question: "How is mid-market activation?",
  history: [],
  sources: [
    {
      label: "Raise mid-market activation",
      content: "Activation sits at 41%.",
    },
    { label: "Cut onboarding", content: "Onboarding takes four days." },
  ],
};

/**
 * The streaming method, called on its drafter.
 *
 * Two things at once, and both matter. `streamGrounded` is optional on the
 * interface, so a caller has to prove it is there; and it has to be called on the
 * drafter rather than pulled out of it, because a host's drafter is very often a
 * class instance and a detached method loses `this`.
 */
const streamOf = (
  drafter: AgentDrafter,
  context: GroundedQuestionContext,
  signal?: AbortSignal,
): AsyncIterable<GroundedChunk> => {
  if (!drafter.streamGrounded) {
    throw new Error("the provider drafter cannot stream");
  }
  return drafter.streamGrounded(context, signal);
};

const collect = async (chunks: AsyncIterable<GroundedChunk>) => {
  const text: string[] = [];
  let done: GroundedChunk | null = null;
  for await (const chunk of chunks) {
    if (chunk.kind === "text") {
      text.push(chunk.text);
    } else {
      done = chunk;
    }
  }
  return { text, joined: text.join(""), done };
};

describe("the sentinel line", () => {
  it("is never sent to the reader, even split across pieces", async () => {
    const { drafter } = drafterOver([
      "Activation is at 41 per c",
      "ent [1], behind the target.\nSOU",
      "RCES: 1, 2",
    ]);

    const { text, joined, done } = await collect(streamOf(drafter, question));
    // Every piece the reader saw, checked individually as well as joined: a
    // buffer bug can hide in the join.
    for (const piece of text) {
      expect(piece).not.toContain("SOURCES");
    }
    expect(joined).not.toContain("SOURCES");
    expect(joined.trim()).toBe(
      "Activation is at 41 per cent [1], behind the target.",
    );
    expect(done).toEqual({
      kind: "done",
      answer: {
        text: "Activation is at 41 per cent [1], behind the target.",
        // One-based on the wire, zero-based to the caller.
        usedSourceIndexes: [0, 1],
        model: "test-model",
      },
    });
  });

  it("arriving whole in one piece is still held back", async () => {
    const { drafter } = drafterOver(["Activation is behind.\nSOURCES: 2\n"]);
    const { joined, done } = await collect(streamOf(drafter, question));
    expect(joined).not.toContain("SOURCES");
    expect(done).toMatchObject({
      answer: { text: "Activation is behind.", usedSourceIndexes: [1] },
    });
  });

  it("cites nothing when the model forgets the line", async () => {
    const { drafter } = drafterOver(["I do not know.", " Nothing says."]);
    const { joined, done } = await collect(streamOf(drafter, question));
    expect(joined).toBe("I do not know. Nothing says.");
    // No claim about sources is not an empty claim: it is no claim, and the
    // honest record is no citation.
    expect(done).toMatchObject({ answer: { usedSourceIndexes: [] } });
  });

  it("ignores what is not a number on the line", async () => {
    const { drafter } = drafterOver([
      "Behind.\nSOURCES: 1, the second one, none",
    ]);
    const { done } = await collect(streamOf(drafter, question));
    expect(done).toMatchObject({ answer: { usedSourceIndexes: [0] } });
  });
});

describe("a stopped stream", () => {
  it("ends with no done chunk, so the caller knows it was cut short", async () => {
    const controller = new AbortController();
    const { drafter } = drafterOver([
      "Activation is",
      " at 41 per cent",
      " and the trend",
    ]);

    const text: string[] = [];
    let done = false;
    for await (const chunk of streamOf(drafter, question, controller.signal)) {
      if (chunk.kind === "done") {
        done = true;
        continue;
      }
      text.push(chunk.text);
      controller.abort();
    }

    // Something arrived and it is a real partial answer, and there is no `done`
    // chunk: that absence is what tells `streamAnswer` to record it as stopped.
    expect(text.length).toBeGreaterThan(0);
    expect(done).toBe(false);
  });
});

describe("the passages a model is shown", () => {
  it("are numbered from one and carry no identifier", async () => {
    const { provider, drafter } = drafterOver(["Fine.\nSOURCES: none"]);
    await collect(streamOf(drafter, question));

    const sent = provider.requests[0]?.messages.at(-1)?.content ?? "";
    expect(sent).toContain("[1] Raise mid-market activation");
    expect(sent).toContain("[2] Cut onboarding");
    expect(sent).toContain("Question: How is mid-market activation?");
  });

  it("say plainly when there are none", async () => {
    const { provider, drafter } = drafterOver(["Nothing here.\nSOURCES: none"]);
    await collect(streamOf(drafter, { ...question, sources: [] }));
    expect(provider.requests[0]?.messages.at(-1)?.content).toContain(
      "There are no passages",
    );
  });

  it("carry the earlier turns as their own messages", async () => {
    const { provider, drafter } = drafterOver(["Yes.\nSOURCES: none"]);
    await collect(
      streamOf(drafter, {
        ...question,
        history: [
          { role: "member", content: "How is activation?" },
          { role: "assistant", content: "At 41 per cent." },
        ],
      }),
    );
    const roles = provider.requests[0]?.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
  });
});

describe("the whole answer, not streamed", () => {
  it("reports the tokens and the cost the streamed path cannot", async () => {
    const { drafter } = drafterOver(["Activation is behind.\nSOURCES: 1"]);
    const answer = await drafter.answerGrounded?.(question);
    expect(answer).toMatchObject({
      text: "Activation is behind.",
      usedSourceIndexes: [0],
      model: "test-model",
      tokensIn: 400,
      tokensOut: 60,
    });
    // 400 in at $1/M plus 60 out at $2/M.
    expect(answer?.costUsd).toBeCloseTo((400 * 1 + 60 * 2) / 1_000_000, 10);
  });

  it("answers nothing at all when the cap is spent", async () => {
    const { provider, drafter } = drafterOver(["Fine.\nSOURCES: none"], 0);
    expect(await drafter.answerGrounded?.(question)).toBeNull();
    const { text, done } = await collect(streamOf(drafter, question));
    expect(text).toEqual([]);
    expect(done).toBeNull();
    // Refused at the door: the provider was never called, so nothing was spent
    // discovering there was nothing to spend.
    expect(provider.requests).toEqual([]);
  });
});
