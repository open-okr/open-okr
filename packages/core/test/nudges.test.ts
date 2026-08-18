import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The due engine, against a real database (P4-T04a).
 *
 * The task's test plan: a trigger fires exactly on its condition, and every
 * nudge row carries a rule key, a channel and an escalation position. The
 * acceptance criterion is the fortnight: a champion who misses a check-in is
 * nudged on the due day and the ladder widens behind them.
 *
 * `now` is an input to the action, which is the only reason a fortnight can be
 * driven in a second. An engine that read the clock would need a fortnight to
 * test what §11's ladder says about a fortnight.
 */

const OWNER = "nudge-owner";
const SECOND = "nudge-second";

let workspaceId: string;
let cycleId: string;
let ownerMemberId: string;
let secondMemberId: string;
let goalId: string;
/** The local date the seeded goal's first check-in falls due. */
let dueOn: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

/** The nudge rows, straight from the table. */
const rows = async () => {
  const wb = await workerDb();
  const { rows: found } = await wb.admin.query<{
    rule_key: string;
    kind: string;
    channel: string;
    escalation_step: number;
    recipient_member_id: string;
    subject_type: string;
    subject_id: string;
    sent_at: string | null;
    suppressed_reason: string | null;
  }>(
    `select rule_key, kind, channel, escalation_step, recipient_member_id,
            subject_type, subject_id, sent_at, suppressed_reason
     from nudges where workspace_id = $1 order by escalation_step, rule_key`,
    [workspaceId],
  );
  return found;
};

