import { trigger } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { urgentFor } from "../src/nudges/sweep.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The Champion's daily, weekly and per-cycle runs (P4-T05b).
 *
 * The task's test plan is three sentences, and each is a describe block below:
 * a goal past its staleness grace produces exactly one sweep result, a blocker
 * aging past its clock escalates, and the countdown fires on its own schedule
 * and not on the sweep's. The KPI corridor, the morning summary and the session
 * lifecycle are the rest of the daily and weekly deliverables and are covered
 * beside them.
 *
 * **On the first of those three.** The task card's acceptance criterion says the
 * champion is nudged when the daily sweep runs. AI-NATIVE-PLAN.md §6.2 puts the
 * check-in nudge in the **hourly** queue and gives the daily run the staleness
 * sweep, which flips health rather than sending a message. §6.2 outranks the
 * implementation plan, so the criterion is corrected in the same change and the
 * test asserts what §6.2 describes: the daily run flips the goal, once, and the
 * hourly ladder is what nudges about it.
 *
 * Every run is driven by `now`. A rhythm agent that read the clock could not be
 * tested against a blocker aging past forty-eight hours without waiting two
 * days, which is the whole reason the parameter exists.
 */

const OWNER = "cadence-owner";
const SECOND = "cadence-second";

let workspaceId: string;
let cycleId: string;
let spaceId: string;
let ownerMemberId: string;
let secondMemberId: string;

const context = (userId = OWNER) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

/** Runs one of the Champion's four cadences at a given instant. */
const runAt = async (
  cadence: "hourly" | "daily" | "weekly" | "cycle",
  at: Date,
) => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "agents.runChampion", {
    now: at.toISOString(),
    cadence,
  });
};

/** Every nudge the runs have delivered, rule key and subject. */
const sentNudges = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    rule_key: string;
    subject_type: string;
    subject_id: string;
    recipient_member_id: string;
    escalation_step: number;
  }>(
    `select rule_key, subject_type, subject_id, recipient_member_id,
            escalation_step
       from nudges
      where workspace_id = $1 and sent_at is not null
      order by rule_key, escalation_step`,
    [workspaceId],
  );
  return rows;
};

/** The trigger and log of every run, oldest first. */
const runs = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    trigger: string;
    status: string;
    log: readonly { message: string }[];
  }>(
    `select r.trigger, r.status, r.log
       from agent_runs r
       join agents a on a.id = r.agent_id
      where r.workspace_id = $1 and a.kind = 'champion'
      order by r.created_at`,
    [workspaceId],
  );
  return rows;
};

/** A goal whose next check-in is already `daysAgo` days in the past. */
const goalDueDaysAgo = async (daysAgo: number, title: string) => {
  const wb = await workerDb();
  const created = (await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      title,
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: secondMemberId,
      weight: 1,
    },
  )) as { id: string };

  // Backdating the due date rather than the clock, so the run under test still
  // receives a real `now`. The alternative, running the agent months in the
  // future, would also age every other row in the fixture.
  await wb.admin.query(
    `update goals
        set next_check_in_at = now() - ($2 || ' days')::interval,
            health = 'on_track'
      where id = $1`,
    [created.id, String(daysAgo)],
  );
  return created.id;
};

