import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The Coach agent and its quality pass (P4-T06a).
 *
 * The task's test plan is two sentences: a message citing a rule key the method
 * package does not define fails the build, and with AI off the quality triggers
 * still fire. The first is enforced by `isTriggerKey` inside the reader and is
 * asserted here by driving a real failing goal and reading back the key; the
 * second is the whole file, because **there is no AI provider configured in this
 * suite at all**. Every nudge below is deterministic by construction rather than
 * by claim.
 *
 * The acceptance criterion is the last test: a goal saved with a failing rule,
 * the Coach runs, a nudge cites that rule key and the goal it links to carries
 * the failing check.
 */

const OWNER = "coach-owner";
const SECOND = "coach-second";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let ownerMemberId: string;
let secondMemberId: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

/** The seeded Coach's agent row, joined to the member it speaks as. */
const coachRow = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    id: string;
    kind: string;
    schedule: string;
    autonomy: string;
    enabled: boolean;
    persona: string;
    member_kind: string;
    member_status: string;
  }>(
    `select a.id, a.kind, a.schedule, a.autonomy, a.enabled, a.persona,
            m.kind as member_kind, m.status as member_status
       from agents a
       join workspace_members m on m.id = a.member_id
      where a.workspace_id = $1 and a.kind = 'coach'`,
    [workspaceId],
  );
  return rows[0];
};

/** Every binding the Coach's own group holds. */
const coachBindings = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    resource_type: string;
    resource_id: string;
    level: number;
  }>(
    `select c.resource_type, c.resource_id, b.level
       from agents a
       join access_groups g on g.member_id = a.member_id and g.kind = 'member'
       join access_bindings b on b.group_id = g.id
       join access_contexts c on c.id = b.context_id
      where a.workspace_id = $1 and a.kind = 'coach'
      order by c.resource_type`,
    [workspaceId],
  );
  return rows;
};

const sentNudges = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    rule_key: string;
    kind: string;
    subject_type: string;
    subject_id: string;
    recipient_member_id: string;
    escalation_step: number;
  }>(
    `select rule_key, kind, subject_type, subject_id, recipient_member_id,
            escalation_step
       from nudges
      where workspace_id = $1 and sent_at is not null
      order by rule_key`,
    [workspaceId],
  );
  return rows;
};

const runCoach = async () => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "agents.runCoach", {});
};

/** The stored quality flags on a goal, which the nudge's subject links to. */
const flagsOf = async (goalId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ quality_flags: string[] }>(
    "select quality_flags from goals where id = $1",
    [goalId],
  );
  return rows[0]?.quality_flags ?? [];
};

const createGoal = async (title: string) => {
  const wb = await workerDb();
  return (await callAction({ pool: wb.appPool, ...context() }, "goals.create", {
    title,
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: ownerMemberId,
    reviewerId: secondMemberId,
    weight: 1,
  })) as { id: string };
};

