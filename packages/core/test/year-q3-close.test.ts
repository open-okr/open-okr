/**
 * Q3's summer and its close, built against a database as of today
 * (P9-T22c-d-b).
 *
 * The acceptance: given today after Q3's retrospective, when its diagnostic
 * is read, then the holiday weeks are not counted as missed check-ins. Each
 * expectation waits for its own date on today's calendar, so the file holds
 * on any day it runs.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildNorthwindYear } from "../src/demo/year/build.ts";
import { isoDay, toReal } from "../src/demo/year/calendar.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "year-q3-close-owner";
const today = isoDay(new Date());
const realYear = Number(today.slice(0, 4));
const on = (scenarioDate: string) => toReal(scenarioDate, realYear);
/**
 * Built to the last day this file reads, or to today when that is earlier:
 * the whole year is the slowest thing the suite builds.
 */
const until = [on("2027-09-16"), today].sort()[0] as string;
const by = (scenarioDate: string) => on(scenarioDate) <= until;

let workspaceId: string;
let q3Id: string | undefined;

const rows = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> => {
  const wb = await workerDb();
  return (await wb.admin.query<T>(sql, [workspaceId, ...params])).rows;
};

/** Who published an objective's check-ins in Q3, by day. */
const checkIns = async (title: string) =>
  rows<{ on: string; author: string }>(
    `select to_char(c.published_at, 'YYYY-MM-DD') as on, m.name as author
       from check_ins c join goals g on g.id = c.subject_id
       join workspace_members m on m.id = c.author_member_id
      where c.workspace_id = $1 and g.cycle_id = $2 and g.title = $3
        and c.state = 'published'
      order by c.published_at`,
    [q3Id, title],
  );

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Elena Marsh", "year-q3-close-owner@example.com"],
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
  const [q3] = await rows<{ id: string }>(
    `select id from cycles where workspace_id = $1 and mode = 'quarterly'
        and starts_on <= $2 and ends_on >= $2 and deleted_at is null`,
    [on("2027-08-15")],
  );
  q3Id = q3?.id;
}, 900_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the summer (NW-Q3-06 to NW-Q3-09)", () => {
  it("checks Product in on nothing in its holiday weeks, and Amara stands in for Sara", async () => {
    if (!by("2027-08-23")) {
      return;
    }
    const p4 = await checkIns("The first session shows value without a call");
    const days = p4.map((one) => one.on);
    expect(days).not.toContain(on("2027-08-09"));
    expect(days).not.toContain(on("2027-08-16"));
    expect(p4.find((one) => one.on === on("2027-08-23"))?.author).toBe(
      "Amara Diallo",
    );
    const [leave] = await rows<{ delegate: string }>(
      `select d.name as delegate from member_leave l
         join workspace_members m on m.id = l.member_id
         join workspace_members d on d.id = l.delegate_member_id
        where l.workspace_id = $1 and m.name = 'Sara Nasser' and l.deleted_at is null`,
    );
    expect(leave?.delegate).toBe("Amara Diallo");
  });

  it("moves SU1 to Customer Success before Support is archived (NW-Q3-07)", async () => {
    if (!by("2027-07-26")) {
      return;
    }
    const [su1] = await rows<{ space: string }>(
      `select s.name as space from goals g join spaces s on s.id = g.space_id
        where g.workspace_id = $1 and g.cycle_id = $2 and g.title = 'Answer once, in the product'`,
      [q3Id],
    );
    expect(su1?.space).toBe("Customer Success");
    const [support] = await rows<{ archived: boolean }>(
      "select deleted_at is not null as archived from spaces where workspace_id = $1 and name = 'Support'",
    );
    expect(support?.archived).toBe(true);
  });

  it("hands C3 and E1 to Leo, with Priya standing in for Mei (NW-Q3-08)", async () => {
    if (!by("2027-07-30")) {
      return;
    }
    const champions = await rows<{ title: string; champion: string }>(
      `select g.title, m.name as champion from goals g join workspace_members m on m.id = g.champion_id
        where g.workspace_id = $1 and g.cycle_id = $2
          and g.title in ('Put the SOC 2 Type II report in customers'' hands', 'Take the repeated questions out of the product')`,
      [q3Id],
    );
    expect(champions.map((one) => one.champion)).toEqual([
      "Leo Martins",
      "Leo Martins",
    ]);
  });

  it("starts G1 mid-cycle with its reason, and adds G1.2 once the baseline is found (NW-Q3-09, NW-Q3-11)", async () => {
    if (!by("2027-08-23")) {
      return;
    }
    const [g1] = await rows<{ added: string; space: string; parent: string }>(
      `select to_char(g.added_mid_cycle_at, 'YYYY-MM-DD') as added, s.name as space, p.title as parent
         from goals g join spaces s on s.id = g.space_id join goals p on p.id = g.parent_goal_id
        where g.workspace_id = $1 and g.cycle_id = $2
          and g.title = 'Trials turn into customers without a sales call'`,
      [q3Id],
    );
    expect(g1).toEqual({
      added: on("2027-08-09"),
      space: "Growth",
      parent: "New accounts reach value in their first week",
    });
    const keyResults = await rows<{
      title: string;
      done: string | null;
      added: string;
    }>(
      `select k.title, to_char(k.done_at, 'YYYY-MM-DD') as done, to_char(k.added_mid_cycle_at, 'YYYY-MM-DD') as added
         from key_results k join goals g on g.id = k.goal_id
        where k.workspace_id = $1 and g.cycle_id = $2
          and g.title = 'Trials turn into customers without a sales call'
          and k.deleted_at is null order by k.created_at`,
      [q3Id],
    );
    expect(keyResults).toEqual([
      {
        title: "Establish the self-serve trial-to-paid rate",
        done: on("2027-08-23"),
        added: on("2027-08-09"),
      },
      {
        title: "Raise self-serve trial-to-paid conversion from 4.1% to 7%",
        done: null,
        added: on("2027-08-23"),
      },
    ]);
  });

  it("ticks F3's milestones and the SOC 2 report done on their days (NW-Q3-12, NW-Q3-13)", async () => {
    if (!by("2027-09-10")) {
      return;
    }
    const done = await rows<{ title: string; on: string }>(
      `select k.title, to_char(k.done_at, 'YYYY-MM-DD') as on from key_results k
         join goals g on g.id = k.goal_id
        where k.workspace_id = $1 and g.cycle_id = $2 and k.kind = 'milestone'
        order by k.done_at`,
      [q3Id],
    );
    expect(done.map((one) => one.on)).toEqual([
      on("2027-08-27"),
      on("2027-09-01"),
      on("2027-09-10"),
    ]);
  });
});

