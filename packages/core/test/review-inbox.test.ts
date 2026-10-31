import { withWorkspace } from "@openokr/db";
import { canonThresholds } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { dueAcknowledgementNudges } from "../src/nudges/service.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The review inbox against a real database (P3-T08, UIUX-PLAN.md §4 S-02,
 * design §4.4 and §6.5).
 *
 * The task's test plan, one test each: an obligation appears and disappears
 * exactly on publication and acknowledgement; a reviewer appointed today is not
 * asked to acknowledge a loop somebody else already closed; and the badge count
 * moves with both. Plus the task's acceptance criterion, which is the only test
 * here that exercises two goals and two roles at once, and the design
 * document's own §4.4 Given / When / Then.
 */

const CHAMPION = "inbox-champion";
const REVIEWER = "inbox-reviewer";
const SUCCESSOR = "inbox-successor";

let workspaceId: string;
let cycleId: string;
let championId: string;
let reviewerId: string;
let successorId: string;

const context = (userId = CHAMPION) => ({
  workspaceId,
  actor: { kind: "human" as const, userId },
});

const richText = (text: string) =>
  ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  }) as never;

/** A goal owned by `championId` and reviewed by `reviewerId`, with one key result. */
async function makeGoal(title: string): Promise<string> {
  const wb = await workerDb();
  const goal = await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      title,
      cycleId,
      level: "company",
      ownerKind: "workspace",
      championId,
      reviewerId,
      weight: 1,
    },
  );
  await callAction({ pool: wb.appPool, ...context() }, "goals.addKeyResult", {
    goalId: goal.id,
    title: `${title}: raise activation from 40 to 100`,
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 40,
    targetValue: 100,
    weight: 1,
  });
  return goal.id;
}

/** Publishes a check-in on a goal as its champion, and returns its id. */
async function publish(goalId: string): Promise<string> {
  const wb = await workerDb();
  const draft = await callAction(
    { pool: wb.appPool, ...context() },
    "goals.startCheckIn",
    { goalId },
  );
  await callAction({ pool: wb.appPool, ...context() }, "goals.publishCheckIn", {
    id: draft.id,
    status: "on_track",
    confidence: 0.7,
    narrative: richText("Moving, and the lever is onboarding."),
    values: [],
  });
  return draft.id;
}

/**
 * Drags a goal's next check-in back so it reads as overdue by `days`.
 *
 * The end of the local day, not midnight, because that is the instant the
 * cadence engine stores (P3-T06: "a check-in posted at any hour of the due date
 * is on time"). Writing midnight here made the goal read as one day later than
 * intended, which is the test lying rather than the engine being wrong.
 */
async function makeOverdue(goalId: string, days: number): Promise<void> {
  const wb = await workerDb();
  await wb.admin.query(
    `update goals
        set next_check_in_at =
          (((now() at time zone 'UTC')::date - make_interval(days => $2))
            + interval '23:59:59.999') at time zone 'UTC'
      where id = $1`,
    [goalId, days],
  );
}

