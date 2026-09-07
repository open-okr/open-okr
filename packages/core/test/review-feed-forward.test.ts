/**
 * §8.9's feed-forward, completed (METHOD.md §8.9, P4-T12-b).
 *
 * The task's test plan:
 * - a carried learning becomes an issue at impact 4
 * - the lowest process-health statement becomes an issue with source
 *   `process_health`
 * - the feed-forward is idempotent, so running it twice does not double anything
 *
 * **`cycles.feedForward` existed before this row.** P3-T15 built it with a
 * `waiting` list naming the two rows it could not fill, because the tables did
 * not exist: learnings arrived at P4-T11c-b and the survey at P4-T11b. These
 * tests fill those two and assert the list is empty, which is the honest way to
 * close a mapping that was deliberately partial.
 *
 * **Pulled, not pushed.** §8.10 holds the review before the next cycle is
 * drafted, so at close time the next cycle usually does not exist. The
 * feed-forward runs when it does, which is what taking a `fromCycleId` and a
 * `toCycleId` already meant.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const FACILITATOR = "feed-facilitator";

let workspaceId: string;
let fromCycleId: string;
let toCycleId: string;
let spaceId: string;
let facilitatorMemberId: string;
let sessionId: string;
let goalId: string;
let keyResultId: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: FACILITATOR },
});

const call = async (name: string, input: unknown) => {
  const wb = await workerDb();
  return callAction(
    { pool: wb.appPool, ...context() },
    name as never,
    input as never,
  );
};

const feedForward = async () =>
  (await call("cycles.feedForward", { fromCycleId, toCycleId })) as {
    priorScores: number;
    issues: number;
    frameCarried: boolean;
    waiting: string[];
    processHealthIssue: boolean;
    packNote: boolean;
  };

const issuesIn = async (cycleId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    text: string;
    impact: number;
    source: string;
  }>(
    `select text, impact, source from cycle_issues
      where cycle_id = $1 and deleted_at is null order by created_at`,
    [cycleId],
  );
  return rows;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();

  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Facilitator', $2)`,
    [FACILITATOR, "feed-facilitator@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: FACILITATOR,
    name: "Facilitator",
  });
  workspaceId = provisioned.workspaceId;
  facilitatorMemberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const current = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  fromCycleId = current.id;

  // The next cycle, created after the review, which is the order §8.10 asks
  // for. `cycles.create` takes a date inside the period it should generate
  // rather than the period's own bounds, so a day in the following quarter is
  // how you ask for the following quarter.
  const inNextQuarter = new Date(Date.now() + 120 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const next = (await call("cycles.create", {
    on: inNextQuarter,
    cadence: "quarterly",
  })) as { id: string };
  toCycleId = next.id;

  const goal = (await call("goals.create", {
    title: "Become the platform mid-market teams reach for first",
    cycleId: fromCycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: facilitatorMemberId,
    reviewerId: facilitatorMemberId,
    weight: 1,
  })) as { id: string };
  goalId = goal.id;

  const keyResult = (await call("goals.addKeyResult", {
    goalId,
    title: "Raise weekly active teams from 120 to 300 by 31 March",
    direction: "increase",
    indicatorType: "leading",
    baselineValue: 120,
    targetValue: 300,
    unit: "teams",
    weight: 1,
  })) as { id: string };
  keyResultId = keyResult.id;

  const session = (await call("sessions.create", {
    spaceId,
    cycleId: fromCycleId,
    kind: "quarterly",
    title: "Q1 review",
    scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    facilitatorId: facilitatorMemberId,
  })) as { id: string };
  sessionId = session.id;
  await call("sessions.open", { id: sessionId });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

/** A closed review with a carried learning and a survey behind it. */
const holdTheReview = async () => {
  await call("sessions.scoreKeyResult", {
    sessionId,
    keyResultId,
    score: 0.4,
    reason: "Landed 210 of 300.",
  });
  await call("sessions.captureLearning", {
    sessionId,
    text: "We learned that a dependency nobody owns is a dependency nobody clears.",
    carryForward: true,
  });
  await call("sessions.captureLearning", {
    sessionId,
    text: "We learned that the funnel above activation was never the constraint.",
    carryForward: false,
  });
  await call("sessions.submitProcessHealth", {
    sessionId,
    // Statement three lowest at 2, so it is the one §8.5's closing rule names.
    scores: [5, 4, 2, 5, 4].map((score, index) => ({
      statementKey: index + 1,
      score,
    })),
  });
  await call("sessions.close", { id: sessionId });
};

