/**
 * Q2's competitor and its close, built against a database on a year whose
 * dates have passed (P9-T22c-c-b). The acceptance: given today after Q2's
 * retrospective, when the scorecard is read, then Q2 shows C2's change of
 * kind, S2.1's eased target and the additions. The year is placed where these
 * dates have passed (year-placement.ts), so every expectation runs whatever
 * day the suite does.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { buildNorthwindYear } from "../src/demo/year/build.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";
import { placeYear } from "./year-placement.ts";

const OWNER = "year-q2-close-owner";
/**
 * Placed on the latest real year whose 21 June has passed, and built to it
 * (year-placement.ts).
 */
const { until, on, by } = placeYear("2027-06-21");

let workspaceId: string;
let q2Id: string | undefined;

const rows = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> => {
  const wb = await workerDb();
  return (await wb.admin.query<T>(sql, [workspaceId, ...params])).rows;
};

/** An objective in Q2 by its title. */
const objective = async (title: string) =>
  (
    await rows<{
      id: string;
      kind: string;
      added: string | null;
      closed: string | null;
      decision: string | null;
      reason: string | null;
      parent: string | null;
    }>(
      `select g.id, g.kind, to_char(g.added_mid_cycle_at, 'YYYY-MM-DD') as added,
              to_char(g.closed_at, 'YYYY-MM-DD') as closed, g.close_decision as decision,
              g.close_reason as reason, p.title as parent
         from goals g left join goals p on p.id = g.parent_goal_id
        where g.workspace_id = $1 and g.cycle_id = $2 and g.title = $3 and g.deleted_at is null`,
      [q2Id, title],
    )
  )[0];

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Elena Marsh", "year-q2-close-owner@example.com"],
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
  const [q2] = await rows<{ id: string }>(
    `select id from cycles where workspace_id = $1 and mode = 'quarterly'
        and starts_on <= $2 and ends_on >= $2 and deleted_at is null`,
    [on("2027-05-12")],
  );
  q2Id = q2?.id;
}, 900_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the competitor (NW-Q2-09 to NW-Q2-17)", () => {
  it("makes the five moves on 12 May, each with its reason and its date", async () => {
    if (!by("2027-05-12")) {
      return;
    }
    // Start: C5, marked added mid-cycle that day, aligned to A4.
    const c5 = await objective("Mid-market buyers choose us over Brightline");
    expect(c5?.added).toBe(on("2027-05-12"));
    expect(c5?.parent).toBe("Win the mid-market deals we should win");
    // Stop: C4, abandoned with its reason on the day.
    const c4 = await objective(
      "Expansion comes from accounts that reached value",
    );
    expect(c4).toMatchObject({
      closed: on("2027-05-12"),
      decision: "abandon",
      reason:
        "Capacity moves to the competitive response; expansion returns as a strategic issue for Q3",
    });
    // Update: CS2 under the annual A2, M1 under C5.
    expect(
      (await objective("Accounts that reached value grow with us"))?.parent,
    ).toBe("Grow profitably from the customers we keep");
    expect((await objective("Leads that turn into deals"))?.parent).toBe(
      "Mid-market buyers choose us over Brightline",
    );
    // The decision log holds them against the key results they touched.
    const decisions = await rows<{ on: string }>(
      `select to_char(at, 'YYYY-MM-DD') as on from decisions
        where workspace_id = $1 and deleted_at is null and at = $2`,
      [on("2027-05-12")],
    );
    expect(decisions).toHaveLength(4);
  });

  it("moves S2.1 to Jonas, and keeps Ben's check-ins on S2 (NW-Q2-12)", async () => {
    if (!by("2027-05-21")) {
      return;
    }
    const [owner] = await rows<{ name: string }>(
      `select m.name from key_results k join workspace_members m on m.id = k.owner_id
        where k.workspace_id = $1 and k.title = 'Grow qualified mid-market pipeline from $2.6M to $3.4M'`,
    );
    expect(owner?.name).toBe("Jonas Weber");
    const [ben] = await rows<{ status: string }>(
      "select status from workspace_members where workspace_id = $1 and name = 'Ben Carter'",
    );
    expect(ben?.status).toBe("suspended");
  });

  it("records Elena's decision on the questionnaires against C3.2 (NW-Q2-14)", async () => {
    if (!by("2027-05-17")) {
      return;
    }
    const [decision] = await rows<{ text: string; on: string }>(
      `select d.text, to_char(d.at, 'YYYY-MM-DD') as on from decisions d
         join key_results k on k.id = d.key_result_id
        where d.workspace_id = $1 and k.title like 'Cut security questionnaire turnaround%'`,
    );
    expect(decision?.on).toBe(on("2027-05-17"));
    const [initiative] = await rows<{ title: string }>(
      "select title from initiatives where workspace_id = $1 and title = 'Publish a trust-centre page'",
    );
    expect(initiative).toBeDefined();
  });

  it("finds C5.1's number, and adds C5.4 with its reason (NW-Q2-16)", async () => {
    if (!by("2027-05-31")) {
      return;
    }
    const [baseline] = await rows<{ done: string; value: string }>(
      `select to_char(k.done_at, 'YYYY-MM-DD') as done, k.current_value as value
         from key_results k join goals g on g.id = k.goal_id
        where k.workspace_id = $1 and g.cycle_id = $2 and k.deleted_at is null
          and k.title = 'Establish our win rate against Brightline'`,
      [q2Id],
    );
    expect(baseline?.done).toBe(on("2027-05-31"));
    expect(Number(baseline?.value)).toBe(31);
    const [added] = await rows<{ added: string }>(
      `select to_char(k.added_mid_cycle_at, 'YYYY-MM-DD') as added
         from key_results k join goals g on g.id = k.goal_id
        where k.workspace_id = $1 and g.cycle_id = $2 and k.deleted_at is null
          and k.title = 'Raise win rate against Brightline from 31% to 45%'`,
      [q2Id],
    );
    expect(added?.added).toBe(on("2027-05-31"));
  });
});

