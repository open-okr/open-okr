/**
 * The annual review, Q4's close and 2028, built against a database on a year
 * whose 24 December has passed (P9-T22c-e-b).
 *
 * The acceptance: given the year built to 24 December, when the scorecard is
 * read, then each quarter's column reads from its own snapshot as NW-Q4-12
 * tabulates it.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { buildNorthwindYear } from "../src/demo/year/build.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";
import { placeYear } from "./year-placement.ts";

const OWNER = "year-q4-close-owner";
/** Placed on the latest real year whose 24 December has passed. */
const { until, on } = placeYear("2027-12-24");

let workspaceId: string;

const rows = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> => {
  const wb = await workerDb();
  return (await wb.admin.query<T>(sql, [workspaceId, ...params])).rows;
};

/** A cycle by a scenario date it holds. */
const cycleAt = async (scenarioDate: string, mode = "quarterly") =>
  (
    await rows<{ id: string; status: string }>(
      `select id, status from cycles where workspace_id = $1 and mode = $2
          and starts_on <= $3 and ends_on >= $3 and deleted_at is null`,
      [mode, on(scenarioDate)],
    )
  )[0];

/** The aspirational average and committed met of a closed cycle's scores. */
async function column(cycleId: string | undefined) {
  const scores = await rows<{ kind: string; score: string }>(
    `select g.kind, k.score from key_results k join goals g on g.id = k.goal_id
      where k.workspace_id = $1 and g.cycle_id = $2 and k.deleted_at is null
        and g.deleted_at is null and k.score is not null`,
    [cycleId],
  );
  const aspirational = scores.filter((one) => one.kind === "aspirational");
  const committed = scores.filter((one) => one.kind === "committed");
  return {
    aspirational:
      Math.round(
        (aspirational.reduce((sum, one) => sum + Number(one.score), 0) /
          aspirational.length) *
          100,
      ) / 100,
    committed: `${committed.filter((one) => Number(one.score) >= 1).length} of ${committed.length}`,
  };
}

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Elena Marsh", "year-q4-close-owner@example.com"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Elena Marsh",
    })
  ).workspaceId;
  await buildNorthwindYear({
    pool: wb.appPool,
    workspaceId,
    adminUserId: OWNER,
    today: new Date(`${until}T12:00:00.000Z`),
  });
}, 900_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the annual review of 2027 (NW-Q4-06, NW-Q4-08)", () => {
  it("is held before 2028 is drafted, and closes the year with A3 achieved", async () => {
    const year = await cycleAt("2027-06-30", "annual");
    expect(year?.status).toBe("closed");
    const decisions = await rows<{ title: string; decision: string }>(
      `select g.title, r.decision from review_decisions r join goals g on g.id = r.goal_id
        where r.workspace_id = $1 and g.cycle_id = $2 and r.deleted_at is null order by g.title`,
      [year?.id],
    );
    expect(
      decisions.find(
        (one) =>
          one.title === "Enterprise security teams approve us without a fight",
      )?.decision,
    ).toBe("achieved");
    expect(await column(year?.id)).toEqual({
      aspirational: 0.77,
      committed: "2 of 6",
    });
  });

  it("shows A4's eased win rate beside its original", async () => {
    const scorecard = await callAction(
      {
        pool: (await workerDb()).appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
      },
      "cycles.scorecard",
      {},
    );
    const year = await cycleAt("2027-06-30", "annual");
    const row = scorecard.rows.find((one) => one.cycleId === year?.id);
    expect(row?.moved?.eased).toEqual([
      expect.objectContaining({ original: 35, target: 32 }),
    ]);
  });

  it("publishes 2028's four annual objectives, three carried and one new", async () => {
    const next = await cycleAt("2028-06-30", "annual");
    const [cycle] = await rows<{ published: boolean }>(
      "select published_at is not null as published from cycles where workspace_id = $1 and id = $2",
      [next?.id],
    );
    expect(cycle?.published).toBe(true);
    const goals = await rows<{ title: string; carried: boolean }>(
      `select title, carried_from_goal_id is not null as carried from goals
        where workspace_id = $1 and cycle_id = $2 and deleted_at is null order by title`,
      [next?.id],
    );
    expect(goals).toHaveLength(4);
    expect(goals.filter((one) => one.carried)).toHaveLength(3);
  });
});

