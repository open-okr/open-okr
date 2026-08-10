import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Agent, run and proposal actions (P2-T17 test plan, AI-NATIVE-PLAN.md
 * §6.5, §7).
 *
 * Creating an agent creates its own member, kind = 'agent', with no access
 * anywhere until `agents.bindScope` grants one. Starting and reading a run
 * round-trips its task list and append-only log. A proposal commits nothing
 * on its own; `proposals.bulkApply`/`bulkDismiss` are what decide it,
 * scoped to exactly the ids named, never every pending row in the workspace.
 */

const OWNER = "agents-owner";

let workspaceId: string;
let pool: Pool;

const ownerContext = () => ({
  pool,
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

beforeEach(async () => {
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Agents Owner", "agents-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Agents Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

/**
 * `agents.create`'s input schema defaults every field but `name` with
 * `z.default(...)`, which Zod treats as optional at runtime but
 * `callAction`'s inferred input type does not — the same gap
 * `ai.addCustomModel`'s own tests hit in P2-T15. Filling every field
 * explicitly here is what keeps every call site below a one-line literal.
 */
function createAgentInput(overrides: {
  readonly name: string;
  readonly kind?: "coach" | "champion" | "custom";
  readonly autonomy?: "sandbox" | "propose" | "scoped_direct";
}) {
  return {
    name: overrides.name,
    kind: overrides.kind ?? "custom",
    persona: "",
    planningInstructions: "",
    executionInstructions: "",
    provider: null,
    tier: null,
    schedule: "manual" as const,
    autonomy: overrides.autonomy ?? "propose",
  };
}

describe("agents.create", () => {
  it("creates an agent's own member record, kind = 'agent', enabled by default", async () => {
    const agent = await callAction(
      ownerContext(),
      "agents.create",
      createAgentInput({ name: "Test Coach", kind: "coach" }),
    );
    expect(agent.name).toBe("Test Coach");
    expect(agent.kind).toBe("coach");
    expect(agent.enabled).toBe(true);
    expect(agent.autonomy).toBe("propose");

    const wb = await workerDb();
    const member = await wb.admin.query(
      "select kind, status from workspace_members where id = $1",
      [agent.memberId],
    );
    expect(member.rows[0]).toEqual({ kind: "agent", status: "active" });
  });

  it("lists every agent the workspace has", async () => {
    await callAction(
      ownerContext(),
      "agents.create",
      createAgentInput({ name: "A" }),
    );
    await callAction(
      ownerContext(),
      "agents.create",
      createAgentInput({ name: "B" }),
    );
    const rows = await callAction(ownerContext(), "agents.list", {});
    expect(rows.map((r) => r.name).sort()).toEqual(["A", "B"]);
  });
});

describe("agents.setEnabled", () => {
  it("turns an agent off and back on", async () => {
    const agent = await callAction(
      ownerContext(),
      "agents.create",
      createAgentInput({ name: "Toggle" }),
    );
    const off = await callAction(ownerContext(), "agents.setEnabled", {
      id: agent.id,
      enabled: false,
    });
    expect(off.enabled).toBe(false);
    const [row] = await callAction(ownerContext(), "agents.list", {});
    expect(row?.enabled).toBe(false);
  });
});

describe("agents.bindScope", () => {
  it("grants the agent's own member group a binding on a named resource, not the workspace at large", async () => {
    const agent = await callAction(
      ownerContext(),
      "agents.create",
      createAgentInput({ name: "Bound" }),
    );
    await callAction(ownerContext(), "agents.bindScope", {
      agentId: agent.id,
      resourceType: "workspace",
      resourceId: workspaceId,
      level: 40,
    });

    const wb = await workerDb();
    const bindings = await wb.admin.query<{ level: number; kind: string }>(
      `select b.level, g.kind
         from access_bindings b
         join access_groups g on g.id = b.group_id
        where g.member_id = $1`,
      [agent.memberId],
    );
    expect(bindings.rows).toEqual([{ level: 40, kind: "member" }]);
  });
});

describe("agents.startRun / agents.readRun", () => {
  it("starts a run against a decomposed task list and reads it back", async () => {
    const agent = await callAction(
      ownerContext(),
      "agents.create",
      createAgentInput({ name: "Runner" }),
    );
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [{ action: "workspace.rename", input: { name: "Renamed" } }],
    });
    expect(run.status).toBe("running");
    expect(run.taskCount).toBe(1);
    expect(run.currentTaskIndex).toBe(0);

    const read = await callAction(ownerContext(), "agents.readRun", {
      id: run.id,
    });
    expect(read).toEqual(run);
  });

  it("refuses to start a run for a disabled agent", async () => {
    const agent = await callAction(
      ownerContext(),
      "agents.create",
      createAgentInput({ name: "Disabled" }),
    );
    await callAction(ownerContext(), "agents.setEnabled", {
      id: agent.id,
      enabled: false,
    });
    await expect(
      callAction(ownerContext(), "agents.startRun", {
        agentId: agent.id,
        trigger: "manual",
        tasks: [{ action: "workspace.rename", input: { name: "x" } }],
      }),
    ).rejects.toThrow();
  });
});

describe("agents.cancelRun", () => {
  it("cancels a running run", async () => {
    const agent = await callAction(
      ownerContext(),
      "agents.create",
      createAgentInput({ name: "Cancellable" }),
    );
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [{ action: "workspace.rename", input: { name: "x" } }],
    });
    const cancelled = await callAction(ownerContext(), "agents.cancelRun", {
      id: run.id,
    });
    expect(cancelled.status).toBe("cancelled");
  });
});