const inbox = async (userId = CHAMPION) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...context(userId) },
    "review.inbox",
    {},
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email)
     values ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)`,
    [
      CHAMPION,
      "Champion",
      "inbox-champion@example.com",
      REVIEWER,
      "Reviewer",
      "inbox-reviewer@example.com",
      SUCCESSOR,
      "Successor",
      "inbox-successor@example.com",
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

  const extra = await wb.admin.query<{ id: string; user_id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Reviewer', 'active'),
            (gen_random_uuid(), $1, $3, 'Successor', 'active')
     returning id, user_id`,
    [workspaceId, REVIEWER, SUCCESSOR],
  );
  reviewerId = extra.rows.find((row) => row.user_id === REVIEWER)?.id as string;
  successorId = extra.rows.find((row) => row.user_id === SUCCESSOR)
    ?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("an acknowledgement obligation", () => {
  it("does not exist until the check-in is published", async () => {
    const wb = await workerDb();
    const goalId = await makeGoal("Make mobile the way customers reach us");

    await callAction({ pool: wb.appPool, ...context() }, "goals.startCheckIn", {
      goalId,
    });

    const owed = await inbox(REVIEWER);
    expect(
      owed.obligations.filter((item) => item.kind === "acknowledgement"),
    ).toHaveLength(0);
  });

  it("appears for the reviewer on publication and for nobody else", async () => {
    const goalId = await makeGoal("Make mobile the way customers reach us");
    await publish(goalId);

    const reviewers = await inbox(REVIEWER);
    const acknowledgements = reviewers.obligations.filter(
      (item) => item.kind === "acknowledgement",
    );
    expect(acknowledgements).toHaveLength(1);
    expect(acknowledgements[0]?.actionLabel).toBe("Acknowledge");

    const champions = await inbox(CHAMPION);
    expect(
      champions.obligations.filter((item) => item.kind === "acknowledgement"),
    ).toHaveLength(0);
  });

  it("disappears exactly on acknowledgement", async () => {
    const wb = await workerDb();
    const goalId = await makeGoal("Make mobile the way customers reach us");
    const checkInId = await publish(goalId);

    expect((await inbox(REVIEWER)).counts.actionable).toBe(1);

    await callAction(
      { pool: wb.appPool, ...context(REVIEWER) },
      "goals.acknowledgeCheckIn",
      { id: checkInId },
    );

    const after = await inbox(REVIEWER);
    expect(
      after.obligations.filter((item) => item.kind === "acknowledgement"),
    ).toHaveLength(0);
    expect(after.counts.actionable).toBe(0);
  });

  it("disappears when the check-in is deleted", async () => {
    const wb = await workerDb();
    const goalId = await makeGoal("Make mobile the way customers reach us");
    const checkInId = await publish(goalId);

    await callAction(
      { pool: wb.appPool, ...context() },
      "goals.deleteCheckIn",
      { id: checkInId },
    );

    expect(
      (await inbox(REVIEWER)).obligations.filter(
        (item) => item.kind === "acknowledgement",
      ),
    ).toHaveLength(0);
  });
});

/** Back-dates a check-in's publication by `days`, so its age can be chosen. */
async function publishedDaysAgo(checkInId: string, days: number) {
  const wb = await workerDb();
  await wb.admin.query(
    "update check_ins set published_at = now() - make_interval(days => $2) where id = $1",
    [checkInId, days],
  );
}

const acknowledgementsOf = async (userId: string) =>
  (await inbox(userId)).obligations.filter(
    (item) => item.kind === "acknowledgement",
  );

