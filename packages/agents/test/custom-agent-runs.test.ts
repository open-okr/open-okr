import { OutboxRelay } from "@openokr/adapters";
import {
  AGENT_RUN_STEP_TOPIC,
  callAction,
  dispatchOutbox,
  provisionWorkspaceForUser,
  recordUsageEvent,
} from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  type AgentRunModel,
  continueAgentRun,
  readRunState,
} from "../src/run-executor.ts";
import { mockRunModel } from "./mock-model.ts";

/**
 * A custom agent's run, from `agents.startRun` to its last step (completeness
 * review M-11, AI-NATIVE-PLAN.md §6.5).
 *
 * **Driven through the real relay and the real outbox handler.** Before M-11
 * `agents.startRun` wrote a run row and nothing else, and nothing read the
 * executor's own continuation rows, so the unit tests could call
 * `processNextTask` by hand and pass while no run in the product ever took a
 * step. These tests only start a run and drain the outbox, the way the relay
 * host does, so a run that is not carried to its end fails here.
 *
 * The model is the mock driver, handed over as the host's choke point would
 * hand it: the run asks whether it may use it and never builds one.
 */

const OWNER = "custom-runs-owner";

let workspaceId: string;
let ownSpaceId: string;
let otherSpaceId: string;
let pool: Pool;

const ownerContext = () => ({
  pool,
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

type Autonomy = "sandbox" | "propose" | "scoped_direct";

async function createAgent(autonomy: Autonomy) {
  const agent = await callAction(ownerContext(), "agents.create", {
    name: `Custom (${autonomy})`,
    kind: "custom",
    persona: "",
    planningInstructions: "",
    executionInstructions: "",
    provider: null,
    tier: null,
    schedule: "manual",
    autonomy,
  });
  // Bound to one named space and nothing else, the only shape of access an
  // agent can hold.
  await callAction(ownerContext(), "agents.bindScope", {
    agentId: agent.id,
    resourceType: "space",
    resourceId: ownSpaceId,
    level: 100,
  });
  return agent;
}

const rename = (spaceId: string, name: string) => ({
  action: "spaces.update",
  input: { id: spaceId, name },
  subjectType: "space",
  subjectId: spaceId,
});

async function spaceName(id: string): Promise<string> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ name: string }>(
    "select name from spaces where id = $1",
    [id],
  );
  return result.rows[0]?.name ?? "";
}

async function countOf(query: string, values: unknown[] = []) {
  const wb = await workerDb();
  const result = await wb.admin.query<{ n: number }>(query, values);
  return result.rows[0]?.n ?? 0;
}

/**
 * Drains the outbox the way the relay host does, until nothing is left, and
 * answers with the reasons any step was skipped.
 *
 * Every row goes through `dispatchOutbox`, so the step topic reaches the same
 * handler it reaches in production. Other topics a step's writes enqueue
 * (the feed, the search index) are acknowledged here: they are not what
 * these tests are about. `model` is what the host's choke point would
 * answer, and null is a workspace with no provider for the agent's tier.
 */
async function drain(
  model: AgentRunModel | null = mockRunModel(),
): Promise<string[]> {
  const wb = await workerDb();
  const skipped: string[] = [];
  const relay = new OutboxRelay(wb.admin, {
    // Large, because the relay is fair and oldest first: the rows the setup
    // above enqueued (the feed, the search index) come before the run's
    // first step, and a small batch would spend every drain on them.
    batchSize: 1000,
    async dispatch(record) {
      if (record.topic !== AGENT_RUN_STEP_TOPIC) {
        return;
      }
      await dispatchOutbox(record, {
        pool: wb.appPool,
        continueAgentRun: (job) =>
          continueAgentRun(wb.appPool, job, {
            modelFor: async () => model,
          }),
        onSkipped: (_delivery, reason) => skipped.push(reason),
      });
    },
  });
  // Until the queue is empty rather than until the run stops: a step for a
  // run that has already stopped must still be delivered, and skipped.
  for (let attempt = 0; attempt < 20; attempt++) {
    // A row's `available_at` is stamped by this process's clock and the
    // claim compares it with the database's. Where the two disagree, as a
    // Docker VM that has drifted behind its host does, a row written a
    // moment ago looks due in the future and is not claimed. Rows never yet
    // attempted are brought into the database's own time; a row that failed
    // keeps its backoff.
    await wb.admin.query(
      `update outbox
          set available_at = now()
        where delivered_at is null
          and attempts = 0
          and available_at > now()`,
    );
    if ((await relay.drainOnce()) === 0) {
      break;
    }
  }
  return skipped;
}

async function runOf(runId: string) {
  const wb = await workerDb();
  const state = await readRunState(wb.appPool, { workspaceId, runId });
  if (!state) {
    throw new Error("the run has gone");
  }
  return state;
}

