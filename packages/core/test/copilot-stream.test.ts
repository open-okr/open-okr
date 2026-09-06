/**
 * A streamed answer, and what happens when it is stopped (P4-T14a-b).
 *
 * The task's test plan line this file owns: **the stop control ends the stream
 * and leaves the thread readable.**
 *
 * Two ways a reader stops one, and both are tested, because they take different
 * code paths and only one of them is obvious:
 *
 * 1. The signal aborts. The provider's own generator returns, the loop ends, and
 *    the `finally` records what arrived.
 * 2. The consumer stops pulling, which is what a closed tab looks like from
 *    here. `streamAnswer` is never resumed, so the runtime finalises it, and the
 *    `finally` is the only thing that runs. Nothing can be yielded from there,
 *    so the write has to be the last thing it does.
 *
 * A partial answer is recorded with **no citations**, and that is the point
 * rather than an omission: the model never said which passages its unfinished
 * sentence rested on, and filling that in would be inventing the one thing this
 * feature promises not to invent.
 */
import type {
  AgentDrafter,
  GroundedChunk,
  GroundedQuestionContext,
} from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { type CopilotEvent, streamAnswer } from "../src/copilot/answer.ts";
import { runEmbedJob } from "../src/embeddings/worker.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "stream-owner";

let workspaceId: string;
let ownerMemberId: string;
let goalId: string;

/** Replays fixed chunks, and stops early when the signal says to. */
class ScriptedDrafter implements AgentDrafter {
  readonly seen: GroundedQuestionContext[] = [];
  #chunks: readonly GroundedChunk[];
  #throwAfter: number | null;

  constructor(
    chunks: readonly GroundedChunk[],
    options: { readonly throwAfter?: number } = {},
  ) {
    this.#chunks = chunks;
    this.#throwAfter = options.throwAfter ?? null;
  }

  async *streamGrounded(
    context: GroundedQuestionContext,
    signal?: AbortSignal,
  ): AsyncIterable<GroundedChunk> {
    this.seen.push(context);
    let sent = 0;
    for (const chunk of this.#chunks) {
      if (signal?.aborted) {
        return;
      }
      if (this.#throwAfter !== null && sent === this.#throwAfter) {
        throw new Error("the provider fell over");
      }
      sent += 1;
      yield chunk;
    }
  }

  spentUsd() {
    return 0;
  }
}

const embed = async (inputs: readonly string[]) => ({
  vectors: inputs.map(() => [0.1, 0.2, 0.3]),
  dimensions: 3,
  model: "test-embed",
});

const contextFor = async (drafter?: AgentDrafter) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: OWNER },
    drafter,
  };
};

const call = async (name: string, input: unknown) =>
  callAction(await contextFor(), name as never, input as never);

/** Drains a stream, optionally stopping after a given number of text events. */
const drain = async (
  drafter: AgentDrafter | undefined,
  question: string,
  options: {
    readonly threadId?: string;
    readonly signal?: AbortSignal;
    readonly breakAfterText?: number;
  } = {},
) => {
  const events: CopilotEvent[] = [];
  let texts = 0;
  const stream = streamAnswer(
    await contextFor(drafter),
    { workspaceId, question, threadId: options.threadId },
    options.signal,
  );
  for await (const event of stream) {
    events.push(event);
    if (event.kind !== "text") {
      continue;
    }
    texts += 1;
    if (options.breakAfterText === texts) {
      break;
    }
  }
  return events;
};

const textOf = (events: readonly CopilotEvent[]) =>
  events
    .filter(
      (event): event is Extract<CopilotEvent, { kind: "text" }> =>
        event.kind === "text",
    )
    .map((event) => event.text)
    .join("");

const threadIdOf = (events: readonly CopilotEvent[]) => {
  const first = events[0];
  if (first?.kind !== "thread") {
    throw new Error("the stream did not open with its thread");
  }
  return first.threadId;
};

