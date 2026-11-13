/**
 * The record of the copilot's reads (plan 0.9.0 L3, docs/design/
 * copilot-live-data.md 3.6 and acceptance 10, decision D6).
 *
 * Every read the loop makes is a row in `ai_tool_calls` with `source =
 * 'copilot'`, the asking member and no grant or token. Nothing the model sent
 * or the read returned is stored. The line under an answer is rebuilt from the
 * rows after a reload, and an administrator lists them with the member.
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
import { answerQuestion } from "../src/copilot/answer.ts";
import { recordCopilotRead } from "../src/copilot/read-record.ts";
import type { ReadResult } from "../src/copilot/read-tools.ts";
import { runEmbedJob } from "../src/embeddings/worker.ts";
import { dispatchOutbox } from "../src/outbox/handlers.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const PRIYA = "record-priya";
const BO = "record-bo";
const BO_MEMBER = "00000000-0000-4000-8000-0000000000b0";
const GOAL_TITLE = "Raise activation for mid-market teams";
const QUESTION = "How is the activation objective doing?";

let workspaceId: string;
let priyaMemberId: string;
let goalId: string;

type Read = (name: string, args: unknown) => Promise<string>;

/** Reads the goal list, opens the goal and tries a tool the copilot lacks. */
class ReadingDrafter implements AgentDrafter {
  readonly #extra: boolean;
  constructor(extra = false) {
    this.#extra = extra;
  }
  async chooseReads(
    _context: unknown,
    _tools: unknown,
    read: Read,
  ): Promise<ChosenReads> {
    await read("goals.list", {});
    await read("goals.read", { id: 1 });
    if (this.#extra) {
      await read("drop table goals", { query: "secret search words" });
    }
    return {
      reads: this.#extra ? 3 : 2,
      limited: false,
      costUsd: 0,
      tokensIn: 1,
      tokensOut: 1,
    };
  }
  async answerGrounded(context: GroundedQuestionContext) {
    return {
      text: "It is on track.",
      usedSourceIndexes: context.sources.map((_, index) => index),
      costUsd: 0,
    };
  }
  async *streamGrounded(
    context: GroundedQuestionContext,
  ): AsyncIterable<GroundedChunk> {
    yield { kind: "text", text: "It is on track." };
    yield {
      kind: "done",
      answer: {
        text: "It is on track.",
        usedSourceIndexes: context.sources.map((_, index) => index),
        costUsd: 0,
      },
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

interface Row {
  source: string;
  member_id: string;
  grant_id: string | null;
  token_id: string | null;
  tool: string | null;
  scope: string | null;
  outcome: string;
  refusal_code: string | null;
  target_ids: string[];
  whole: string;
}

const rows = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<Row>(
    "select source, member_id, grant_id, token_id, tool, scope, outcome, refusal_code, target_ids, row_to_json(c)::text as whole from ai_tool_calls c where workspace_id = $1 order by called_at, id",
    [workspaceId],
  );
  return rows;
};

const answers = async (threadId: string) =>
  (
    (await call("copilot.thread", { threadId })) as {
      messages: { role: string; readCount: number }[];
    }
  ).messages;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Priya', $2), ($3, 'Bo', $4)",
    [PRIYA, "priya-rec@example.com", BO, "bo-rec@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: PRIYA,
    name: "Priya",
  });
  workspaceId = provisioned.workspaceId;
  priyaMemberId = provisioned.memberId;
  await wb.admin.query(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
     values ($1, $2, $3, 'Bo', 'guest', 'active')`,
    [BO_MEMBER, workspaceId, BO],
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
  await runEmbedJob(
    { workspaceId, entityType: "goal", entityId: goalId },
    { pool: wb.appPool, embed },
  );
}, 60_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("what the loop records", () => {
  it("writes one row per read, as the member, with no grant or token", async () => {
    await answerQuestion(await contextFor(new ReadingDrafter()), {
      workspaceId,
      question: QUESTION,
    });
    const recorded = await rows();
    expect(recorded).toHaveLength(2);
    for (const row of recorded) {
      expect(row.source).toBe("copilot");
      expect(row.member_id).toBe(priyaMemberId);
      expect(row.grant_id).toBeNull();
      expect(row.token_id).toBeNull();
      expect(row.scope).toBe("read");
      expect(row.outcome).toBe("ok");
    }
    expect(recorded.map((row) => row.tool)).toEqual([
      "goals.list",
      "goals.read",
    ]);
    // The one record a read opened, by id, and nothing else.
    expect(recorded[1]?.target_ids).toEqual([goalId]);
    expect(recorded[0]?.target_ids).toEqual([]);
  });

  it("stores no argument, no result and no title, and keeps an unknown tool's name out", async () => {
    await answerQuestion(await contextFor(new ReadingDrafter(true)), {
      workspaceId,
      question: QUESTION,
    });
    const recorded = await rows();
    expect(recorded).toHaveLength(3);
    const unknown = recorded[2];
    expect(unknown?.outcome).toBe("unknown_tool");
    expect(unknown?.tool).toBeNull();
    expect(unknown?.scope).toBeNull();
    const everything = recorded.map((row) => row.whole).join("\n");
    expect(everything).not.toContain(GOAL_TITLE);
    expect(everything).not.toContain("secret search words");
    expect(everything).not.toContain("drop table");
  });

  it("records a refused read with its code, and never the sentence", async () => {
    const refused: ReadResult = {
      text: "Nothing found.",
      entities: [],
      outcome: "refused",
      refusalCode: "forbidden",
      durationMs: 3,
      tool: "goals.read",
    };
    await recordCopilotRead((await workerDb()).appPool, {
      workspaceId,
      memberId: priyaMemberId,
      result: refused,
    });
    const [row] = await rows();
    expect(row?.outcome).toBe("refused");
    expect(row?.refusal_code).toBe("forbidden");
    expect(row?.whole).not.toContain("Nothing found");
  });

  it("never fails the answer when the record cannot be written", async () => {
    const result = await recordCopilotRead((await workerDb()).appPool, {
      workspaceId,
      // A member that does not exist: the foreign key refuses the insert.
      memberId: "00000000-0000-4000-8000-00000000dead",
      result: {
        text: "x",
        entities: [],
        outcome: "ok",
        durationMs: 1,
        tool: "goals.list",
      },
    });
    expect(result).toBeUndefined();
    expect(await rows()).toHaveLength(0);
  });
});

describe("the line under an answer after a reload", () => {
  it("counts the reads behind each recorded answer, and none for a question", async () => {
    const first = await answerQuestion(await contextFor(new ReadingDrafter()), {
      workspaceId,
      question: QUESTION,
    });
    const second = await answerQuestion(
      await contextFor(new ReadingDrafter(true)),
      { workspaceId, question: QUESTION, threadId: first.threadId },
    );
    expect(second.threadId).toBe(first.threadId);
    const messages = await answers(first.threadId);
    expect(messages.map((one) => [one.role, one.readCount])).toEqual([
      ["member", 0],
      ["assistant", 2],
      ["member", 0],
      // The unknown tool's row has no tool, so the line does not count it,
      // as the live line labels only the copilot's own tools.
      ["assistant", 2],
    ]);
  });

  it("ends a run that never finished at the next question in its thread", async () => {
    const wb = await workerDb();
    const started = (await call("copilot.ask", {
      question: QUESTION,
      background: true,
    })) as { threadId: string };
    const readAt = async () =>
      wb.admin.query(
        `insert into ai_tool_calls (workspace_id, member_id, source, tool, scope, outcome, duration_ms)
         values ($1, $2, 'copilot', 'goals.list', 'read', 'ok', 4)`,
        [workspaceId, priyaMemberId],
      );
    await readAt();
    await new Promise((resolve) => setTimeout(resolve, 30));
    // The process died: the run is still marked running. A later question in
    // the same thread, and a read made for it, must not be the dead run's.
    await call("copilot.ask", {
      question: "And the next one?",
      threadId: started.threadId,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await readAt();
    await readAt();
    await call("copilot.recordAnswer", {
      threadId: started.threadId,
      text: "Two reads.",
    });
    const messages = await answers(started.threadId);
    const counts = messages
      .filter((one) => one.role === "assistant")
      .map((one) => one.readCount);
    expect(counts).toEqual([1, 2]);
  });

  it("counts a background run's reads once it has finished", async () => {
    const started = (await call("copilot.ask", {
      question: QUESTION,
      background: true,
    })) as { threadId: string };
    const wb = await workerDb();
    const { rows: queued } = await wb.admin.query<{
      topic: string;
      payload: Record<string, unknown>;
      idempotency_key: string;
    }>(
      "select topic, payload, idempotency_key from outbox where topic = 'copilot.run' order by created_at limit 1",
    );
    const job = queued[0];
    if (!job) {
      throw new Error("nothing enqueued a copilot run");
    }
    await dispatchOutbox(
      {
        topic: job.topic,
        payload: job.payload,
        idempotencyKey: job.idempotency_key,
        attempts: 0,
      },
      {
        pool: wb.appPool,
        drafterFor: async () => new ReadingDrafter(),
        async publish() {},
      },
    );
    const messages = await answers(started.threadId);
    // The question and the empty answer a background run starts with share a
    // `created_at`, so their order in the list is the id's, not a given.
    const answer = messages.find((one) => one.role === "assistant");
    expect(answer?.readCount).toBe(2);
    expect(messages.find((one) => one.role === "member")?.readCount).toBe(0);
  });

  it("says 0 for an answer that read nothing", async () => {
    const { threadId } = (await call("copilot.ask", {
      question: QUESTION,
    })) as { threadId: string };
    await call("copilot.recordAnswer", { threadId, text: "From passages." });
    expect((await answers(threadId)).map((one) => one.readCount)).toEqual([
      0, 0,
    ]);
  });
});

describe("what an administrator sees", () => {
  it("lists each copilot read with the member, the tool, the outcome and the time", async () => {
    await answerQuestion(await contextFor(new ReadingDrafter()), {
      workspaceId,
      question: QUESTION,
    });
    const summary = (await call("ai.readToolCallSummary", {})) as {
      calls: number;
      busiestTools: unknown[];
      copilot: {
        calls: number;
        refused: number;
        recent: {
          member: string;
          tool: string | null;
          outcome: string;
          calledAt: string;
        }[];
      };
    };
    expect(summary.copilot.calls).toBe(2);
    expect(summary.copilot.refused).toBe(0);
    expect(summary.copilot.recent).toHaveLength(2);
    expect(summary.copilot.recent.map((row) => row.tool).sort()).toEqual([
      "goals.list",
      "goals.read",
    ]);
    for (const read of summary.copilot.recent) {
      expect(read.member).toBe("Priya");
      expect(read.outcome).toBe("ok");
      expect(Number.isNaN(Date.parse(read.calledAt))).toBe(false);
    }
    // External agents are still counted apart: the copilot is not one.
    expect(summary.calls).toBe(0);
    expect(summary.busiestTools).toEqual([]);
  });
});

describe("erasing a member", () => {
  it("removes the copilot's reads made for them", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into ai_tool_calls (workspace_id, member_id, source, tool, scope, outcome, duration_ms)
       values ($1, $2, 'copilot', 'goals.list', 'read', 'ok', 4)`,
      [workspaceId, BO_MEMBER],
    );
    await answerQuestion(await contextFor(new ReadingDrafter()), {
      workspaceId,
      question: QUESTION,
    });
    await call("people.erase", { memberId: BO_MEMBER });
    const left = await rows();
    expect(left.some((row) => row.member_id === BO_MEMBER)).toBe(false);
    // Priya's own reads are untouched.
    expect(left.filter((row) => row.member_id === priyaMemberId)).toHaveLength(
      2,
    );
  });
});