const addKeyResult = async (
  goalId: string,
  title: string,
  indicatorType: "leading" | "lagging",
) => {
  const wb = await workerDb();
  return (await callAction(
    { pool: wb.appPool, ...context() },
    "goals.addKeyResult",
    {
      goalId,
      title,
      direction: "increase",
      indicatorType,
      baselineValue: 100,
      targetValue: 300,
      unit: "teams",
      weight: 1,
    },
  )) as { id: string };
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Coach Owner",
      "coach-owner@example.com",
      SECOND,
      "Coach Second",
      "coach-second@example.com",
    ],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Coach Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const spaces = (await callAction(
    { pool: wb.appPool, ...context() },
    "spaces.list",
    {},
  )) as { id: string }[];
  spaceId = spaces[0]?.id as string;

  const current = (await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  )) as { id: string };
  cycleId = current.id;

  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Coach Second', 'active') returning id`,
    [workspaceId, SECOND],
  );
  secondMemberId = second.rows[0]?.id as string;
  await callAction({ pool: wb.appPool, ...context() }, "spaces.addMember", {
    spaceId,
    memberId: secondMemberId,
    role: "member",
  });
  // **Quiet hours off for this workspace, or these tests keep the time of
  // day.** Every member is provisioned with §4.14's 19:00 to 08:00 window, so
  // a suite asserting that a nudge was *delivered* silently passes in the
  // afternoon and fails overnight. Continuous integration found this at 01:39
  // UTC, having been written against local runs in the early afternoon.
  // Suppression has its own suite at P4-T04b; here it is noise that decides
  // the result.
  await wb.admin.query(
    "update workspace_members set quiet_hours = null where workspace_id = $1",
    [workspaceId],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the seeded Coach", () => {
  it("exists in every new workspace, continuous and proposing", async () => {
    const coach = await coachRow();
    expect(coach).toBeDefined();
    expect(coach?.member_kind).toBe("agent");
    expect(coach?.member_status).toBe("active");
    // §6.1's table: the Coach evaluates on every write, which P4-T02a already
    // does inside the writing transaction.
    expect(coach?.schedule).toBe("continuous");
    expect(coach?.enabled).toBe(true);
    // §12 A5 and design §1.4. `scoped_direct` is an explicit opt-in and never
    // something a seed does.
    expect(coach?.autonomy).toBe("propose");
    expect(coach?.persona.length).toBeGreaterThan(0);
  });

  it("holds no workspace-wide binding", async () => {
    const bindings = await coachBindings();
    expect(bindings.some((row) => row.resource_type === "workspace")).toBe(
      false,
    );
  });

  it("gains a view binding on each space as the space is created", async () => {
    const before = await coachBindings();
    const space = (await callAction(
      { pool: (await workerDb()).appPool, ...context() },
      "spaces.create",
      { name: "Product" },
    )) as { id: string };

    const after = await coachBindings();
    const gained = after.filter(
      (row) => !before.some((was) => was.resource_id === row.resource_id),
    );
    expect(gained).toHaveLength(1);
    expect(gained[0]?.resource_type).toBe("space");
    expect(gained[0]?.resource_id).toBe(space.id);
    // `view`, not `edit`: the Coach writes nothing, and P4-T02a recomputes the
    // flags inside the transaction of whoever edited the goal.
    expect(gained[0]?.level).toBe(10);
    expect(after.some((row) => row.resource_type === "workspace")).toBe(false);
  });

  it("lives beside the Champion rather than replacing it", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ kind: string }>(
      "select kind from agents where workspace_id = $1 order by kind",
      [workspaceId],
    );
    expect(rows.map((row) => row.kind)).toEqual(["champion", "coach"]);
  });
});

