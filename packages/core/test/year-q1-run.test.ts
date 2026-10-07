/**
 * Q1's quarter and its close, built against a database as of today
 * (P9-T22c-b-b).
 *
 * The acceptance: given today after Q1's review, when the scorecard is read,
 * then Q1 is closed under its own snapshot with its aspirational average and
 * its committed share met. Each expectation waits for its own date on
 * today's calendar, so the file holds on any day it runs. A second workspace
 * is built as of a day inside Q1, to show the seed stops where today is.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { buildNorthwindYear } from "../src/demo/year/build.ts";
import { isoDay, toReal } from "../src/demo/year/calendar.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "year-q1-run-owner";
/** A second workspace, built as of a day inside Q1. */
const INSIDE = "year-q1-run-inside";
const today = isoDay(new Date());
const realYear = Number(today.slice(0, 4));
const on = (scenarioDate: string) => toReal(scenarioDate, realYear);
const by = (scenarioDate: string) => on(scenarioDate) <= today;

let workspaceId: string;
let q1Id: string;
let insideId: string;

const rows = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> => {
  const wb = await workerDb();
  return (await wb.admin.query<T>(sql, [workspaceId, ...params])).rows;
};

const keyResult = async (title: string) =>
  (
    await rows<{
      id: string;
      score: string | null;
      score_computed: string | null;
      done_at: string | null;
      added: string | null;
    }>(
      `select k.id, k.score, k.score_computed, to_char(k.done_at, 'YYYY-MM-DD') as done_at,
              to_char(k.added_mid_cycle_at, 'YYYY-MM-DD') as added
         from key_results k join goals g on g.id = k.goal_id
        where k.workspace_id = $1 and g.cycle_id = $2 and k.title = $3 and k.deleted_at is null`,
      [q1Id, title],
    )
  )[0];

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Elena Marsh", "year-q1-run-owner@example.com"],
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
  });
  const [q1] = await rows<{ id: string }>(
    `select id from cycles where workspace_id = $1 and mode = 'quarterly'
        and starts_on <= $2 and ends_on >= $2 and deleted_at is null`,
    [on("2027-02-15")],
  );
  q1Id = q1?.id as string;

  // Placed on a day that has happened, so the build never writes ahead.
  if (!by("2027-02-10")) {
    return;
  }
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [INSIDE, "Elena Marsh", "year-q1-run-inside@example.com"],
  );
  insideId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: INSIDE,
      name: "Elena Marsh",
    })
  ).workspaceId;
  await buildNorthwindYear({
    pool: wb.appPool,
    workspaceId: insideId,
    adminUserId: INSIDE,
    today: new Date(`${on("2027-02-10")}T12:00:00.000Z`),
  });
}, 900_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("running Q1 (NW-Q1-15 to NW-Q1-25)", () => {
  it("checks in every objective weekly, Marketing's late one inside the grace", async () => {
    if (!by("2027-03-15")) {
      return;
    }
    const checkIns = await rows<{ title: string; on: string }>(
      `select g.title, to_char(c.published_at, 'YYYY-MM-DD') as on
         from check_ins c join goals g on g.id = c.subject_id
        where c.workspace_id = $1 and g.cycle_id = $2 and c.state = 'published'`,
      [q1Id],
    );
    const marketing = checkIns.filter(
      (checkIn) => checkIn.title === "Bring in accounts that fit",
    );
    // Week 4's due Monday checked in on the Wednesday (NW-Q1-16).
    expect(marketing.map((checkIn) => checkIn.on)).toContain(on("2027-01-27"));
    expect(marketing.map((checkIn) => checkIn.on)).not.toContain(
      on("2027-01-25"),
    );
  });

  it("adds C2.3 on 1 February, marked as added mid-cycle that day, as the KPI's answer (NW-Q1-17)", async () => {
    if (!by("2027-02-01")) {
      return;
    }
    const c23 = await keyResult(
      "Cut reopened tickets from the January release from 18% to 5%",
    );
    expect(c23?.added).toBe(on("2027-02-01"));
    const [response] = await rows<{ kind: string }>(
      `select response_kind as kind from kpis
        where workspace_id = $1 and title = 'Support tickets per account'`,
    );
    expect(response?.kind).toBe("key_result");
  });

  it("ticks both milestones done on their days (NW-Q1-20, NW-Q1-22)", async () => {
    if (!by("2027-02-26")) {
      return;
    }
    expect(
      (await keyResult("Bulk import generally available by 15 February"))
        ?.done_at,
    ).toBe(on("2027-02-12"));
    expect(
      (await keyResult("Audit observation window started by 1 March"))?.done_at,
    ).toBe(on("2027-02-26"));
  });

  it("raises the blocker on guided setup, and resolves it a week later (NW-Q1-19, NW-Q1-20)", async () => {
    if (!by("2027-02-15")) {
      return;
    }
    const blockers = await rows<{ resolved: boolean; next_action: string }>(
      "select resolved_at is not null as resolved, next_action from blockers where workspace_id = $1 and deleted_at is null",
    );
    expect(blockers).toEqual([
      { resolved: true, next_action: "Mei confirms the new date on Thursday" },
    ]);
  });

  it("holds the two monthly reviews, each with its decision (NW-Q1-18, NW-Q1-23)", async () => {
    if (!by("2027-03-01")) {
      return;
    }
    const decisions = await rows<{ text: string }>(
      "select text from decisions where workspace_id = $1 and deleted_at is null order by created_at",
    );
    expect(decisions.map((one) => one.text)).toEqual([
      "C2.3 added against C2 for the January release regression; everything else continues.",
      "Activation is behind pace and trending off track: one engineer moves to the activation checklist for four weeks.",
    ]);
  });
});

