/**
 * Q4 to the outage, built against a database on a year whose dates have
 * passed (P9-T22c-e-a).
 *
 * The acceptance: given Q4 built to 6 December, when Q4 is read, then five
 * company objectives are published with C8 first on the issue list, and
 * uptime's response is a task with an owner and a date and no recovery.
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildNorthwindYear } from "../src/demo/year/build.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";
import { placeYear } from "./year-placement.ts";

const OWNER = "year-q4-plan-owner";
/**
 * Placed on the latest real year whose 6 December has passed, and built to
 * it (year-placement.ts).
 */
const { until, on } = placeYear("2027-12-06");

let workspaceId: string;
let q4Id: string | undefined;

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
    [OWNER, "Elena Marsh", "year-q4-plan-owner@example.com"],
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
  const [q4] = await rows<{ id: string }>(
    `select id from cycles where workspace_id = $1 and mode = 'quarterly'
        and starts_on <= $2 and ends_on >= $2 and deleted_at is null`,
    [on("2027-11-15")],
  );
  q4Id = q4?.id;
}, 900_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("planning Q4 (NW-Q4-01)", () => {
  it("puts expansion first on the issue list", async () => {
    const [first] = await rows<{ text: string; impact: number }>(
      `select text, impact from cycle_issues where workspace_id = $1 and cycle_id = $2
          and deleted_at is null order by impact desc, created_at limit 1`,
      [q4Id],
    );
    expect(first).toEqual({
      text: "Expansion from the accounts that reached value",
      impact: 5,
    });
  });

  it("publishes five company objectives at the cap, and seven from the teams", async () => {
    const [q4] = await rows<{ company: boolean; published: boolean }>(
      `select company_published_at is not null as company, published_at is not null as published
         from cycles where workspace_id = $1 and id = $2`,
      [q4Id],
    );
    expect(q4).toEqual({ company: true, published: true });
    const goals = await rows<{
      title: string;
      level: string;
      space: string | null;
    }>(
      `select g.title, g.level, s.name as space from goals g left join spaces s on s.id = g.space_id
        where g.workspace_id = $1 and g.cycle_id = $2 and g.deleted_at is null`,
      [q4Id],
    );
    expect(goals.filter((one) => one.level === "company")).toHaveLength(5);
    expect(goals).toHaveLength(12);
    // C2 became the merged team's committed objective (NW-Q4-01).
    expect(
      goals.find(
        (one) =>
          one.title ===
          "Support costs less per account, run from Customer Success",
      ),
    ).toMatchObject({ level: "team", space: "Customer Success" });
  });

  it("starts C6 from September's margin and C8 on the expansion and retention KPIs", async () => {
    const keyResults = await rows<{
      title: string;
      baseline: number;
      kpi: string | null;
    }>(
      `select k.title, k.baseline_value::float as baseline, i.title as kpi
         from key_results k join goals g on g.id = k.goal_id left join kpis i on i.id = k.kpi_id
        where k.workspace_id = $1 and g.cycle_id = $2 and k.deleted_at is null
          and g.title in ('Margins we can run the business on again', 'Expansion comes from accounts that reached value')
        order by g.title, k.position, k.created_at`,
      [q4Id],
    );
    expect(keyResults.map((one) => one.kpi)).toEqual([
      "Expansion seats added",
      "Net revenue retention",
      "Operating margin",
      null,
    ]);
    expect(keyResults[2]?.baseline).toBe(10.4);
  });
});

describe("Q4's weeks (NW-Q4-02 to NW-Q4-05)", () => {
  it("hands E1 back to Mei on her return", async () => {
    const [e1] = await rows<{ champion: string }>(
      `select m.name as champion from goals g join workspace_members m on m.id = g.champion_id
        where g.workspace_id = $1 and g.cycle_id = $2
          and g.title = 'Take the repeated questions out of the product'`,
      [q4Id],
    );
    expect(e1?.champion).toBe("Mei Lin");
  });

  it("answers the outage with a task, not a recovery, and Leo checks in at 3 in 10", async () => {
    const [uptime] = await rows<{
      state: string;
      kind: string;
      owner: string;
      due: string;
      recovery: string | null;
    }>(
      `select i.state, i.response_kind as kind, m.name as owner, to_char(t.due_on, 'YYYY-MM-DD') as due,
              i.recovery_goal_id as recovery
         from kpis i join tasks t on t.id = i.response_task_id
         join task_assignees a on a.task_id = t.id join workspace_members m on m.id = a.member_id
        where i.workspace_id = $1 and i.title = 'Uptime'`,
    );
    expect(uptime).toMatchObject({
      kind: "fix_now",
      owner: "Leo Martins",
      due: on("2027-12-17"),
      recovery: null,
    });
    const [e2] = await rows<{ confidence: string; on: string }>(
      `select c.confidence, to_char(c.published_at, 'YYYY-MM-DD') as on
         from check_ins c join goals g on g.id = c.subject_id
        where c.workspace_id = $1 and g.cycle_id = $2 and g.title = 'Keep the platform standing'
          and c.state = 'published' order by c.published_at desc limit 1`,
      [q4Id],
    );
    expect(e2).toEqual({ confidence: "0.30", on: on("2027-12-06") });
  });

  it("reads November's margin healthy, with C6 still open", async () => {
    const [margin] = await rows<{ state: string; open: boolean }>(
      `select i.state, g.closed_at is null as open from kpis i join goals g on g.id = i.recovery_goal_id
        where i.workspace_id = $1 and i.title = 'Operating margin'`,
    );
    expect(margin?.open).toBe(true);
    expect(margin?.state).toBe("healthy");
  });
});
