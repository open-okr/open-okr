import { canonThresholds } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { archiveCycleInTx, feedForwardInTx } from "../src/cycles/archive.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The archive and the feed-forward against real rows (P3-T15, METHOD.md §8.9).
 *
 * What only rows can settle: that the buckets and the verdict match the scores
 * as stored, that carried work re-enters the next cycle as an issue at impact
 * four, and that running either twice changes nothing.
 */

const OWNER = "archive-owner";
const thresholds = canonThresholds();

let workspaceId: string;
let cycleId: string;
let memberId: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

async function inOperation<T>(
  fn: (
    tx: Parameters<Parameters<typeof runOperation>[1]["execute"]>[0]["tx"],
  ) => Promise<T>,
): Promise<T> {
  const wb = await workerDb();
  return runOperation(
    { pool: wb.appPool },
    {
      action: "test.archive",
      workspaceId,
      actor: { kind: "human", userId: OWNER },
      async execute({ tx }) {
        const result = await fn(tx);
        return {
          result,
          activity: {
            kind: "test.archive",
            subjectType: "cycle",
            subjectId: cycleId,
          },
          audit: { action: "test.archive", targetType: "cycle" },
        };
      },
    },
  );
}

/** A goal with two key results, scored, in the current cycle. */
async function scoredGoal(scores: readonly number[], carryForward = false) {
  const wb = await workerDb();
  const goal = await callAction(
    { pool: wb.appPool, ...context() },
    "goals.create",
    {
      title: "Ship the thing",
      cycleId,
      level: "team",
      ownerKind: "workspace",
      championId: memberId,
      reviewerId: memberId,
      // Every field with a schema default has to be named: callAction types on
      // the schema output, so a default is a value the caller still states.
      weight: 1,
    },
  );
  const ids: string[] = [];
  for (const [index, score] of scores.entries()) {
    const keyResult = await callAction(
      { pool: wb.appPool, ...context() },
      "goals.addKeyResult",
      {
        goalId: goal.id,
        title: `Measure ${index + 1}`,
        direction: "increase",
        indicatorType: "leading",
        baselineValue: 0,
        targetValue: 10,
        weight: 1,
      },
    );
    ids.push(keyResult.id);
    // Scores are written by the Phase 7 scoring surface (P4-T08), which does
    // not exist. Setting the column directly is the only way to reach the
    // archive from here, and it is the same value that surface will write.
    await wb.admin.query(
      "update key_results set score = $1, carry_forward = $2 where id = $3",
      [String(score), carryForward, keyResult.id],
    );
  }
  return { goalId: goal.id, keyResultIds: ids };
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Owner", "archive-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  const member = await wb.admin.query<{ id: string }>(
    "select id from workspace_members where workspace_id = $1 and user_id = $2",
    [workspaceId, OWNER],
  );
  memberId = member.rows[0]?.id as string;
  const current = await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  );
  cycleId = current?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the archive", () => {
  it("writes the result, the bands and the verdict, once per owner", async () => {
    const wb = await workerDb();
    await scoredGoal([1, 0.6]);

    const first = await inOperation((tx) =>
      archiveCycleInTx(tx, workspaceId, cycleId, thresholds),
    );
    // 1.00 and 0.60 average 0.80, which §3.4 reads as healthy.
    expect(first.resultValue).toBe(0.8);
    expect(first.verdict).toBe("healthy");
    // The workspace, plus the champion. No space owns this goal.
    expect(first.snapshots).toBe(2);

    const rows = await wb.admin.query<{
      owner_kind: string;
      result_value: string;
      fully_achieved_count: number;
      strong_count: number;
      verdict: string;
    }>(
      "select owner_kind, result_value, fully_achieved_count, strong_count, verdict from performance_snapshots where cycle_id = $1 order by owner_kind",
      [cycleId],
    );
    expect(rows.rows).toHaveLength(2);
    const workspaceRow = rows.rows.find(
      (row) => row.owner_kind === "workspace",
    );
    expect(Number(workspaceRow?.result_value)).toBe(0.8);
    // One at 1.00 is fully achieved, one at 0.60 is partial rather than strong.
    expect(workspaceRow?.fully_achieved_count).toBe(1);
    expect(workspaceRow?.strong_count).toBe(0);
    expect(workspaceRow?.verdict).toBe("healthy");
  });

  it("is idempotent: archiving twice updates rather than doubling", async () => {
    const wb = await workerDb();
    await scoredGoal([1, 0.6]);
    await inOperation((tx) =>
      archiveCycleInTx(tx, workspaceId, cycleId, thresholds),
    );
    await inOperation((tx) =>
      archiveCycleInTx(tx, workspaceId, cycleId, thresholds),
    );
    const rows = await wb.admin.query(
      "select id from performance_snapshots where cycle_id = $1",
      [cycleId],
    );
    expect(rows.rows).toHaveLength(2);
  });

  it("has no verdict when nothing was scored", async () => {
    const result = await inOperation((tx) =>
      archiveCycleInTx(tx, workspaceId, cycleId, thresholds),
    );
    // A cycle nobody scored has no verdict rather than a bad one.
    expect(result.resultValue).toBeNull();
    expect(result.verdict).toBeNull();
  });
});