describe("one acknowledgement per goal (METHOD.md §2.5)", () => {
  it("lists only the latest open check-in on a goal and says how many earlier ones it covers", async () => {
    const goalId = await makeGoal("New accounts reach value faster");
    const first = await publish(goalId);
    const second = await publish(goalId);
    const latest = await publish(goalId);
    await publishedDaysAgo(first, 14);
    await publishedDaysAgo(second, 7);

    const owed = await acknowledgementsOf(REVIEWER);
    expect(owed).toHaveLength(1);
    expect(owed[0]?.checkInId).toBe(latest);
    expect(owed[0]?.meta).toContain("2 earlier");
  });

  it("closes every earlier open check-in on the goal when the latest is acknowledged", async () => {
    const wb = await workerDb();
    const goalId = await makeGoal("New accounts reach value faster");
    const first = await publish(goalId);
    const latest = await publish(goalId);
    await publishedDaysAgo(first, 7);

    const result = await callAction(
      { pool: wb.appPool, ...context(REVIEWER) },
      "goals.acknowledgeCheckIn",
      { id: latest },
    );
    expect(result.settledEarlier).toBe(1);

    const rows = await wb.admin.query<{
      id: string;
      acknowledged_by_id: string | null;
    }>("select id, acknowledged_by_id from check_ins where subject_id = $1", [
      goalId,
    ]);
    expect(
      rows.rows.every((row) => row.acknowledged_by_id === reviewerId),
    ).toBe(true);
    expect(await acknowledgementsOf(REVIEWER)).toHaveLength(0);
  });

  it("leaves a later check-in open when an earlier one is acknowledged", async () => {
    const wb = await workerDb();
    const goalId = await makeGoal("New accounts reach value faster");
    const earlier = await publish(goalId);
    const later = await publish(goalId);
    await publishedDaysAgo(earlier, 7);

    await callAction(
      { pool: wb.appPool, ...context(REVIEWER) },
      "goals.acknowledgeCheckIn",
      { id: earlier },
    );

    const owed = await acknowledgementsOf(REVIEWER);
    expect(owed.map((item) => item.checkInId)).toEqual([later]);
  });

  it("owes nothing on a goal whose latest check-in is already acknowledged", async () => {
    // Rows left open before this rule existed: the latest one says where the
    // goal stands, so a backlog behind it is not a debt.
    const wb = await workerDb();
    const goalId = await makeGoal("New accounts reach value faster");
    const old = await publish(goalId);
    const latest = await publish(goalId);
    await publishedDaysAgo(old, 7);
    await wb.admin.query(
      "update check_ins set acknowledged_at = now(), acknowledged_by_id = $2 where id = $1",
      [latest, reviewerId],
    );

    expect(await acknowledgementsOf(REVIEWER)).toHaveLength(0);
  });

  it("owes nothing on a closed goal", async () => {
    const wb = await workerDb();
    const goalId = await makeGoal("New accounts reach value faster");
    await publish(goalId);
    await callAction({ pool: wb.appPool, ...context() }, "goals.close", {
      id: goalId,
      successStatus: "achieved",
      closeDecision: "keep",
      retrospectiveBody: richText("It worked, and the next cycle keeps it."),
    });

    expect(await acknowledgementsOf(REVIEWER)).toHaveLength(0);
  });

  it("owes nothing on a goal in a closed cycle", async () => {
    const wb = await workerDb();
    const goalId = await makeGoal("New accounts reach value faster");
    await publish(goalId);
    await wb.admin.query("update cycles set status = 'closed' where id = $1", [
      cycleId,
    ]);

    expect(await acknowledgementsOf(REVIEWER)).toHaveLength(0);
  });

  it("nudges about the latest check-in only, and never about a closed cycle", async () => {
    const wb = await workerDb();
    const goalId = await makeGoal("New accounts reach value faster");
    const old = await publish(goalId);
    const latest = await publish(goalId);
    await publishedDaysAgo(old, 9);
    await publishedDaysAgo(latest, 2);

    const due = () =>
      withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
        dueAcknowledgementNudges(tx, {
          workspaceId,
          now: new Date(),
          thresholds: canonThresholds(),
        }),
      );

    const open = await due();
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((nudge) => nudge.subjectId === latest)).toBe(true);

    await wb.admin.query("update cycles set status = 'closed' where id = $1", [
      cycleId,
    ]);
    expect(await due()).toHaveLength(0);
  });
});

