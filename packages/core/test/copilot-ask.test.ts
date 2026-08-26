/**
 * Grounded question answering (AI-NATIVE-PLAN.md §2.4, P4-T14a-a).
 *
 * The task's test plan line this file owns: **a citation never points at
 * something the viewer cannot read.** The stop control is P4-T14a-b's.
 *
 * That guarantee is made twice over, and both halves are asserted here.
 *
 * 1. **By construction.** The model is shown retrieved passages positionally and
 *    is never given an identifier, so a citation it produces can only name
 *    something retrieval already found for this member. An index outside the
 *    list resolves to nothing rather than to a row.
 * 2. **At read time.** The stored citation is the answer's claim about what it
 *    used, and access is asked again on every read. A member who could read a
 *    goal when they asked, and cannot now, is shown the prose and not the
 *    source.
 *
 * **The refusal used is deletion, not suspension**, and that is not a
 * convenience. P3-T01's `workspace_standard` binding gives every active member
 * `edit` across the workspace, so "a goal in a space they are not in" is not a
 * refusal this product has and a test asserting it would pass for the wrong
 * reason. A suspended member cannot read their own thread at all, which is
 * asserted separately and is a different guarantee.
 *
 * Every retrieval here takes the full-text path: this machine has no pgvector,
 * and no embed function is given to the answering context. That is
 * AI-NATIVE-PLAN §2.4's own stated degradation, so it is the path a self-hosted
 * instance with no API key runs on.
 */
import type {
  AgentDrafter,
  GroundedAnswer,
  GroundedQuestionContext,
} from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { answerQuestion } from "../src/copilot/answer.ts";
import { runEmbedJob } from "../src/embeddings/worker.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "copilot-owner";
const OTHER = "copilot-other";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let ownerMemberId: string;
let otherMemberId: string;
let goalId: string;

/** A stand-in provider. Every call is recorded so the prompt can be asserted. */
class StubDrafter implements AgentDrafter {
  readonly seen: GroundedQuestionContext[] = [];
  #answer: GroundedAnswer | null;
  #throws = false;

  constructor(answer: GroundedAnswer | null) {
    this.#answer = answer;
  }

  set answer(next: GroundedAnswer | null) {
    this.#answer = next;
  }

  throwNext() {
    this.#throws = true;
  }

  async answerGrounded(context: GroundedQuestionContext) {
    this.seen.push(context);
    if (this.#throws) {
      this.#throws = false;
      throw new Error("the provider fell over");
    }
    return this.#answer;
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

const contextFor = async (userId = OWNER, drafter?: AgentDrafter) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
    drafter,
  };
};

const call = async (name: string, input: unknown, userId = OWNER) =>
  callAction(await contextFor(userId), name as never, input as never);

const ask = async (
  question: string,
  drafter?: AgentDrafter,
  extra: Record<string, unknown> = {},
) =>
  answerQuestion(await contextFor(OWNER, drafter), {
    workspaceId,
    question,
    ...extra,
  });

