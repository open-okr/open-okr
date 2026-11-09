/**
 * A token's scopes are a ceiling for every action it causes
 * (docs/design/token-scope-ceiling.md, approved 10 November 2026).
 *
 * The gap A13's build found: a `write` token could apply a proposal whose
 * action is destructive, because the scope was checked against the outer
 * action only. Here the call context carries the token's scopes, as REST and
 * the agent endpoint now set them.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { ScopeCeilingRefused } from "../src/actions/scope-ceiling.ts";
import { errorFor } from "../src/api/errors.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "scope-ceiling-owner";
let workspaceId: string;
let cycleId: string;

const context = async (scopes?: readonly string[]) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: OWNER },
    ...(scopes ? { scopes } : {}),
  };
};

const call = async (name: string, input: unknown, scopes?: readonly string[]) =>
  callAction(await context(scopes), name as never, input as never);

const newGoal = async (title: string) =>
  (
    (await call("goals.create", { title, cycleId, level: "company" })) as {
      id: string;
    }
  ).id;

/** A pending agent proposal, as a custom agent would raise it. */
const proposal = async (
  action: string,
  payload: Record<string, unknown>,
  goalId: string,
): Promise<string> => {
  const wb = await workerDb();
  const { rows: runs } = await wb.admin.query<{ id: string }>(
    `insert into agent_runs (id, workspace_id, agent_id, status, trigger)
     select gen_random_uuid(), $1, id, 'completed', 'manual'
       from agents where workspace_id = $1 and kind = 'champion'
     returning id`,
    [workspaceId],
  );
  const { rows } = await wb.admin.query<{ id: string }>(
    `insert into proposed_changes
       (id, workspace_id, run_id, action, payload, subject_type, subject_id, status)
     values (gen_random_uuid(), $1, $2, $3, $4::jsonb, 'goal', $5, 'pending')
     returning id`,
    [workspaceId, runs[0]?.id, action, JSON.stringify(payload), goalId],
  );
  return rows[0]?.id as string;
};

const goalState = async (goalId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    title: string;
    deleted: boolean;
  }>(
    "select title, deleted_at is not null as deleted from goals where id = $1",
    [goalId],
  );
  return rows[0];
};

const proposalStatus = async (id: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ status: string }>(
    "select status from proposed_changes where id = $1",
    [id],
  );
  return rows[0]?.status;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', $2)",
    [OWNER, "scope-ceiling@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  cycleId = (
    (await call("cycles.current", { mode: "quarterly" })) as {
      id: string;
    }
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a write token applying a proposal", () => {
  it("is refused a destructive proposed action, which leaves the goal and the proposal as they were", async () => {
    const goalId = await newGoal("Win the mid-market");
    const id = await proposal("goals.delete", { id: goalId }, goalId);

    const refused = await call("proposals.apply", { id }, [
      "read",
      "write",
    ]).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ScopeCeilingRefused);
    expect((refused as ScopeCeilingRefused).message).toBe(
      "This runs goals.delete, which needs the destructive scope. This token has: read, write.",
    );
    expect(errorFor(refused).code).toBe("insufficient_scope");
    expect((await goalState(goalId))?.deleted).toBe(false);
    expect(await proposalStatus(id)).toBe("pending");
  });

  it("applies a proposed write as before", async () => {
    const goalId = await newGoal("Win the mid-market");
    const id = await proposal(
      "goals.update",
      { id: goalId, title: "Win the mid-market first" },
      goalId,
    );
    await call("proposals.apply", { id }, ["read", "write"]);
    expect((await goalState(goalId))?.title).toBe("Win the mid-market first");
    expect(await proposalStatus(id)).toBe("applied");
  });

  it("applies the destructive one for a token that has the destructive scope", async () => {
    const goalId = await newGoal("Win the mid-market");
    const id = await proposal("goals.delete", { id: goalId }, goalId);
    await call("proposals.apply", { id }, ["read", "write", "destructive"]);
    expect((await goalState(goalId))?.deleted).toBe(true);
  });

  it("is unchanged for a person in the browser, who has no scopes", async () => {
    const goalId = await newGoal("Win the mid-market");
    const id = await proposal("goals.delete", { id: goalId }, goalId);
    await call("proposals.apply", { id });
    expect((await goalState(goalId))?.deleted).toBe(true);
  });

  it("in bulk, refuses the destructive one by name and applies the rest", async () => {
    const kept = await newGoal("Keep this one");
    const renamed = await newGoal("Rename this one");
    const destructive = await proposal("goals.delete", { id: kept }, kept);
    const write = await proposal(
      "goals.update",
      { id: renamed, title: "Renamed in bulk" },
      renamed,
    );

    const result = (await call(
      "proposals.bulkApply",
      { ids: [destructive, write] },
      ["read", "write"],
    )) as {
      applied: string[];
      failed: { id: string; error: string }[];
    };

    expect(result.applied).toEqual([write]);
    expect(result.failed).toEqual([
      {
        id: destructive,
        error:
          "This runs goals.delete, which needs the destructive scope. This token has: read, write.",
      },
    ]);
    expect((await goalState(kept))?.deleted).toBe(false);
    expect((await goalState(renamed))?.title).toBe("Renamed in bulk");
  });

  it("holds the outer action to the token too", async () => {
    const goalId = await newGoal("Win the mid-market");
    await expect(
      call("goals.delete", { id: goalId }, ["read", "write"]),
    ).rejects.toBeInstanceOf(ScopeCeilingRefused);
  });
});
