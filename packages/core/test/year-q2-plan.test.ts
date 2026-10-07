/**
 * Q2's plan and its first five weeks, built against a database as of today
 * (P9-T22c-c-a).
 *
 * The acceptance: given today after 3 May, when Q2 is read, then the eleven
 * objectives Q1 kept or modified are there with each key result starting
 * where Q1 left it, both publish steps are done with F2's override on
 * record, nothing is marked as added mid-cycle, and the first monthly review
 * gave each company objective a trend. Each expectation waits for its own
 * date on today's calendar, so the file holds on any day it runs.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildNorthwindYear } from "../src/demo/year/build.ts";
import { isoDay, toReal } from "../src/demo/year/calendar.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "year-q2-plan-owner";
const today = isoDay(new Date());
const realYear = Number(today.slice(0, 4));
const on = (scenarioDate: string) => toReal(scenarioDate, realYear);
const by = (scenarioDate: string) => on(scenarioDate) <= today;

let workspaceId: string;
let q2Id: string | undefined;

const rows = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> => {
  const wb = await workerDb();
  return (await wb.admin.query<T>(sql, [workspaceId, ...params])).rows;
};

/** A key result in Q2 by its title. */
const keyResult = async (title: string) =>
  (
    await rows<{ baseline: number; target: number | null }>(
      `select k.baseline_value::float as baseline, k.target_value::float as target
         from key_results k join goals g on g.id = k.goal_id
        where k.workspace_id = $1 and g.cycle_id = $2 and k.title = $3 and k.deleted_at is null`,
      [q2Id, title],
    )
  )[0];

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Elena Marsh", "year-q2-plan-owner@example.com"],
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
  const [q2] = await rows<{ id: string }>(
    `select id from cycles where workspace_id = $1 and mode = 'quarterly'
        and starts_on <= $2 and ends_on >= $2 and deleted_at is null`,
    [on("2027-05-03")],
  );
  q2Id = q2?.id;
}, 900_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("planning Q2 (NW-Q2-01 to NW-Q2-07)", () => {
  it("starts each kept key result where Q1 left it, and C1.2 from Sara's 56%", async () => {
    if (!by("2027-03-24")) {
      return;
    }
    const carried = await rows<{ title: string }>(
      `select title from goals where workspace_id = $1 and cycle_id = $2
          and carried_from_goal_id is not null and deleted_at is null`,
      [q2Id],
    );
    expect(carried).toHaveLength(11);
    expect(await keyResult("Raise 30-day activation from 56% to 62%")).toEqual({
      baseline: 56,
      target: 62,
    });
    expect(
      await keyResult("Cut median time to first value from 7 days to 5"),
    ).toEqual({ baseline: 7, target: 5 });
    expect(
      await keyResult(
        "Cut support tickets per account from 2.55 to 2.3 a month",
      ),
    ).toEqual({ baseline: 2.55, target: 2.3 });
  });

  it("publishes the company's step on 29 March and the teams' on 15 April", async () => {
    const [q2] = await rows<{ company: boolean; published: boolean }>(
      `select company_published_at is not null as company, published_at is not null as published
         from cycles where id = $2 and workspace_id = $1`,
      [q2Id],
    );
    expect(q2?.company ?? false).toBe(by("2027-03-29"));
    expect(q2?.published ?? false).toBe(by("2027-04-15"));
  });

  it("holds fifteen objectives, two per team at most, and the build time as an initiative", async () => {
    if (!by("2027-04-15")) {
      return;
    }
    // The plan: what was not started after it published (C5 is, on 12 May).
    const objectives = await rows<{ title: string; space: string | null }>(
      `select g.title, s.name as space from goals g left join spaces s on s.id = g.space_id
        where g.workspace_id = $1 and g.cycle_id = $2 and g.deleted_at is null
          and g.added_mid_cycle_at is null`,
      [q2Id],
    );
    expect(objectives).toHaveLength(15);
    const engineering = objectives.filter((one) => one.space === "Engineering");
    expect(engineering).toHaveLength(2);
    // Nadia's rewrite is what published (NW-Q2-06).
    expect(objectives.map((one) => one.title)).toContain(
      "Leads that turn into deals",
    );
    const [build] = await rows<{ title: string }>(
      "select title from initiatives where workspace_id = $1 and title = 'Halve the build time' and deleted_at is null",
    );
    expect(build).toBeDefined();
  });

  it("marks nothing in the plan as added mid-cycle, only what started after it", async () => {
    const marked = await rows<{ title: string }>(
      `select title from goals where workspace_id = $1 and cycle_id = $2
          and added_mid_cycle_at is not null and deleted_at is null`,
      [q2Id],
    );
    // C5, started on 12 May (P9-T22c-c-b), is the one addition.
    expect(marked.map((one) => one.title)).toEqual(
      by("2027-05-12") ? ["Mid-market buyers choose us over Brightline"] : [],
    );
  });

  it("records the override past OBJ-1 for F2, with Elena's reason (NW-Q2-06)", async () => {
    if (!by("2027-04-15")) {
      return;
    }
    const overrides = await rows<{ payload: string }>(
      "select payload::text as payload from audit_events where workspace_id = $1 and action = 'workflow.override'",
    );
    expect(overrides).toHaveLength(1);
    expect(overrides[0]?.payload).toContain(
      "A reporting deliverable the board asked for",
    );
  });

  it("has Yuki following P1 (NW-Q2-05)", async () => {
    if (!by("2027-04-12")) {
      return;
    }
    const following = await rows<{ title: string }>(
      `select g.title from subscriptions s
         join subscription_lists l on l.id = s.list_id
         join goals g on g.id = l.subject_id
         join workspace_members m on m.id = s.member_id
        where s.workspace_id = $1 and m.name = 'Yuki Tanaka' and not s.canceled
          and s.deleted_at is null and g.cycle_id = $2`,
      [q2Id],
    );
    expect(following.map((one) => one.title)).toEqual([
      "Onboarding runs without us in the room",
    ]);
  });

  it("escalates CS2's unconfirmed dependency and then confirms it (NW-Q2-07)", async () => {
    if (!by("2027-04-19")) {
      return;
    }
    const dependencies = await rows<{ escalated: boolean; confirmed: boolean }>(
      `select d.escalated_at is not null as escalated, d.confirmed
         from key_result_dependencies d join key_results k on k.id = d.key_result_id
         join goals g on g.id = k.goal_id
        where d.workspace_id = $1 and g.cycle_id = $2 and d.deleted_at is null`,
      [q2Id],
    );
    expect(dependencies).toEqual([{ escalated: true, confirmed: true }]);
  });
});

