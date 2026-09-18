import { workerDb } from "@openokr/test-support/db";
import { beforeAll, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { buildDemoWorkspace } from "../src/demo/builder.ts";
import {
  LAST_QUARTER,
  LAST_QUARTER_PROCESS_HEALTH,
} from "../src/demo/last-quarter.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The quarter the demo has never had (P8-T13b).
 *
 * P3-T17 wrote "the scorecard stays empty. It reads `key_results.score`, and
 * scoring at the quarterly review is P4-T10", and that note stayed true for
 * five phases after P4-T10 shipped. So the demo of a product whose closing
 * argument is "did we miss because the strategy was wrong or because the
 * cadence broke" had nowhere to show that argument.
 *
 * These tests are about the three things a visitor has to be able to see, read
 * the way the screens read them: a scored quarter on the goal pages, a row on
 * the scorecard, and §8.6's verdict with the two numbers behind it.
 *
 * **The verdict is asserted as derived, not as written.** The test computes
 * what the catalogue's own grades average and what its own survey answers make
 * of the two rhythm statements, and checks the product agreed. A test that
 * hardcoded "strategy_or_quality" would pass just as well if somebody typed
 * the verdict into the seed.
 */

const OWNER = "last-quarter-owner";

let workspaceId: string;

const context = async () => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Demo Owner", "last-quarter-owner@example.com"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Northwind",
    })
  ).workspaceId;
  await buildDemoWorkspace({
    pool: wb.appPool,
    workspaceId,
    adminUserId: OWNER,
  });
}, 120_000);

/** What the catalogue itself says the two numbers should be. */
const expectedCycleScore =
  LAST_QUARTER.flatMap((objective) =>
    objective.keyResults.map((keyResult) => keyResult.score),
  ).reduce((sum, score) => sum + score, 0) /
  LAST_QUARTER.flatMap((objective) => objective.keyResults).length;

const expectedRhythmScore =
  // §8.6 reads statements two and five, and nothing else.
  [2, 5]
    .map(
      (key) =>
        LAST_QUARTER_PROCESS_HEALTH.find((one) => one.statementKey === key)
          ?.score ?? 0,
    )
    .reduce((sum, score) => sum + score, 0) / 2;

describe("the closed cycle", () => {
  it("holds last quarter's objectives, graded", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      `select k.title, k.score
         from key_results k
         join goals g on g.id = k.goal_id
         join cycles c on c.id = g.cycle_id
        where k.workspace_id = $1 and k.score is not null
          and c.starts_on < current_date - interval '30 days'`,
      [workspaceId],
    );
    // Every key result of last quarter, and nothing from this one: scores
    // become facts when the review closes, and this quarter's has not.
    expect(rows).toHaveLength(
      LAST_QUARTER.flatMap((objective) => objective.keyResults).length,
    );
  });

  it("puts a row on the scorecard, which used to be empty on purpose", async () => {
    const scorecard = await callAction(await context(), "cycles.scorecard", {});
    expect(scorecard.rows.length).toBeGreaterThan(0);

    const row = scorecard.rows[0];
    expect(row?.resultValue).not.toBeNull();
    expect(row?.verdict).not.toBeNull();
  });
});

describe("§8.6's diagnostic", () => {
  it("reads back with a verdict, a diagnosis and a prescription", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      `select s.id from okr_sessions s
        where s.workspace_id = $1 and s.kind = 'quarterly'
          and s.deleted_at is null`,
      [workspaceId],
    );
    expect(rows).toHaveLength(1);

    const diagnostic = await callAction(
      await context(),
      "sessions.diagnostic",
      { sessionId: rows[0]?.id as string },
    );

    expect(diagnostic.recorded).toBe(true);
    expect(diagnostic.readable).toBe(true);
    expect(diagnostic.diagnosis).toBeTruthy();
    expect(diagnostic.prescription).toBeTruthy();
  });

  it("is derived from the grades and the survey, not written into the seed", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      `select cycle_score, rhythm_score, verdict
         from review_diagnostics
        where workspace_id = $1 and deleted_at is null`,
      [workspaceId],
    );
    expect(rows).toHaveLength(1);

    expect(Number(rows[0]?.cycle_score)).toBeCloseTo(expectedCycleScore, 4);
    expect(Number(rows[0]?.rhythm_score)).toBeCloseTo(expectedRhythmScore, 4);

    // The case the demo is built to show: under §8.6's cycle floor of 0.7 and
    // over its rhythm floor of 3.5, which is "the team ran the rhythm and
    // still missed". The thresholds are asserted here rather than assumed,
    // because the whole value of the screen is that the verdict follows from
    // them.
    expect(expectedCycleScore).toBeLessThan(0.7);
    expect(expectedRhythmScore).toBeGreaterThanOrEqual(3.5);
    expect(rows[0]?.verdict).toBe("strategy_or_quality");
  });
});

describe("the current quarter", () => {
  it("no longer claims to be the first, because one is behind it", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      `select first_cycle from cycles
        where workspace_id = $1 and deleted_at is null
        order by starts_on desc
        limit 1`,
      [workspaceId],
    );
    expect(rows[0]?.first_cycle).toBe(false);
  });
});