describe("closing Q1 (NW-Q1-26 to NW-Q1-32)", () => {
  it("closes Q1 under its own snapshot, 0.68 aspirational and six of ten committed met", async () => {
    if (!by("2027-03-18")) {
      return;
    }
    const scorecard = await callAction(
      {
        pool: (await workerDb()).appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
      },
      "cycles.scorecard",
      {},
    );
    const row = scorecard.rows.find((one) => one.cycleId === q1Id);
    expect(row).toBeDefined();
    // The one adjustment of the quarter: C1.2 graded 0.71 beside its 0.57.
    expect(
      row?.moved?.adjusted.map((one) => [one.score, one.computed]),
    ).toEqual([[0.71, 0.57]]);

    const scores = await rows<{ kind: string; score: string }>(
      `select g.kind, k.score from key_results k join goals g on g.id = k.goal_id
        where k.workspace_id = $1 and g.cycle_id = $2 and k.deleted_at is null and g.deleted_at is null`,
      [q1Id],
    );
    const aspirational = scores.filter((one) => one.kind === "aspirational");
    const committed = scores.filter((one) => one.kind === "committed");
    expect(aspirational).toHaveLength(18);
    expect(committed).toHaveLength(10);
    const average =
      aspirational.reduce((sum, one) => sum + Number(one.score), 0) /
      aspirational.length;
    expect(average).toBeCloseTo(0.68, 2);
    expect(committed.filter((one) => Number(one.score) >= 1)).toHaveLength(6);
  });

  it("reads results delivered, with the rhythm the team kept up to the review (NW-Q1-30)", async () => {
    if (!by("2027-03-18")) {
      return;
    }
    const [diagnostic] = await rows<{ verdict: string; share: string }>(
      "select verdict, on_time_share as share from review_diagnostics where workspace_id = $1 and deleted_at is null",
    );
    expect(diagnostic?.verdict).toBe("results_delivered");
    // The two drafting weeks before the teams published are the misses:
    // about four check-ins in five were on time (the story says 81%).
    expect(Number(diagnostic?.share)).toBeGreaterThan(0.75);
    expect(Number(diagnostic?.share)).toBeLessThan(0.85);
  });

  it("decides every objective, and Q2 holds the eleven kept and modified as drafts (NW-Q1-31)", async () => {
    if (!by("2027-03-18")) {
      return;
    }
    const decisions = await rows<{ decision: string }>(
      "select decision from review_decisions where workspace_id = $1 and deleted_at is null",
    );
    expect(decisions).toHaveLength(14);
    const carried = await rows<{ title: string }>(
      `select g.title from goals g join cycles c on c.id = g.cycle_id
        where g.workspace_id = $1 and g.carried_from_goal_id is not null
          and c.starts_on > (select ends_on from cycles where id = $2) and g.deleted_at is null`,
      [q1Id],
    );
    expect(carried).toHaveLength(11);
  });
});

describe("Q1 as of 10 February, inside its sixth week", () => {
  const inside = async <T extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> => {
    const wb = await workerDb();
    return (await wb.admin.query<T>(sql, [insideId, ...params])).rows;
  };

  it("holds what happened by then and nothing after it", async () => {
    if (!by("2027-02-10")) {
      return;
    }
    const [q1] = await inside<{ id: string; status: string }>(
      `select id, status from cycles where workspace_id = $1 and mode = 'quarterly'
          and starts_on <= $2 and ends_on >= $2 and deleted_at is null`,
      [on("2027-02-10")],
    );
    expect(q1?.status).toBe("active");

    // Week 6's check-ins are the last; nothing is dated after today.
    const [latest] = await inside<{ on: string }>(
      `select to_char(max(c.published_at), 'YYYY-MM-DD') as on from check_ins c
        join goals g on g.id = c.subject_id
        where c.workspace_id = $1 and g.cycle_id = $2 and c.state = 'published'`,
      [q1?.id],
    );
    expect(latest?.on).toBe(on("2027-02-08"));

    // C2.3 is there, the blocker is open, and bulk import is not yet done.
    const c23 = await inside<{ id: string }>(
      "select id from key_results where workspace_id = $1 and title like 'Cut reopened tickets%' and deleted_at is null",
    );
    expect(c23).toHaveLength(1);
    const blockers = await inside<{ resolved: boolean }>(
      "select resolved_at is not null as resolved from blockers where workspace_id = $1 and deleted_at is null",
    );
    expect(blockers).toEqual([{ resolved: false }]);
    const [bulk] = await inside<{ done: boolean }>(
      "select done_at is not null as done from key_results where workspace_id = $1 and title = 'Bulk import generally available by 15 February'",
    );
    expect(bulk?.done).toBe(false);

    // One monthly review held, and no quarterly review yet.
    const decisions = await inside<{ text: string }>(
      "select text from decisions where workspace_id = $1 and deleted_at is null",
    );
    expect(decisions).toHaveLength(1);
    const reviewed = await inside<{ count: string }>(
      "select count(*) as count from review_decisions where workspace_id = $1 and deleted_at is null",
    );
    expect(Number(reviewed[0]?.count)).toBe(0);
  });
});
