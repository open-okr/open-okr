/**
 * The run, against a real database (P6-T01a).
 *
 * Its acceptance criterion is the one thing only a real run can settle: that
 * the dry-run report and the real run agree, row for row. Everything else here
 * follows from that: the bad row is skipped in both, the good rows are written
 * once however many times the file is run, and nobody is notified about a
 * quarter that has already happened.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callAction, provisionWorkspaceForUser } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runImport } from "../src/index";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OWNER_EMAIL = "importer-owner@example.com";

let pool: Pool;
let workspaceId: string;
let directory: string;

/** A goals file with three rows, the third of which cannot be read. */
const GOALS_CSV = [
  "Objective ID,Objective,LEVEL,Start,End,Champion,Reviewer",
  `obj-1,Make onboarding obvious,company,2026-01-01,2026-03-31,${OWNER_EMAIL},${OWNER_EMAIL}`,
  `obj-2,Cut the time to first value,company,2026-01-01,2026-03-31,${OWNER_EMAIL},${OWNER_EMAIL}`,
  `obj-3,Something at an invented level,divisional,2026-01-01,2026-03-31,${OWNER_EMAIL},${OWNER_EMAIL}`,
].join("\n");

async function fileWith(name: string, body: string): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, body, "utf8");
  return path;
}

async function count(table: string): Promise<number> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ n: number }>(
    `select count(*)::int as n from ${table}`,
  );
  return result.rows[0]?.n ?? 0;
}

beforeEach(async () => {
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Importer Owner", OWNER_EMAIL],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Importer Owner",
  });
  workspaceId = provisioned.workspaceId;
  directory = await mkdtemp(join(tmpdir(), "openokr-import-"));
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a dry run, then the real run", () => {
  it("previews what it would write and writes exactly that", async () => {
    const file = await fileWith("goals.csv", GOALS_CSV);

    const preview = await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file,
      dryRun: true,
    });

    expect(preview.report.rowsRead).toBe(3);
    expect(preview.report.created).toBe(2);
    expect(preview.report.updated).toBe(0);
    expect(preview.report.skipped).toBe(1);
    // The error names the cell and what it may say, against the line the
    // person's own spreadsheet shows.
    const skipped = preview.report.rows.find(
      (row) => row.outcome === "skipped",
    );
    expect(skipped?.line).toBe(4);
    expect(skipped?.reason).toContain("divisional");
    expect(skipped?.reason).toContain("company");
    // Nothing was written, which is the whole point of the mode.
    expect(await count("goals")).toBe(0);

    const real = await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file,
      dryRun: false,
    });

    expect(real.report.created).toBe(preview.report.created);
    expect(real.report.updated).toBe(preview.report.updated);
    expect(real.report.skipped).toBe(preview.report.skipped);
    expect(real.report.rows).toEqual(
      preview.report.rows.map((row) => ({ ...row })),
    );
    expect(await count("goals")).toBe(2);
  });

  it("writes nothing the second time and updates instead", async () => {
    const file = await fileWith("goals.csv", GOALS_CSV);
    await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file,
      dryRun: false,
    });

    const again = await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file,
      dryRun: false,
    });

    expect(again.report.created).toBe(0);
    expect(again.report.updated).toBe(2);
    expect(await count("goals")).toBe(2);
  });

  it("records a run whichever mode it was, and closes it", async () => {
    const file = await fileWith("goals.csv", GOALS_CSV);
    await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file,
      dryRun: true,
    });
    await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file,
      dryRun: false,
    });

    const runs = await callAction(
      {
        pool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
      },
      "imports.listRuns",
      { limit: 20 },
    );

    expect(runs.runs).toHaveLength(2);
    expect(runs.runs.map((run) => run.mode)).toEqual(["real", "dry_run"]);
    for (const run of runs.runs) {
      expect(run.status).toBe("completed");
      expect(run.entity).toBe("goals");
      expect(run.finishedAt).not.toBeNull();
      expect(run.rowsRead).toBe(3);
      expect(run.rowsWritten).toBe(2);
      expect(run.rowsSkipped).toBe(1);
    }
  });

  it("notifies nobody, because the work has already happened", async () => {
    // §7.1 step 3's bulk flag. The activity rows are still written, which is
    // what the feed reads, and the fan-out is what an import must not do.
    const file = await fileWith("goals.csv", GOALS_CSV);
    await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file,
      dryRun: false,
    });

    expect(await count("notifications")).toBe(0);
    expect(await count("activities")).toBeGreaterThan(0);
  });

  it("carries the legacy identity onto the rows it wrote", async () => {
    const file = await fileWith("goals.csv", GOALS_CSV);
    await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file,
      dryRun: false,
    });

    const wb = await workerDb();
    const rows = await wb.admin.query<{
      legacy_type: string;
      legacy_id: string;
    }>("select legacy_type, legacy_id from goals order by legacy_id");
    expect(rows.rows).toEqual([
      { legacy_type: "csv", legacy_id: "obj-1" },
      { legacy_type: "csv", legacy_id: "obj-2" },
    ]);
  });
});

