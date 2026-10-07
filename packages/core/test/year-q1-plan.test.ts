/**
 * The pilot and Q1's plan, built against a database on a year whose dates
 * have passed (P9-T22c-b-a). The acceptance: given today after 15 January,
 * when Q1 is read, then both publish steps are done, no objective is marked
 * as added mid-cycle, and the pilot is closed with its scores in Q1's
 * prior-cycle list. The year is placed where these dates have passed
 * (year-placement.ts), so every expectation runs whatever day the suite does.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildNorthwindYear } from "../src/demo/year/build.ts";
import { toReal } from "../src/demo/year/calendar.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";
import { placeYear } from "./year-placement.ts";

const OWNER = "year-q1-plan-owner";
/**
 * Placed on the latest real year whose 15 January has passed, and built to it
 * (year-placement.ts).
 */
const { realYear, until, by } = placeYear("2027-01-15");

let workspaceId: string;

const rows = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> => {
  const wb = await workerDb();
  return (await wb.admin.query<T>(sql, [workspaceId, ...params])).rows;
};

/** The quarter that holds a scenario date, by its real bounds. */
const cycleAt = async (scenarioDate: string, mode = "quarterly") => {
  const on = toReal(scenarioDate, realYear);
  const [cycle] = await rows<{
    id: string;
    status: string;
    first_cycle: boolean;
    company_published: boolean;
    published: boolean;
  }>(
    `select id, status, first_cycle, company_published_at is not null as company_published,
            published_at is not null as published
       from cycles where workspace_id = $1 and mode = $2
        and starts_on <= $3 and ends_on >= $3 and deleted_at is null`,
    [mode, on],
  );
  return cycle;
};

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Elena Marsh", "year-q1-plan-owner@example.com"],
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
}, 600_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the pilot (NW-P-02, NW-P-03, NW-P-13)", () => {
  it("is a declared first cycle, closed after its review", async () => {
    const pilot = await cycleAt("2026-10-01");
    expect(pilot?.first_cycle).toBe(true);
    expect(pilot?.status).toBe(by("2026-12-14") ? "closed" : "active");
  });

  it("checked in every Monday, on the Monday", async () => {
    const checkIns = await rows<{
      on: string;
      confidence: string;
      title: string;
    }>(
      `select to_char(c.published_at, 'YYYY-MM-DD') as on, c.confidence, g.title
         from check_ins c join goals g on g.id = c.subject_id
        where c.workspace_id = $1 and c.state = 'published'
          and g.title in ('New accounts reach value faster', 'No customer is surprised by their own renewal')
          and g.cycle_id in (select id from cycles where workspace_id = $1 and first_cycle)`,
    );
    expect(checkIns).toHaveLength(18);
    for (const checkIn of checkIns) {
      expect(new Date(`${checkIn.on}T00:00:00Z`).getUTCDay()).toBe(1);
    }
    // Tomás's renewals confidence fell to 3 in 10 in week five (NW-P-03).
    const weekFive = toReal("2026-11-02", realYear);
    const renewals = checkIns.find(
      (checkIn) =>
        checkIn.on === weekFive &&
        checkIn.title === "No customer is surprised by their own renewal",
    );
    expect(Number(renewals?.confidence)).toBe(0.3);
  });

  it("scored 0.55, and its scores reached Q1's prior-cycle list", async () => {
    const scores = await rows<{ score: string }>(
      `select k.score from key_results k join goals g on g.id = k.goal_id
        join cycles c on c.id = g.cycle_id
        where k.workspace_id = $1 and c.first_cycle and k.deleted_at is null`,
    );
    const average =
      scores.reduce((sum, row) => sum + Number(row.score), 0) / scores.length;
    expect(average).toBeCloseTo(0.55, 10);

    const q1 = await cycleAt("2027-01-15");
    const prior = await rows<{ count: string }>(
      "select count(*) as count from cycle_prior_scores where workspace_id = $1 and cycle_id = $2 and deleted_at is null",
      [q1?.id],
    );
    expect(Number(prior[0]?.count)).toBe(4);
    // Both learnings are in Q1's input pack (NW-P-13).
    const [pack] = await rows<{ note: string }>(
      "select note from cycle_pack_items where workspace_id = $1 and cycle_id = $2 and item_key = 2 and deleted_at is null",
      [q1?.id],
    );
    expect(pack?.note).toContain("four key results per objective");
    expect(pack?.note).toContain("the weekly session is where the value is");
  });
});

