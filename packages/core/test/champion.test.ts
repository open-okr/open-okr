import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The Champion agent, seeded and running (P4-T05a).
 *
 * The task's test plan is three sentences: the agent holds no workspace-wide
 * grant, a run with AI off still fires every trigger and drafts nothing, and a
 * run halts on the cost cap. Each one is a test below, against a real database.
 *
 * The run is driven by `now` for the same reason the nudge engine is: a rhythm
 * agent that read the clock could not be tested against a missed check-in
 * without waiting for one.
 */

const OWNER = "champion-owner";
const SECOND = "champion-second";

let workspaceId: string;
let cycleId: string;
let ownerMemberId: string;
let secondMemberId: string;
let dueOn: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

/** The seeded Champion's agent row, joined to the member it speaks as. */
const championRow = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    member_id: string;
    kind: string;
    schedule: string;
    autonomy: string;
    enabled: boolean;
    persona: string;
    member_kind: string;
    member_status: string;
  }>(
    `select a.id, a.member_id, a.kind, a.schedule, a.autonomy, a.enabled,
            a.persona, m.kind as member_kind, m.status as member_status
       from agents a
       join workspace_members m on m.id = a.member_id
      where a.workspace_id = $1 and a.kind = 'champion'`,
    [workspaceId],
  );
  return rows[0];
};

/** Every binding the Champion's own group holds, with what it is bound to. */
const championBindings = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    resource_type: string;
    resource_id: string;
    level: number;
  }>(
    `select c.resource_type, c.resource_id, b.level
       from agents a
       join access_groups g
         on g.member_id = a.member_id and g.kind = 'member'
       join access_bindings b on b.group_id = g.id
       join access_contexts c on c.id = b.context_id
      where a.workspace_id = $1 and a.kind = 'champion'
      order by c.resource_type`,
    [workspaceId],
  );
  return rows;
};

/** The run rows this agent has produced, newest last. */
const runs = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    trigger: string;
    status: string;
    log: readonly { kind: string; message: string }[];
    cost: string;
    error: string | null;
  }>(
    `select r.id, r.trigger, r.status, r.log, r.cost, r.error
       from agent_runs r
       join agents a on a.id = r.agent_id
      where r.workspace_id = $1 and a.kind = 'champion'
      order by r.created_at`,
    [workspaceId],
  );
  return rows;
};

/** The nudge rows the run delivered. */
const sentNudges = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ rule_key: string }>(
    `select rule_key from nudges
      where workspace_id = $1 and sent_at is not null
      order by rule_key`,
    [workspaceId],
  );
  return rows;
};