describe("what a row error is, and what it is not", () => {
  it("skips a row whose reference does not exist and imports the rest", async () => {
    const file = await fileWith(
      "goals.csv",
      [
        "Objective ID,Objective,LEVEL,Start,End,Champion,Reviewer",
        `obj-1,A real one,company,2026-01-01,2026-03-31,${OWNER_EMAIL},${OWNER_EMAIL}`,
        "obj-2,One nobody owns,company,2026-01-01,2026-03-31,ghost@example.com,ghost@example.com",
      ].join("\n"),
    );

    const result = await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file,
      dryRun: false,
    });

    expect(result.report.created).toBe(1);
    expect(result.report.skipped).toBe(1);
    expect(result.report.rows[1]?.reason).toContain("ghost@example.com");
    expect(await count("goals")).toBe(1);
  });

  it("skips a row with an empty required cell, naming the field", async () => {
    const file = await fileWith(
      "goals.csv",
      [
        "Objective ID,Objective,LEVEL,Start,End,Champion,Reviewer",
        `obj-1,,company,2026-01-01,2026-03-31,${OWNER_EMAIL},${OWNER_EMAIL}`,
      ].join("\n"),
    );

    const result = await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file,
      dryRun: true,
    });

    expect(result.report.skipped).toBe(1);
    expect(result.report.rows[0]?.reason).toBe("title is empty.");
  });

  it("skips the second of two rows claiming one identity, naming the first", async () => {
    const file = await fileWith(
      "goals.csv",
      [
        "Objective ID,Objective,LEVEL,Start,End,Champion,Reviewer",
        `obj-1,First,company,2026-01-01,2026-03-31,${OWNER_EMAIL},${OWNER_EMAIL}`,
        `obj-1,Second,company,2026-01-01,2026-03-31,${OWNER_EMAIL},${OWNER_EMAIL}`,
      ].join("\n"),
    );

    const result = await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file,
      dryRun: true,
    });

    expect(result.report.created).toBe(1);
    expect(result.report.skipped).toBe(1);
    expect(result.report.rows[1]?.reason).toContain("line 2");
  });

  it("refuses the file, and no rows, when a required column is missing", async () => {
    const file = await fileWith(
      "goals.csv",
      "Objective ID,Objective,LEVEL\nobj-1,A goal,company",
    );

    // A property of the file rather than of a row, so it is one refusal and
    // not one per line. No run is recorded, because nothing was read.
    await expect(
      runImport({
        pool,
        workspaceId,
        userId: OWNER,
        entity: "goals",
        file,
        dryRun: true,
      }),
    ).rejects.toThrow(/needs champion, reviewer/);
    expect(await count("import_runs")).toBe(0);
  });

  it("refuses a file in a format it does not read", async () => {
    const file = await fileWith("goals.txt", "id,title\n1,One");
    await expect(
      runImport({
        pool,
        workspaceId,
        userId: OWNER,
        entity: "goals",
        file,
        dryRun: true,
      }),
    ).rejects.toThrow(/\.csv and \.xlsx/);
  });
});

describe("a second entity, against the rows the first one wrote", () => {
  it("finds its objective by the identifier the goals file used", async () => {
    await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file: await fileWith("goals.csv", GOALS_CSV),
      dryRun: false,
    });

    const result = await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "key-results",
      file: await fileWith(
        "krs.csv",
        [
          "Key result ID,Objective,Key result,Direction,Baseline,Target,Unit",
          "kr-1,obj-1,Weekly active teams,increase,10,40,teams",
          "kr-2,obj-9,Points to a goal that is not here,increase,0,1,",
        ].join("\n"),
      ),
      dryRun: false,
    });

    expect(result.report.created).toBe(1);
    expect(result.report.skipped).toBe(1);
    expect(result.report.rows[1]?.reason).toContain("obj-9");
    expect(await count("key_results")).toBe(1);
  });
});