describe("Q2's first five weeks (NW-Q2-08)", () => {
  it("checks the company in from week 1 and the teams from week 3", async () => {
    if (!by("2027-04-19")) {
      return;
    }
    const first = await rows<{ level: string; on: string }>(
      `select g.level, to_char(min(c.published_at), 'YYYY-MM-DD') as on
         from check_ins c join goals g on g.id = c.subject_id
        where c.workspace_id = $1 and g.cycle_id = $2 and c.state = 'published'
        group by g.level`,
      [q2Id],
    );
    expect(first.find((one) => one.level === "company")?.on).toBe(
      on("2027-04-05"),
    );
    for (const level of ["department", "team"]) {
      expect(first.find((one) => one.level === level)?.on).toBe(
        on("2027-04-19"),
      );
    }
  });

  it("gives each company objective a trend at the first monthly review", async () => {
    if (!by("2027-05-03")) {
      return;
    }
    const trends = await rows<{ title: string; trend: string }>(
      `select g.title, t.trend from objective_trends t join goals g on g.id = t.goal_id
        where t.workspace_id = $1 and g.cycle_id = $2 and t.deleted_at is null
          and t.month = date_trunc('month', $3::date)::date
        order by g.title`,
      [q2Id, on("2027-05-03")],
    );
    expect(trends).toHaveLength(4);
    expect(
      trends.find(
        (one) => one.title === "New accounts reach value in their first week",
      )?.trend,
    ).toBe("improving");
  });
});