describe("closing Q4 (NW-Q4-09 to NW-Q4-11)", () => {
  it("closes C6 as achieved, and keeps C5 and C8", async () => {
    const q4 = await cycleAt("2027-11-15");
    expect(q4?.status).toBe("closed");
    const decided = await rows<{ title: string; decision: string }>(
      `select g.title, r.decision from review_decisions r join goals g on g.id = r.goal_id
        where r.workspace_id = $1 and g.cycle_id = $2 and r.deleted_at is null`,
      [q4?.id],
    );
    const decisionOf = (title: string) =>
      decided.find((one) => one.title === title)?.decision;
    expect(decisionOf("Margins we can run the business on again")).toBe(
      "achieved",
    );
    expect(decisionOf("Mid-market buyers choose us over Brightline")).toBe(
      "keep",
    );
    expect(decisionOf("Expansion comes from accounts that reached value")).toBe(
      "keep",
    );
    const [margin] = await rows<{ recovering: boolean }>(
      `select g.closed_at is null as recovering from kpis i join goals g on g.id = i.recovery_goal_id
        where i.workspace_id = $1 and i.title = 'Operating margin'`,
    );
    expect(margin?.recovering).toBe(false);
  });

  it("reads results delivered", async () => {
    const q4 = await cycleAt("2027-11-15");
    const [diagnostic] = await rows<{ verdict: string; share: string }>(
      `select d.verdict, d.on_time_share as share from review_diagnostics d
         join okr_sessions s on s.id = d.session_id
        where d.workspace_id = $1 and s.cycle_id = $2 and d.deleted_at is null`,
      [q4?.id],
    );
    expect(diagnostic?.verdict).toBe("results_delivered");
    expect(Number(diagnostic?.share)).toBeGreaterThan(0.85);
  });
});

describe("the year in one table (NW-Q4-12)", () => {
  it("reads each quarter from its own scores", async () => {
    const columns = [];
    for (const day of [
      "2027-02-15",
      "2027-05-15",
      "2027-08-15",
      "2027-11-15",
    ]) {
      columns.push(await column((await cycleAt(day))?.id));
    }
    expect(columns).toEqual([
      { aspirational: 0.68, committed: "6 of 10" },
      { aspirational: 0.59, committed: "5 of 5" },
      { aspirational: 0.66, committed: "7 of 11" },
      { aspirational: 0.71, committed: "7 of 9" },
    ]);
  });

  it("shows the additions, the eased target and the kind change where they happened", async () => {
    const scorecard = await callAction(
      {
        pool: (await workerDb()).appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
      },
      "cycles.scorecard",
      {},
    );
    const moved = [];
    for (const day of [
      "2027-02-15",
      "2027-05-15",
      "2027-08-15",
      "2027-11-15",
    ]) {
      const cycle = await cycleAt(day);
      const row = scorecard.rows.find((one) => one.cycleId === cycle?.id);
      moved.push([
        row?.moved?.addedMidCycle,
        row?.moved?.eased.length,
        row?.moved?.kindChanges.length,
      ]);
    }
    // Q1's C2.3; Q2's C5 with four key results, S2.1 eased and C2's kind;
    // Q3's G1 with two key results; Q4 nothing.
    expect(moved).toEqual([
      [1, 0, 0],
      [5, 1, 1],
      [3, 0, 1],
      [0, 0, 0],
    ]);
  });
});

describe("2028 begins (NW-Q4-13, NW-Q4-14)", () => {
  it("publishes Q1 2028's company set from what Q4 kept, with no department level", async () => {
    const next = await cycleAt("2028-02-15");
    const [cycle] = await rows<{ company: boolean }>(
      "select company_published_at is not null as company from cycles where workspace_id = $1 and id = $2",
      [next?.id],
    );
    expect(cycle?.company).toBe(true);
    const company = await rows<{ title: string }>(
      `select title from goals where workspace_id = $1 and cycle_id = $2
          and level = 'company' and deleted_at is null order by title`,
      [next?.id],
    );
    expect(company.map((one) => one.title)).toEqual([
      "Expansion comes from accounts that reached value",
      "Mid-market buyers choose us over Brightline",
      "New accounts reach value in their first week",
    ]);
  });
});