describe("the feed-forward", () => {
  /**
   * The acceptance criterion: "Given a closed cycle with two carry-forward key
   * results, when the next cycle opens, then its issue list contains those two
   * at impact four and its scoring list contains every prior key result with
   * its score."
   */
  it("carries every score into the scoring list and the marked work into the issue list", async () => {
    const wb = await workerDb();
    await scoredGoal([1, 0.6], true);

    const next = await callAction(
      { pool: wb.appPool, ...context() },
      "cycles.create",
      // A date inside the next quarter, not the period's own start: the cycle
      // service works out the bounds from the cadence.
      { on: "2027-02-15", firstCycle: false },
    );

    const result = await inOperation((tx) =>
      feedForwardInTx(tx, workspaceId, cycleId, next.id),
    );
    expect(result.priorScores).toBe(2);
    expect(result.issues).toBe(2);
    // **Empty since P4-T12-b, and this assertion is the reason the field exists.**
    // It read `toHaveLength(2)` from P3-T15 until the tables arrived: learnings
    // at P4-T11c-b and the process-health survey at P4-T11b. A partial mapping
    // that reported nothing waiting would have looked complete for four months.
    expect(result.waiting).toEqual([]);
    // This cycle has no review behind it, so §8.9's last two rows hand over
    // nothing and say so rather than inventing a hand-over.
    expect(result.processHealthIssue).toBe(false);
    expect(result.packNote).toBe(false);

    const scores = await wb.admin.query<{ text: string; score: string }>(
      "select text, score from cycle_prior_scores where cycle_id = $1 order by position",
      [next.id],
    );
    expect(scores.rows.map((row) => row.text)).toEqual([
      "Measure 1",
      "Measure 2",
    ]);
    expect(scores.rows.map((row) => Number(row.score))).toEqual([1, 0.6]);

    const issues = await wb.admin.query<{
      text: string;
      impact: number;
      source: string;
    }>(
      "select text, impact, source from cycle_issues where cycle_id = $1 order by text",
      [next.id],
    );
    expect(issues.rows).toHaveLength(2);
    expect(issues.rows.every((row) => row.impact === 4)).toBe(true);
    expect(issues.rows.every((row) => row.source === "carry_forward")).toBe(
      true,
    );
  });

  it("is idempotent: running it twice adds nothing", async () => {
    const wb = await workerDb();
    await scoredGoal([1, 0.6], true);
    const next = await callAction(
      { pool: wb.appPool, ...context() },
      "cycles.create",
      // A date inside the next quarter, not the period's own start: the cycle
      // service works out the bounds from the cadence.
      { on: "2027-02-15", firstCycle: false },
    );

    await inOperation((tx) =>
      feedForwardInTx(tx, workspaceId, cycleId, next.id),
    );
    const second = await inOperation((tx) =>
      feedForwardInTx(tx, workspaceId, cycleId, next.id),
    );
    expect(second.priorScores).toBe(0);
    expect(second.issues).toBe(0);

    const scores = await wb.admin.query(
      "select id from cycle_prior_scores where cycle_id = $1",
      [next.id],
    );
    expect(scores.rows).toHaveLength(2);
  });

  it("refuses to feed a cycle into itself", async () => {
    await expect(
      inOperation((tx) => feedForwardInTx(tx, workspaceId, cycleId, cycleId)),
    ).rejects.toThrow(/cannot feed itself/i);
  });
});

describe("the points layer", () => {
  it("has no rows at all while it is off", async () => {
    const wb = await workerDb();
    await scoredGoal([1, 0.6]);
    await inOperation((tx) =>
      archiveCycleInTx(tx, workspaceId, cycleId, thresholds),
    );
    // REQUIREMENTS.md keeps the points layer off unless the human funds it, so
    // the tables exist and stay empty. This is the assertion that catches
    // somebody wiring it up by accident.
    const entries = await wb.admin.query("select id from score_entries");
    expect(entries.rows).toHaveLength(0);
    const settings = await wb.admin.query(
      "select id from scorecard_settings where enabled = true",
    );
    expect(settings.rows).toHaveLength(0);
  });
});
