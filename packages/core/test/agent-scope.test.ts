import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The built-in agents read as themselves, and sandbox commits nothing
 * (completeness review H-04).
 *
 * The Champion and the Coach were seeded with one view binding per space and
 * no workspace-wide grant, and then read every goal, KPI, blocker and session
 * in the workspace, because none of their readers asked about bindings. A
 * sandboxed agent still wrote its nudges and proposals. Here a space the
 * Champion is not bound to is a space it cannot see; a company goal, which
 * belongs to no space, is bound by name and stays in sight; and sandbox mode
 * computes a run and discards it.
 */

const OWNER = "scope-owner";
const SECOND = "scope-second";

let workspaceId: string;
let spaceId: string;
let ownerMemberId: string;
let secondMemberId: string;
let companyGoalId: string;
let spaceGoalId: string;
let dueOn: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

const agentRow = async (kind: "champion" | "coach") => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ id: string; member_id: string }>(
    "select id, member_id from agents where workspace_id = $1 and kind = $2",
    [workspaceId, kind],
  );
  return rows[0] as { id: string; member_id: string };
};

/** Where an agent's own group holds a binding. */
const boundTo = async (kind: "champion" | "coach") => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    resource_type: string;
    resource_id: string;
  }>(
    `select c.resource_type, c.resource_id
       from agents a
       join access_groups g on g.member_id = a.member_id and g.kind = 'member'
       join access_bindings b on b.group_id = g.id and b.deleted_at is null
       join access_contexts c on c.id = b.context_id
      where a.workspace_id = $1 and a.kind = $2`,
    [workspaceId, kind],
  );
  return rows;
};

/** The goals a nudge was recorded about. */
const nudgedGoals = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ subject_id: string }>(
    `select distinct subject_id from nudges
      where workspace_id = $1 and subject_type = 'goal'`,
    [workspaceId],
  );
  return rows.map((row) => row.subject_id).sort();
};