describe("a reviewer change", () => {
  /** The design document's own §4.4 Given / When / Then, as written. */
  it("moves the open acknowledgement and leaves the closed one alone", async () => {
    const wb = await workerDb();
    const goalId = await makeGoal("Make mobile the way customers reach us");

    // Last month's, already acknowledged by the reviewer of the day.
    const closed = await publish(goalId);
    await callAction(
      { pool: wb.appPool, ...context(REVIEWER) },
      "goals.acknowledgeCheckIn",
      { id: closed },
    );

    // Today's, still open.
    const open = await publish(goalId);

    await callAction({ pool: wb.appPool, ...context() }, "goals.reassignRole", {
      id: goalId,
      role: "reviewer",
      memberId: successorId,
    });

    const successorOwes = (await inbox(SUCCESSOR)).obligations.filter(
      (item) => item.kind === "acknowledgement",
    );
    expect(successorOwes).toHaveLength(1);
    expect(successorOwes[0]?.checkInId).toBe(open);

    const oldReviewerOwes = (await inbox(REVIEWER)).obligations.filter(
      (item) => item.kind === "acknowledgement",
    );
    expect(oldReviewerOwes).toHaveLength(0);

    // The acknowledged one keeps the member who actually closed it.
    const row = await wb.admin.query<{ reviewer_member_id: string }>(
      "select reviewer_member_id from check_ins where id = $1",
      [closed],
    );
    expect(row.rows[0]?.reviewer_member_id).toBe(reviewerId);
  });

  it("lets only the reviewer of record acknowledge", async () => {
    const wb = await workerDb();
    const goalId = await makeGoal("Make mobile the way customers reach us");
    const checkInId = await publish(goalId);

    await callAction({ pool: wb.appPool, ...context() }, "goals.reassignRole", {
      id: goalId,
      role: "reviewer",
      memberId: successorId,
    });

    const refusal = await callAction(
      { pool: wb.appPool, ...context(REVIEWER) },
      "goals.acknowledgeCheckIn",
      { id: checkInId },
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(Error);
    // Two refusals could fire here and it matters which one does. The rebind
    // took the outgoing reviewer's binding away, so the access getter answers
    // not-found before §6.5's "only the reviewer of record" is ever reached.
    // Not-found rather than forbidden is the access model's own rule: a member
    // who cannot see a goal is not told it exists.
    expect((refusal as { code?: string }).code).toBe("not_found");

    const ok = await callAction(
      { pool: wb.appPool, ...context(SUCCESSOR) },
      "goals.acknowledgeCheckIn",
      { id: checkInId },
    );
    expect(ok.alreadyAcknowledged).toBe(false);
  });
});

describe("the check-in obligation", () => {
  it("is grouped overdue first, with the days in the label", async () => {
    const goalId = await makeGoal("Make mobile the way customers reach us");
    await makeOverdue(goalId, 4);

    const owed = await inbox(CHAMPION);
    const checkIn = owed.obligations.find((item) => item.kind === "check_in");
    expect(checkIn?.group).toBe("overdue");
    expect(checkIn?.daysPastDue).toBe(4);
    expect(checkIn?.dueLabel).toBe("Overdue by 4 days");
    expect(checkIn?.actionLabel).toBe("Check in");
    expect(checkIn?.href).toBe(`/check-in?goal=${goalId}`);
  });

  it("belongs to the champion, never to the reviewer", async () => {
    const goalId = await makeGoal("Make mobile the way customers reach us");
    await makeOverdue(goalId, 4);

    expect(
      (await inbox(REVIEWER)).obligations.filter(
        (item) => item.kind === "check_in",
      ),
    ).toHaveLength(0);
  });

  it("disappears on publication, because the cadence moves", async () => {
    const goalId = await makeGoal("Make mobile the way customers reach us");
    await makeOverdue(goalId, 4);
    expect((await inbox(CHAMPION)).counts.overdue).toBe(1);

    await publish(goalId);

    const after = await inbox(CHAMPION);
    expect(after.counts.overdue).toBe(0);
  });

  it("is not owed on a closed goal", async () => {
    const wb = await workerDb();
    const goalId = await makeGoal("Make mobile the way customers reach us");
    await makeOverdue(goalId, 4);

    await callAction({ pool: wb.appPool, ...context() }, "goals.close", {
      id: goalId,
      successStatus: "achieved",
      closeDecision: "keep",
      retrospectiveBody: richText("It worked, and the next cycle keeps it."),
    });

    expect(
      (await inbox(CHAMPION)).obligations.filter(
        (item) => item.kind === "check_in",
      ),
    ).toHaveLength(0);
  });
});

describe("the whole inbox", () => {
  /**
   * The task's acceptance criterion, word for word: "Given a champion with one
   * overdue check-in and a reviewer role on another goal's fresh check-in, when
   * they open Review, then they see exactly two obligations, overdue first,
   * each actionable inline."
   */
  it("shows exactly two obligations, overdue first, each with an action", async () => {
    const wb = await workerDb();
    const mine = await makeGoal("Make mobile the way customers reach us");
    await makeOverdue(mine, 3);

    // A second goal this member reviews rather than champions.
    const theirs = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.create",
      {
        title: "Become the default supplier for mid-market retail",
        cycleId,
        level: "company",
        ownerKind: "workspace",
        championId: reviewerId,
        reviewerId: championId,
        weight: 1,
      },
    );
    const draft = await callAction(
      { pool: wb.appPool, ...context(REVIEWER) },
      "goals.startCheckIn",
      { goalId: theirs.id },
    );
    await callAction(
      { pool: wb.appPool, ...context(REVIEWER) },
      "goals.publishCheckIn",
      {
        id: draft.id,
        status: "on_track",
        confidence: 0.7,
        narrative: richText("Two logos signed, the third is in legal."),
        values: [],
      },
    );

    const owed = await inbox(CHAMPION);
    expect(owed.obligations).toHaveLength(2);
    expect(owed.obligations[0]?.kind).toBe("check_in");
    expect(owed.obligations[0]?.group).toBe("overdue");
    expect(owed.obligations[1]?.kind).toBe("acknowledgement");
    for (const obligation of owed.obligations) {
      expect(obligation.actionLabel.length).toBeGreaterThan(0);
      expect(obligation.href.startsWith("/")).toBe(true);
    }
  });

  it("is empty for a member who owes nothing", async () => {
    const owed = await inbox(SUCCESSOR);
    expect(owed.obligations).toHaveLength(0);
    expect(owed.counts.total).toBe(0);
    expect(owed.counts.actionable).toBe(0);
  });

  it("has no source left to declare, and still declares the ones it has", async () => {
    const owed = await inbox(CHAMPION);
    // Empty since P6-G02. It held blockers, commitments, sessions and agent
    // proposals, naming P3-T09, P4-T07, P4-T04 and P4-T05, and all four of
    // those tasks had been done for weeks by the time the gap audit read the
    // file. The mechanism stays: a source that arrives ahead of its reader
    // declares itself here rather than being invisible.
    expect(owed.pending).toEqual([]);
    for (const source of owed.pending) {
      expect(source.task.length).toBeGreaterThan(0);
    }
  });

  /** The badge is a count of the same query, so it cannot drift from the list. */
  it("counts only what needs action now for the badge", async () => {
    const goalId = await makeGoal("Make mobile the way customers reach us");
    await makeOverdue(goalId, 2);

    const owed = await inbox(CHAMPION);
    expect(owed.counts.actionable).toBe(
      owed.counts.overdue + owed.counts.today,
    );
    expect(owed.counts.total).toBe(owed.obligations.length);
  });
});

