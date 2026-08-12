import { callAction, provisionWorkspaceForUser } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { processNextTask, readRunState } from "../src/run-executor.ts";

/**
 * The run executor state machine (P2-T17 test plan, AI-NATIVE-PLAN.md §6.5,
 * §7). Four behaviours the acceptance criteria name, plus resume-after-
 * restart and the binding check that gates every dispatch mode alike:
 *
 *  - sandbox mode simulates and commits nothing (no proposal, no real write)
 *  - propose mode commits nothing until a human applies the proposal
 *  - scoped_direct calls the real action immediately, within its bindings
 *  - a task outside the agent's bindings is denied and logged, never tried
 *  - a run resumes correctly from persisted state alone, one task per call
 */

const OWNER = "run-executor-owner";

let workspaceId: string;
let pool: Pool;

const ownerContext = () => ({
  pool,
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

async function createAgent(autonomy: "sandbox" | "propose" | "scoped_direct") {
  // Every field but `name` carries a Zod `.default(...)` on the action's own
  // input schema, which is optional at runtime but not in the type
  // `callAction`'s generics infer from it — filled in explicitly here rather
  // than leaning on the runtime default.
  return callAction(ownerContext(), "agents.create", {
    name: `Runner (${autonomy})`,
    kind: "custom",
    persona: "",
    planningInstructions: "",
    executionInstructions: "",
    provider: null,
    tier: null,
    schedule: "manual",
    autonomy,
  });
}

async function bindToWorkspace(agentId: string, level: number) {
  await callAction(ownerContext(), "agents.bindScope", {
    agentId,
    resourceType: "workspace",
    resourceId: workspaceId,
    level,
  });
}

async function startRenameRun(agentId: string, names: readonly string[]) {
  return callAction(ownerContext(), "agents.startRun", {
    agentId,
    trigger: "test",
    tasks: names.map((name) => ({
      action: "workspace.rename",
      input: { name },
      subjectType: "workspace",
      subjectId: workspaceId,
    })),
  });
}

async function workspaceName(): Promise<string> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ name: string }>(
    "select name from workspaces where id = $1",
    [workspaceId],
  );
  return result.rows[0]?.name ?? "";
}

