import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Check-ins against a real database (P3-T07, METHOD.md §7.2, design §6).
 *
 * The task's test plan, one test each: a draft emits nothing and moves nothing;
 * publication snapshots, advances the cadence and creates the reviewer's
 * obligation; an edit after the window is refused; deleting the latest check-in
 * restores the pointers; a non-reviewer cannot acknowledge; and votes stay hidden
 * until the reveal.
 */

const CHAMPION = "checkin-champion";
const REVIEWER = "checkin-reviewer";

let workspaceId: string;
let cycleId: string;
let championId: string;
let reviewerId: string;
let goalId: string;
let keyResultId: string;

const context = (userId = CHAMPION) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const richText = (text: string) =>
  ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  }) as never;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      CHAMPION,
      "Champion",
      "checkin-champion@example.com",
      REVIEWER,
      "Reviewer",
      "checkin-reviewer@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: CHAMPION,
    name: "Champion",
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
  championId = members.rows.find((row) => row.user_id === CHAMPION)
    ?.id as string;

  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Reviewer', 'active') returning id`,
    [workspaceId, REVIEWER],
  );
  reviewerId = second.rows[0]?.id as string;

  const goal = await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      title: "Make mobile the way our customers prefer to reach us",
      cycleId,
      level: "company",
      ownerKind: "workspace",
      championId,
      reviewerId,
      weight: 1,
    },
  );
  goalId = goal.id;

  const keyResult = await callAction(
    { pool: wb.appPool, ...context() },
    "goals.addKeyResult",
    {
      goalId,
      title: "Raise activation from 40 to 100",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 40,
      targetValue: 100,
      weight: 1,
    },
  );
  keyResultId = keyResult.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a draft", () => {
  it("moves nothing: no value history, no cadence movement, no notification", async () => {
    const wb = await workerDb();
    const before = await wb.admin.query<{
      next_check_in_at: Date;
      health: string;
    }>("select next_check_in_at, health from goals where id = $1", [goalId]);
    const historyBefore = await wb.admin.query(
      "select id from key_result_values where key_result_id = $1 and deleted_at is null",
      [keyResultId],
    );

    const draft = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.startCheckIn",
      { goalId },
    );
    expect(draft.reopened).toBe(false);

    const after = await wb.admin.query<{
      next_check_in_at: Date;
      health: string;
    }>("select next_check_in_at, health from goals where id = $1", [goalId]);
    const historyAfter = await wb.admin.query(
      "select id from key_result_values where key_result_id = $1 and deleted_at is null",
      [keyResultId],
    );
    const notifications = await wb.admin.query(
      "select id from notifications where workspace_id = $1 and reason = 'review'",
      [workspaceId],
    );

    expect(after.rows[0]?.next_check_in_at).toEqual(
      before.rows[0]?.next_check_in_at,
    );
    expect(after.rows[0]?.health).toBe(before.rows[0]?.health);
    expect(historyAfter.rows).toHaveLength(historyBefore.rows.length);
    expect(notifications.rows).toHaveLength(0);
  });

  it("is reopened rather than duplicated", async () => {
    const wb = await workerDb();
    const first = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.startCheckIn",
      { goalId },
    );
    const second = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.startCheckIn",
      { goalId },
    );
    expect(second.id).toBe(first.id);
    expect(second.reopened).toBe(true);
  });

  it("is visible to its author and to nobody else", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "goals.startCheckIn", {
      goalId,
    });

    const mine = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.checkIns",
      { goalId, includeDrafts: true },
    );
    expect(mine.checkIns).toHaveLength(1);

    const theirs = await callAction(
      { pool: wb.appPool, ...context(REVIEWER) },
      "goals.checkIns",
      { goalId, includeDrafts: true },
    );
    expect(theirs.checkIns).toHaveLength(0);
  });
});