beforeEach(async () => {
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Custom Runs Owner", "custom-runs-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Custom Runs Owner",
  });
  workspaceId = provisioned.workspaceId;

  const spaces = await callAction(ownerContext(), "spaces.list", {});
  const first = spaces[0];
  if (!first) {
    throw new Error("provisioning made no space");
  }
  ownSpaceId = first.id;
  const other = await callAction(ownerContext(), "spaces.create", {
    name: "Finance",
    mission: "Nothing the agent is bound to.",
  });
  otherSpaceId = other.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("starting a run", () => {
  it("queues its first step in the transaction that writes the run", async () => {
    const agent = await createAgent("scoped_direct");
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [rename(ownSpaceId, "First")],
    });

    const wb = await workerDb();
    const rows = await wb.admin.query<{
      payload: Record<string, unknown>;
      idempotency_key: string;
    }>("select payload, idempotency_key from outbox where topic = $1", [
      AGENT_RUN_STEP_TOPIC,
    ]);
    expect(rows.rows).toEqual([
      {
        payload: { workspaceId, runId: run.id, taskIndex: 0 },
        idempotency_key: `${AGENT_RUN_STEP_TOPIC}:${run.id}:0`,
      },
    ]);
  });

  it("refuses a task naming an action the registry does not have", async () => {
    const agent = await createAgent("scoped_direct");
    await expect(
      callAction(ownerContext(), "agents.startRun", {
        agentId: agent.id,
        trigger: "manual",
        tasks: [{ action: "spaces.takeOver", input: {} }],
      }),
    ).rejects.toThrow();
    expect(await countOf("select count(*)::int as n from agent_runs")).toBe(0);
  });
});

describe("a run carried by the relay", () => {
  it("is continued step by step to completion, with every step recorded", async () => {
    const agent = await createAgent("scoped_direct");
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [rename(ownSpaceId, "First"), rename(ownSpaceId, "Second")],
    });

    await drain();

    const state = await runOf(run.id);
    expect(state.status).toBe("completed");
    expect(state.currentTaskIndex).toBe(2);
    expect(state.finishedAt).not.toBeNull();
    expect(state.log.map((entry) => entry.kind)).toEqual([
      "applied",
      "applied",
    ]);
    expect(await spaceName(ownSpaceId)).toBe("Second");

    // One audit row per step, and the writes themselves under the agent.
    expect(
      await countOf(
        "select count(*)::int as n from audit_events where action = 'agents.processNextTask'",
      ),
    ).toBe(2);
    expect(
      await countOf(
        "select count(*)::int as n from audit_events where action = 'spaces.update' and actor_kind = 'agent'",
      ),
    ).toBe(2);

    // The screen's own read carries how far it got.
    const listed = await callAction(ownerContext(), "agents.listRuns", {});
    const row = listed.find((entry) => entry.id === run.id);
    expect(row?.taskCount).toBe(2);
    expect(row?.currentTaskIndex).toBe(2);
    expect(row?.log).toHaveLength(2);
  });

  it("does not take a step twice when its row is delivered again", async () => {
    const agent = await createAgent("scoped_direct");
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [rename(ownSpaceId, "Once"), rename(ownSpaceId, "Twice")],
    });
    await drain();

    // The first step's row, delivered a second time after the run has
    // finished: at-least-once delivery does exactly this.
    const wb = await workerDb();
    const outcome = await continueAgentRun(
      wb.appPool,
      { workspaceId, runId: run.id, taskIndex: 0 },
      { modelFor: async () => mockRunModel() },
    );
    expect(outcome.kind).toBe("skipped");
    expect((await runOf(run.id)).log).toHaveLength(2);
  });

  it("stops at the next step once somebody cancels it", async () => {
    const agent = await createAgent("scoped_direct");
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [rename(ownSpaceId, "Never")],
    });
    await callAction(ownerContext(), "agents.cancelRun", { id: run.id });

    const skipped = await drain();
    expect(skipped).toEqual(["the run is cancelled"]);
    expect(await spaceName(ownSpaceId)).not.toBe("Never");
  });
});

