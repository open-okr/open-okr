/**
 * The two table actions the wizard calls (P6-T01b-b).
 *
 * The acceptance criterion this file settles is the one the screen exists to
 * keep: what the wizard shows is what the command prints. Both go through
 * `runTable`, so the test is an equality between two reports produced by the
 * same lines from the same bytes, and it would fail the moment the wizard grew
 * a path of its own.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { parseCsv } from "../src/imports/readers/csv.ts";
import { runImport } from "../src/imports/run.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "22222222-2222-4222-8222-222222222222";
const OWNER_EMAIL = "wizard-owner@example.com";
const STRANGER = "33333333-3333-4333-8333-333333333333";

let pool: Pool;
let workspaceId: string;
let directory: string;

/** Headers no alias matches, which is what the mapping step is for. */
const UNFAMILIAR_CSV = [
  "Ref,Statement,Band,Opens,Closes,Runner,Checker",
  `okr-1,Make onboarding obvious,company,2026-01-01,2026-03-31,${OWNER_EMAIL},${OWNER_EMAIL}`,
  `okr-2,Cut the time to first value,company,2026-01-01,2026-03-31,${OWNER_EMAIL},${OWNER_EMAIL}`,
  `okr-3,Something at an invented level,divisional,2026-01-01,2026-03-31,${OWNER_EMAIL},${OWNER_EMAIL}`,
].join("\n");

/** The reader's own answer, which the wizard posts back as it was confirmed. */
const MAPPING: Record<string, string | null> = {
  Ref: "externalId",
  Statement: "title",
  Band: "level",
  Opens: "startsOn",
  Closes: "endsOn",
  Runner: "champion",
  Checker: "reviewer",
};

/**
 * A CSV as the action declares a table, with mutable arrays.
 *
 * `parseCsv` answers with readonly ones, and the schema describes what crosses
 * a request boundary, where readonly means nothing. Copied rather than cast, so
 * the test cannot hand an action something the contract does not allow.
 */
function tableOf(csv: string): { headers: string[]; rows: string[][] } {
  const table = parseCsv(csv);
  return {
    headers: [...table.headers],
    rows: table.rows.map((row) => [...row]),
  };
}

function ownerContext() {
  return {
    pool,
    workspaceId,
    actor: { kind: "human" as const, userId: OWNER },
  };
}

async function count(table: string): Promise<number> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ n: number }>(
    `select count(*)::int as n from ${table}`,
  );
  return result.rows[0]?.n ?? 0;
}

async function setRowLimit(limit: number): Promise<void> {
  const wb = await workerDb();
  await wb.admin.query(
    "update workspaces set settings = settings || $2::jsonb where id = $1",
    [workspaceId, JSON.stringify({ importRowLimit: limit })],
  );
}

