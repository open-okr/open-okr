/**
 * Projects, tasks and checklists, from a real FlowyTeam into a real workspace
 * (TECHNICAL-PLAN §7.2, P6-T04a).
 *
 * Two claims worth a real database. That a task's status comes from its board
 * column where the column is one this product recognises and from the task's
 * own field where it is not, which is the case a live instance forces: its
 * columns are free text and multilingual. And that a project with nobody on a
 * team is skipped by name rather than dropped into an arbitrary space, because
 * an initiative in the wrong team is work the wrong people are accountable for.
 */
import { provisionWorkspaceForUser, type Source } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runFlowyteamImport } from "../src/flowyteam/run.ts";
import { openSource } from "../src/flowyteam/source.ts";
import {
  available,
  SEEDED,
  type SeededSource,
  SKIP_REASON,
  seedSource,
} from "./support/flowyteam-source.ts";

const OWNER = "88888888-8888-4888-8888-888888888888";
const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam work tests. ${SKIP_REASON}`);
}

let pool: Pool;
let workspaceId: string;
let seeded: SeededSource;
let source: Source;

async function rows<T extends Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  const wb = await workerDb();
  const result = await wb.admin.query<T>(sql);
  return result.rows;
}

async function count(sql: string): Promise<number> {
  const [row] = await rows<{ n: number }>(sql);
  return row?.n ?? 0;
}

async function run(write: boolean) {
  return runFlowyteamImport({
    pool,
    workspaceId,
    userId: OWNER,
    url: seeded.url,
    companyId: SEEDED.first.id,
    source,
    write,
  });
}

const domain = (
  report: Awaited<ReturnType<typeof run>>["report"],
  name: string,
) => report.reconciliation.find((one) => one.domain === name);

beforeEach(async () => {
  if (!runnable) {
    return;
  }
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Import Owner", "work-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Import Owner",
  });
  workspaceId = provisioned.workspaceId;

  await seeded?.drop();
  await source?.close();
  seeded = await seedSource("work");
  source = await openSource({ url: seeded.url });
});

afterAll(async () => {
  await source?.close();
  await seeded?.drop();
  const wb = await workerDb();
  await wb.close();
});

describe.skipIf(!runnable)("importing one company's work", () => {
  it("acceptance: a project becomes an initiative in the space of somebody on it", async () => {
    await run(true);

    const [initiative] = await rows<{
      title: string;
      status: string;
      space: string;
    }>(
      `select i.title, i.status, s.name as space
         from initiatives i join spaces s on s.id = i.space_id
        where i.legacy_id = 'projects:1'`,
    );
    expect(initiative?.title).toBe("Onboarding rebuild");
    expect(initiative?.status).toBe("active");
    // Project 1's admin has no team; a member of it belongs to Commercial.
    expect(initiative?.space).toBe("Commercial");
  });

  it("skips a project nobody on a team belongs to, rather than guessing a space", async () => {
    const { report } = await run(true);
    const reasons = domain(report, "initiatives")
      ?.skipped.map((row) => `${row.source}: ${row.reason}`)
      .join(" | ");
    expect(reasons).toContain("projects:2");
    expect(reasons).toContain("no space to put it in");
  });

  it("flags a project status the source has and this product does not", async () => {
    const { report } = await run(true);
    expect(
      domain(report, "initiatives")
        ?.flags.map((row) => row.reason)
        .join(" | "),
    ).toContain('"archived"');
  });

  it("keeps the start of a project whose deadline is before it, and says so", async () => {
    const preview = await run(false);
    const said = (report: typeof preview.report) =>
      domain(report, "initiatives")
        ?.flags.filter((row) => row.source === "projects:3")
        .map((row) => row.reason)
        .join(" | ");
    expect(said(preview.report)).toContain(
      "The source's deadline, 2026-02-15, is before its start, 2026-04-01.",
    );

    const { report } = await run(true);
    expect(said(report)).toContain("Imported with the start and no end date.");
    const [initiative] = await rows<{
      starts_on: string | null;
      ends_on: string | null;
    }>(
      `select to_char(starts_on, 'YYYY-MM-DD') as starts_on,
              to_char(ends_on, 'YYYY-MM-DD') as ends_on
         from initiatives where legacy_id = 'projects:3'`,
    );
    expect(initiative).toEqual({ starts_on: "2026-04-01", ends_on: null });
  });

  it("acceptance: the status comes from the board column, then from the task", async () => {
    await run(true);
    const tasks = await rows<{ legacy_id: string; status: string }>(
      `select legacy_id, status from tasks
        where legacy_type = 'flowyteam' order by legacy_id`,
    );
    expect(
      Object.fromEntries(
        tasks
          .filter((t) => Number(t.legacy_id.split(":")[1]) <= 3)
          .map((t) => [t.legacy_id, t.status]),
      ),
    ).toEqual({
      // Column `in_progress`, which this product recognises.
      "tasks:1": "in_progress",
      // Column `en_proceso`, which it does not: the task says completed.
      "tasks:2": "done",
      // No column at all: the task says completed.
      "tasks:3": "done",
    });
  });

  it("says which board column it did not recognise", async () => {
    const { report } = await run(true);
    expect(
      domain(report, "tasks")
        ?.flags.map((row) => row.reason)
        .join(" | "),
    ).toContain("en_proceso");
  });

  it("skips a task whose project did not import", async () => {
    const { report } = await run(true);
    const reasons = domain(report, "tasks")
      ?.skipped.map((row) => `${row.source}: ${row.reason}`)
      .join(" | ");
    expect(reasons).toContain("tasks:4");
    expect(reasons).toContain("did not import");
  });

  it("keeps the key result a task serves", async () => {
    await run(true);
    const [task] = await rows<{ measure: string | null }>(
      `select k.legacy_id as measure
         from tasks t left join key_results k on k.id = t.key_result_id
        where t.legacy_id = 'tasks:1'`,
    );
    expect(task?.measure).toBe("key_results:1");
  });

  it("acceptance: a task with no project goes to the space of its key result's team", async () => {
    await run(true);
    const [task] = await rows<{ space: string; measure: string | null }>(
      `select s.name as space, k.legacy_id as measure
         from tasks t
         join spaces s on s.id = t.space_id
         left join key_results k on k.id = t.key_result_id
        where t.legacy_id = 'tasks:5'`,
    );
    // Key result 3 hangs off objective 2, which belongs to the Commercial team.
    expect(task).toEqual({ space: "Commercial", measure: "key_results:3" });
  });

  it("acceptance: a task with no project, no team objective and an assignee in a team goes to that team", async () => {
    await run(true);
    const [task] = await rows<{ space: string }>(
      `select s.name as space from tasks t join spaces s on s.id = t.space_id
        where t.legacy_id = 'tasks:6'`,
    );
    expect(task?.space).toBe("Commercial");
  });

  it("acceptance: a task with none of that goes to one created space, and the report counts it", async () => {
    const { report } = await run(true);
    const [task] = await rows<{ space: string; legacy_id: string }>(
      `select s.name as space, s.legacy_id
         from tasks t join spaces s on s.id = t.space_id
        where t.legacy_id = 'tasks:7'`,
    );
    expect(task?.space.startsWith("Tasks from ")).toBe(true);
    expect(task?.legacy_id).toBe("teams:tasks-space");
    expect(report.notes.join(" ")).toContain(
      "Tasks with no project were placed 1 by the team of their key result's objective, 1 by their assignee's team, 1 into the new space Tasks from",
    );
    expect(report.notes.join(" ")).toMatch(
      /Move the ones in Tasks from .* to the right space\./,
    );
  });

  it("acceptance: a second run reuses the created space", async () => {
    await run(true);
    const { report } = await run(true);
    expect(domain(report, "tasks")?.created).toBe(0);
    expect(
      await count(
        `select count(*)::int as n from spaces where legacy_id = 'teams:tasks-space'`,
      ),
    ).toBe(1);
  });

  it("counts the no-project tasks on a dry run and creates no space", async () => {
    const preview = await run(false);
    // Tasks 1 to 3 and 5 to 7. Task 4 names a project that did not import.
    expect(domain(preview.report, "tasks")?.created).toBe(6);
    expect(preview.report.notes.join(" ")).toContain(
      "Tasks with no project were placed",
    );
    expect(
      await count(
        `select count(*)::int as n from spaces where legacy_id = 'teams:tasks-space'`,
      ),
    ).toBe(0);
  });

  it("turns sub-tasks into checklist lines, ticked where the source says done", async () => {
    const { report } = await run(true);
    console.log(JSON.stringify(domain(report, "checklists")));
    const items = await rows<{
      legacy_id: string;
      title: string;
      done: boolean;
    }>(
      `select c.legacy_id, c.title, c.done from checklist_items c
         join tasks t on t.id = c.task_id
        where t.legacy_id = 'tasks:1' order by c.legacy_id`,
    );
    expect(items).toEqual([
      { legacy_id: "sub_tasks:1", title: "Find the number", done: true },
      { legacy_id: "sub_tasks:2", title: "Write it down", done: false },
    ]);
  });

  it("records the task links this product does not model", async () => {
    const { report } = await run(true);
    expect(report.notes.join(" ")).toContain("no task dependency");
  });

  it("acceptance: a second run writes nothing new", async () => {
    await run(true);
    const { report } = await run(true);

    for (const name of ["initiatives", "tasks", "checklists"]) {
      expect(domain(report, name)?.created, `${name} on the second run`).toBe(
        0,
      );
    }
    expect(
      await count(
        `select count(*)::int as n from initiatives where legacy_type = 'flowyteam'`,
      ),
    ).toBe(2);
    expect(
      await count(
        `select count(*)::int as n from tasks where legacy_type = 'flowyteam'`,
      ),
    ).toBe(6);
    expect(
      await count(
        `select count(*)::int as n from checklist_items where legacy_type = 'flowyteam'`,
      ),
    ).toBe(2);
  });

  it("writes nothing on a dry run", async () => {
    const { report } = await run(false);
    expect(domain(report, "initiatives")?.created).toBe(2);
    expect(await count(`select count(*)::int as n from initiatives`)).toBe(0);
  });
});