/** Indexes one entity the way the outbox relay would. */
const indexEntity = async (entityType: string, entityId: string) => {
  const wb = await workerDb();
  return runEmbedJob(
    { workspaceId, entityType, entityId },
    { pool: wb.appPool, embed },
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Owner', $2), ($3, 'Other', $4)`,
    [OWNER, "copilot-owner@example.com", OTHER, "copilot-other@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  cycleId = (
    (await call("cycles.current", { mode: "quarterly" })) as { id: string }
  ).id;

  const other = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Other', 'active') returning id`,
    [workspaceId, OTHER],
  );
  otherMemberId = other.rows[0]?.id as string;
  await call("spaces.addMember", {
    spaceId,
    memberId: otherMemberId,
    role: "member",
  });

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
  await indexEntity("goal", goalId);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the AI-off state, which is what a self-hosted instance gets", () => {
  it("records the question and answers with the passages retrieval found", async () => {
    const result = await ask("What is happening with mid-market activation?");

    expect(result.answer).toBeNull();
    expect(result.answerMessageId).toBeNull();
    expect(result.unavailableReason).toContain("No AI provider");
    // §2.4's degradation is not an empty screen. The passages are the answer.
    expect(result.sources.map((source) => source.entityId)).toEqual([goalId]);
    expect(result.sources[0]?.label).toBe(
      "Raise mid-market activation to sixty per cent",
    );

    // And the question is on the record, because it was asked.
    const thread = (await call("copilot.thread", {
      threadId: result.threadId,
    })) as { messages: { role: string; content: string }[]; title: string };
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]?.role).toBe("member");
    expect(thread.title).toBe("What is happening with mid-market activation?");
  });

  it("says the copilot is unavailable and that search still is", async () => {
    const availability = (await call("copilot.availability", {})) as {
      available: boolean;
      providerConfigured: boolean;
      reason: string | null;
      searchAvailable: boolean;
    };
    expect(availability.available).toBe(false);
    expect(availability.providerConfigured).toBe(false);
    expect(availability.searchAvailable).toBe(true);
    expect(availability.reason).toContain("No AI provider");
  });

  it("reports available once a provider can answer", async () => {
    const drafter = new StubDrafter({ text: "yes", usedSourceIndexes: [] });
    const availability = (await callAction(
      await contextFor(OWNER, drafter),
      "copilot.availability" as never,
      {} as never,
    )) as { available: boolean; providerConfigured: boolean };
    expect(availability).toMatchObject({
      available: true,
      providerConfigured: true,
    });
  });

  it("keeps the question when the provider throws", async () => {
    const drafter = new StubDrafter({
      text: "Activation is at 41 per cent.",
      usedSourceIndexes: [0],
    });
    drafter.throwNext();

    const result = await ask("How is activation?", drafter);
    expect(result.answer).toBeNull();
    expect(result.unavailableReason).toContain("did not answer");
    expect(result.sources).toHaveLength(1);

    const thread = (await call("copilot.thread", {
      threadId: result.threadId,
    })) as { messages: unknown[] };
    expect(thread.messages).toHaveLength(1);
  });

  it("treats a switched-off feature the same as no provider", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into ai_feature_settings (id, workspace_id, feature_key, enabled)
       values (gen_random_uuid(), $1, 'copilot.ask', false)`,
      [workspaceId],
    );

    const drafter = new StubDrafter({ text: "no", usedSourceIndexes: [] });
    const result = await ask("How is activation?", drafter);
    expect(result.answer).toBeNull();
    expect(result.unavailableReason).toContain("turned off");
    // The model was never asked, so nothing was spent finding that out.
    expect(drafter.seen).toHaveLength(0);
  });
});

describe("a grounded answer", () => {
  it("records the prose, the citation and what the turn cost", async () => {
    const drafter = new StubDrafter({
      text: "Activation is at 41 per cent against a target of sixty.",
      usedSourceIndexes: [0],
      model: "stub-1",
      tokensIn: 900,
      tokensOut: 40,
      costUsd: 0.0123,
    });

    const result = await ask("How is mid-market activation?", drafter);
    expect(result.answer).toContain("41 per cent");
    expect(result.answerMessageId).not.toBeNull();

    const thread = (await call("copilot.thread", {
      threadId: result.threadId,
    })) as {
      messages: {
        role: string;
        citations: { entityType: string; entityId: string; label: string }[];
        model: string | null;
        tokensIn: number | null;
        tokensOut: number | null;
        cost: string | null;
        stopped: boolean;
      }[];
    };
    expect(thread.messages).toHaveLength(2);
    const answer = thread.messages[1];
    expect(answer?.role).toBe("assistant");
    expect(answer?.citations).toEqual([
      {
        entityType: "goal",
        entityId: goalId,
        label: "Raise mid-market activation to sixty per cent",
      },
    ]);
    expect(answer?.model).toBe("stub-1");
    expect(answer?.tokensIn).toBe(900);
    expect(answer?.tokensOut).toBe(40);
    // A decimal string, not a float: §7 asks for the cost of the turn, and
    // rounding it through a double is how a cost report stops adding up.
    expect(answer?.cost).toBe("0.012300");
    expect(answer?.stopped).toBe(false);
  });

  it("shows the model passages and no identifiers", async () => {
    const drafter = new StubDrafter({
      text: "It is fine.",
      usedSourceIndexes: [],
    });
    await ask("How is mid-market activation?", drafter);

    const shown = drafter.seen[0];
    expect(shown?.sources).toHaveLength(1);
    expect(shown?.sources[0]?.label).toBe(
      "Raise mid-market activation to sixty per cent",
    );
    // The whole reason citations come back positional: there is no id here for
    // a model to copy, alter or invent.
    expect(JSON.stringify(shown?.sources)).not.toContain(goalId);
  });

  it("carries the earlier turns into a follow-up", async () => {
    const drafter = new StubDrafter({
      text: "It is at 41 per cent.",
      usedSourceIndexes: [0],
    });
    const first = await ask("How is activation?", drafter);
    await ask("And why?", drafter, { threadId: first.threadId });

    const followUp = drafter.seen[1];
    expect(followUp?.question).toBe("And why?");
    expect(followUp?.history).toEqual([
      { role: "member", content: "How is activation?" },
      { role: "assistant", content: "It is at 41 per cent." },
    ]);
  });
});

describe("a citation never points at something the viewer cannot read", () => {
  const answering = () =>
    new StubDrafter({
      text: "Activation is behind.",
      usedSourceIndexes: [0],
      model: "stub-1",
    });

  it("drops an index the model made up", async () => {
    const drafter = new StubDrafter({
      text: "Activation is behind.",
      // One passage was shown. Four, minus one and a fraction are all a model
      // miscounting, and none of them resolves to a row.
      usedSourceIndexes: [4, -1, 0.5],
    });

    const result = await ask("How is activation?", drafter);
    const thread = (await call("copilot.thread", {
      threadId: result.threadId,
    })) as { messages: { citations: unknown[] }[] };
    expect(thread.messages[1]?.citations).toEqual([]);
  });

  it("withholds a cited goal that has been deleted since the answer", async () => {
    const wb = await workerDb();
    const result = await ask("How is activation?", answering());
    const before = (await call("copilot.thread", {
      threadId: result.threadId,
    })) as { messages: { content: string; citations: unknown[] }[] };
    expect(before.messages[1]?.citations).toHaveLength(1);

    // Soft-deleted, which is this repository's default scope. The citation row
    // still says what the answer used; the reader is no longer shown it.
    await wb.admin.query("update goals set deleted_at = now() where id = $1", [
      goalId,
    ]);

    const after = (await call("copilot.thread", {
      threadId: result.threadId,
    })) as { messages: { content: string; citations: unknown[] }[] };
    // The prose stands. It was true when it was written, and rewriting history
    // is not this module's job.
    expect(after.messages[1]?.content).toBe("Activation is behind.");
    expect(after.messages[1]?.citations).toEqual([]);
    // Nothing was rewritten to achieve that: it is a read-time decision.
    const stored = await wb.admin.query<{ citations: unknown[] }>(
      "select citations from ai_messages where role = 'assistant'",
    );
    expect(stored.rows[0]?.citations).toHaveLength(1);
  });

  it("refuses to store a citation nothing can ever resolve", async () => {
    const result = await ask("How is activation?");
    await call("copilot.recordAnswer", {
      threadId: result.threadId,
      text: "From somewhere.",
      citations: [
        { entityType: "goal", entityId: goalId },
        // Not in the embeddable set, so the citation resolver cannot label it
        // and `mayRead` would withhold it anyway. Dropped at the write.
        { entityType: "workspace_member", entityId: otherMemberId },
      ],
    });

    const wb = await workerDb();
    const stored = await wb.admin.query<{
      citations: { entityType: string }[];
    }>("select citations from ai_messages where role = 'assistant'");
    expect(stored.rows[0]?.citations).toEqual([
      { entityType: "goal", entityId: goalId },
    ]);
  });
});

describe("a thread belongs to one member", () => {
  it("does not exist for anybody else", async () => {
    const result = await ask("How is activation?", answeringDrafter());

    await expect(
      call("copilot.thread", { threadId: result.threadId }, OTHER),
    ).rejects.toThrow(/No such conversation/);
    // And it is not in their list either, which is the same answer said quietly.
    expect(await call("copilot.threads", {}, OTHER)).toEqual([]);
  });

  it("refuses a question written into somebody else's conversation", async () => {
    const result = await ask("How is activation?");
    await expect(
      call(
        "copilot.ask",
        { threadId: result.threadId, question: "And mine?" },
        OTHER,
      ),
    ).rejects.toThrow(/No such conversation/);
  });

  it("is unreachable by its own member once they are suspended", async () => {
    const wb = await workerDb();
    const result = await ask("How is activation?");
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [ownerMemberId],
    );

    await expect(
      call("copilot.thread", { threadId: result.threadId }),
    ).rejects.toThrow(/No such workspace/);
  });

  it("lists the member's own conversations, most recently used first", async () => {
    const first = await ask("How is activation?");
    const second = await ask("What about onboarding?");
    // A follow-up on the older thread moves it back to the top.
    await ask("And now?", undefined, { threadId: first.threadId });

    const threads = (await call("copilot.threads", {})) as { id: string }[];
    expect(threads.map((thread) => thread.id)).toEqual([
      first.threadId,
      second.threadId,
    ]);
  });
});

describe("one answer per question", () => {
  it("refuses a second answer to the same question", async () => {
    const result = await ask("How is activation?", answeringDrafter());

    await expect(
      call("copilot.recordAnswer", {
        threadId: result.threadId,
        text: "A different answer.",
      }),
    ).rejects.toThrow(/no unanswered question/i);
  });

  it("refuses an answer to a conversation that has never been asked anything", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ id: string }>(
      `insert into ai_threads (id, workspace_id, member_id)
       values (gen_random_uuid(), $1, $2) returning id`,
      [workspaceId, ownerMemberId],
    );

    await expect(
      call("copilot.recordAnswer", {
        threadId: rows[0]?.id as string,
        text: "Answering nothing.",
      }),
    ).rejects.toThrow(/no unanswered question/i);
  });
});

describe("an anchored conversation", () => {
  it("keeps the anchor and can be listed by it", async () => {
    const result = await ask("Is this on track?", undefined, {
      subjectType: "goal",
      subjectId: goalId,
    });

    const anchored = (await call("copilot.threads", {
      subjectType: "goal",
      subjectId: goalId,
    })) as { id: string; subjectType: string | null }[];
    expect(anchored.map((thread) => thread.id)).toEqual([result.threadId]);
    expect(anchored[0]?.subjectType).toBe("goal");
  });

  it("refuses half an anchor", async () => {
    await expect(
      call("copilot.ask", { question: "Half of one?", subjectType: "goal" }),
    ).rejects.toThrow(/both a subject type and a subject id/);
  });
});

describe("a conversation is not the workspace's reading", () => {
  it("keeps copilot activity out of the feed", async () => {
    const wb = await workerDb();
    await ask("How is activation?", answeringDrafter());

    // The rows exist: the Operation pipeline requires an activity, and the
    // audit trail is what an administrator reads.
    const written = await wb.admin.query<{ kind: string }>(
      "select kind from activities where kind like 'copilot.%'",
    );
    expect(written.rows.map((row) => row.kind).sort()).toEqual([
      "copilot.answered",
      "copilot.asked",
    ]);

    // The asker's own feed does not show them, so nobody else's does either:
    // an activity with no context is workspace-public by construction.
    const feed = (await call("activities.workspaceFeed", {})) as {
      kind: string;
    }[];
    expect(feed.filter((item) => item.kind.startsWith("copilot."))).toEqual([]);
  });
});

/** The stub used where the answer's content does not matter, only that there is one. */
function answeringDrafter() {
  return new StubDrafter({
    text: "Activation is behind.",
    usedSourceIndexes: [0],
    model: "stub-1",
  });
}
