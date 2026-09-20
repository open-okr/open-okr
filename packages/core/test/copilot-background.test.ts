/**
 * A copilot run that outlives the request that asked for it (P4-T14b-b).
 *
 * The task's test plan, both lines: **a background run survives a page
 * reload**, and **a run whose budget is spent halts and says so.**
 *
 * **What "survives a page reload" means here.** A reload is not something a
 * unit test can perform, and there is nothing to perform: the whole point of
 * the row is that the run is not attached to a request at all. What decides
 * it is whether the state a returning page reads is there, and whether a run
 * driven with nobody watching still lands. Both are asserted directly. The
 * browser half, the panel rejoining the stream, is
 * `e2e/s39-copilot-background.spec.ts`.
 *
 * **The run is driven the way the relay drives it**, through
 * `dispatchOutbox`, rather than by calling `runCopilotAnswer` and hoping the
 * handler is wired the same way. A row enqueued with no handler dead-letters,
 * and a test that skipped the dispatcher would not notice.
 */
import type { AgentDrafter, GroundedQuestionContext } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { runEmbedJob } from "../src/embeddings/worker.ts";
import { dispatchOutbox } from "../src/outbox/handlers.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "background-owner";
const QUESTION = "What is the plan for mid-market activation?";

let workspaceId: string;
let ownerMemberId: string;

/** Answers whole, which is what the drafter port offers. */
class FixedDrafter implements AgentDrafter {
  readonly seen: GroundedQuestionContext[] = [];
  #text: string;
  #costUsd: number;

  constructor(text: string, costUsd = 0.01) {
    this.#text = text;
    this.#costUsd = costUsd;
  }

  async answerGrounded(context: GroundedQuestionContext) {
    this.seen.push(context);
    return {
      text: this.#text,
      usedSourceIndexes: [0],
      model: "test-model",
      tokensIn: 10,
      tokensOut: 20,
      costUsd: this.#costUsd,
    };
  }

  spentUsd() {
    return 0;
  }
}

/** A provider having a bad minute. */
class BrokenDrafter implements AgentDrafter {
  async answerGrounded(): Promise<never> {
    throw new Error("the provider fell over");
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

const contextFor = async () => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: OWNER },
  };
};

const call = async (name: string, input: unknown) =>
  callAction(await contextFor(), name as never, input as never);

/** The outbox rows this topic has, oldest first. */
const enqueued = async (topic: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    topic: string;
    payload: Record<string, unknown>;
    idempotency_key: string;
  }>(
    "select id, topic, payload, idempotency_key from outbox where topic = $1 order by created_at",
    [topic],
  );
  return rows;
};

/** The assistant messages in the thread, oldest first. */
const answers = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    content: string;
    run_started_at: Date | null;
    run_completed_at: Date | null;
    run_halted_reason: string | null;
    cost: string | null;
  }>(
    `select id, content, run_started_at, run_completed_at, run_halted_reason,
            cost
       from ai_messages
      where role = 'assistant'
      order by created_at`,
  );
  return rows;
};

/** Drives the enqueued run the way the relay does, and collects what it published. */
const drive = async (
  drafter: AgentDrafter | null,
  options: { readonly skipped?: string[] } = {},
) => {
  const wb = await workerDb();
  const [row] = await enqueued("copilot.run");
  if (!row) {
    throw new Error("nothing enqueued a copilot run");
  }
  const published: { channel: string; event: string }[] = [];
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
      async publish(channel, event) {
        published.push({ channel, event });
      },
      onSkipped: (_delivery, reason) => options.skipped?.push(reason),
    },
  );
  return published;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', $2)",
    [OWNER, "background-owner@example.com"],
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
  const goalId = (
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
    { pool: wb.appPool, embed },
  );
}, 60_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("asking for a background run", () => {
  it("writes the question, the empty answer and the job in one transaction", async () => {
    const started = (await call("copilot.ask", {
      question: QUESTION,
      background: true,
    })) as { threadId: string; messageId: string; answerMessageId: string };

    expect(started.answerMessageId).toBeTruthy();

    // The row a returning page reads. It exists before any prose does, which
    // is what makes there be something to come back to.
    const [answer] = await answers();
    expect(answer?.id).toBe(started.answerMessageId);
    expect(answer?.content).toBe("");
    expect(answer?.run_started_at).not.toBeNull();
    expect(answer?.run_completed_at).toBeNull();

    const [job] = await enqueued("copilot.run");
    expect(job?.payload).toMatchObject({
      workspaceId,
      threadId: started.threadId,
      questionMessageId: started.messageId,
      answerMessageId: started.answerMessageId,
      userId: OWNER,
      question: QUESTION,
    });
  });

  it("enqueues nothing when it is not a background run", async () => {
    await call("copilot.ask", { question: QUESTION });

    expect(await enqueued("copilot.run")).toEqual([]);
    expect(await answers()).toEqual([]);
  });

  it("says the answer is still being written, until it is not", async () => {
    const started = (await call("copilot.ask", {
      question: QUESTION,
      background: true,
    })) as { threadId: string };

    const before = (await call("copilot.thread", {
      threadId: started.threadId,
    })) as { messages: { role: string; running: boolean }[] };
    expect(
      before.messages.find((one) => one.role === "assistant")?.running,
    ).toBe(true);

    await drive(new FixedDrafter("Activation is the quarter's first goal."));

    const after = (await call("copilot.thread", {
      threadId: started.threadId,
    })) as { messages: { role: string; running: boolean; content: string }[] };
    const answer = after.messages.find((one) => one.role === "assistant");
    expect(answer?.running).toBe(false);
    expect(answer?.content).toBe("Activation is the quarter's first goal.");
  });
});