describe("publication", () => {
  it("snapshots the movement, moves health and creates the obligation", async () => {
    // The task's acceptance criterion: 40 to 55 with a caution status.
    const wb = await workerDb();
    const before = await wb.admin.query<{ next_check_in_at: Date }>(
      "select next_check_in_at from goals where id = $1",
      [goalId],
    );

    const draft = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.startCheckIn",
      { goalId },
    );
    const published = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.publishCheckIn",
      {
        id: draft.id,
        status: "caution",
        confidence: 0.5,
        narrative: richText("Activation moved, onboarding is the lever."),
        values: [{ keyResultId, value: 55 }],
      },
    );
    expect(published.valuesWritten).toBe(1);

    const goal = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: goalId },
    );
    // Health rule 3 now has a status to read.
    expect(goal.health).toBe("caution");
    expect(goal.keyResults[0]?.currentValue).toBe(55);
    // 40 to 100, now at 55.
    expect(goal.progressPct).toBe(25);

    const timeline = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.checkIns",
      { goalId, includeDrafts: false },
    );
    const entry = timeline.checkIns[0]?.entries[0];
    expect(entry?.value).toBe(55);
    expect(entry?.previousValue).toBe(40);

    // The cadence advanced.
    const after = await wb.admin.query<{ next_check_in_at: Date }>(
      "select next_check_in_at from goals where id = $1",
      [goalId],
    );
    expect(
      new Date(after.rows[0]?.next_check_in_at as Date).getTime(),
    ).toBeGreaterThan(
      new Date(before.rows[0]?.next_check_in_at as Date).getTime(),
    );

    // The reviewer owes an acknowledgement.
    const obligations = await wb.admin.query(
      "select id from notifications where workspace_id = $1 and reason = 'review' and recipient_member_id = $2",
      [workspaceId, reviewerId],
    );
    expect(obligations.rows).toHaveLength(1);
    expect(timeline.checkIns[0]?.acknowledgedAt).toBeNull();
  });

  it("refuses a publication with no narrative", async () => {
    const wb = await workerDb();
    const draft = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.startCheckIn",
      { goalId },
    );
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "goals.publishCheckIn", {
        id: draft.id,
        status: "on_track",
        confidence: 0.8,
        narrative: null,
        values: [],
      }),
    ).rejects.toThrow(/narrative/i);
  });

  it("writes no history row for a value that did not change", async () => {
    const wb = await workerDb();
    const draft = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.startCheckIn",
      { goalId },
    );
    const published = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.publishCheckIn",
      {
        id: draft.id,
        status: "on_track",
        confidence: 0.8,
        narrative: richText("Nothing moved this week, and that is the news."),
        values: [{ keyResultId, value: 40 }],
      },
    );
    // A sparkline should show movement, not the heartbeat of somebody opening a
    // form.
    expect(published.valuesWritten).toBe(0);
  });
});

describe("the edit window", () => {
  it("refuses an edit once the next check-in is due", async () => {
    const wb = await workerDb();
    const draft = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.startCheckIn",
      { goalId },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.publishCheckIn",
      {
        id: draft.id,
        status: "on_track",
        confidence: 0.8,
        narrative: richText("On track."),
        values: [],
      },
    );

    // The period has finished.
    await wb.admin.query(
      "update goals set next_check_in_at = now() - interval '1 day' where id = $1",
      [goalId],
    );

    await expect(
      callAction({ pool: wb.appPool, ...context() }, "goals.editCheckIn", {
        id: draft.id,
        status: "caution",
        values: [],
      }),
    ).rejects.toThrow(/finished period/i);
  });

  it("keeps the old snapshot when an edit inside the window re-snapshots", async () => {
    const wb = await workerDb();
    const draft = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.startCheckIn",
      { goalId },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.publishCheckIn",
      {
        id: draft.id,
        status: "on_track",
        confidence: 0.8,
        narrative: richText("On track."),
        values: [{ keyResultId, value: 50 }],
      },
    );

    await callAction({ pool: wb.appPool, ...context() }, "goals.editCheckIn", {
      id: draft.id,
      status: "caution",
      values: [{ keyResultId, value: 60 }],
    });

    const snapshots = await wb.admin.query<{ entries: unknown }>(
      "select entries from check_in_snapshots where check_in_id = $1 order by at",
      [draft.id],
    );
    // Two snapshots, not one rewritten: the difference a reviewer already read
    // cannot change under them.
    expect(snapshots.rows).toHaveLength(2);

    const timeline = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.checkIns",
      { goalId, includeDrafts: false },
    );
    expect(timeline.checkIns[0]?.status).toBe("caution");
    expect(timeline.checkIns[0]?.entries[0]?.value).toBe(60);
  });
});