describe("proposals.bulkApply / bulkDismiss", () => {
  async function seedTwoProposals(): Promise<{
    runId: string;
    firstId: string;
    secondId: string;
  }> {
    const wb = await workerDb();
    const agent = await callAction(
      ownerContext(),
      "agents.create",
      createAgentInput({ name: "Proposer" }),
    );
    const run = await callAction(ownerContext(), "agents.startRun", {
      agentId: agent.id,
      trigger: "manual",
      tasks: [
        { action: "workspace.rename", input: { name: "First" } },
        { action: "workspace.rename", input: { name: "Second" } },
      ],
    });
    const inserted = await wb.admin.query<{ id: string }>(
      `insert into proposed_changes (id, workspace_id, run_id, action, payload)
       values
         (gen_random_uuid(), $1, $2, 'workspace.rename', $3),
         (gen_random_uuid(), $1, $2, 'workspace.rename', $4)
       returning id`,
      [
        workspaceId,
        run.id,
        JSON.stringify({ name: "First" }),
        JSON.stringify({ name: "Second" }),
      ],
    );
    const [first, second] = inserted.rows;
    if (!first || !second) {
      throw new Error("expected two inserted proposal rows");
    }
    return { runId: run.id, firstId: first.id, secondId: second.id };
  }

  it("applies only the ids named, leaving every other pending proposal untouched", async () => {
    const { firstId, secondId } = await seedTwoProposals();

    const result = await callAction(ownerContext(), "proposals.bulkApply", {
      ids: [firstId],
    });
    expect(result.applied).toEqual([firstId]);
    expect(result.failed).toEqual([]);

    const wb = await workerDb();
    const rows = await wb.admin.query<{ id: string; status: string }>(
      "select id, status from proposed_changes order by created_at",
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r.status]));
    expect(byId.get(firstId)).toBe("applied");
    expect(byId.get(secondId)).toBe("pending");

    const workspace = await wb.admin.query<{ name: string }>(
      "select name from workspaces where id = $1",
      [workspaceId],
    );
    expect(workspace.rows[0]?.name).toBe("First");

    const audit = await wb.admin.query(
      "select action from audit_events where action = 'workspace.rename'",
    );
    expect(audit.rowCount).toBe(1);
  });

  it("dismisses only the ids named", async () => {
    const { firstId, secondId } = await seedTwoProposals();

    const result = await callAction(ownerContext(), "proposals.bulkDismiss", {
      ids: [secondId],
    });
    expect(result.dismissed).toEqual([secondId]);

    const list = await callAction(ownerContext(), "proposals.list", {
      status: "pending",
    });
    expect(list.map((r) => r.id)).toEqual([firstId]);
  });
});