/** Runs the engine as of a number of days past the goal's due date. */
const runAt = async (daysPastDue: number) => {
  const wb = await workerDb();
  const at = new Date(`${dueOn}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + daysPastDue);
  return callAction({ pool: wb.appPool, ...context() }, "nudges.run", {
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
      "Nudge Owner",
      "nudge-owner@example.com",
      SECOND,
      "Nudge Second",
      "nudge-second@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Nudge Owner",
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
     values (gen_random_uuid(), $1, $2, 'Nudge Second', 'active') returning id`,
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
  goalId = created.id;

  // The cadence stamped a first due date at creation (P3-T06). Read it rather
  // than computing it here: the anchor day and the frequency are §11 parameters
  // and a test that hardcoded a date would be testing its own arithmetic.
  const { rows: due } = await wb.admin.query<{ next: string }>(
    "select (next_check_in_at at time zone 'UTC')::date::text as next from goals where id = $1",
    [goalId],
  );
  dueOn = due[0]?.next as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("what fires, and exactly when", () => {
  it("says nothing a week before the due date", async () => {
    const result = await runAt(-7);
    expect(result.recorded).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it("nudges the champion the day before, and nobody else", async () => {
    const result = await runAt(-1);
    expect(result.ruleKeys).toEqual(["checkin.due_soon"]);
    const found = await rows();
    expect(found).toHaveLength(1);
    expect(found[0]?.recipient_member_id).toBe(ownerMemberId);
    expect(found[0]?.escalation_step).toBe(0);
  });

  it("nudges the champion on the due day, which is the acceptance criterion", async () => {
    const result = await runAt(0);
    expect(result.ruleKeys).toEqual(["checkin.due"]);
    const found = await rows();
    expect(found).toHaveLength(1);
    expect(found[0]?.rule_key).toBe("checkin.due");
    expect(found[0]?.recipient_member_id).toBe(ownerMemberId);
    expect(found[0]?.subject_type).toBe("goal");
    expect(found[0]?.subject_id).toBe(goalId);
  });

  it("carries a rule key, a channel and an escalation position on every row", async () => {
    await runAt(0);
    for (const row of await rows()) {
      // The task's test plan, asserted on the row rather than on the return
      // value: a run that reported correctly and stored nothing usable would
      // pass a test written against its output.
      expect(row.rule_key).not.toBe("");
      expect(row.channel).toBe("in_app");
      expect(row.escalation_step).toBeGreaterThanOrEqual(0);
      expect(row.kind).toBe("rhythm");
      expect(row.sent_at).not.toBeNull();
      expect(row.suppressed_reason).toBeNull();
    }
  });
});

describe("the ladder widens rather than repeating", () => {
  it("brings the reviewer in once the staleness grace is exceeded", async () => {
    // §11: reviewer when the grace is exceeded. The grace is a §11 parameter, so
    // the test reads it rather than writing 3.
    const wb = await workerDb();
    const { thresholds } = await callAction(
      { pool: wb.appPool, ...context() },
      "rhythm.read",
      {},
    );
    const grace = (thresholds as Record<string, number>)[
      "cadence.stalenessGraceDays"
    ] as number;

    // One day past, not at: the boundary is exclusive. §3.5 and `escalation`
    // agree that at exactly the grace limit the goal is not yet outdated and the
    // reviewer is not yet involved, and a test that ran at the boundary would
    // have been asserting the opposite rule.
    await runAt(grace + 1);
    const found = await rows();
    const recipients = new Set(found.map((row) => row.recipient_member_id));
    // The champion keeps being asked. §11's ladder widens rather than handing
    // the problem to somebody else, and dropping the champion at this step would
    // tell the one person who can act that it is no longer theirs.
    expect(recipients.has(ownerMemberId)).toBe(true);
    expect(recipients.has(secondMemberId)).toBe(true);
  });

  it("keeps the champion on every step of a fortnight", async () => {
    for (const day of [0, 1, 5, 8, 14]) {
      const wb = await workerDb();
      await wb.admin.query(
        "delete from notifications where workspace_id = $1",
        [workspaceId],
      );
      await wb.admin.query("delete from nudges where workspace_id = $1", [
        workspaceId,
      ]);
      await runAt(day);
      const found = await rows();
      expect(
        found.some((row) => row.recipient_member_id === ownerMemberId),
        `day ${day}`,
      ).toBe(true);
    }
  });
});

describe("who never hears anything", () => {
  it("says nothing about a closed goal", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "goals.close", {
      id: goalId,
      successStatus: "achieved",
      closeDecision: "keep",
      closeReason: "Done.",
      retrospectiveBody: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "It worked." }],
          },
        ],
      },
    });
    // A closed goal owes nobody a check-in, and nudging on one is the fastest
    // way to teach a champion to ignore the product.
    expect((await runAt(0)).recorded).toBe(0);
  });

  it("says nothing to a suspended member, while still nudging the rest", async () => {
    const wb = await workerDb();
    const { thresholds } = await callAction(
      { pool: wb.appPool, ...context() },
      "rhythm.read",
      {},
    );
    const grace = (thresholds as Record<string, number>)[
      "cadence.stalenessGraceDays"
    ] as number;

    // The reviewer, not the caller. Suspending the caller is refused by the
    // Operation pipeline before any of this runs, which is correct and a
    // different test: a suspended member is told what an outsider is told.
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [secondMemberId],
    );

    // Past the grace, so the ladder reaches the reviewer. A nudge to somebody
    // who cannot open the product is an email to a former colleague.
    await runAt(grace + 1);
    const found = await rows();
    expect(found.length).toBeGreaterThan(0);
    expect(
      found.some((row) => row.recipient_member_id === secondMemberId),
    ).toBe(false);
    expect(found.some((row) => row.recipient_member_id === ownerMemberId)).toBe(
      true,
    );
  });
});

describe("the nudge log", () => {
  it("reads back this member's own nudges with the rule that caused each", async () => {
    const wb = await workerDb();
    await runAt(0);
    const { nudges: mine } = await callAction(
      { pool: wb.appPool, ...context() },
      "nudges.list",
      { limit: 50 },
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.ruleKey).toBe("checkin.due");
    expect(mine[0]?.sentAt).not.toBeNull();
  });

  it("links each nudge to a row in the in-app inbox", async () => {
    const wb = await workerDb();
    await runAt(0);
    const { rows: linked } = await wb.admin.query<{ count: string }>(
      `select count(*)::text as count from notifications n
       join nudges g on g.id = n.nudge_id
       where n.workspace_id = $1`,
      [workspaceId],
    );
    // The `nudge_id` column has carried since migration 0013 with nothing to
    // point at. This is the first thing that fills it.
    expect(Number(linked[0]?.count)).toBe(1);
  });
});

/**
 * Suppression, against a real database (P4-T04b).
 *
 * The pure decision is golden-master tested in `packages/method`. These are the
 * cases that need rows: that the previous nudge is found, that a suppressed one
 * is a row rather than an absence, and that it gets no inbox entry.
 */
