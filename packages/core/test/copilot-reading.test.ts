/**
 * The copilot's reading step on all three answer paths (plan 0.9.0 L2b,
 * docs/design/copilot-live-data.md sections 3.1, 3.3 and 5).
 *
 * The drafter here is a stand-in that asks for reads through the callback core
 * gives it, so what is under test is the product's side of the loop: reads run
 * as the member, the records read become the answer's numbered sources, a
 * citation resolves to what was read and nothing else, and every way the loop
 * can give up leaves today's passage path exactly as it was. The provider side
 * of the loop (rounds, limits, cost) is `packages/agents/test/copilot-read-loop`.
 */
import type {
  AgentDrafter,
  ChosenReads,
  GroundedChunk,
  GroundedQuestionContext,
} from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { callRecorder } from "../src/ai/usage.ts";
import {
  answerQuestion,
  type CopilotEvent,
  copilotStepFrom,
  streamAnswer,
} from "../src/copilot/answer.ts";
import { drainReading, readLiveData } from "../src/copilot/reading.ts";
import { runEmbedJob } from "../src/embeddings/worker.ts";
import { dispatchOutbox } from "../src/outbox/handlers.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { CLOUD_ENABLED_KEY } from "../src/tenancy/index.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const PRIYA = "reading-priya";
const GUEST = "reading-guest";
const GOAL_TITLE = "Raise activation for mid-market teams";
const KR_TITLE = "Activation rate from 10 to 50";
const QUESTION = "How is the activation objective doing?";

let workspaceId: string;
let priyaMemberId: string;
let goalId: string;
let keyResultId: string;

type Read = (name: string, args: unknown) => Promise<string>;
type Script = (
  read: Read,
  beforeRound: () => Promise<boolean>,
  toolNames: readonly string[],
) => Promise<ChosenReads | null>;

const spent = (reads: number, limited = false): ChosenReads => ({
  reads,
  limited,
  costUsd: 0.02,
  tokensIn: 100,
  tokensOut: 10,
});

/** Reads the way a model would, then answers from what it was given. */
class ReadingDrafter implements AgentDrafter {
  readonly seen: GroundedQuestionContext[] = [];
  readonly results: string[] = [];
  readonly toolNames: string[] = [];
  readonly #script: Script;
  readonly #used: (context: GroundedQuestionContext) => readonly number[];

  /**
   * `used` says which sources the answer cites. By default the goal and its
   * key result, found by label, because the space a goal sits in is numbered
   * too and the positions are not worth hard-coding.
   */
  constructor(
    script: Script,
    used: (context: GroundedQuestionContext) => readonly number[] = (context) =>
      context.sources.flatMap((source, index) =>
        source.label === GOAL_TITLE || source.label === KR_TITLE ? [index] : [],
      ),
  ) {
    this.#script = script;
    this.#used = used;
  }

  async chooseReads(
    _context: unknown,
    tools: readonly { readonly name: string }[],
    read: Read,
    beforeRound: () => Promise<boolean>,
  ) {
    this.toolNames.push(...tools.map((tool) => tool.name));
    return this.#script(
      async (name, args) => {
        const text = await read(name, args);
        this.results.push(text);
        return text;
      },
      beforeRound,
      this.toolNames,
    );
  }

  async answerGrounded(context: GroundedQuestionContext) {
    this.seen.push(context);
    return {
      text: "It is on track.",
      usedSourceIndexes: this.#used(context),
      model: "test-model",
      tokensIn: 10,
      tokensOut: 20,
      costUsd: 0.01,
    };
  }

  async *streamGrounded(
    context: GroundedQuestionContext,
  ): AsyncIterable<GroundedChunk> {
    this.seen.push(context);
    yield { kind: "text", text: "It is on track." };
    yield {
      kind: "done",
      answer: {
        text: "It is on track.",
        usedSourceIndexes: this.#used(context),
        model: "test-model",
        tokensIn: 10,
        tokensOut: 20,
        costUsd: 0.01,
      },
    };
  }

  spentUsd() {
    return 0;
  }
}

/** The goal and its key result, listed then opened by number, as a model would. */
const readTheGoal: Script = async (read) => {
  await read("goals.list", {});
  await read("goals.read", { id: 1 });
  return spent(2);
};

