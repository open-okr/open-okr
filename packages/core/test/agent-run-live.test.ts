import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  AGENT_RUN_CHANGED_TOPIC,
  agentRunChangedEvent,
  agentRunsChannel,
  agentRunVersion,
} from "../src/agents/live.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Live agent run streams, the producing half (PLAN.md §7, release 0.7.0 A11).
 *
 * Every write that changes a run leaves one outbox row on the workspace's run
 * channel, inside its own transaction, carrying the run's id and version and
 * nothing else. The executor's steps are proved in
 * `packages/agents/test/custom-agent-runs.test.ts`, the route and the browser
 * half in `apps/web/test/agent-runs-live.test.tsx`.
 */

const OWNER = "agent-run-live-owner";

let workspaceId: string;
let pool: Pool;

const ownerContext = () => ({
  pool,
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

interface EventRow {
  readonly payload: Record<string, unknown>;
  readonly idempotency_key: string;
}

async function runEvents(): Promise<EventRow[]> {
  const wb = await workerDb();
  const result = await wb.admin.query<EventRow>(
    `select payload, idempotency_key
       from outbox
      where topic = $1
      order by (payload->>'version')::int, created_at`,
    [AGENT_RUN_CHANGED_TOPIC],
  );
  return result.rows;
}

/** A run as the agents screen's own read returns it. */
async function listedRun(runId: string) {
  const runs = await callAction(ownerContext(), "agents.listRuns", {});
  const run = runs.find((one) => one.id === runId);
  if (!run) {
    throw new Error("the run is not on the list");
  }
  return run;
}

async function customAgent(): Promise<string> {
  const agent = await callAction(ownerContext(), "agents.create", {
    name: "Live",
    kind: "custom",
    persona: "",
    planningInstructions: "",
    executionInstructions: "",
    provider: null,
    tier: null,
    schedule: "manual",
    autonomy: "propose",
  });
  return agent.id;
}

beforeEach(async () => {
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Live Owner", "agent-run-live-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Live Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a run's version", () => {
  it("counts its log lines, and one more once it has ended", () => {
    expect(agentRunVersion({ status: "running", logLength: 0 })).toBe(0);
    expect(agentRunVersion({ status: "running", logLength: 3 })).toBe(3);
    expect(agentRunVersion({ status: "completed", logLength: 3 })).toBe(4);
    expect(agentRunVersion({ status: "failed", logLength: 1 })).toBe(2);
    expect(agentRunVersion({ status: "cancelled", logLength: 0 })).toBe(1);
  });

  it("is keyed afresh every time, so a repeat cannot refuse the write", () => {
    const input = { workspaceId: "w", runId: "r", status: "running" };
    const first = agentRunChangedEvent({ ...input, logLength: 1 });
    const second = agentRunChangedEvent({ ...input, logLength: 1 });
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(first.payload.channel).toBe(agentRunsChannel("w"));
  });
});

describe("every write that changes a run announces it", () => {
  it("starting a run, with the run's id and version and nothing else", async () => {
    const agentId = await customAgent();
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId,
      trigger: "manual",
      tasks: [{ action: "spaces.list", input: {} }],
    });

    const rows = await runEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({
      channel: `workspace:${workspaceId}:agent-runs`,
      workspaceId,
      runId: run.id,
      version: 0,
    });
    expect(rows[0]?.idempotency_key).toMatch(
      new RegExp(`^agentRun\\.changed:${run.id}:`),
    );
  });

  it("cancelling it, at the version the screen's read then returns", async () => {
    const agentId = await customAgent();
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId,
      trigger: "manual",
      tasks: [{ action: "spaces.list", input: {} }],
    });
    await callAction(ownerContext(), "agents.cancelRun", { id: run.id });

    const rows = await runEvents();
    expect(rows.map((row) => row.payload.version)).toEqual([0, 1]);
    const listed = await listedRun(run.id);
    expect(listed.status).toBe("cancelled");
    expect(
      agentRunVersion({ status: listed.status, logLength: listed.log.length }),
    ).toBe(1);
  });

  it("refuses to cancel a run that has already ended, and says nothing", async () => {
    const agentId = await customAgent();
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId,
      trigger: "manual",
      tasks: [{ action: "spaces.list", input: {} }],
    });
    await callAction(ownerContext(), "agents.cancelRun", { id: run.id });
    await expect(
      callAction(ownerContext(), "agents.cancelRun", { id: run.id }),
    ).rejects.toThrow();
    expect(await runEvents()).toHaveLength(2);
  });

  it("the Champion's run, once, in its finished state", async () => {
    const result = await callAction(ownerContext(), "agents.runChampion", {});

    const rows = await runEvents();
    expect(rows).toHaveLength(1);
    const listed = await listedRun(result.runId);
    expect(rows[0]?.payload).toEqual({
      channel: `workspace:${workspaceId}:agent-runs`,
      workspaceId,
      runId: result.runId,
      version: agentRunVersion({
        status: listed.status,
        logLength: listed.log.length,
      }),
    });
  });

  it("the Champion's run halted by a cost cap of zero", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `update workspaces
          set settings = settings || '{"agentRunCostCapUsd": 0}'::jsonb
        where id = $1`,
      [workspaceId],
    );
    const result = await callAction(ownerContext(), "agents.runChampion", {});
    expect(result.status).toBe("cancelled");

    const rows = await runEvents();
    expect(rows).toHaveLength(1);
    // One line saying why, and the end.
    expect(rows[0]?.payload.runId).toBe(result.runId);
    expect(rows[0]?.payload.version).toBe(2);
  });

  it("the Coach's run, once, in its finished state", async () => {
    const result = await callAction(ownerContext(), "agents.runCoach", {});

    const rows = await runEvents();
    expect(rows).toHaveLength(1);
    const listed = await listedRun(result.runId);
    expect(rows[0]?.payload.runId).toBe(result.runId);
    expect(rows[0]?.payload.version).toBe(
      agentRunVersion({ status: listed.status, logLength: listed.log.length }),
    );
  });
});