describe("the run, with nobody watching", () => {
  it("lands the answer and publishes it on the thread's channel", async () => {
    const started = (await call("copilot.ask", {
      question: QUESTION,
      background: true,
    })) as { threadId: string };

    const published = await drive(new FixedDrafter("Sixty per cent by June."));

    // The whole point of the row: nothing here is attached to a request, and
    // the answer lands anyway.
    const [answer] = await answers();
    expect(answer?.content).toBe("Sixty per cent by June.");
    expect(answer?.run_completed_at).not.toBeNull();
    expect(answer?.run_halted_reason).toBeNull();
    expect(answer?.cost).toBe("0.010000");

    expect(published.map((one) => one.event)).toEqual([
      "copilot.sources",
      "copilot.text",
      "copilot.done",
    ]);
    for (const one of published) {
      expect(one.channel).toBe(
        `workspace:${workspaceId}:copilot:${started.threadId}`,
      );
    }
  });

  it("is safe to run twice, because the relay delivers at least once", async () => {
    await call("copilot.ask", { question: QUESTION, background: true });

    const drafter = new FixedDrafter("Once.");
    await drive(drafter);
    await drive(new FixedDrafter("Twice."));

    // One answer, and it is the first one. A second delivery finding the work
    // done is the arrangement working rather than a second answer charged to
    // the workspace.
    const rows = await answers();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe("Once.");
  });

  it("says so when the provider will not answer", async () => {
    await call("copilot.ask", { question: QUESTION, background: true });

    const skipped: string[] = [];
    await drive(new BrokenDrafter(), { skipped });

    const [answer] = await answers();
    expect(answer?.run_completed_at).not.toBeNull();
    expect(answer?.run_halted_reason).toContain("did not answer");
    // Not left in flight. A run that stopped and still said "still writing"
    // is a reader waiting for ever.
    expect(answer?.content).toBe("");
    expect(skipped[0]).toContain("did not answer");
  });

  it("says so when there is no provider at all", async () => {
    await call("copilot.ask", { question: QUESTION, background: true });

    await drive(null);

    const [answer] = await answers();
    expect(answer?.run_halted_reason).toContain("No AI provider is configured");
    expect(answer?.run_completed_at).not.toBeNull();
  });
});

describe("the budget", () => {
  it("halts before starting when a run may not spend, and says so", async () => {
    const wb = await workerDb();
    // Zero is a real answer and means the agent may not spend, which is the
    // opposite of unset.
    await wb.admin.query(
      "update workspaces set settings = jsonb_set(settings, '{agentRunCostCapUsd}', '0') where id = $1",
      [workspaceId],
    );

    await call("copilot.ask", { question: QUESTION, background: true });

    const drafter = new FixedDrafter("This should never be produced.");
    const skipped: string[] = [];
    await drive(drafter, { skipped });

    // Not a token spent: the drafter was never called.
    expect(drafter.seen).toEqual([]);
    const [answer] = await answers();
    expect(answer?.run_halted_reason).toContain("may not spend");
    expect(answer?.run_completed_at).not.toBeNull();
    expect(skipped[0]).toContain("may not spend");
  });

  it("says the budget is spent when an answer cost more than the cap", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspaces set settings = jsonb_set(settings, '{agentRunCostCapUsd}', '0.001') where id = $1",
      [workspaceId],
    );

    await call("copilot.ask", { question: QUESTION, background: true });
    await drive(new FixedDrafter("An expensive answer.", 5));

    const [answer] = await answers();
    // The answer is kept: the money is already spent and throwing it away
    // would charge the workspace for nothing.
    expect(answer?.content).toBe("An expensive answer.");
    expect(answer?.run_halted_reason).toContain("will halt before starting");
  });
});