/** A drafter with no read loop: the passage path alone. */
class PassagesOnlyDrafter implements AgentDrafter {
  readonly seen: GroundedQuestionContext[] = [];
  async answerGrounded(context: GroundedQuestionContext) {
    this.seen.push(context);
    return {
      text: "From the passages.",
      usedSourceIndexes: [0],
      costUsd: 0.01,
    };
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
    actor: { kind: "human" as const, userId: PRIYA },
    drafter,
  };
};

const call = async (name: string, input: unknown) =>
  callAction(await contextFor(), name as never, input as never);

/** The citations on the thread's last answer, as the reader would be shown them. */
const citationsOn = async (threadId: string) => {
  const thread = (await call("copilot.thread", { threadId })) as {
    messages: {
      role: string;
      citations: { entityType: string; entityId: string; label: string }[];
    }[];
  };
  return thread.messages.filter((m) => m.role === "assistant").at(-1)
    ?.citations;
};

const drainStream = async (drafter: AgentDrafter, signal?: AbortSignal) => {
  const events: CopilotEvent[] = [];
  for await (const event of streamAnswer(
    await contextFor(drafter),
    { workspaceId, question: QUESTION },
    signal,
  )) {
    events.push(event);
  }
  return events;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Priya', $2), ($3, 'Guest', $4)",
    [PRIYA, "priya-rd@example.com", GUEST, "guest-rd@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: PRIYA,
    name: "Priya",
  });
  workspaceId = provisioned.workspaceId;
  priyaMemberId = provisioned.memberId;

  // A guest holds no access through the blanket tiers, so it stands in for a
  // member who may not read the goal below.
  await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'Guest', 'guest', 'active')`,
    [workspaceId, GUEST],
  );

  const spaceId = ((await call("spaces.list", {})) as { id: string }[])[0]
    ?.id as string;
  const cycleId = (
    (await call("cycles.current", { mode: "quarterly" })) as { id: string }
  ).id;
  goalId = (
    (await call("goals.create", {
      title: GOAL_TITLE,
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: priyaMemberId,
      reviewerId: priyaMemberId,
      weight: 1,
    })) as { id: string }
  ).id;
  keyResultId = (
    (await call("goals.addKeyResult", {
      goalId,
      title: KR_TITLE,
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 10,
      targetValue: 50,
      weight: 1,
    })) as { id: string }
  ).id;
  await runEmbedJob(
    { workspaceId, entityType: "goal", entityId: goalId },
    { pool: wb.appPool, embed },
  );
}, 60_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a whole answer (the chat Ask path)", () => {
  it("answers from the records it read and cites them", async () => {
    const drafter = new ReadingDrafter(readTheGoal);
    const result = await answerQuestion(await contextFor(drafter), {
      workspaceId,
      question: QUESTION,
    });

    expect(result.answer).toBe("It is on track.");
    const ask = drafter.seen[0];
    expect(ask?.reading).toEqual({ reads: 2, limited: false });
    // The numbers the model saw are the positions: [1] is the goal, and its
    // key result comes after it.
    expect(ask?.sources[0]?.label).toBe(GOAL_TITLE);
    const keyResult = ask?.sources.find((one) => one.label === KR_TITLE);
    expect(keyResult).toBeDefined();
    expect(keyResult?.content).toContain("key result");
    // What the reader is shown links the goal and the key result.
    expect(result.sources.map((one) => one.entityType)).toEqual(
      expect.arrayContaining(["goal", "key_result"]),
    );
    const cited = await citationsOn(result.threadId);
    expect(cited?.map((one) => one.entityType).sort()).toEqual([
      "goal",
      "key_result",
    ]);
    expect(cited?.map((one) => one.label)).toContain(KR_TITLE);
  });

  it("offers every read tool and no identifier in what it hands the model", async () => {
    const drafter = new ReadingDrafter(readTheGoal);
    await answerQuestion(await contextFor(drafter), {
      workspaceId,
      question: QUESTION,
    });
    expect(drafter.toolNames).toHaveLength(13);
    expect(drafter.toolNames).toContain("goals.read");
    for (const text of drafter.results) {
      expect(text).not.toContain(goalId);
      expect(text).not.toContain(keyResultId);
    }
    const ask = drafter.seen[0];
    expect(JSON.stringify(ask?.sources)).not.toContain(goalId);
  });

  it("adds what the rounds cost to what the answer cost", async () => {
    const drafter = new ReadingDrafter(readTheGoal);
    await answerQuestion(await contextFor(drafter), {
      workspaceId,
      question: QUESTION,
    });
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      cost: string;
      tokens_in: number;
    }>(
      "select cost, tokens_in from ai_messages where role = 'assistant' limit 1",
    );
    expect(Number(rows[0]?.cost)).toBeCloseTo(0.03, 5);
    expect(rows[0]?.tokens_in).toBe(110);
  });

  it("tells the answer when a limit stopped the reading", async () => {
    const drafter = new ReadingDrafter(async (read) => {
      await read("goals.list", {});
      return spent(1, true);
    });
    await answerQuestion(await contextFor(drafter), {
      workspaceId,
      question: QUESTION,
    });
    expect(drafter.seen[0]?.reading).toEqual({ reads: 1, limited: true });
  });

  it("keeps the passage path when the drafter has no read loop", async () => {
    const drafter = new PassagesOnlyDrafter();
    const result = await answerQuestion(await contextFor(drafter), {
      workspaceId,
      question: QUESTION,
    });
    expect(result.answer).toBe("From the passages.");
    expect(drafter.seen[0]?.reading).toBeUndefined();
    expect(drafter.seen[0]?.sources[0]?.content).toContain(GOAL_TITLE);
  });

  it("keeps the passage path when the loop gives up (null)", async () => {
    const drafter = new ReadingDrafter(async () => null);
    await answerQuestion(await contextFor(drafter), {
      workspaceId,
      question: QUESTION,
    });
    expect(drafter.seen[0]?.reading).toBeUndefined();
    expect(drafter.seen[0]?.sources[0]?.content).toContain(GOAL_TITLE);
  });

  it("keeps the passage path when the first round throws", async () => {
    const drafter = new ReadingDrafter(async () => {
      throw new Error("the provider fell over");
    });
    const result = await answerQuestion(await contextFor(drafter), {
      workspaceId,
      question: QUESTION,
    });
    expect(result.answer).toBe("It is on track.");
    expect(drafter.seen[0]?.reading).toBeUndefined();
    expect(drafter.seen[0]?.sources[0]?.content).toContain(GOAL_TITLE);
  });

  it("keeps the passages when the model needed nothing read, and still counts the cost", async () => {
    const drafter = new ReadingDrafter(async () => spent(0));
    await answerQuestion(await contextFor(drafter), {
      workspaceId,
      question: QUESTION,
    });
    expect(drafter.seen[0]?.reading).toBeUndefined();
    expect(drafter.seen[0]?.sources[0]?.content).toContain(GOAL_TITLE);
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ cost: string }>(
      "select cost from ai_messages where role = 'assistant' limit 1",
    );
    expect(Number(rows[0]?.cost)).toBeCloseTo(0.03, 5);
  });

  it("answers a number the model was never shown with a refusal, and cites nothing", async () => {
    // A guest cannot ask the copilot at all, so the unreadable record is one
    // the member was never shown: the same sentence, and nothing to cite.
    const drafter = new ReadingDrafter(
      async (read) => {
        await read("goals.read", { id: 7 });
        return spent(1);
      },
      () => [0, 1, 2],
    );
    const result = await answerQuestion(await contextFor(drafter), {
      workspaceId,
      question: QUESTION,
    });
    expect(drafter.results).toEqual(["That is not something you were shown."]);
    expect(drafter.seen[0]?.sources).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(await citationsOn(result.threadId)).toEqual([]);
    expect(JSON.stringify(drafter.results)).not.toContain(GOAL_TITLE);
  });
});

describe("a streamed answer (the panel's inline path)", () => {
  it("yields a step per read, then the records as the sources, then the answer", async () => {
    const drafter = new ReadingDrafter(readTheGoal);
    const events = await drainStream(drafter);

    const kinds = events.map((event) =>
      event.kind === "step"
        ? `step:${event.step}${"tool" in event ? `:${event.tool}` : ""}`
        : event.kind,
    );
    const firstReading = kinds.indexOf("step:reading:goals.list");
    expect(firstReading).toBeGreaterThan(kinds.indexOf("step:found"));
    expect(kinds).toContain("step:reading:goals.read");
    expect(kinds.indexOf("step:writing")).toBeGreaterThan(
      kinds.indexOf("step:reading:goals.read"),
    );
    // A read of one record names it.
    const opened = events.find(
      (event) =>
        event.kind === "step" &&
        event.step === "reading" &&
        event.tool === "goals.read",
    );
    expect(opened).toMatchObject({ subject: GOAL_TITLE });

    const sources = events.filter((event) => event.kind === "sources");
    expect(sources).toHaveLength(2);
    const readSources = sources[1];
    expect(
      readSources?.kind === "sources" &&
        readSources.sources.map((one) => one.entityType),
    ).toEqual(expect.arrayContaining(["goal", "key_result"]));

    const done = events.at(-1);
    if (done?.kind !== "done") {
      throw new Error("no done event");
    }
    const cited = await citationsOn(
      (events[0] as { threadId: string }).threadId,
    );
    expect(cited?.map((one) => one.entityType).sort()).toEqual([
      "goal",
      "key_result",
    ]);
  });

  it("sends one sources event and no reading step when the loop cannot run", async () => {
    const drafter = new ReadingDrafter(async () => null);
    const events = await drainStream(drafter);
    expect(
      events.filter((event) => event.kind === "step").map((e) => e.step),
    ).not.toContain("reading");
    expect(events.filter((event) => event.kind === "sources")).toHaveLength(1);
  });
});

describe("a background run", () => {
  it("publishes a reading step per read and records the answer against what was read", async () => {
    const started = (await call("copilot.ask", {
      question: QUESTION,
      background: true,
    })) as { threadId: string };
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      topic: string;
      payload: Record<string, unknown>;
      idempotency_key: string;
    }>(
      "select topic, payload, idempotency_key from outbox where topic = 'copilot.run' order by created_at limit 1",
    );
    const row = rows[0];
    if (!row) {
      throw new Error("nothing enqueued a copilot run");
    }
    const drafter = new ReadingDrafter(readTheGoal);
    const published: { event: string; data?: Record<string, unknown> }[] = [];
    await dispatchOutbox(
      {
        topic: row.topic,
        payload: row.payload,
        idempotencyKey: row.idempotency_key,
        attempts: 0,
      },
      {
        pool: wb.appPool,
        drafterFor: async () => drafter,
        async publish(_channel, event, data) {
          published.push({ event, data });
        },
      },
    );

    const steps = published
      .filter((one) => one.event === "copilot.step")
      .map((one) => one.data);
    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: "reading", tool: "goals.list" }),
        expect.objectContaining({
          step: "reading",
          tool: "goals.read",
          subject: GOAL_TITLE,
        }),
      ]),
    );
    expect(drafter.seen[0]?.reading).toEqual({ reads: 2, limited: false });
    const cited = await citationsOn(started.threadId);
    expect(cited?.map((one) => one.entityType).sort()).toEqual([
      "goal",
      "key_result",
    ]);
  });
});

describe("a reading step off the wire", () => {
  it("passes a known tool with a bounded subject", () => {
    expect(
      copilotStepFrom({ step: "reading", tool: "goals.read", subject: "Grow" }),
    ).toEqual({ step: "reading", tool: "goals.read", subject: "Grow" });
    expect(copilotStepFrom({ step: "reading", tool: "goals.list" })).toEqual({
      step: "reading",
      tool: "goals.list",
    });
    const long = copilotStepFrom({
      step: "reading",
      tool: "tasks.read",
      subject: "x".repeat(500),
    });
    expect(long).toMatchObject({ step: "reading" });
    expect(long?.step === "reading" ? long.subject?.length : undefined).toBe(
      120,
    );
  });

  it("refuses a tool the copilot does not have, or none", () => {
    expect(
      copilotStepFrom({ step: "reading", tool: "people.erase" }),
    ).toBeNull();
    expect(copilotStepFrom({ step: "reading" })).toBeNull();
    expect(copilotStepFrom({ step: "reading", tool: 7 })).toBeNull();
  });
});

describe("a record the member may not read", () => {
  it("never reaches the model, the sources or the citations", async () => {
    // A guest cannot ask the copilot at all, so the shared step is driven
    // directly, as the guest, with the question already prepared.
    const wb = await workerDb();
    const drafter = new ReadingDrafter(async (read) => {
      await read("goals.list", {});
      await read("goals.read", { id: 1 });
      await read("passages", { query: GOAL_TITLE });
      return spent(3);
    });
    const outcome = await drainReading(
      readLiveData(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human" as const, userId: GUEST },
          drafter,
        },
        {
          threadId: "t",
          questionMessageId: "q",
          hits: [],
          cite: [],
          sources: [],
          ask: { question: QUESTION, history: [], sources: [] },
          unavailableReason: null,
        },
      ),
    );
    expect(drafter.results[0]).toBe("Nothing found.");
    expect(drafter.results[1]).toBe("That is not something you were shown.");
    expect(JSON.stringify(drafter.results)).not.toContain(GOAL_TITLE);
    expect(JSON.stringify(drafter.results)).not.toContain(KR_TITLE);
    expect(outcome?.reads).toBe(3);
    expect(outcome?.prepared.sources).toEqual([]);
    expect(outcome?.prepared.cite).toEqual([]);
    expect(outcome?.prepared.ask?.sources).toEqual([]);
  });
});

describe("a reader who has gone", () => {
  it("ends the loop before the next round when the signal is aborted", async () => {
    const controller = new AbortController();
    let askedAgain: boolean | null = null;
    const drafter = new ReadingDrafter(async (read, beforeRound) => {
      await read("goals.list", {});
      controller.abort();
      askedAgain = await beforeRound();
      if (askedAgain) {
        await read("goals.read", { id: 1 });
      }
      return spent(1, true);
    });
    await drainStream(drafter, controller.signal);
    expect(askedAgain).toBe(false);
    expect(drafter.results).toHaveLength(1);
  });
});

describe("credits used up by the reading", () => {
  const ring = parseKeyRing({ current: newRootKey() });

  /** A hosted workspace on the free plan: 100 credits, one dollar. */
  const goHosted = async () => {
    const wb = await workerDb();
    await wb.admin.query("delete from system_settings");
    await writeSettings(
      wb.appPool,
      ring,
      Object.entries({
        [CLOUD_ENABLED_KEY]: true,
        "cloud.plans": [
          { key: "free", name: "Free", seats: 10, aiCredits: 100 },
        ],
        "cloud.defaultPlan": "free",
      }).map(([key, value]) => ({ key, value })),
    );
    // The workspace was made before cloud mode, so it has no tenant record.
    await wb.admin.query(
      `insert into tenants (workspace_id, state, plan_key, region)
       values ($1, 'active', 'free', 'local')
       on conflict (workspace_id) do update set plan_key = 'free'`,
      [workspaceId],
    );
  };

  /** What the rounds spend: the last of the credits. */
  const spendAll = async () => {
    const wb = await workerDb();
    await callRecorder(wb.appPool, {
      workspaceId,
      provider: "anthropic",
      rates: { costInPerMillion: 1_000, costOutPerMillion: 0 },
      keySource: "deployment",
      forUser: PRIYA,
    })({ model: "m", usage: { inputTokens: 1000, outputTokens: 0 } });
  };

  const readThenSpend: Script = async (read) => {
    await read("goals.list", {});
    await spendAll();
    return spent(1);
  };

  afterAll(async () => {
    const wb = await workerDb();
    await wb.admin.query("delete from system_settings");
  });

  it("does not call the answer from a whole-answer path, and says why", async () => {
    await goHosted();
    const drafter = new ReadingDrafter(readThenSpend);
    const result = await answerQuestion(await contextFor(drafter), {
      workspaceId,
      question: QUESTION,
    });
    expect(result.answer).toBeNull();
    expect(result.unavailableReason).toMatch(/AI is paused/);
    expect(drafter.seen).toEqual([]);
  });

  it("does not stream the answer, and says why", async () => {
    await goHosted();
    const drafter = new ReadingDrafter(readThenSpend);
    const events = await drainStream(drafter);
    expect(drafter.seen).toEqual([]);
    expect(events.some((event) => event.kind === "text")).toBe(false);
    expect(events.find((event) => event.kind === "unavailable")).toMatchObject({
      reason: expect.stringMatching(/AI is paused/),
    });
  });

  it("halts a background run with the credits reason", async () => {
    await goHosted();
    await call("copilot.ask", { question: QUESTION, background: true });
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      topic: string;
      payload: Record<string, unknown>;
      idempotency_key: string;
    }>(
      "select topic, payload, idempotency_key from outbox where topic = 'copilot.run' order by created_at limit 1",
    );
    const row = rows[0];
    if (!row) {
      throw new Error("nothing enqueued a copilot run");
    }
    const drafter = new ReadingDrafter(readThenSpend);
    const published: { event: string; data?: Record<string, unknown> }[] = [];
    await dispatchOutbox(
      {
        topic: row.topic,
        payload: row.payload,
        idempotencyKey: row.idempotency_key,
        attempts: 0,
      },
      {
        pool: wb.appPool,
        drafterFor: async () => drafter,
        async publish(_channel, event, data) {
          published.push({ event, data });
        },
      },
    );
    expect(drafter.seen).toEqual([]);
    const done = published.find((one) => one.event === "copilot.done");
    expect(String(done?.data?.haltedReason)).toMatch(/AI is paused/);
  });
});