/** The stored health of a goal. */
const healthOf = async (goalId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ health: string }>(
    "select health from goals where id = $1",
    [goalId],
  );
  return rows[0]?.health;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Cadence Owner",
      "cadence-owner@example.com",
      SECOND,
      "Cadence Second",
      "cadence-second@example.com",
    ],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Cadence Owner",
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
     values (gen_random_uuid(), $1, $2, 'Cadence Second', 'active') returning id`,
    [workspaceId, SECOND],
  );
  secondMemberId = second.rows[0]?.id as string;
  await callAction({ pool: wb.appPool, ...context() }, "spaces.addMember", {
    spaceId,
    memberId: secondMemberId,
    role: "member",
  });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("urgency is read from the catalogue, never chosen per call site", () => {
  it("never marks a non-escalating trigger urgent", () => {
    // `urgent` bypasses quiet mode, the member's quiet hours and the
    // ten-a-week ceiling. Several of these repeat for as long as their
    // condition holds, so one marked urgent by hand would be unbounded noise:
    // the exact defect a simulated month found in the check-in ladder at
    // P4-T04c.
    for (const key of [
      "kpi.watch",
      "kpi.unhealthy",
      "kpi.recovery_proposed",
      "kpi.recovered",
      "digest.daily",
      "cycle.planning_opens",
      "cycle.deadline",
      "cycle.starts",
      "cycle.review_due",
      "cycle.closing",
      "blocker.warning",
      "session.due_soon",
      "session.open",
    ]) {
      expect(trigger(key)?.escalates, `${key} escalates`).toBe(false);
      expect(urgentFor(key, false), `${key} is urgent`).toBe(false);
    }
  });

  it("marks an escalation urgent, but never the owner's own copy of it", () => {
    for (const key of ["blocker.overdue", "blocker.escalated"]) {
      expect(urgentFor(key, false), `${key} to a third party`).toBe(true);
      expect(urgentFor(key, true), `${key} to the owner`).toBe(false);
    }
  });
});

describe("the daily run: the staleness sweep", () => {
  it("flips a goal past its grace to outdated, exactly once", async () => {
    // Three days past the grace, which is itself three days: six days overdue.
    const goalId = await goalDueDaysAgo(6, "Ship the migration tooling");
    expect(await healthOf(goalId)).toBe("on_track");

    const first = await runAt("daily", new Date());
    expect(first.staleFlipped).toBe(1);
    expect(await healthOf(goalId)).toBe("outdated");

    // Idempotent: the second run finds the goal already outdated and changes
    // nothing. A sweep that flipped it again would write an audit row a day
    // saying something happened when nothing did.
    const second = await runAt("daily", new Date());
    expect(second.staleFlipped).toBe(0);
    expect(await healthOf(goalId)).toBe("outdated");
  });

  it("leaves a goal inside its grace alone", async () => {
    // Two days overdue, grace is three: not stale yet.
    const goalId = await goalDueDaysAgo(2, "Reduce onboarding time to a day");
    const result = await runAt("daily", new Date());
    expect(result.staleFlipped).toBe(0);
    expect(await healthOf(goalId)).toBe("on_track");
  });

  it("names the flip in the run log, under its own trigger", async () => {
    await goalDueDaysAgo(6, "Ship the migration tooling");
    await runAt("daily", new Date());

    const [run] = await runs();
    // Its own trigger, not the hourly one. An administrator asking which clock
    // spoke has to be able to tell them apart.
    expect(run?.trigger).toBe("schedule.daily");
    expect(run?.status).toBe("completed");
    expect(
      run?.log.some((entry) => entry.message.includes("cadence.staleness")),
    ).toBe(true);
  });

  it("does not send the check-in ladder's nudges: those are the hourly queue's", async () => {
    await goalDueDaysAgo(6, "Ship the migration tooling");
    await runAt("daily", new Date());

    // §6.2 puts the nudge queue on the hour and the sweep on the day. The
    // daily run touching the ladder would mean two cadences reading the same
    // rows, and a run log that could not say which one spoke.
    const sent = await sentNudges();
    expect(sent.some((row) => row.rule_key.startsWith("checkin."))).toBe(false);
  });

  it("hands the same goal to the hourly queue, which does nudge about it", async () => {
    await goalDueDaysAgo(6, "Ship the migration tooling");
    await runAt("hourly", new Date());

    const sent = await sentNudges();
    expect(sent.some((row) => row.rule_key === "checkin.stale")).toBe(true);
  });
});

describe("the daily run: blocker aging", () => {
  /**
   * A blocker on a real key result, opened through P4-T07c's own action.
   *
   * Nothing is inserted by hand and nothing is backdated: the blocker opens
   * now, and each run below is asked about a `now` further along its clock.
   * That is what makes this a test of the ladder rather than of a fixture.
   */
  const openBlocker = async () => {
    const wb = await workerDb();
    const goal = (await callAction(
      { pool: wb.appPool, ...context() },
      "goals.create",
      {
        title: "Become the default choice for mid-market teams",
        cycleId,
        spaceId,
        level: "team",
        ownerKind: "space",
        championId: ownerMemberId,
        reviewerId: secondMemberId,
        weight: 1,
      },
    )) as { id: string };
    const keyResult = (await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResult",
      {
        goalId: goal.id,
        title: "Monthly active teams",
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 100,
        targetValue: 300,
        unit: "teams",
        weight: 1,
      },
    )) as { id: string };

    const session = (await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.create",
      {
        spaceId,
        cycleId,
        kind: "weekly",
        title: "Weekly check-in",
        scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
        facilitatorId: ownerMemberId,
      },
    )) as { id: string };
    await callAction({ pool: wb.appPool, ...context() }, "sessions.open", {
      id: session.id,
    });
    await callAction({ pool: wb.appPool, ...context() }, "sessions.castVote", {
      sessionId: session.id,
      keyResultId: keyResult.id,
      confidence: 0.3,
    });
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.revealVotes",
      { sessionId: session.id, keyResultId: keyResult.id },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.confirmConfidence",
      {
        sessionId: session.id,
        keyResultId: keyResult.id,
        confidence: 0.3,
        whatChanged: "The vendor contract slipped",
      },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.advanceStage",
      { id: session.id },
    );
    const blocker = (await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.createBlocker",
      {
        sessionId: session.id,
        keyResultId: keyResult.id,
        type: "dependency",
        ownerId: secondMemberId,
        nextAction: "Get the vendor to confirm the date by Thursday",
      },
    )) as { id: string };
    return { blockerId: blocker.id, goalId: goal.id };
  };

  /** Hours from now, as an instant a run can be asked about. */
  const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000);

  it("says nothing before the twenty-hour warning", async () => {
    await openBlocker();
    await runAt("daily", inHours(19));
    const sent = await sentNudges();
    expect(sent.filter((row) => row.rule_key.startsWith("blocker."))).toEqual(
      [],
    );
  });

  it("warns the blocker's owner at twenty hours, before the deadline", async () => {
    const { blockerId } = await openBlocker();
    await runAt("daily", inHours(20.5));

    const warnings = (await sentNudges()).filter(
      (row) => row.rule_key === "blocker.warning",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.subject_type).toBe("blocker");
    expect(warnings[0]?.subject_id).toBe(blockerId);
    // The blocker's own named owner, not the goal's champion. The person who
    // agreed to the next action is the person the clock is about.
    expect(warnings[0]?.recipient_member_id).toBe(secondMemberId);
  });

  it("escalates past the owner at twenty-four hours (acceptance criterion)", async () => {
    await openBlocker();
    await runAt("daily", inHours(25));

    const overdue = (await sentNudges()).filter(
      (row) => row.rule_key === "blocker.overdue",
    );
    expect(overdue.length).toBeGreaterThan(0);
    // The step widened: somebody other than the owner now hears about it.
    const recipients = new Set(overdue.map((row) => row.recipient_member_id));
    expect(recipients.has(secondMemberId)).toBe(true);
    expect(recipients.size).toBeGreaterThan(1);
    expect(overdue.every((row) => row.escalation_step === 2)).toBe(true);
  });

  it("reaches the sponsor at forty-eight hours", async () => {
    await openBlocker();
    await runAt("daily", inHours(49));

    const escalated = (await sentNudges()).filter(
      (row) => row.rule_key === "blocker.escalated",
    );
    expect(escalated.length).toBeGreaterThan(0);
    expect(escalated.every((row) => row.escalation_step === 3)).toBe(true);
  });

  it("stops the moment the blocker is resolved", async () => {
    const wb = await workerDb();
    const { blockerId } = await openBlocker();
    await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.resolveBlocker",
      { id: blockerId },
    );

    await runAt("daily", inHours(49));
    const sent = await sentNudges();
    expect(sent.filter((row) => row.rule_key.startsWith("blocker."))).toEqual(
      [],
    );
  });
});

describe("the daily run: KPI corridors and the morning summary", () => {
  /** A KPI owned by a member, with one recorded period. */
  const kpiAt = async (actual: number, target: number) => {
    const wb = await workerDb();
    const kpi = (await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.create",
      {
        title: "Operating margin",
        ownerKind: "member",
        memberId: ownerMemberId,
        frequency: "monthly",
        direction: "higher_better",
        indicatorType: "lagging",
        tier: "output",
        aggregate: "sum",
      },
    )) as { id: string };
    await callAction({ pool: wb.appPool, ...context() }, "kpis.record", {
      kpiId: kpi.id,
      on: new Date().toISOString().slice(0, 10),
      targetValue: target,
      actualValue: actual,
    });
    return kpi.id;
  };

  it("tells the owner when a KPI falls out of the healthy corridor", async () => {
    // 60 of 100 is below the 70 watch boundary: unhealthy.
    const kpiId = await kpiAt(60, 100);
    await runAt("daily", new Date());

    const unhealthy = (await sentNudges()).filter(
      (row) => row.rule_key === "kpi.unhealthy",
    );
    expect(unhealthy).toHaveLength(1);
    expect(unhealthy[0]?.subject_type).toBe("kpi");
    expect(unhealthy[0]?.subject_id).toBe(kpiId);
    expect(unhealthy[0]?.recipient_member_id).toBe(ownerMemberId);
  });

  it("says nothing about a KPI inside its corridor", async () => {
    await kpiAt(95, 100);
    await runAt("daily", new Date());
    const sent = await sentNudges();
    expect(sent.filter((row) => row.rule_key.startsWith("kpi."))).toEqual([]);
  });

  it("sends the morning summary at the member's own local hour and not at another", async () => {
    const wb = await workerDb();
    // 08:00 is the §4.14 default. Asia/Jakarta is UTC+7 all year, so 01:00 UTC
    // is 08:00 there and 02:00 UTC is not. A zone with no daylight shift keeps
    // this test about the hour rather than about the calendar.
    await wb.admin.query(
      "update workspace_members set timezone = 'Asia/Jakarta' where id = $1",
      [ownerMemberId],
    );

    const notMorning = new Date("2026-08-20T02:00:00Z");
    await runAt("daily", notMorning);
    expect(
      (await sentNudges()).filter((row) => row.rule_key === "digest.daily"),
    ).toEqual([]);

    const morning = new Date("2026-08-20T01:00:00Z");
    await runAt("daily", morning);
    const digests = (await sentNudges()).filter(
      (row) => row.rule_key === "digest.daily",
    );
    expect(digests).toHaveLength(1);
    expect(digests[0]?.recipient_member_id).toBe(ownerMemberId);
    // The subject is the member, so deduplication is per person per day.
    expect(digests[0]?.subject_type).toBe("member");
    expect(digests[0]?.subject_id).toBe(ownerMemberId);
  });

  it("sends nothing to a member who turned the summary off", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set timezone = 'Asia/Jakarta' where workspace_id = $1",
      [workspaceId],
    );
    // The preference lives in `notification_settings`, where P2-T06 put it,
    // and the row is created lazily. Only an explicit false turns the summary
    // off; an absent row means the table's default, which is on.
    await wb.admin.query(
      `insert into notification_settings
         (id, workspace_id, member_id, daily_summary)
       values (gen_random_uuid(), $1, $2, false)`,
      [workspaceId, ownerMemberId],
    );
    await runAt("daily", new Date("2026-08-20T01:00:00Z"));
    const digests = (await sentNudges()).filter(
      (row) => row.rule_key === "digest.daily",
    );
    expect(
      digests.some((row) => row.recipient_member_id === ownerMemberId),
    ).toBe(false);
  });

  it("still sends to a member who has never opened their settings", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set timezone = 'Asia/Jakarta' where workspace_id = $1",
      [workspaceId],
    );
    // No `notification_settings` row exists for anybody here. "Nothing must be
    // configured before the product works" is what this asserts.
    const { rows } = await wb.admin.query<{ count: string }>(
      "select count(*)::text as count from notification_settings where workspace_id = $1",
      [workspaceId],
    );
    expect(rows[0]?.count).toBe("0");

    await runAt("daily", new Date("2026-08-20T01:00:00Z"));
    const digests = (await sentNudges()).filter(
      (row) => row.rule_key === "digest.daily",
    );
    expect(
      digests.some((row) => row.recipient_member_id === ownerMemberId),
    ).toBe(true);
  });

  it("never sends the Champion its own morning summary", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set timezone = 'Asia/Jakarta' where workspace_id = $1",
      [workspaceId],
    );
    await runAt("daily", new Date("2026-08-20T01:00:00Z"));

    const { rows } = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 and kind = 'agent'",
      [workspaceId],
    );
    const agentIds = new Set(rows.map((row) => row.id));
    const digests = (await sentNudges()).filter(
      (row) => row.rule_key === "digest.daily",
    );
    expect(digests.length).toBeGreaterThan(0);
    expect(digests.some((row) => agentIds.has(row.recipient_member_id))).toBe(
      false,
    );
  });
});

describe("the weekly run: the session lifecycle", () => {
  const scheduleSession = async (scheduledFor: Date) => {
    const wb = await workerDb();
    return (await callAction(
      { pool: wb.appPool, ...context() },
      "sessions.create",
      {
        spaceId,
        cycleId,
        kind: "weekly",
        title: "Weekly check-in",
        scheduledFor: scheduledFor.toISOString(),
        facilitatorId: ownerMemberId,
      },
    )) as { id: string };
  };

  it("reminds the facilitator the day before", async () => {
    const at = new Date("2026-09-07T09:00:00Z");
    const session = await scheduleSession(at);
    await runAt("weekly", new Date("2026-09-06T15:00:00Z"));

    const dueSoon = (await sentNudges()).filter(
      (row) => row.rule_key === "session.due_soon",
    );
    expect(dueSoon).toHaveLength(1);
    expect(dueSoon[0]?.subject_type).toBe("session");
    expect(dueSoon[0]?.subject_id).toBe(session.id);
    expect(dueSoon[0]?.recipient_member_id).toBe(ownerMemberId);
  });

  it("says nothing a week out", async () => {
    await scheduleSession(new Date("2026-09-07T09:00:00Z"));
    await runAt("weekly", new Date("2026-08-31T09:00:00Z"));
    expect(
      (await sentNudges()).filter((row) => row.rule_key.startsWith("session.")),
    ).toEqual([]);
  });

  it("opens the session at its scheduled hour", async () => {
    await scheduleSession(new Date("2026-09-07T09:00:00Z"));
    await runAt("weekly", new Date("2026-09-07T09:05:00Z"));
    expect(
      (await sentNudges()).filter((row) => row.rule_key === "session.open"),
    ).toHaveLength(1);
  });

  it("calls it missed the next day, and calls a held one nothing", async () => {
    const missed = await scheduleSession(new Date("2026-09-07T09:00:00Z"));
    await runAt("weekly", new Date("2026-09-08T10:00:00Z"));

    const sent = (await sentNudges()).filter(
      (row) => row.rule_key === "session.missed",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject_id).toBe(missed.id);

    // A session somebody opened is not missed however late it ran.
    const wb = await workerDb();
    await wb.admin.query("delete from nudges where workspace_id = $1", [
      workspaceId,
    ]);
    await wb.admin.query(
      "update okr_sessions set state = 'running' where id = $1",
      [missed.id],
    );
    // Still inside the one-day missed window, so what silences it is the state
    // and not the clock. Running the assertion two days out would have passed
    // for the wrong reason.
    await runAt("weekly", new Date("2026-09-08T12:00:00Z"));
    expect(
      (await sentNudges()).filter((row) => row.rule_key.startsWith("session.")),
    ).toEqual([]);
  });

  it("stops talking about a session two days gone", async () => {
    await scheduleSession(new Date("2026-09-07T09:00:00Z"));
    // A permanent `missed` state would nudge about this session every day
    // until somebody deleted the row.
    await runAt("weekly", new Date("2026-09-09T10:00:00Z"));
    expect(
      (await sentNudges()).filter((row) => row.rule_key.startsWith("session.")),
    ).toEqual([]);
  });
});

describe("the per-cycle run: the countdown", () => {
  /** Sets the cycle's dates and the two roles the countdown addresses. */
  const cycleDates = async (dates: {
    startsOn?: string;
    endsOn?: string;
    publicationDeadline?: string | null;
    status?: string;
  }) => {
    const wb = await workerDb();
    await wb.admin.query(
      `update cycles
          set starts_on = coalesce($2::date, starts_on),
              ends_on = coalesce($3::date, ends_on),
              publication_deadline = $4::date,
              status = coalesce($5, status),
              sponsor_id = $6,
              facilitator_id = $7
        where id = $1`,
      [
        cycleId,
        dates.startsOn ?? null,
        dates.endsOn ?? null,
        dates.publicationDeadline ?? null,
        dates.status ?? null,
        secondMemberId,
        ownerMemberId,
      ],
    );
  };

  it("fires the fourteen-day milestone and stays quiet the day after", async () => {
    await cycleDates({ publicationDeadline: "2026-10-01" });

    await runAt("cycle", new Date("2026-09-17T09:00:00Z"));
    const fourteen = (await sentNudges()).filter(
      (row) => row.rule_key === "cycle.deadline",
    );
    // Sponsor and facilitator both: §6.4 addresses the deadline to the pair.
    expect(fourteen).toHaveLength(2);
    expect(new Set(fourteen.map((row) => row.recipient_member_id))).toEqual(
      new Set([ownerMemberId, secondMemberId]),
    );

    const wb = await workerDb();
    await wb.admin.query("delete from nudges where workspace_id = $1", [
      workspaceId,
    ]);
    // Thirteen days out is between the milestones, and the silence is the point
    // of naming three days rather than counting down aloud from fourteen.
    await runAt("cycle", new Date("2026-09-18T09:00:00Z"));
    expect(
      (await sentNudges()).filter((row) => row.rule_key === "cycle.deadline"),
    ).toEqual([]);
  });

  it("opens planning three weeks before a quarterly cycle starts", async () => {
    await cycleDates({ startsOn: "2026-10-01", endsOn: "2026-12-31" });
    await runAt("cycle", new Date("2026-09-10T09:00:00Z"));
    expect(
      (await sentNudges()).filter(
        (row) => row.rule_key === "cycle.planning_opens",
      ),
    ).toHaveLength(2);
  });

  it("asks the facilitator to prepare the review two weeks before the end", async () => {
    await cycleDates({ startsOn: "2026-07-01", endsOn: "2026-09-30" });
    await runAt("cycle", new Date("2026-09-16T09:00:00Z"));

    const reviewDue = (await sentNudges()).filter(
      (row) => row.rule_key === "cycle.review_due",
    );
    // The facilitator alone: preparing the pack is their job, and the sponsor
    // hears about it when the review itself is due.
    expect(reviewDue).toHaveLength(1);
    expect(reviewDue[0]?.recipient_member_id).toBe(ownerMemberId);
  });

  it("chases a cycle that ended unscored, and stops once it is closed", async () => {
    await cycleDates({
      startsOn: "2026-04-01",
      endsOn: "2026-06-30",
      status: "active",
    });
    await runAt("cycle", new Date("2026-07-03T09:00:00Z"));
    expect(
      (await sentNudges()).filter((row) => row.rule_key === "cycle.closing")
        .length,
    ).toBeGreaterThan(0);

    const wb = await workerDb();
    await wb.admin.query("delete from nudges where workspace_id = $1", [
      workspaceId,
    ]);
    await wb.admin.query("update cycles set status = 'closed' where id = $1", [
      cycleId,
    ]);
    await runAt("cycle", new Date("2026-07-03T09:00:00Z"));
    expect(
      (await sentNudges()).filter((row) => row.rule_key === "cycle.closing"),
    ).toEqual([]);
  });

  it("fires on its own schedule and not on the sweep's", async () => {
    // The test plan's third sentence, as one assertion. A goal past its grace
    // and a deadline fourteen days out are both true at this instant; the daily
    // run must produce the sweep and no countdown, and the cycle run the
    // reverse.
    await cycleDates({ publicationDeadline: "2026-10-01" });
    await goalDueDaysAgo(6, "Ship the migration tooling");

    const daily = await runAt("daily", new Date("2026-09-17T09:00:00Z"));
    expect(daily.staleFlipped).toBe(1);
    expect(
      (await sentNudges()).filter((row) => row.rule_key.startsWith("cycle.")),
    ).toEqual([]);

    const cycle = await runAt("cycle", new Date("2026-09-17T09:00:00Z"));
    expect(cycle.staleFlipped).toBe(0);
    expect(
      (await sentNudges()).filter((row) => row.rule_key === "cycle.deadline")
        .length,
    ).toBeGreaterThan(0);

    // Two runs, two triggers, each named for its own clock.
    expect((await runs()).map((row) => row.trigger)).toEqual([
      "schedule.daily",
      "schedule.cycle",
    ]);
  });
});