const storedAnswer = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    content: string;
    citations: unknown[];
    stopped_at: Date | null;
    model: string | null;
  }>(
    "select content, citations, stopped_at, model from ai_messages where role = 'assistant'",
  );
  return rows;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', $2)",
    [OWNER, "stream-owner@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const spaceId = ((await call("spaces.list", {})) as { id: string }[])[0]
    ?.id as string;
  const cycleId = (
    (await call("cycles.current", { mode: "quarterly" })) as { id: string }
  ).id;
  goalId = (
    (await call("goals.create", {
      title: "Raise mid-market activation to sixty per cent",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string }
  ).id;
  await runEmbedJob(
    { workspaceId, entityType: "goal", entityId: goalId },
    { pool: (await workerDb()).appPool, embed },
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const finished: readonly GroundedChunk[] = [
  { kind: "text", text: "Activation is at 41 per cent" },
  { kind: "text", text: " against a target of sixty." },
  {
    kind: "done",
    answer: {
      text: "Activation is at 41 per cent against a target of sixty.",
      usedSourceIndexes: [0],
      model: "stub-1",
      tokensIn: 500,
      tokensOut: 30,
    },
  },
];

describe("a stream that finishes", () => {
  it("opens with the thread, then the passages, then the words", async () => {
    const events = await drain(
      new ScriptedDrafter(finished),
      "How is mid-market activation?",
    );
    expect(events.map((event) => event.kind)).toEqual([
      "thread",
      "sources",
      "text",
      "text",
      "done",
    ]);
    const sources = events[1];
    if (sources?.kind !== "sources") {
      throw new Error("the second event was not the passages");
    }
    expect(sources.sources.map((source) => source.entityId)).toEqual([goalId]);
    expect(textOf(events)).toBe(
      "Activation is at 41 per cent against a target of sixty.",
    );
  });

  it("records the whole answer with its citation and its cost", async () => {
    const events = await drain(
      new ScriptedDrafter(finished),
      "How is mid-market activation?",
    );
    const last = events.at(-1);
    if (last?.kind !== "done") {
      throw new Error("the stream did not end with done");
    }
    expect(last.stopped).toBe(false);
    expect(last.answerMessageId).not.toBeNull();

    const thread = (await call("copilot.thread", {
      threadId: threadIdOf(events),
    })) as {
      messages: {
        role: string;
        content: string;
        citations: { entityId: string }[];
        stopped: boolean;
        tokensIn: number | null;
      }[];
    };
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]).toMatchObject({
      role: "assistant",
      content: "Activation is at 41 per cent against a target of sixty.",
      stopped: false,
      tokensIn: 500,
    });
    expect(thread.messages[1]?.citations.map((c) => c.entityId)).toEqual([
      goalId,
    ]);
  });
});

describe("the stop control ends the stream and leaves the thread readable", () => {
  it("records what arrived when the reader stops pulling", async () => {
    // A closed tab, from this side. The generator is never resumed, so only its
    // `finally` runs, and that is where the write is.
    const events = await drain(
      new ScriptedDrafter(finished),
      "How is mid-market activation?",
      {
        breakAfterText: 1,
      },
    );
    expect(textOf(events)).toBe("Activation is at 41 per cent");

    const stored = await storedAnswer();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.content).toBe("Activation is at 41 per cent");
    expect(stored[0]?.stopped_at).not.toBeNull();
    // No `done` chunk arrived, so the model never said what it used.
    expect(stored[0]?.citations).toEqual([]);

    // And the thread reads: the half-answer is there, marked as stopped.
    const thread = (await call("copilot.thread", {
      threadId: threadIdOf(events),
    })) as { messages: { content: string; stopped: boolean }[] };
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]).toMatchObject({
      content: "Activation is at 41 per cent",
      stopped: true,
    });
  });

  it("records what arrived when the signal aborts", async () => {
    const controller = new AbortController();
    const drafter = new ScriptedDrafter([
      { kind: "text", text: "Activation is" },
      { kind: "text", text: " at 41 per cent" },
      ...finished.slice(2),
    ]);

    const events: CopilotEvent[] = [];
    for await (const event of streamAnswer(
      await contextFor(drafter),
      { workspaceId, question: "How is mid-market activation?" },
      controller.signal,
    )) {
      events.push(event);
      if (event.kind === "text") {
        controller.abort();
      }
    }

    expect(textOf(events)).toBe("Activation is");
    const last = events.at(-1);
    expect(last).toMatchObject({ kind: "done", stopped: true });

    const stored = await storedAnswer();
    expect(stored[0]?.content).toBe("Activation is");
    expect(stored[0]?.stopped_at).not.toBeNull();
  });

  it("records nothing when it is stopped before the first word", async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await drain(
      new ScriptedDrafter(finished),
      "How is mid-market activation?",
      { signal: controller.signal },
    );

    expect(textOf(events)).toBe("");
    // The question is still there and still unanswered, so it can be asked
    // again. Recording an empty answer would say the copilot said nothing.
    expect(await storedAnswer()).toEqual([]);
    const thread = (await call("copilot.thread", {
      threadId: threadIdOf(events),
    })) as { messages: unknown[] };
    expect(thread.messages).toHaveLength(1);
  });

  it("keeps what arrived when the provider falls over mid-answer", async () => {
    const events = await drain(
      new ScriptedDrafter(finished, { throwAfter: 1 }),
      "How is mid-market activation?",
    );
    expect(textOf(events)).toBe("Activation is at 41 per cent");
    const stored = await storedAnswer();
    expect(stored[0]?.content).toBe("Activation is at 41 per cent");
    expect(stored[0]?.stopped_at).not.toBeNull();
  });
});

describe("a stopped answer is still a turn", () => {
  it("can be followed up, and the follow-up sees it", async () => {
    const first = await drain(
      new ScriptedDrafter(finished),
      "How is mid-market activation?",
      {
        breakAfterText: 1,
      },
    );
    const drafter = new ScriptedDrafter(finished);
    await drain(drafter, "And why?", { threadId: threadIdOf(first) });

    expect(drafter.seen[0]?.history).toEqual([
      { role: "member", content: "How is mid-market activation?" },
      { role: "assistant", content: "Activation is at 41 per cent" },
    ]);
  });
});

describe("with no streaming provider", () => {
  it("sends the passages and says why there is no prose", async () => {
    const events = await drain(undefined, "How is activation?");
    expect(events.map((event) => event.kind)).toEqual([
      "thread",
      "sources",
      "unavailable",
      "done",
    ]);
    const reason = events[2];
    if (reason?.kind !== "unavailable") {
      throw new Error("the third event was not the reason");
    }
    expect(reason.reason).toContain("No AI provider");
    expect(await storedAnswer()).toEqual([]);
  });

  it("says the same when the model has nothing to add", async () => {
    const events = await drain(new ScriptedDrafter([]), "How is activation?");
    expect(events.at(-2)).toMatchObject({ kind: "unavailable" });
    expect(await storedAnswer()).toEqual([]);
  });
});