/** Runs the Champion as of a number of days past the seeded goal's due date. */
const runAt = async (daysPastDue: number) => {
  const wb = await workerDb();
  const at = new Date(`${dueOn}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + daysPastDue);
  return callAction({ pool: wb.appPool, ...context() }, "agents.runChampion", {
    now: at.toISOString(),
  });
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Champion Owner",
      "champion-owner@example.com",
      SECOND,
      "Champion Second",
      "champion-second@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Champion Owner",
  });
  workspaceId = provisioned.workspaceId;

  const current = await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  );
  cycleId = current?.id as string;

  const members = await wb.admin.query<{ id: string; user_id: string | null }>(
    "select id, user_id from workspace_members where workspace_id = $1",
    [workspaceId],
  );
  ownerMemberId = members.rows.find((row) => row.user_id === OWNER)
    ?.id as string;
  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Champion Second', 'active') returning id`,
    [workspaceId, SECOND],
  );
  secondMemberId = second.rows[0]?.id as string;

  const created = (await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      title: "Become the preferred platform for mid-market teams",
      cycleId,
      level: "company",
      ownerKind: "workspace",
      championId: ownerMemberId,
      reviewerId: secondMemberId,
      weight: 1,
    },
  )) as { id: string };

  const { rows: due } = await wb.admin.query<{ next: string }>(
    "select (next_check_in_at at time zone 'UTC')::date::text as next from goals where id = $1",
    [created.id],
  );
  dueOn = due[0]?.next as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the seeded Champion", () => {
  it("exists in every new workspace, as a member with an hourly schedule", async () => {
    const champion = await championRow();
    expect(champion).toBeDefined();
    expect(champion?.member_kind).toBe("agent");
    expect(champion?.member_status).toBe("active");
    expect(champion?.schedule).toBe("hourly");
    expect(champion?.enabled).toBe(true);
    // §12 A5: propose and approve. A seeded agent never starts with a
    // direct write.
    expect(champion?.autonomy).toBe("propose");
    expect(champion?.persona.length).toBeGreaterThan(0);
  });

  it("holds no workspace-wide binding", async () => {
    const bindings = await championBindings();
    expect(bindings.some((row) => row.resource_type === "workspace")).toBe(
      false,
    );
  });

  it("gains a binding on each space as the space is created", async () => {
    const before = await championBindings();
    const space = (await callAction(
      { pool: (await workerDb()).appPool, ...context() },
      "spaces.create",
      { name: "Product" },
    )) as { id: string };

    const after = await championBindings();
    const gained = after.filter(
      (row) => !before.some((was) => was.resource_id === row.resource_id),
    );
    expect(gained).toHaveLength(1);
    expect(gained[0]?.resource_type).toBe("space");
    expect(gained[0]?.resource_id).toBe(space.id);
    // Still nothing workspace-wide after growing.
    expect(after.some((row) => row.resource_type === "workspace")).toBe(false);
  });
});

describe("the hourly run, with AI off", () => {
  it("delivers every due nudge and records what fired", async () => {
    const result = await runAt(0);
    expect(result.recorded).toBeGreaterThan(0);

    const sent = await sentNudges();
    expect(sent.length).toBe(result.recorded);

    const [run] = await runs();
    expect(run?.trigger).toBe("schedule.hourly");
    expect(run?.status).toBe("completed");
    expect(run?.log.length).toBeGreaterThan(0);
    // The log names the rules, not just a count. A run log that says "3
    // nudges" cannot answer why any of them was sent.
    expect(run?.log.some((entry) => entry.message.includes("checkin."))).toBe(
      true,
    );
  });

  it("drafts nothing and spends nothing", async () => {
    await runAt(0);
    const [run] = await runs();
    expect(Number(run?.cost)).toBe(0);

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ count: string }>(
      "select count(*)::text as count from proposed_changes where workspace_id = $1",
      [workspaceId],
    );
    expect(rows[0]?.count).toBe("0");
  });

  it("is a run per hour, not a nudge per hour: the second run inside a day adds nothing", async () => {
    const first = await runAt(0);
    const second = await runAt(0);
    expect(first.recorded).toBeGreaterThan(0);
    expect(second.recorded).toBe(0);
    expect(await runs()).toHaveLength(2);
  });
});

describe("the cost cap", () => {
  it("halts the run and says so, rather than failing", async () => {
    const wb = await workerDb();
    // No admin card names this setting yet, so there is no action to call.
    // §4.14 resolves it from the workspace's own settings map, and that is
    // what the run reads.
    await wb.admin.query(
      `update workspaces
          set settings = settings || '{"agentRunCostCapUsd": 0}'::jsonb
        where id = $1`,
      [workspaceId],
    );

    const result = await runAt(0);
    expect(result.recorded).toBe(0);

    const [run] = await runs();
    expect(run?.status).toBe("cancelled");
    expect(run?.error).toBeNull();
    expect(
      run?.log.some((entry) => entry.message.toLowerCase().includes("cap")),
    ).toBe(true);
    // Halting is not failing. A cap that reported an error would page
    // somebody about a limit the workspace chose.
    expect(await sentNudges()).toHaveLength(0);
  });
});
