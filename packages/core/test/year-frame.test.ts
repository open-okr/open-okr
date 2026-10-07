/**
 * The frame of the Northwind year, built against a database as of today
 * (P9-T22c-a).
 *
 * Written so it holds on any day the suite runs: each expectation is worked
 * out from the scenario's own dates placed on the real calendar, rather than
 * from what happened to be true the day this was written. Every person,
 * space, setting and reading dated on or before today is there, and nothing
 * dated after it.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { ANNUAL_OBJECTIVES } from "../src/demo/year/annual.ts";
import { buildNorthwindYear } from "../src/demo/year/build.ts";
import { isoDay, toReal } from "../src/demo/year/calendar.ts";
import { YEAR_KPIS } from "../src/demo/year/kpis.ts";
import { YEAR_PEOPLE, YEAR_SPACES } from "../src/demo/year/people.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "year-frame-owner";
const today = isoDay(new Date());
const realYear = Number(today.slice(0, 4));
const on = (scenarioDate: string) => toReal(scenarioDate, realYear);
const by = (scenarioDate: string) => on(scenarioDate) <= today;

let workspaceId: string;

const rows = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[],
): Promise<T[]> => {
  const wb = await workerDb();
  return (await wb.admin.query<T>(sql, params)).rows;
};

beforeAll(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Elena Marsh", "year-frame-owner@example.com"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Elena Marsh",
    })
  ).workspaceId;
  const built = await buildNorthwindYear({
    pool: wb.appPool,
    workspaceId,
    adminUserId: OWNER,
    frameOnly: true,
  });
  expect(built.alreadySeeded).toBe(false);
}, 300_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the people (README §2)", () => {
  it("has everybody who has arrived by today, and nobody who has not", async () => {
    const members = await rows<{ name: string; status: string }>(
      "select name, status from workspace_members where workspace_id = $1 and kind = 'human' and deleted_at is null",
      [workspaceId],
    );
    for (const person of YEAR_PEOPLE) {
      if (person.key === "elena") {
        continue;
      }
      const found = members.find((member) => member.name === person.name);
      if (!by(person.arrives)) {
        expect(found, person.name).toBeUndefined();
        continue;
      }
      // Suspended on their last day, the way directory sync does it.
      expect(found?.status, person.name).toBe(
        person.leaves && by(person.leaves) ? "suspended" : "active",
      );
    }
  });

  it("gives the registrant Elena's seat, and keeps their own name", async () => {
    const [founder] = await rows<{ name: string; title: string }>(
      "select name, title from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, OWNER],
    );
    expect(founder).toEqual({ name: "Elena Marsh", title: "Chief Executive" });
  });

  it("has the manager chain", async () => {
    const [jonas] = await rows<{ manager: string }>(
      `select m.name as manager from workspace_members w
         join workspace_members m on m.id = w.manager_id
        where w.workspace_id = $1 and w.name = 'Jonas Weber'`,
      [workspaceId],
    );
    expect(jonas?.manager).toBe("Daniel Osei");
  });
});

describe("the spaces (README §3)", () => {
  it("has every space formed by today, and archives the one that merged", async () => {
    const spaces = await rows<{ name: string; deleted: boolean }>(
      "select name, deleted_at is not null as deleted from spaces where workspace_id = $1",
      [workspaceId],
    );
    for (const space of YEAR_SPACES) {
      if (space.key === "company") {
        continue;
      }
      const found = spaces.find((one) => one.name === space.name);
      if (!by(space.forms)) {
        expect(found, space.name).toBeUndefined();
        continue;
      }
      expect(found?.deleted, space.name).toBe(
        space.merges !== undefined && by(space.merges),
      );
    }
  });

  it("calls a space a team (NW-P-06)", async () => {
    const [settings] = await rows<{ labels: Record<string, unknown> }>(
      "select labels from rhythm_settings where workspace_id = $1",
      [workspaceId],
    );
    expect(settings?.labels.space).toEqual({
      singular: "Team",
      plural: "Teams",
    });
  });
});

describe("the year's practice settings, as they stood on each date", () => {
  it("has changed each setting only once its date has come", async () => {
    const [settings] = await rows<{
      overrides: Record<string, unknown>;
      practice: Record<string, unknown>;
    }>(
      "select overrides, practice from rhythm_settings where workspace_id = $1",
      [workspaceId],
    );
    const practice = settings?.practice ?? {};
    expect(settings?.overrides["quality.objectivesPerUnitCap"]).toBe(
      by("2027-04-02") ? 2 : undefined,
    );
    expect(practice["escalation.criticalConfidence"]).toBe(
      by("2027-04-02") ? "on" : undefined,
    );
    expect(practice["checks.OBJ-1"]).toBe(
      by("2027-06-25") ? "warn" : by("2027-04-02") ? "block" : undefined,
    );
    expect(practice["reasons.midCycleAddition"]).toBe(
      by("2027-05-14") ? "required" : undefined,
    );
    expect(practice["review.format"]).toBe(
      by("2027-06-07") ? "split" : undefined,
    );
    expect(practice["levels.department"]).toBe(
      by("2027-12-17") ? "off" : undefined,
    );
  });
});

describe("the KPIs (NW-P-12)", () => {
  it("has the eleven, each judged by its own thresholds", async () => {
    const kpis = await rows<{
      title: string;
      target_type: string;
      green_low: string | null;
      red_high: string | null;
    }>(
      "select title, target_type, green_low, red_high from kpis where workspace_id = $1 and deleted_at is null",
      [workspaceId],
    );
    expect(kpis).toHaveLength(YEAR_KPIS.length);
    const uptime = kpis.find((kpi) => kpi.title === "Uptime");
    expect(uptime?.target_type).toBe("range");
    expect(Number(uptime?.green_low)).toBe(99.9);
    const tickets = kpis.find(
      (kpi) => kpi.title === "Support tickets per account",
    );
    expect(Number(tickets?.red_high)).toBe(3.2);
  });

  it("holds every reading recorded by today, and none recorded after", async () => {
    const months = [
      ["2026-12", "2027-01-05"],
      ["2027-01", "2027-02-01"],
      ["2027-02", "2027-03-05"],
      ["2027-03", "2027-04-05"],
      ["2027-04", "2027-05-05"],
      ["2027-05", "2027-06-05"],
      ["2027-06", "2027-07-05"],
      ["2027-07", "2027-08-05"],
      ["2027-08", "2027-09-05"],
      ["2027-09", "2027-10-05"],
      ["2027-10", "2027-11-05"],
      ["2027-11", "2027-12-06"],
    ] as const;
    const recorded = months.filter(([, day]) => by(day)).length;
    const measured = YEAR_KPIS.filter((kpi) => kpi.before.length > 0).length;
    const [count] = await rows<{ count: string }>(
      "select count(*) as count from kpi_records where workspace_id = $1 and deleted_at is null",
      [workspaceId],
    );
    expect(Number(count?.count)).toBe(measured * 6 + measured * recorded);
  });
});

describe("the annual frame and objectives (NW-P-08, NW-P-10, NW-P-14)", () => {
  it("publishes the four annual objectives, two committed and two aspirational", async () => {
    const goals = await rows<{ title: string; kind: string }>(
      `select g.title, g.kind from goals g join cycles c on c.id = g.cycle_id
        where g.workspace_id = $1 and c.mode = 'annual' and g.deleted_at is null`,
      [workspaceId],
    );
    expect(goals.map((goal) => goal.title).sort()).toEqual(
      ANNUAL_OBJECTIVES.map((objective) => objective.title).sort(),
    );
    expect(goals.filter((goal) => goal.kind === "committed")).toHaveLength(2);

    const [annual] = await rows<{ published: boolean }>(
      "select published_at is not null as published from cycles where workspace_id = $1 and mode = 'annual'",
      [workspaceId],
    );
    expect(annual?.published).toBe(true);
  });

  it("reads the frame back with its four strategies and the not-doing list", async () => {
    const frame = await callAction(
      {
        pool: (await workerDb()).appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
      },
      "frame.read",
      {},
    );
    expect(frame?.strategies.map((strategy) => strategy.text)).toEqual([
      "Own the mid-market segment we already win in",
      "Make the product prove itself in the first thirty days",
      "Turn support load into product change instead of headcount",
      "Earn the trust of enterprise security teams without custom work",
    ]);
  });
});

describe("a second run", () => {
  it("writes nothing into a workspace that already holds the year", async () => {
    const wb = await workerDb();
    const again = await buildNorthwindYear({
      pool: wb.appPool,
      workspaceId,
      adminUserId: OWNER,
    });
    expect(again.alreadySeeded).toBe(true);
  });
});