describe("the hard rules", () => {
  it("cannot read outside its bindings", async () => {
    const agent = await createAgent("propose");
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [
        // Outside its binding, named: refused before anything is called.
        {
          action: "spaces.read",
          input: { id: otherSpaceId },
          subjectType: "space",
          subjectId: otherSpaceId,
        },
        // Outside it, unnamed: the read's own access check refuses it, with
        // the same not-found a member without access gets.
        { action: "spaces.read", input: { id: otherSpaceId } },
      ],
    });

    await drain();

    const state = await runOf(run.id);
    expect(state.status).toBe("completed");
    expect(state.log.map((entry) => entry.kind)).toEqual(["denied", "error"]);
    expect(state.log[1]?.message).toMatch(/No such space/);
    // A read is not a write, so propose mode made no proposal of either: a
    // refused read is not turned into something a reviewer might approve.
    expect(
      await countOf("select count(*)::int as n from proposed_changes"),
    ).toBe(0);
  });

  it("turns its write into a proposal by default, and commits nothing", async () => {
    const agent = await createAgent("propose");
    const before = await spaceName(ownSpaceId);
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [rename(ownSpaceId, "Proposed")],
    });

    await drain();

    expect((await runOf(run.id)).log.map((entry) => entry.kind)).toEqual([
      "proposed",
    ]);
    expect(await spaceName(ownSpaceId)).toBe(before);
    const proposals = await callAction(ownerContext(), "proposals.list", {
      status: "pending",
    });
    expect(proposals.map((proposal) => proposal.runId)).toEqual([run.id]);
  });

  it("writes directly only with the per-agent opt-in", async () => {
    const agent = await createAgent("propose");
    await callAction(ownerContext(), "agents.setAutonomy", {
      id: agent.id,
      autonomy: "scoped_direct",
    });
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [rename(ownSpaceId, "Direct")],
    });

    await drain();

    expect((await runOf(run.id)).log.map((entry) => entry.kind)).toEqual([
      "applied",
    ]);
    expect(await spaceName(ownSpaceId)).toBe("Direct");
    expect(
      await countOf("select count(*)::int as n from proposed_changes"),
    ).toBe(0);
  });

  it("commits nothing in sandbox mode", async () => {
    const agent = await createAgent("sandbox");
    const before = await spaceName(ownSpaceId);
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [rename(ownSpaceId, "Sandboxed")],
    });

    await drain();

    const state = await runOf(run.id);
    expect(state.status).toBe("completed");
    expect(state.log.map((entry) => entry.kind)).toEqual(["simulated"]);
    expect(await spaceName(ownSpaceId)).toBe(before);
    expect(
      await countOf("select count(*)::int as n from proposed_changes"),
    ).toBe(0);
    expect(
      await countOf(
        "select count(*)::int as n from audit_events where action = 'spaces.update'",
      ),
    ).toBe(0);
  });

  it("halts mid-flight when the agent's own budget is spent", async () => {
    const agent = await createAgent("scoped_direct");
    await callAction(ownerContext(), "ai.setBudget", {
      scope: "agent",
      scopeRef: agent.id,
      metric: "calls",
      period: "day",
      limitValue: 1,
    });
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [rename(ownSpaceId, "Spent"), rename(ownSpaceId, "Too late")],
    });
    const wb = await workerDb();
    await recordUsageEvent(wb.appPool, {
      workspaceId,
      agentId: agent.id,
      source: "agent",
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      inputTokens: 10,
      outputTokens: 10,
      cost: 0.01,
    });

    await drain();

    const state = await runOf(run.id);
    expect(state.status).toBe("failed");
    expect(state.currentTaskIndex).toBe(0);
    expect(state.error).toMatch(/agent's calls budget/);
    expect(state.log.at(-1)?.message).toMatch(/^Halted:/);
    expect(await spaceName(ownSpaceId)).not.toBe("Spent");
  });

  it("stops before spending when the per-run cost cap is zero", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `update workspaces
          set settings = settings || '{"agentRunCostCapUsd": 0}'::jsonb
        where id = $1`,
      [workspaceId],
    );
    const agent = await createAgent("scoped_direct");
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [rename(ownSpaceId, "Capped")],
    });

    await drain();

    const state = await runOf(run.id);
    // A limit the workspace chose, so cancelled rather than failed.
    expect(state.status).toBe("cancelled");
    expect(state.log.at(-1)?.message).toMatch(/cost cap/);
    expect(await spaceName(ownSpaceId)).not.toBe("Capped");
  });

  it("stops a run whose agent was turned off after it started", async () => {
    const agent = await createAgent("scoped_direct");
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [rename(ownSpaceId, "After off")],
    });
    await callAction(ownerContext(), "agents.setEnabled", {
      id: agent.id,
      enabled: false,
    });

    await drain();

    const state = await runOf(run.id);
    expect(state.status).toBe("cancelled");
    expect(state.log[0]?.message).toMatch(/turned off/);
    expect(await spaceName(ownSpaceId)).not.toBe("After off");
  });
});

describe("with AI off", () => {
  it("ends the run at its first step with the reason on it, and does nothing", async () => {
    const agent = await createAgent("scoped_direct");
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [rename(ownSpaceId, "Without a model")],
    });

    await drain(null);

    const state = await runOf(run.id);
    expect(state.status).toBe("cancelled");
    expect(state.finishedAt).not.toBeNull();
    expect(state.log).toHaveLength(1);
    expect(state.log[0]?.kind).toBe("denied");
    expect(state.log[0]?.message).toMatch(/no AI provider is configured/);
    expect(await spaceName(ownSpaceId)).not.toBe("Without a model");

    // On the record, as a stop and not as a crash.
    const wb = await workerDb();
    const audit = await wb.admin.query<{ payload: Record<string, unknown> }>(
      "select payload from audit_events where action = 'agents.processNextTask'",
    );
    expect(audit.rows.map((row) => row.payload.halted)).toEqual([
      "ai_unavailable",
    ]);
  });

  it("ends the same way when the privacy settings let nothing reach the provider", async () => {
    const agent = await createAgent("scoped_direct");
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [rename(ownSpaceId, "Withheld")],
    });

    await drain(mockRunModel({ permits: false }));

    const state = await runOf(run.id);
    expect(state.status).toBe("cancelled");
    expect(state.log[0]?.message).toMatch(/privacy settings/);
    expect(await spaceName(ownSpaceId)).not.toBe("Withheld");
  });
});