beforeEach(async () => {
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Run Executor Owner", "run-executor-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Run Executor Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("sandbox mode", () => {
  it("simulates a task and commits nothing", async () => {
    const agent = await createAgent("sandbox");
    await bindToWorkspace(agent.id, 10);
    const originalName = await workspaceName();
    const run = await startRenameRun(agent.id, ["Sandboxed"]);

    const wb = await workerDb();
    const result = await processNextTask(wb.appPool, {
      workspaceId,
      runId: run.id,
    });

    expect(result.finished).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.logEntry.kind).toBe("simulated");
    expect(await workspaceName()).toBe(originalName);

    const proposals = await wb.admin.query(
      "select count(*)::int as n from proposed_changes",
    );
    expect(proposals.rows[0]?.n).toBe(0);
  });
});

describe("propose mode", () => {
  it("commits nothing until a human applies the proposal", async () => {
    const agent = await createAgent("propose");
    await bindToWorkspace(agent.id, 10);
    const originalName = await workspaceName();
    const run = await startRenameRun(agent.id, ["Proposed name"]);

    const wb = await workerDb();
    const result = await processNextTask(wb.appPool, {
      workspaceId,
      runId: run.id,
    });
    expect(result.logEntry.kind).toBe("proposed");
    expect(await workspaceName()).toBe(originalName);

    const proposals = await callAction(ownerContext(), "proposals.list", {
      status: "pending",
    });
    expect(proposals).toHaveLength(1);
    const [proposal] = proposals;
    if (!proposal) {
      throw new Error("expected one pending proposal");
    }
    expect(proposal.action).toBe("workspace.rename");

    await callAction(ownerContext(), "proposals.bulkApply", {
      ids: [proposal.id],
    });
    expect(await workspaceName()).toBe("Proposed name");

    const audit = await wb.admin.query(
      "select actor_kind from audit_events where action = 'workspace.rename'",
    );
    expect(audit.rowCount).toBe(1);
  });
});

describe("scoped_direct mode", () => {
  it("calls the real action immediately, within its bindings", async () => {
    const agent = await createAgent("scoped_direct");
    await bindToWorkspace(agent.id, 100);
    const run = await startRenameRun(agent.id, ["Direct name"]);

    const wb = await workerDb();
    const result = await processNextTask(wb.appPool, {
      workspaceId,
      runId: run.id,
    });
    expect(result.logEntry.kind).toBe("applied");
    expect(await workspaceName()).toBe("Direct name");

    const audit = await wb.admin.query(
      "select actor_kind from audit_events where action = 'workspace.rename'",
    );
    expect(audit.rows[0]?.actor_kind).toBe("agent");
  });

  it("logs an error and keeps the run's own progress when the real action fails", async () => {
    const agent = await createAgent("scoped_direct");
    // Bound only enough to pass the run-executor's own check, not enough
    // for workspace.rename's own `full` requirement — so the dispatched
    // action itself refuses, and the run still advances past it.
    await bindToWorkspace(agent.id, 10);
    const run = await startRenameRun(agent.id, ["Refused name"]);

    const wb = await workerDb();
    const result = await processNextTask(wb.appPool, {
      workspaceId,
      runId: run.id,
    });
    expect(result.logEntry.kind).toBe("error");
    expect(result.finished).toBe(true);
  });
});

describe("bindings", () => {
  it("denies and logs a task outside the agent's bindings without ever calling it", async () => {
    const agent = await createAgent("scoped_direct");
    // No binding at all: workspace_standard excludes agent-kind members by
    // design, so this agent reaches nothing.
    const originalName = await workspaceName();
    const run = await startRenameRun(agent.id, ["Should never land"]);

    const wb = await workerDb();
    const result = await processNextTask(wb.appPool, {
      workspaceId,
      runId: run.id,
    });
    expect(result.logEntry.kind).toBe("denied");
    expect(await workspaceName()).toBe(originalName);
  });
});

describe("resume after restart", () => {
  it("advances one task per call, purely from persisted state", async () => {
    const agent = await createAgent("scoped_direct");
    await bindToWorkspace(agent.id, 100);
    const run = await startRenameRun(agent.id, ["First", "Second"]);

    const wb = await workerDb();

    const first = await processNextTask(wb.appPool, {
      workspaceId,
      runId: run.id,
    });
    expect(first.finished).toBe(false);
    expect(first.status).toBe("running");
    expect(await workspaceName()).toBe("First");

    const afterFirst = await readRunState(wb.appPool, {
      workspaceId,
      runId: run.id,
    });
    expect(afterFirst?.currentTaskIndex).toBe(1);
    expect(afterFirst?.log).toHaveLength(1);

    const outboxAfterFirst = await wb.admin.query(
      "select topic from outbox where topic = 'agents.run.continue'",
    );
    expect(outboxAfterFirst.rowCount).toBe(1);

    // A second, independent call — nothing carried over from the first
    // beyond what is in the database, proving resume needs no in-memory
    // state at all.
    const second = await processNextTask(wb.appPool, {
      workspaceId,
      runId: run.id,
    });
    expect(second.finished).toBe(true);
    expect(second.status).toBe("completed");
    expect(await workspaceName()).toBe("Second");

    const afterSecond = await readRunState(wb.appPool, {
      workspaceId,
      runId: run.id,
    });
    expect(afterSecond?.status).toBe("completed");
    expect(afterSecond?.log).toHaveLength(2);
    expect(afterSecond?.finishedAt).not.toBeNull();
  });

  it("refuses to process a run that is not running", async () => {
    const agent = await createAgent("scoped_direct");
    await bindToWorkspace(agent.id, 100);
    const run = await startRenameRun(agent.id, ["Only task"]);
    await callAction(ownerContext(), "agents.cancelRun", { id: run.id });

    const wb = await workerDb();
    await expect(
      processNextTask(wb.appPool, { workspaceId, runId: run.id }),
    ).rejects.toThrow();
  });
});