describe("an acknowledgement nobody gave in time (OKRGoal UX review, H4)", () => {
  it("lapses from the inbox and the ladder once the window has passed", async () => {
    // The demo greeted a reviewer with 241 overdue items, some 267 days old.
    // Fourteen days on, a check-in nobody acknowledged is history, not a debt:
    // it leaves Review and the ladder stops asking, and it is not recorded as
    // acknowledged, because nobody did.
    const wb = await workerDb();
    const goalId = await makeGoal("Support answers within the hour");
    const checkInId = await publish(goalId);
    const window = canonThresholds()["cadence.acknowledgementWindowDays"];
    expect(window).toBe(14);

    await publishedDaysAgo(checkInId, window - 1);
    expect(await acknowledgementsOf(REVIEWER)).toHaveLength(1);

    await publishedDaysAgo(checkInId, window + 1);
    expect(await acknowledgementsOf(REVIEWER)).toHaveLength(0);
    const ladder = await withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
      dueAcknowledgementNudges(tx, {
        workspaceId,
        now: new Date(),
        thresholds: canonThresholds(),
      }),
    );
    expect(ladder.filter((nudge) => nudge.subjectId === checkInId)).toEqual([]);
    const row = await wb.admin.query<{ acknowledged_at: Date | null }>(
      "select acknowledged_at from check_ins where id = $1",
      [checkInId],
    );
    expect(row.rows[0]?.acknowledged_at).toBeNull();
  });

  it("previews what the check-in says on the row", async () => {
    const goalId = await makeGoal("Support answers within the hour");
    await publish(goalId);
    const [row] = await acknowledgementsOf(REVIEWER);
    // "Acknowledge all" is only honest if the reviewer can see what each one
    // says before pressing it.
    expect(row?.preview?.status).toBe("on_track");
    expect(row?.preview?.excerpt).toContain("the lever is onboarding");
  });
});