describe("closing Q3 (NW-Q3-14 to NW-Q3-16)", () => {
  it("grades 0.66 over sixteen aspirational key results, with seven of eleven commitments met", async () => {
    if (!by("2027-09-15")) {
      return;
    }
    const scores = await rows<{ kind: string; score: string }>(
      `select g.kind, k.score from key_results k join goals g on g.id = k.goal_id
        where k.workspace_id = $1 and g.cycle_id = $2 and k.deleted_at is null
          and g.deleted_at is null and k.score is not null`,
      [q3Id],
    );
    const aspirational = scores.filter((one) => one.kind === "aspirational");
    const committed = scores.filter((one) => one.kind === "committed");
    expect(aspirational).toHaveLength(16);
    expect(committed).toHaveLength(11);
    const average =
      aspirational.reduce((sum, one) => sum + Number(one.score), 0) /
      aspirational.length;
    expect(average).toBeCloseTo(0.66, 2);
    expect(committed.filter((one) => Number(one.score) >= 1)).toHaveLength(7);
  });

  it("reads results delivered, with the holiday weeks left out rather than missed", async () => {
    if (!by("2027-09-16")) {
      return;
    }
    const [diagnostic] = await rows<{
      verdict: string;
      share: string;
      due: number;
      onTime: number;
    }>(
      `select d.verdict, d.on_time_share as share, d.due_check_ins as due, d.on_time_check_ins as "onTime"
         from review_diagnostics d join okr_sessions s on s.id = d.session_id
        where d.workspace_id = $1 and s.cycle_id = $2 and d.deleted_at is null`,
      [q3Id],
    );
    expect(diagnostic?.verdict).toBe("results_delivered");
    // The twenty misses are the Mondays before each set checked in: the
    // teams' first two (eight weekly objectives), the first for Sales' two
    // fortnightly ones and for C6, and G1's first. Product's two holiday
    // weeks would add four more for P4 and P2 if they were counted.
    expect(Number(diagnostic?.due) - Number(diagnostic?.onTime)).toBe(20);
    // About 86%, as the chapter reads it.
    expect(Number(diagnostic?.share)).toBeGreaterThan(0.85);
    expect(Number(diagnostic?.share)).toBeLessThan(0.9);
  });

  it("decides all sixteen objectives, and Q4 holds the nine kept and modified as drafts", async () => {
    if (!by("2027-09-16")) {
      return;
    }
    const decided = await rows<{ decision: string }>(
      `select r.decision from review_decisions r join goals g on g.id = r.goal_id
        where r.workspace_id = $1 and g.cycle_id = $2 and r.deleted_at is null`,
      [q3Id],
    );
    expect(decided).toHaveLength(16);
    const carried = await rows<{ title: string }>(
      `select g.title from goals g join goals f on f.id = g.carried_from_goal_id
        where g.workspace_id = $1 and f.cycle_id = $2 and g.deleted_at is null`,
      [q3Id],
    );
    expect(carried).toHaveLength(9);
  });
});
