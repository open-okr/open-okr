/**
 * Q3's plan and the margin recovery, built against a database on a year whose
 * dates have passed (P9-T22c-d-a). The acceptance: given today after 14 July,
 * when Q3 is read, then C6 is part of the plan rather than added mid-cycle,
 * its first key result is the operating margin KPI from 7.6% to 13.5%, and
 * the expansion KPI's response names C6.2. The year is placed where these
 * dates have passed (year-placement.ts), so every expectation runs whatever
 * day the suite does.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildNorthwindYear } from "../src/demo/year/build.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";
import { placeYear } from "./year-placement.ts";

const OWNER = "year-q3-plan-owner";
/**
 * Placed on the latest real year whose 19 July has passed, and built to it
 * (year-placement.ts).
 */
const { until, on, by } = placeYear("2027-07-19");

let workspaceId: string;
let q3Id: string | undefined;

const rows = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> => {
  const wb = await workerDb();
  return (await wb.admin.query<T>(sql, [workspaceId, ...params])).rows;
};

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Elena Marsh", "year-q3-plan-owner@example.com"],
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

describe("planning Q3 (NW-Q3-01)", () => {
  it("ranks the deferred expansion below the two that come first, without losing it", async () => {
    if (!by("2027-06-21")) {
      return;
    }
    const issues = await rows<{ text: string; impact: number; source: string }>(
      `select text, impact, source from cycle_issues
        where workspace_id = $1 and cycle_id = $2 and deleted_at is null
        order by impact desc, created_at`,
      [q3Id],
    );
    const expansion = issues.find((one) =>
      one.text.includes("Accounts that reached value grow with us"),
    );
    expect(expansion).toMatchObject({ impact: 4, source: "carry_forward" });
    expect(issues.filter((one) => one.impact === 5)).toHaveLength(2);
  });

  it("keeps OBJ-1 at block in Q2's snapshot after it goes back to warn", async () => {
    if (!by("2027-06-25")) {
      return;
    }
    const [q2] = await rows<{ snapshot: string }>(
      `select practice_snapshot::text as snapshot from cycles
        where workspace_id = $1 and mode = 'quarterly'
          and starts_on <= $2 and ends_on >= $2`,
      [on("2027-05-12")],
    );
    expect(q2?.snapshot).toContain('"checks.OBJ-1": "block"');
  });

  it("publishes the company step on 28 June and the teams' on 14 July", async () => {
    const [q3] = await rows<{ company: boolean; published: boolean }>(
      `select company_published_at is not null as company, published_at is not null as published
         from cycles where workspace_id = $1 and id = $2`,
      [q3Id],
    );
    expect(q3?.company ?? false).toBe(by("2027-06-28"));
    expect(q3?.published ?? false).toBe(by("2027-07-14"));
  });

  it("holds five company objectives and ten from the teams, C2 committed again", async () => {
    if (!by("2027-07-14")) {
      return;
    }
    const goals = await rows<{ title: string; level: string; kind: string }>(
      `select title, level, kind from goals
        where workspace_id = $1 and cycle_id = $2 and deleted_at is null
          and added_mid_cycle_at is null`,
      [q3Id],
    );
    expect(goals.filter((one) => one.level === "company")).toHaveLength(5);
    expect(goals).toHaveLength(15);
    expect(
      goals.find(
        (one) => one.title === "Support cost per account falls while we grow",
      )?.kind,
    ).toBe("committed");
    expect(goals.map((one) => one.title)).toContain(
      "The first session shows value without a call",
    );
  });
});

describe("the margin recovery (NW-Q3-03, NW-Q3-04)", () => {
  it("launches C6 inside the window, the KPI first, the double counts swapped for the discount", async () => {
    if (!by("2027-07-06")) {
      return;
    }
    const [c6] = await rows<{
      id: string;
      kind: string;
      level: string;
      added: string | null;
      champion: string;
      parent: string;
    }>(
      `select g.id, g.kind, g.level, g.added_mid_cycle_at as added, m.name as champion, p.title as parent
         from goals g join workspace_members m on m.id = g.champion_id
         join goals p on p.id = g.parent_goal_id
        where g.workspace_id = $1 and g.cycle_id = $2
          and g.title = 'Margins we can run the business on again'`,
      [q3Id],
    );
    expect(c6).toMatchObject({
      kind: "committed",
      level: "company",
      added: null,
      champion: "Hugo Lindqvist",
      parent: "Grow profitably from the customers we keep",
    });
    const keyResults = await rows<{
      title: string;
      baseline: number;
      target: number;
      kpi: string | null;
    }>(
      `select k.title, k.baseline_value::float as baseline, k.target_value::float as target, i.title as kpi
         from key_results k left join kpis i on i.id = k.kpi_id
        where k.workspace_id = $1 and k.goal_id = $2 and k.deleted_at is null
        order by k.position, k.created_at`,
      [c6?.id],
    );
    expect(keyResults).toHaveLength(3);
    expect(keyResults[0]).toMatchObject({
      kpi: "Operating margin",
      baseline: 7.6,
      target: 13.5,
    });
    expect(keyResults.map((one) => one.kpi)).not.toContain(
      "Support tickets per account",
    );
    expect(keyResults.map((one) => one.title)).toContain(
      "Cut the average renewal discount from 14% to 6%",
    );
  });

  it("answers expansion seats with C6.2", async () => {
    if (!by("2027-07-06")) {
      return;
    }
    const [response] = await rows<{ kind: string; keyResult: string }>(
      `select i.response_kind as kind, k.title as "keyResult"
         from kpis i join key_results k on k.id = i.response_key_result_id
        where i.workspace_id = $1 and i.title = 'Expansion seats added'`,
    );
    expect(response).toEqual({
      kind: "key_result",
      keyResult: "Raise expansion seats added from 125 to 170 a month",
    });
  });
});

describe("Q3's first weeks (NW-Q3-02)", () => {
  it("checks the company in from week 1 and Sales from week 3, every two weeks", async () => {
    if (!by("2027-07-19")) {
      return;
    }
    const first = await rows<{ level: string; on: string }>(
      `select g.level, to_char(min(c.published_at), 'YYYY-MM-DD') as on
         from check_ins c join goals g on g.id = c.subject_id
        where c.workspace_id = $1 and g.cycle_id = $2 and c.state = 'published'
        group by g.level`,
      [q3Id],
    );
    expect(first.find((one) => one.level === "company")?.on).toBe(
      on("2027-07-05"),
    );
    const sales = await rows<{ on: string }>(
      `select distinct to_char(c.published_at, 'YYYY-MM-DD') as on
         from check_ins c join goals g on g.id = c.subject_id
        where c.workspace_id = $1 and g.cycle_id = $2 and c.state = 'published'
          and g.title = 'Win the late-stage deals against Brightline'
        order by 1`,
      [q3Id],
    );
    expect(sales[0]?.on).toBe(on("2027-07-19"));
    expect(sales.map((one) => one.on)).not.toContain(on("2027-07-26"));
  });
});