describe("the quality pass, with no provider configured", () => {
  it("cites quality.all_lagging when every key result is lagging", async () => {
    const goal = await createGoal("Become the preferred platform for teams");
    await addKeyResult(goal.id, "Monthly active teams", "lagging");
    await addKeyResult(goal.id, "Weekly retained teams", "lagging");

    await runCoach();

    const lagging = (await sentNudges()).filter(
      (row) => row.rule_key === "quality.all_lagging",
    );
    expect(lagging).toHaveLength(1);
    expect(lagging[0]?.kind).toBe("quality");
    expect(lagging[0]?.subject_type).toBe("goal");
    expect(lagging[0]?.subject_id).toBe(goal.id);
    // §6.4 addresses it to the champion.
    expect(lagging[0]?.recipient_member_id).toBe(ownerMemberId);
    // No ladder: none of §6.4's quality triggers escalates.
    expect(lagging[0]?.escalation_step).toBe(0);

    // "Links to the rule" is the goal's own stored flags naming the check,
    // which is why the nudge needs no detail column of its own.
    expect(await flagsOf(goal.id)).toContain("KR-4");
  });

  it("says nothing about all-lagging when the set is mixed", async () => {
    const goal = await createGoal("Become the preferred platform for teams");
    await addKeyResult(goal.id, "Monthly active teams", "lagging");
    await addKeyResult(goal.id, "Trial starts per week", "leading");

    await runCoach();
    expect(
      (await sentNudges()).filter(
        (row) => row.rule_key === "quality.all_lagging",
      ),
    ).toEqual([]);
  });

  it("does not mistake an all-leading set for an all-lagging one", async () => {
    // KR-4 trips on both, and only one of them is `quality.all_lagging`. A
    // trigger chosen from the stored flag id alone would send the wrong
    // message here, which is the whole reason the reader re-evaluates and
    // matches on the condition.
    const goal = await createGoal("Become the preferred platform for teams");
    await addKeyResult(goal.id, "Trial starts per week", "leading");
    await addKeyResult(goal.id, "Demo requests per week", "leading");

    await runCoach();
    expect(await flagsOf(goal.id)).toContain("KR-4");
    expect(
      (await sentNudges()).filter(
        (row) => row.rule_key === "quality.all_lagging",
      ),
    ).toEqual([]);
  });

  it("leaves a closed goal alone", async () => {
    const goal = await createGoal("Become the preferred platform for teams");
    await addKeyResult(goal.id, "Monthly active teams", "lagging");
    await addKeyResult(goal.id, "Weekly retained teams", "lagging");

    // Closed through the real action, not a raw update: `goals` carries a
    // `goals_close_is_complete` check constraint, and a fixture that set
    // `closed_at` alone would be closing a goal in a way the product cannot.
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "goals.close", {
      id: goal.id,
      successStatus: "missed",
      closeDecision: "abandon",
      retrospectiveBody: {
        type: "doc" as const,
        content: [
          {
            type: "paragraph" as const,
            content: [
              { type: "text" as const, text: "The market moved first." },
            ],
          },
        ],
      },
    });

    await runCoach();
    // A closed goal's key results cannot be improved. Coaching it is asking
    // somebody to rewrite history.
    expect(
      (await sentNudges()).filter((row) => row.rule_key.startsWith("quality.")),
    ).toEqual([]);
  });

  it("says nothing at all about a workspace with no goals", async () => {
    const result = (await runCoach()) as {
      recorded: number;
      ruleKeys: string[];
    };
    expect(result.recorded).toBe(0);
    expect(result.ruleKeys).toEqual([]);
  });

  it("records the run under its own trigger, separate from the Champion's", async () => {
    const goal = await createGoal("Become the preferred platform for teams");
    await addKeyResult(goal.id, "Monthly active teams", "lagging");
    await addKeyResult(goal.id, "Weekly retained teams", "lagging");
    await runCoach();

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      trigger: string;
      status: string;
      kind: string;
      log: { message: string }[];
    }>(
      `select r.trigger, r.status, a.kind, r.log
         from agent_runs r join agents a on a.id = r.agent_id
        where r.workspace_id = $1`,
      [workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("coach");
    expect(rows[0]?.trigger).toBe("schedule.quality");
    expect(rows[0]?.status).toBe("completed");
    // One log entry per rule, not a count: a run log saying "3 nudges" cannot
    // answer why any of them was sent.
    expect(
      rows[0]?.log.some((entry) => entry.message.includes("quality.")),
    ).toBe(true);
  });

  it("spends nothing and proposes nothing", async () => {
    const goal = await createGoal("Become the preferred platform for teams");
    await addKeyResult(goal.id, "Monthly active teams", "lagging");
    await addKeyResult(goal.id, "Weekly retained teams", "lagging");
    await runCoach();

    const wb = await workerDb();
    const { rows: cost } = await wb.admin.query<{ cost: string }>(
      "select cost from agent_runs where workspace_id = $1",
      [workspaceId],
    );
    expect(Number(cost[0]?.cost)).toBe(0);
    // The rewrite assist is P4-T06c and the semantic sweep is P4-T06b. This
    // run reads stored verdicts and proposes nothing.
    const { rows: proposals } = await wb.admin.query<{ count: string }>(
      "select count(*)::text as count from proposed_changes where workspace_id = $1",
      [workspaceId],
    );
    expect(proposals[0]?.count).toBe("0");
  });

  it("holds the second run inside a day, so a standing complaint is said once", async () => {
    const goal = await createGoal("Become the preferred platform for teams");
    await addKeyResult(goal.id, "Monthly active teams", "lagging");
    await addKeyResult(goal.id, "Weekly retained teams", "lagging");

    const first = (await runCoach()) as { recorded: number };
    expect(first.recorded).toBeGreaterThan(0);

    const second = (await runCoach()) as {
      recorded: number;
      suppressed: number;
    };
    // The deduplication window, the same one the rhythm cadences use. A goal
    // written the way it is written stays that way, so an unheld second run
    // would repeat the same complaint every time anybody called it.
    expect(second.recorded).toBe(0);
    expect(second.suppressed).toBeGreaterThan(0);
  });

  it("refuses to run when the Coach is turned off", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update agents set enabled = false where workspace_id = $1 and kind = 'coach'",
      [workspaceId],
    );
    await expect(runCoach()).rejects.toThrow(/turned off/i);
  });
});