describe("deletion", () => {
  it("rolls the goal back to what it said before the latest check-in", async () => {
    const wb = await workerDb();
    const before = await wb.admin.query<{ next_check_in_at: Date }>(
      "select next_check_in_at from goals where id = $1",
      [goalId],
    );

    const draft = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.startCheckIn",
      { goalId },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.publishCheckIn",
      {
        id: draft.id,
        status: "caution",
        confidence: 0.5,
        narrative: richText("Moved to 55."),
        values: [{ keyResultId, value: 55 }],
      },
    );

    const deleted = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.deleteCheckIn",
      { id: draft.id },
    );
    expect(deleted.rolledBack).toBe(true);

    const goal = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: goalId },
    );
    // The value, the pointer, the health and the obligation all go back.
    expect(goal.keyResults[0]?.currentValue).toBe(40);
    expect(goal.health).toBe("pending");

    const row = await wb.admin.query<{
      last_check_in_id: string | null;
      next_check_in_at: Date;
    }>("select last_check_in_id, next_check_in_at from goals where id = $1", [
      goalId,
    ]);
    expect(row.rows[0]?.last_check_in_id).toBeNull();
    expect(
      new Date(row.rows[0]?.next_check_in_at as Date).getTime(),
    ).toBeLessThanOrEqual(
      new Date(before.rows[0]?.next_check_in_at as Date).getTime(),
    );
  });
});

describe("acknowledgement", () => {
  it("is refused for everyone but the reviewer of record", async () => {
    const wb = await workerDb();
    const draft = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.startCheckIn",
      { goalId },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.publishCheckIn",
      {
        id: draft.id,
        status: "on_track",
        confidence: 0.8,
        narrative: richText("On track."),
        values: [],
      },
    );

    // The champion is also the workspace administrator here, which is the point:
    // an admin is refused like anybody else.
    await expect(
      callAction(
        { pool: wb.appPool, ...context() },
        "goals.acknowledgeCheckIn",
        {
          id: draft.id,
        },
      ),
    ).rejects.toThrow(/only this goal's reviewer/i);

    const first = await callAction(
      { pool: wb.appPool, ...context(REVIEWER) },
      "goals.acknowledgeCheckIn",
      { id: draft.id },
    );
    expect(first.alreadyAcknowledged).toBe(false);

    // Idempotent, not an error.
    const second = await callAction(
      { pool: wb.appPool, ...context(REVIEWER) },
      "goals.acknowledgeCheckIn",
      { id: draft.id },
    );
    expect(second.alreadyAcknowledged).toBe(true);
  });

  it("never changes health", async () => {
    const wb = await workerDb();
    const draft = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.startCheckIn",
      { goalId },
    );
    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.publishCheckIn",
      {
        id: draft.id,
        status: "off_track",
        confidence: 0.2,
        narrative: richText("Off track, and here is why."),
        values: [],
      },
    );
    await callAction(
      { pool: wb.appPool, ...context(REVIEWER) },
      "goals.acknowledgeCheckIn",
      { id: draft.id },
    );

    const goal = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.read",
      { id: goalId },
    );
    // Acknowledgement closes a loop. It is not a second opinion on the status.
    expect(goal.health).toBe("off_track");
  });
});