beforeEach(async () => {
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Wizard Owner",
      OWNER_EMAIL,
      STRANGER,
      "Stranger",
      "stranger@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Wizard Owner",
  });
  workspaceId = provisioned.workspaceId;
  directory = await mkdtemp(join(tmpdir(), "openokr-wizard-"));
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the wizard and the command agree", () => {
  it("previews exactly what the command's dry run reports", async () => {
    const path = join(directory, "goals.csv");
    await writeFile(path, UNFAMILIAR_CSV, "utf8");
    const mappingPath = join(directory, "map.json");
    await writeFile(mappingPath, JSON.stringify({ columns: MAPPING }), "utf8");

    const fromCommand = await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file: path,
      mapping: { columns: MAPPING },
      dryRun: true,
    });

    const fromWizard = await callAction(
      ownerContext(),
      "imports.previewTable",
      {
        entity: "goals",
        table: tableOf(UNFAMILIAR_CSV),
        name: "goals.csv",
        mapping: MAPPING,
      },
    );

    // The file label is the one thing that differs, because one of them is a
    // path on a disk and the other is what the browser called the upload.
    expect({ ...fromWizard.report, file: path }).toEqual({
      ...fromCommand.report,
    });
    // Two rows creatable, the invented level skipped with the reason.
    expect(fromWizard.report.created).toBe(2);
    expect(fromWizard.report.skipped).toBe(1);
    expect(fromWizard.report.rows[2]?.reason).toContain("divisional");
    // A preview writes nothing but its own record.
    expect(await count("goals")).toBe(0);
  });

  it("writes exactly what it previewed", async () => {
    const preview = await callAction(ownerContext(), "imports.previewTable", {
      entity: "goals",
      table: tableOf(UNFAMILIAR_CSV),
      name: "goals.csv",
      mapping: MAPPING,
    });
    const real = await callAction(ownerContext(), "imports.runTable", {
      entity: "goals",
      table: tableOf(UNFAMILIAR_CSV),
      name: "goals.csv",
      mapping: MAPPING,
    });

    expect(real.report.rows).toEqual(preview.report.rows);
    expect(real.report.mode).toBe("real");
    expect(preview.report.mode).toBe("dry_run");
    expect(await count("goals")).toBe(2);
    // One run row each, and the preview's is not pretending it wrote anything.
    const runs = await callAction(ownerContext(), "imports.listRuns", {
      limit: 20,
    });
    expect(runs.runs.map((run) => run.mode).sort()).toEqual([
      "dry_run",
      "real",
    ]);
    expect(runs.runs.every((run) => run.status === "completed")).toBe(true);
  });

  it("refuses the unfamiliar file by name when no mapping is supplied", async () => {
    // The manual path's own refusal, and the reason the mapping step exists.
    // It names the fields nothing carries rather than importing three empty
    // objectives.
    await expect(
      callAction(ownerContext(), "imports.previewTable", {
        entity: "goals",
        table: tableOf(UNFAMILIAR_CSV),
        name: "goals.csv",
      }),
    ).rejects.toThrow(/needs externalId, title, level, champion, reviewer/);
  });

  it("leaves the aliases to decide when no mapping is supplied", async () => {
    const familiar = tableOf(
      [
        "Objective ID,Objective,Level,Start,End,Champion,Reviewer",
        `obj-1,Make onboarding obvious,company,2026-01-01,2026-03-31,${OWNER_EMAIL},${OWNER_EMAIL}`,
      ].join("\n"),
    );
    const preview = await callAction(ownerContext(), "imports.previewTable", {
      entity: "goals",
      table: familiar,
      name: "goals.csv",
    });
    expect(preview.report.created).toBe(1);
    expect(preview.report.unmappedHeaders).toEqual([]);
  });
});

describe("the row bound", () => {
  it("refuses a file above it with the number, rather than truncating", async () => {
    await setRowLimit(2);
    const table = tableOf(UNFAMILIAR_CSV);

    await expect(
      callAction(ownerContext(), "imports.runTable", {
        entity: "goals",
        table,
        name: "goals.csv",
        mapping: MAPPING,
      }),
    ).rejects.toThrow(/3 rows and this workspace imports at most 2/);

    expect(await count("goals")).toBe(0);
    // Refused before the run started, so there is no run row claiming it ran.
    expect(await count("import_runs")).toBe(0);
  });

  it("allows a file exactly at the bound", async () => {
    await setRowLimit(3);
    const preview = await callAction(ownerContext(), "imports.previewTable", {
      entity: "goals",
      table: tableOf(UNFAMILIAR_CSV),
      name: "goals.csv",
      mapping: MAPPING,
    });
    expect(preview.report.rowsRead).toBe(3);
  });
});

describe("who may import", () => {
  it("refuses somebody who is not a member of the workspace", async () => {
    await expect(
      callAction(
        {
          pool,
          workspaceId,
          actor: { kind: "human" as const, userId: STRANGER },
        },
        "imports.previewTable",
        {
          entity: "goals",
          table: tableOf(UNFAMILIAR_CSV),
          name: "goals.csv",
          mapping: MAPPING,
        },
      ),
    ).rejects.toThrow(/No such workspace/);
    expect(await count("import_runs")).toBe(0);
  });
});
