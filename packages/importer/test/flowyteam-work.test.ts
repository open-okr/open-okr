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
import { provisionWorkspaceForUser } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runFlowyteamImport } from "../src/flowyteam/run.ts";
import { openSource, type Source } from "../src/flowyteam/source.ts";
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

  it("acceptance: the status comes from the board column, then from the task", async () => {
    await run(true);
    const tasks = await rows<{ legacy_id: string; status: string }>(
      `select legacy_id, status from tasks
        where legacy_type = 'flowyteam' order by legacy_id`,
    );
    expect(
      Object.fromEntries(tasks.map((t) => [t.legacy_id, t.status])),
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
    ).toBe(3);
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