describe("confidence votes", () => {
  it("stay private until the reveal, then show every number and the average", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "goals.vote", {
      keyResultId,
      confidence: 0.8,
    });
    await callAction({ pool: wb.appPool, ...context(REVIEWER) }, "goals.vote", {
      keyResultId,
      confidence: 0.4,
    });

    const hidden = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.readVotes",
      { keyResultId },
    );
    // Only the count and your own number before the reveal.
    expect(hidden.revealed).toBe(false);
    expect(hidden.count).toBe(2);
    expect(hidden.own).toBe(0.8);
    expect(hidden.votes).toEqual([]);
    expect(hidden.average).toBeNull();

    const revealed = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.revealVotes",
      { keyResultId },
    );
    expect(revealed.revealed).toBe(2);

    const shown = await callAction(
      { pool: wb.appPool, ...context(REVIEWER) },
      "goals.readVotes",
      { keyResultId },
    );
    expect(shown.revealed).toBe(true);
    expect(shown.votes).toHaveLength(2);
    expect(shown.average).toBe(0.6);
  });

  it("updates rather than stacking when somebody changes their mind", async () => {
    const wb = await workerDb();
    const first = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.vote",
      { keyResultId, confidence: 0.8 },
    );
    const second = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.vote",
      { keyResultId, confidence: 0.3 },
    );
    expect(second.id).toBe(first.id);

    const votes = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.readVotes",
      { keyResultId },
    );
    expect(votes.count).toBe(1);
    expect(votes.own).toBe(0.3);
  });

  it("never moves health, progress or the cadence", async () => {
    const wb = await workerDb();
    const before = await wb.admin.query<{
      health: string;
      progress_pct: string;
      next_check_in_at: Date;
    }>(
      "select health, progress_pct, next_check_in_at from goals where id = $1",
      [goalId],
    );
    await callAction({ pool: wb.appPool, ...context() }, "goals.vote", {
      keyResultId,
      confidence: 0.1,
    });
    const after = await wb.admin.query<{
      health: string;
      progress_pct: string;
      next_check_in_at: Date;
    }>(
      "select health, progress_pct, next_check_in_at from goals where id = $1",
      [goalId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

describe("the due list the walker reads", () => {
  it("offers a goal only to the member who champions it", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update goals set next_check_in_at = now() + interval '2 hours' where id = $1",
      [goalId],
    );

    const mine = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.due",
      { withinDays: 2 },
    );
    expect(mine.goals.map((goal) => goal.id)).toEqual([goalId]);
    expect(mine.goals[0]?.keyResultCount).toBe(1);
    expect(mine.goals[0]?.hasOpenDraft).toBe(false);

    // The reviewer can read the goal and cannot check it in. METHOD.md §2.5 puts
    // the check-in on the champion, so offering it to anybody else would be
    // asking the wrong person.
    const theirs = await callAction(
      { pool: wb.appPool, ...context(REVIEWER) },
      "goals.due",
      { withinDays: 2 },
    );
    expect(theirs.goals).toEqual([]);
  });

  it("reports an open draft so the walker can be resumed", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update goals set next_check_in_at = now() + interval '2 hours' where id = $1",
      [goalId],
    );
    await callAction({ pool: wb.appPool, ...context() }, "goals.startCheckIn", {
      goalId,
    });

    const due = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.due",
      { withinDays: 2 },
    );
    expect(due.goals[0]?.hasOpenDraft).toBe(true);
  });

  it("leaves out a goal that is not due yet, and a closed one", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update goals set next_check_in_at = now() + interval '10 days' where id = $1",
      [goalId],
    );
    const ahead = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.due",
      { withinDays: 2 },
    );
    expect(ahead.goals).toEqual([]);

    // Overdue is always in, however far past.
    await wb.admin.query(
      "update goals set next_check_in_at = now() - interval '30 days' where id = $1",
      [goalId],
    );
    const overdue = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.due",
      { withinDays: 2 },
    );
    expect(overdue.goals[0]?.daysPastDue).toBe(30);

    // A closed goal is never due, so it never appears.
    await callAction({ pool: wb.appPool, ...context() }, "goals.close", {
      id: goalId,
      successStatus: "achieved",
      closeDecision: "keep",
      retrospectiveBody: richText("Landed."),
    });
    const closed = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.due",
      { withinDays: 2 },
    );
    expect(closed.goals).toEqual([]);
  });
});