const runChampionDaysPastDue = async (days: number) => {
  const wb = await workerDb();
  const at = new Date(`${dueOn}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return callAction({ pool: wb.appPool, ...context() }, "agents.runChampion", {
    now: at.toISOString(),
  });
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2), ($3, $3, $4)",
    [OWNER, "scope-owner@example.com", SECOND, "scope-second@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Scope Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Scope Second', 'active') returning id`,
    [workspaceId, SECOND],
  );
  secondMemberId = second.rows[0]?.id as string;

  const spaces = (await callAction(
    { pool: wb.appPool, ...context() },
    "spaces.list",
    {},
  )) as Array<{ id: string }>;
  spaceId = spaces[0]?.id as string;
  const cycle = (await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  )) as { id: string };

  companyGoalId = (
    (await callAction({ pool: wb.appPool, ...context() }, "goals.create", {
      title: "Become the preferred platform for mid-market teams",
      cycleId: cycle.id,
      level: "company",
      ownerKind: "workspace",
      championId: ownerMemberId,
      reviewerId: secondMemberId,
      weight: 1,
    })) as { id: string }
  ).id;
  spaceGoalId = (
    (await callAction({ pool: wb.appPool, ...context() }, "goals.create", {
      title: "Make onboarding the reason new customers stay",
      cycleId: cycle.id,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: secondMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string }
  ).id;

  const { rows } = await wb.admin.query<{ next: string }>(
    "select (next_check_in_at at time zone 'UTC')::date::text as next from goals where id = $1",
    [companyGoalId],
  );
  dueOn = rows[0]?.next as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("what the agents are bound to", () => {
  it("binds both agents to a company goal by name, and to a space goal through its space", async () => {
    for (const kind of ["champion", "coach"] as const) {
      const bindings = await boundTo(kind);
      expect(bindings).toContainEqual({
        resource_type: "goal",
        resource_id: companyGoalId,
      });
      expect(bindings).toContainEqual({
        resource_type: "space",
        resource_id: spaceId,
      });
      expect(bindings).not.toContainEqual({
        resource_type: "goal",
        resource_id: spaceGoalId,
      });
      // Still nothing workspace-wide: every binding names one item.
      expect(bindings.some((row) => row.resource_type === "workspace")).toBe(
        false,
      );
    }
  });

  /**
   * The goal is stored by its owner, not by the space it was sent with: only a
   * space-owned goal keeps `spaceId`. The binding used to be decided by the
   * space it was sent with, so a caller passing both, which the API, the
   * command line and the agent tools all allow, got a goal that belonged to no
   * space and that neither agent could see.
   */
  it("binds both agents to a goal sent with a space it does not belong to", async () => {
    const wb = await workerDb();
    const cycle = (await callAction(
      { pool: wb.appPool, ...context() },
      "cycles.current",
      { mode: "quarterly" },
    )) as { id: string };
    // The member's objective is an individual one, which the practice has
    // off by default, so this cycle is told to use it (P9-T07a-c).
    await callAction({ pool: wb.appPool, ...context() }, "cycles.update", {
      id: cycle.id,
      levels: ["company", "department", "team", "individual"],
    });
    for (const ownerKind of ["workspace", "member"] as const) {
      const goal = (await callAction(
        { pool: wb.appPool, ...context() },
        "goals.create",
        {
          title: `Win the ${ownerKind} segment before the next planning round`,
          cycleId: cycle.id,
          spaceId,
          level: ownerKind === "member" ? "individual" : "company",
          ownerKind,
          ...(ownerKind === "member" ? { memberId: ownerMemberId } : {}),
          championId: ownerMemberId,
          reviewerId: secondMemberId,
          weight: 1,
        },
      )) as { id: string };

      const { rows } = await wb.admin.query<{ space_id: string | null }>(
        "select space_id from goals where id = $1",
        [goal.id],
      );
      expect(rows[0]?.space_id, `${ownerKind} goal keeps no space`).toBeNull();
      for (const kind of ["champion", "coach"] as const) {
        expect(
          await boundTo(kind),
          `${kind} sees the ${ownerKind} goal`,
        ).toContainEqual({
          resource_type: "goal",
          resource_id: goal.id,
        });
      }
    }
  });

  it("gives a KPI that belongs to no space its own context, with both agents bound", async () => {
    const wb = await workerDb();
    const workspaceKpi = (await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.create",
      {
        title: "Net revenue retention",
        frequency: "monthly",
        direction: "higher_better",
        indicatorType: "lagging",
        tier: "output",
        aggregate: "sum",
        ownerKind: "workspace",
      },
    )) as { id: string };
    const spaceKpi = (await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.create",
      {
        title: "Activation rate",
        frequency: "weekly",
        direction: "higher_better",
        indicatorType: "leading",
        tier: "output",
        aggregate: "sum",
        ownerKind: "space",
        spaceId,
      },
    )) as { id: string };

    for (const kind of ["champion", "coach"] as const) {
      const bindings = await boundTo(kind);
      expect(bindings).toContainEqual({
        resource_type: "kpi",
        resource_id: workspaceKpi.id,
      });
      expect(bindings).not.toContainEqual({
        resource_type: "kpi",
        resource_id: spaceKpi.id,
      });
    }
  });
});

describe("the Champion reads through its bindings", () => {
  it("chases both goals while it is bound to both", async () => {
    await runChampionDaysPastDue(3);
    expect(await nudgedGoals()).toEqual([companyGoalId, spaceGoalId].sort());
  });

  it("cannot see a space it is no longer bound to, and still sees the company goal", async () => {
    const wb = await workerDb();
    const champion = await agentRow("champion");
    await wb.admin.query(
      `update access_bindings b set deleted_at = now()
         from access_groups g, access_contexts c
        where b.group_id = g.id and b.context_id = c.id
          and g.kind = 'member' and g.member_id = $1
          and c.resource_type = 'space' and c.resource_id = $2`,
      [champion.member_id, spaceId],
    );

    await runChampionDaysPastDue(3);
    expect(await nudgedGoals()).toEqual([companyGoalId]);
  });
});