describe("the table's checks", () => {
  const insert = async (columns: string, values: string) => {
    const wb = await workerDb();
    return wb.admin.query(
      `insert into ai_tool_calls (workspace_id, member_id, ${columns}, outcome, duration_ms)
       values ($1, $2, ${values}, 'ok', 1)`,
      [workspaceId, priyaMemberId],
    );
  };

  it("refuses a copilot row that names a connection", async () => {
    const wb = await workerDb();
    const token = await wb.admin.query<{ id: string }>(
      `insert into api_tokens (id, workspace_id, member_id, name, audience, token_hash, prefix, scopes)
       values (gen_random_uuid(), $1, $2, 't', 'mcp', 'hash-rec', 'okr_', array['read']) returning id`,
      [workspaceId, priyaMemberId],
    );
    await expect(
      insert("source, token_id", `'copilot', '${token.rows[0]?.id}'`),
    ).rejects.toThrow(/ai_tool_calls_one_connection/);
  });

  it("refuses an agent row with no connection, and accepts a copilot row with none", async () => {
    await expect(insert("source", "'mcp'")).rejects.toThrow(
      /ai_tool_calls_one_connection/,
    );
    await expect(insert("source", "'copilot'")).resolves.toBeDefined();
  });

  it("refuses a source it does not know", async () => {
    await expect(insert("source", "'channel'")).rejects.toThrow(
      /violates check constraint/,
    );
  });
});