describe("closing Q2 (NW-Q2-19 to NW-Q2-21)", () => {
  it("shows C2's change of kind, S2.1's eased target and the additions on the scorecard", async () => {
    if (!by("2027-06-18")) {
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
    const row = scorecard.rows.find((one) => one.cycleId === q2Id);
    expect(row?.moved?.kindChanges).toEqual([
      expect.objectContaining({
        from: "committed",
        to: "aspirational",
        reason:
          "Two support agents move to the competitive response until July; the commitment cannot be met with the people left",
      }),
    ]);
    expect(row?.moved?.kindChanges[0]?.at.slice(0, 10)).toBe(on("2027-05-12"));
    expect(row?.moved?.eased).toEqual([
      expect.objectContaining({
        title: "Grow qualified mid-market pipeline from $2.6M to $3.4M",
        original: 3.4,
        target: 2.9,
      }),
    ]);
    // C5, its three key results, and C5.4.
    expect(row?.moved?.addedMidCycle).toBe(5);
    expect(row?.moved?.adjusted).toEqual([]);
  });

  it("grades 0.59 over twenty-two aspirational key results, with five of five committed met", async () => {
    if (!by("2027-06-16")) {
      return;
    }
    const scores = await rows<{
      kind: string;
      score: string | null;
      closed: boolean;
    }>(
      `select g.kind, k.score, g.close_decision = 'abandon' and g.closed_at < $3 as closed
         from key_results k join goals g on g.id = k.goal_id
        where k.workspace_id = $1 and g.cycle_id = $2 and k.deleted_at is null and g.deleted_at is null`,
      [q2Id, `${on("2027-06-01")}`],
    );
    const scored = scores.filter((one) => one.score !== null);
    const aspirational = scored.filter((one) => one.kind === "aspirational");
    const committed = scored.filter((one) => one.kind === "committed");
    expect(aspirational).toHaveLength(22);
    expect(committed).toHaveLength(5);
    const average =
      aspirational.reduce((sum, one) => sum + Number(one.score), 0) /
      aspirational.length;
    expect(average).toBeCloseTo(0.59, 2);
    expect(committed.every((one) => Number(one.score) >= 1)).toBe(true);
    expect(aspirational.filter((one) => Number(one.score) < 0.6)).toHaveLength(
      11,
    );
  });

  it("holds the review and the retrospective apart, the second naming the first", async () => {
    if (!by("2027-06-18")) {
      return;
    }
    const halves = await rows<{
      id: string;
      part: string;
      review: string | null;
      on: string;
    }>(
      `select id, review_part as part, review_session_id as review,
              to_char(scheduled_for, 'YYYY-MM-DD') as on
         from okr_sessions where workspace_id = $1 and cycle_id = $2
          and kind = 'quarterly' and deleted_at is null order by scheduled_for`,
      [q2Id],
    );
    expect(halves.map((one) => [one.part, one.on])).toEqual([
      ["review", on("2027-06-16")],
      ["retrospective", on("2027-06-18")],
    ]);
    expect(halves[1]?.review).toBe(halves[0]?.id);
  });

  it("reads a strategy or OKR-quality problem, with the rhythm kept (NW-Q2-21)", async () => {
    if (!by("2027-06-18")) {
      return;
    }
    const diagnostics = await rows<{
      verdict: string;
      share: string;
      score: string;
    }>(
      `select d.verdict, d.on_time_share as share, d.cycle_score as score
         from review_diagnostics d join okr_sessions s on s.id = d.session_id
        where d.workspace_id = $1 and s.cycle_id = $2 and d.deleted_at is null`,
      [q2Id],
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.verdict).toBe("strategy_or_quality");
    expect(Number(diagnostics[0]?.score)).toBeCloseTo(0.59, 2);
    expect(Number(diagnostics[0]?.share)).toBeGreaterThanOrEqual(0.75);
  });

  it("decides fifteen objectives, and Q3 holds the eleven kept and modified as drafts", async () => {
    if (!by("2027-06-18")) {
      return;
    }
    const decided = await rows<{ decision: string; title: string }>(
      `select r.decision, g.title from review_decisions r join goals g on g.id = r.goal_id
        where r.workspace_id = $1 and g.cycle_id = $2 and r.deleted_at is null`,
      [q2Id],
    );
    expect(decided).toHaveLength(15);
    expect(
      decided.find(
        (one) => one.title === "Fill the pipeline with accounts that fit",
      )?.decision,
    ).toBe("abandon");
    expect(
      decided.find(
        (one) => one.title === "Accounts that reached value grow with us",
      )?.decision,
    ).toBe("defer");
    const carried = await rows<{ title: string }>(
      `select g.title from goals g join goals f on f.id = g.carried_from_goal_id
        where g.workspace_id = $1 and f.cycle_id = $2 and g.deleted_at is null`,
      [q2Id],
    );
    expect(carried).toHaveLength(11);
  });
});

describe("mid-year (NW-Q2-22)", () => {
  it("eases A4's win rate with its reason, adds the Brightline key result and revises the not-doing list", async () => {
    if (!by("2027-06-21")) {
      return;
    }
    const [change] = await rows<{
      from: string;
      to: string;
      reason: string;
      on: string;
    }>(
      `select c.from_value as from, c.to_value as to, c.reason, to_char(c.changed_at, 'YYYY-MM-DD') as on
         from key_result_target_changes c join key_results k on k.id = c.key_result_id
        where c.workspace_id = $1 and k.title = 'Raise mid-market win rate from 26% to 35%'`,
    );
    expect(Number(change?.from)).toBe(35);
    expect(Number(change?.to)).toBe(32);
    expect(change?.reason).toBe(
      "Brightline's entry into the segment on 10 May",
    );
    expect(change?.on).toBe(on("2027-06-21"));
    const [added] = await rows<{ added: string }>(
      `select to_char(added_mid_cycle_at, 'YYYY-MM-DD') as added from key_results
        where workspace_id = $1 and title = 'Raise win rate against Brightline from 31% to 50% by year-end'`,
    );
    expect(added?.added).toBe(on("2027-06-21"));
    const [revision] = await rows<{ reason: string; fields: string[] }>(
      "select reason, fields from annual_frame_revisions where workspace_id = $1 and deleted_at is null",
    );
    expect(revision).toEqual({
      reason: "Competitive price point; the pricing review starts in Q3",
      fields: ["notDoing"],
    });
    // The annual objectives keep their strategies through the revision.
    const orphaned = await rows<{ title: string }>(
      `select g.title from goals g join annual_strategies s on s.id = g.strategy_id
        where g.workspace_id = $1 and s.deleted_at is not null and g.deleted_at is null`,
    );
    expect(orphaned).toEqual([]);
  });
});