describe("the two rows that were waiting", () => {
  it("reports nothing waiting any more", async () => {
    await holdTheReview();
    const result = await feedForward();
    // The list was two rows from P3-T15 until the tables existed. Emptying it is
    // the point of this row, and the field stays for the next row §8.9 grows.
    expect(result.waiting).toEqual([]);
  });

  it("carries a carried learning as an issue at impact four", async () => {
    await holdTheReview();
    await feedForward();

    const issues = await issuesIn(toCycleId);
    const carried = issues.find((row) => row.text.includes("nobody clears"));
    expect(carried?.impact).toBe(4);
    expect(carried?.source).toBe("carry_forward");
  });

  it("leaves an uncarried learning out", async () => {
    await holdTheReview();
    await feedForward();

    // §8.9 carries the ones marked to carry. A learning nobody marked is a
    // learning, not a commitment for the next quarter.
    const issues = await issuesIn(toCycleId);
    expect(
      issues.some((row) => row.text.includes("never the constraint")),
    ).toBe(false);
  });

  it("makes the lowest process-health statement an issue, not a priority", async () => {
    await holdTheReview();
    const result = await feedForward();

    expect(result.processHealthIssue).toBe(true);
    const issues = await issuesIn(toCycleId);
    const health = issues.find((row) => row.source === "process_health");
    // Statement three scored 2, the lowest of the five.
    expect(health?.text).toContain("measured outcomes");
    expect(health?.impact).toBe(4);

    // **An issue rather than a priority, deliberately.** §8.9's table says "a
    // process priority" and its closing line says carried work re-enters as an
    // issue and does not get a free pass. `cycle_issues.source` has carried a
    // `process_health` value since P3-T03 with nothing writing it, so the schema
    // was built for this reading.
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select id from cycle_priorities where cycle_id = $1 and deleted_at is null",
      [toCycleId],
    );
    expect(rows).toHaveLength(0);
  });

  it("puts the learnings into the next cycle's input pack", async () => {
    await holdTheReview();
    const result = await feedForward();

    expect(result.packNote).toBe(true);
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      note: string | null;
      gathered: boolean;
    }>(
      `select note, gathered from cycle_pack_items
        where cycle_id = $1 and item_key = 2 and deleted_at is null`,
      [toCycleId],
    );
    // §2.6's item two is "Prior cycle OKRs with scores and retrospective notes",
    // which is where §8.9 sends them.
    expect(rows[0]?.gathered).toBe(true);
    expect(rows[0]?.note).toContain("nobody clears");
    expect(rows[0]?.note).toContain("(carried forward)");
    // Both learnings are in the pack; only the carried one became an issue.
    expect(rows[0]?.note).toContain("never the constraint");
  });
});

describe("idempotence", () => {
  it("does not double the issues when run twice", async () => {
    await holdTheReview();
    const first = await feedForward();
    const before = await issuesIn(toCycleId);

    const second = await feedForward();
    const after = await issuesIn(toCycleId);

    // A cycle fed forward twice, by two people or by a retry, holds one set of
    // issues. Doubling them would inflate a prioritisation list nobody added to.
    expect(after).toHaveLength(before.length);
    expect(second.issues).toBe(0);
    expect(first.issues).toBeGreaterThan(0);
  });

  it("leaves one input-pack note, not two copies of it", async () => {
    await holdTheReview();
    await feedForward();
    await feedForward();

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ note: string | null }>(
      `select note from cycle_pack_items
        where cycle_id = $1 and item_key = 2 and deleted_at is null`,
      [toCycleId],
    );
    expect(rows).toHaveLength(1);
    // Rewritten rather than appended, so the note is the learnings and not the
    // learnings twice.
    expect(rows[0]?.note?.match(/nobody clears/g)).toHaveLength(1);
  });
});

describe("what happens with nothing to carry", () => {
  it("reports nothing waiting and writes no issue when the review never ran", async () => {
    // No review held: no learnings, no survey. §8.9 has nothing to hand over and
    // the mapping says so rather than inventing a handover.
    const result = await feedForward();
    expect(result.waiting).toEqual([]);
    expect(result.processHealthIssue).toBe(false);
    expect(result.packNote).toBe(false);
    expect(
      (await issuesIn(toCycleId)).filter(
        (row) => row.source === "process_health",
      ),
    ).toHaveLength(0);
  });

  it("writes no process-health issue when the survey went unanswered", async () => {
    await call("sessions.captureLearning", {
      sessionId,
      text: "We learned something, but nobody answered the survey.",
      carryForward: true,
    });
    await call("sessions.close", { id: sessionId });

    const result = await feedForward();
    // A survey nobody answered has no lowest statement, and inventing one would
    // be the product deciding the team's own process problem for it.
    expect(result.processHealthIssue).toBe(false);
    expect(result.packNote).toBe(true);
  });
});
