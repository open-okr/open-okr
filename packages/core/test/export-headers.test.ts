import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { runExportJob } from "../src/exports/worker.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const USER = "export-headers-owner";
const MALAY_GOAL_HEADERS =
  '"Objektif","Tahap","Kesihatan","Kemajuan %","Pemilik","Penyemak","Hasil utama"';

let workspaceId: string;
let memberId: string;
let cycleId: string;
let spaceId: string;

async function context() {
  return {
    pool: (await workerDb()).appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: USER },
  };
}

async function createGoal(title: string) {
  return callAction(await context(), "goals.create", {
    title,
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: memberId,
    reviewerId: memberId,
    weight: 1,
  });
}

beforeEach(async () => {
  const db = await workerDb();
  await db.truncateAllTables();
  await db.admin.query(
    "insert into users (id, name, email) values ($1, 'Ada', $2)",
    [USER, "export-headers@example.com"],
  );
  ({ workspaceId, memberId } = await provisionWorkspaceForUser(db.appPool, {
    id: USER,
    name: "Ada",
  }));
  const cycle = await callAction(await context(), "cycles.current", {
    mode: "quarterly",
  });
  const [space] = await callAction(await context(), "spaces.list", {});
  if (!cycle || !space)
    throw new Error("Missing export fixture cycle or space");
  cycleId = cycle.id;
  spaceId = space.id;
});

afterAll(async () => (await workerDb()).close());

describe("list export headers (languages AC-27)", () => {
  test("localises inline headers and keeps stored health keys and decimal points", async () => {
    const goal = await createGoal("Raise weekly activation to sixty per cent");
    const db = await workerDb();
    await db.admin.query("update goals set progress_pct = 12.5 where id = $1", [
      goal.id,
    ]);
    await callAction(await context(), "people.updateOwnProfile", {
      language: "ms",
    });

    const file = await callAction(await context(), "exports.list", {
      list: "goals",
      cycleId,
      format: "csv",
    });
    expect(file.queued).toBe(false);
    expect(file.csv?.split("\r\n")[0]).toBe(`\uFEFF${MALAY_GOAL_HEADERS}`);
    expect(file.csv).toContain('"pending","12.5"');
  });

  test("localises the due-date header and keeps the date in ISO form", async () => {
    await callAction(await context(), "people.updateOwnProfile", {
      language: "ms",
    });
    await callAction(await context(), "tasks.create", {
      spaceId,
      title: "Review the launch checklist",
      dueOn: "2026-06-17",
    });

    const file = await callAction(await context(), "exports.list", {
      list: "tasks",
      format: "csv",
    });
    expect(file.csv?.split("\r\n")[0]).toContain('"Tarikh akhir"');
    expect(file.csv).toContain('"2026-06-17"');
  });

  test("a queued file uses the requester's language at build time", async () => {
    const db = await workerDb();
    await db.admin.query(
      "update workspaces set settings = settings || $2::jsonb where id = $1",
      [workspaceId, JSON.stringify({ exportInlineRowLimit: 1 })],
    );
    await createGoal("Raise weekly activation to sixty per cent");
    await createGoal("Cut time to first value to two days");
    const asked = await callAction(await context(), "exports.list", {
      list: "goals",
      cycleId,
      format: "csv",
    });
    expect(asked.queued).toBe(true);
    if (!asked.runId) throw new Error("Missing export run");
    await callAction(await context(), "people.updateOwnProfile", {
      language: "ms",
    });

    let csv = "";
    const result = await runExportJob(
      { workspaceId, runId: asked.runId },
      {
        pool: db.appPool,
        async putFile({ key, body }) {
          csv = body.toString("utf8");
          return { key, size: body.byteLength };
        },
      },
    );
    expect(result).toEqual({ kind: "built", rowCount: 2 });
    expect(csv.split("\r\n")[0]).toBe(`\uFEFF${MALAY_GOAL_HEADERS}`);
    expect(csv).toContain('"pending"');
  });
});