describe("Q1's plan (NW-Q1-01 to NW-Q1-14)", () => {
  it("publishes in two steps, the company's first", async () => {
    const q1 = await cycleAt("2027-01-15");
    expect(q1?.company_published).toBe(by("2026-12-23"));
    expect(q1?.published).toBe(by("2027-01-15"));
  });

  it("marks nothing as added mid-cycle, because all of it is the plan (NW-Q1-14)", async () => {
    const q1 = await cycleAt("2027-01-15");
    const marked = await rows<{ title: string }>(
      `select title from goals where workspace_id = $1 and cycle_id = $2
          and added_mid_cycle_at is not null and deleted_at is null`,
      [q1?.id],
    );
    expect(marked).toEqual([]);
  });

  it("holds the plan the peer review left (NW-Q1-12)", async () => {
    if (!by("2027-01-12")) {
      return;
    }
    const q1 = await cycleAt("2027-01-15");
    const goals = await rows<{ title: string }>(
      "select title from goals where workspace_id = $1 and cycle_id = $2 and deleted_at is null order by title",
      [q1?.id],
    );
    // Three company and eleven department and team objectives: Engineering's
    // two extra became initiatives.
    expect(goals).toHaveLength(14);
    expect(goals.map((goal) => goal.title)).not.toContain(
      "Retire the legacy job runner",
    );
    // Q2 adds one of its own (NW-Q2-04), so Q1's are looked for by name.
    const initiatives = await rows<{ title: string }>(
      "select title from initiatives where workspace_id = $1 and deleted_at is null order by title",
    );
    expect(initiatives.map((one) => one.title)).toEqual(
      expect.arrayContaining([
        "Retire the legacy job runner",
        "Write a runbook for every alert",
      ]),
    );
    // S2 measures outcomes now, and P1's duplicate of E3.1 is gone. Read
    // in Q1, because a kept objective comes back in Q2 under the same title.
    const s2 = await rows<{ title: string }>(
      `select k.title from key_results k join goals g on g.id = k.goal_id
        where k.workspace_id = $1 and g.title = 'Fill the pipeline with accounts that fit'
          and g.cycle_id = $2 and k.deleted_at is null order by k.position`,
      [q1?.id],
    );
    expect(s2.map((row) => row.title)).toEqual([
      "Raise call-to-meeting conversion from 8% to 12%",
      "Grow qualified mid-market pipeline from $2.1M to $3.0M",
    ]);
    const p1 = await rows<{ title: string; kind: string }>(
      `select k.title, k.kind from key_results k join goals g on g.id = k.goal_id
        where k.workspace_id = $1 and g.title = 'Onboarding runs without us in the room'
          and g.cycle_id = $2 and k.deleted_at is null order by k.position`,
      [q1?.id],
    );
    expect(p1).toEqual([
      {
        title: "Cut manual setup calls per new account from 1.2 to 0.6",
        kind: "metric",
      },
      { title: "Establish an onboarding NPS baseline", kind: "baseline" },
    ]);
  });

  it("aligns diagonally, to a key result and to an annual objective, and lets Finance stand alone", async () => {
    if (!by("2027-01-07")) {
      return;
    }
    const [m1] = await rows<{ parent: string }>(
      `select p.title as parent from goals g join goals p on p.id = g.parent_goal_id
        where g.workspace_id = $1 and g.title = 'Bring in accounts that fit'`,
    );
    expect(m1?.parent).toBe("Sell to accounts that can onboard themselves");
    const [f1] = await rows<{ standalone_reason: string }>(
      "select standalone_reason from goals where workspace_id = $1 and title = 'Close the books in five days'",
    );
    expect(f1?.standalone_reason).toBe(
      "Finance operating cadence the board relies on",
    );
    const [e1] = await rows<{ parent: string }>(
      `select k.title as parent from goals g join key_results k on k.id = g.parent_key_result_id
        where g.workspace_id = $1 and g.title = 'Take the twelve repeated questions out of the product'`,
    );
    expect(e1?.parent).toBe(
      "Cut support tickets per account from 2.9 to 2.4 a month",
    );
  });

  it("confirms both dependencies on Engineering (NW-Q1-13)", async () => {
    if (!by("2027-01-13")) {
      return;
    }
    const q1 = await cycleAt("2027-01-15");
    const dependencies = await rows<{ confirmed: boolean }>(
      `select d.confirmed_at is not null as confirmed from key_result_dependencies d
         join key_results k on k.id = d.key_result_id join goals g on g.id = k.goal_id
        where d.workspace_id = $1 and g.cycle_id = $2 and d.deleted_at is null`,
      [q1?.id],
    );
    expect(dependencies).toHaveLength(2);
    expect(dependencies.every((one) => one.confirmed)).toBe(true);
  });
});