describe("sandbox mode commits nothing", () => {
  it("computes the run, writes no nudge, and says what it would have done", async () => {
    const wb = await workerDb();
    const champion = await agentRow("champion");
    await callAction({ pool: wb.appPool, ...context() }, "agents.setAutonomy", {
      id: champion.id,
      autonomy: "sandbox",
    });

    const result = (await runChampionDaysPastDue(3)) as {
      recorded: number;
      runId: string;
    };

    // It did the work: the same run in propose mode records these.
    expect(result.recorded).toBeGreaterThan(0);
    // And kept none of it.
    const nudges = await wb.admin.query(
      "select 1 from nudges where workspace_id = $1",
      [workspaceId],
    );
    expect(nudges.rows).toEqual([]);
    const proposals = await wb.admin.query(
      "select 1 from proposed_changes where workspace_id = $1",
      [workspaceId],
    );
    expect(proposals.rows).toEqual([]);

    const run = await wb.admin.query<{
      log: readonly { kind: string; message: string }[];
    }>("select log from agent_runs where id = $1", [result.runId]);
    const log = run.rows[0]?.log ?? [];
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((entry) => entry.kind === "simulated")).toBe(true);
  });

  it("does the same for the Coach", async () => {
    const wb = await workerDb();
    const coach = await agentRow("coach");
    await callAction({ pool: wb.appPool, ...context() }, "agents.setAutonomy", {
      id: coach.id,
      autonomy: "sandbox",
    });
    await callAction({ pool: wb.appPool, ...context() }, "agents.runCoach", {});
    const nudges = await wb.admin.query(
      "select 1 from nudges where workspace_id = $1",
      [workspaceId],
    );
    expect(nudges.rows).toEqual([]);
    const findings = await wb.admin.query(
      "select 1 from alignment_findings where workspace_id = $1 and source = 'coach' and deleted_at is null",
      [workspaceId],
    );
    expect(findings.rows).toEqual([]);
  });
});

/**
 * The Champion records who an aging blocker was escalated to (completeness
 * review H-10). Nothing wrote `escalated_to_id`, so the review inbox's
 * "Escalated to you" never appeared for anybody.
 */
describe("blocker escalation", () => {
  it("stamps the highest rung reached, and the blocker reaches that person's inbox", async () => {
    const wb = await workerDb();
    const actor = { pool: wb.appPool, ...context() };
    const read = (await callAction(actor, "cycles.current", {
      mode: "quarterly",
    })) as { id: string };
    await callAction(actor, "cycles.update", {
      id: read.id,
      sponsorId: ownerMemberId,
    });
    const keyResult = (await callAction(actor, "goals.addKeyResult", {
      goalId: spaceGoalId,
      title: "Raise activation from 41% to 60%",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 41,
      targetValue: 60,
      weight: 1,
    })) as { id: string };
    const session = (await callAction(actor, "sessions.create", {
      spaceId,
      kind: "weekly",
      title: "Weekly check-in",
      scheduledFor: new Date().toISOString(),
      facilitatorId: ownerMemberId,
    })) as { id: string };
    const blocker = (await callAction(actor, "sessions.createBlocker", {
      sessionId: session.id,
      keyResultId: keyResult.id,
      type: "resource",
      ownerId: secondMemberId,
      nextAction: "Ask finance for the second contractor",
    })) as { id: string };

    // Past §11's sponsor rung, forty-eight hours by default, on the daily
    // cadence the blocker ladder runs on.
    await callAction(actor, "agents.runChampion", {
      now: new Date(Date.now() + 50 * 3_600_000).toISOString(),
      cadence: "daily",
    });

    const { rows } = await wb.admin.query<{
      escalated_to_id: string | null;
      escalated_at: Date | null;
    }>("select escalated_to_id, escalated_at from blockers where id = $1", [
      blocker.id,
    ]);
    expect(rows[0]?.escalated_to_id).toBe(ownerMemberId);
    expect(rows[0]?.escalated_at).not.toBeNull();

    const inbox = (await callAction(actor, "review.inbox", {})) as {
      obligations: { kind: string; meta: string }[];
    };
    expect(
      inbox.obligations.some(
        (item) =>
          item.kind === "blocker" && item.meta.startsWith("Escalated to you"),
      ),
    ).toBe(true);
  });
});