describe("what the product decides not to say", () => {
  it("writes a row with a reason rather than nothing at all", async () => {
    const wb = await workerDb();
    await runAt(0);
    // The same day, the same subject, the same step: deduplication.
    const again = await runAt(0);
    expect(again.recorded).toBe(0);
    expect(again.suppressed).toBe(1);

    const found = await rows();
    expect(found).toHaveLength(2);
    const swallowed = found.filter((row) => row.suppressed_reason !== null);
    expect(swallowed).toHaveLength(1);
    expect(swallowed[0]?.suppressed_reason).toBe("dedup");
    // A suppressed nudge is never also sent, which the migration enforces.
    expect(swallowed[0]?.sent_at).toBeNull();
  });

  it("gives a suppressed nudge no inbox row, because nobody saw it", async () => {
    const wb = await workerDb();
    await runAt(0);
    await runAt(0);
    const { rows: inbox } = await wb.admin.query<{ count: string }>(
      "select count(*)::text as count from notifications where workspace_id = $1",
      [workspaceId],
    );
    expect(Number(inbox[0]?.count)).toBe(1);
  });

  it("lets the escalation through the same window, because the step moved", async () => {
    const wb = await workerDb();
    const { thresholds } = await callAction(
      { pool: wb.appPool, ...context() },
      "rhythm.read",
      {},
    );
    const grace = (thresholds as Record<string, number>)[
      "cadence.stalenessGraceDays"
    ] as number;

    await runAt(0);
    // Past the grace on the same clock day would still be inside the
    // deduplication window, and the step has increased, so §11 says it speaks.
    const escalated = await runAt(grace + 1);
    expect(escalated.recorded).toBeGreaterThan(0);
  });

  it("stays quiet while workspace quiet mode is on, and says that is why", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update rhythm_settings set quiet_mode = true where workspace_id = $1",
      [workspaceId],
    );
    const result = await runAt(0);
    expect(result.recorded).toBe(0);
    expect(result.suppressed).toBe(1);
    expect((await rows())[0]?.suppressed_reason).toBe("quiet_hours");
  });

  it("still escalates through workspace quiet mode", async () => {
    const wb = await workerDb();
    const { thresholds } = await callAction(
      { pool: wb.appPool, ...context() },
      "rhythm.read",
      {},
    );
    const grace = (thresholds as Record<string, number>)[
      "cadence.stalenessGraceDays"
    ] as number;
    await wb.admin.query(
      "update rhythm_settings set quiet_mode = true where workspace_id = $1",
      [workspaceId],
    );
    // §6.3: quiet mode silences everything except escalations. A goal stale past
    // its grace is not a message somebody can read in the morning.
    expect((await runAt(grace + 1)).recorded).toBeGreaterThan(0);
  });

  it("stays quiet for a switched-off rule, and calls it disabled", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into nudge_rules (id, workspace_id, rule_key, enabled)
       values (gen_random_uuid(), $1, 'checkin.due', false)`,
      [workspaceId],
    );
    const result = await runAt(0);
    expect(result.recorded).toBe(0);
    // Not "held": turned off. The volume dashboard should not read a switched-off
    // rule as noise the product decided to swallow.
    expect((await rows())[0]?.suppressed_reason).toBe("disabled");
  });

  it("needs no rule rows at all to work, which is §4.14's promise", async () => {
    const wb = await workerDb();
    const { rows: none } = await wb.admin.query<{ count: string }>(
      "select count(*)::text as count from nudge_rules where workspace_id = $1",
      [workspaceId],
    );
    expect(Number(none[0]?.count)).toBe(0);
    // A fresh workspace has no rows and every rule is enabled on the canon
    // ladder. Seeding forty-four would make the table the catalogue's second
    // home.
    expect((await runAt(0)).recorded).toBe(1);
  });

  it("holds an ordinary nudge inside a member's own quiet hours", async () => {
    const wb = await workerDb();
    // The run below lands at 02:00 in this member's timezone.
    await wb.admin.query(
      `update workspace_members
       set timezone = 'UTC', quiet_hours = '{"start":"22:00","end":"07:00"}'::jsonb
       where id = $1`,
      [ownerMemberId],
    );
    const at = new Date(`${dueOn}T02:00:00Z`);
    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "nudges.run",
      { now: at.toISOString() },
    );
    expect(result.recorded).toBe(0);
    expect((await rows())[0]?.suppressed_reason).toBe("quiet_hours");
  });
});
