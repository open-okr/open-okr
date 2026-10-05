import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runImport } from "../src/imports/run.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Kinds through the spreadsheet importer (P9-T12c-b, METHOD.md §2.8, §2.10).
 *
 * NW-P-11's acceptance: a spreadsheet with no kind columns writes every
 * objective as the workspace's default and every key result as a metric, and
 * the report says so. A file that does name kinds is read: a milestone or a
 * baseline row needs no numbers.
 */

const OWNER = "44444444-4444-4444-8444-444444444444";
const OWNER_EMAIL = "kinds-importer@example.com";

let pool: Pool;
let workspaceId: string;
let directory: string;

async function run(entity: string, name: string, csv: string, dryRun = false) {
  const path = join(directory, name);
  await writeFile(path, csv, "utf8");
  return runImport({
    pool,
    workspaceId,
    userId: OWNER,
    entity,
    file: path,
    dryRun,
  });
}

async function kinds(table: "goals" | "key_results") {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ title: string; kind: string }>(
    `select title, kind from ${table} where workspace_id = $1 and deleted_at is null order by title`,
    [workspaceId],
  );
  return Object.fromEntries(rows.map((row) => [row.title, row.kind]));
}

const GOALS = [
  "externalId,title,level,startsOn,endsOn,champion,reviewer",
  `obj-1,Make onboarding the reason teams stay,company,2026-01-01,2026-03-31,${OWNER_EMAIL},${OWNER_EMAIL}`,
].join("\n");

beforeEach(async () => {
  const wb = await workerDb();
  pool = wb.appPool;
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Amara Importer", OWNER_EMAIL],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Amara Importer",
    })
  ).workspaceId;
  directory = await mkdtemp(join(tmpdir(), "openokr-kinds-"));
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("NW-P-11: a spreadsheet with no kind columns", () => {
  it("writes the default kinds, and the report says so, the same in the dry run as in the real one", async () => {
    const dry = await run("goals", "goals.csv", GOALS, true);
    expect(dry.report.assumed).toEqual([
      "This file has no kind column, so every new objective arrives as the workspace's default kind: aspirational, unless it uses committed OKRs only.",
    ]);
    const goals = await run("goals", "goals.csv", GOALS);
    expect(goals.report.assumed).toEqual(dry.report.assumed);
    expect(await kinds("goals")).toEqual({
      "Make onboarding the reason teams stay": "aspirational",
    });

    const keyResults = await run(
      "key-results",
      "key-results.csv",
      [
        "externalId,goal,title,direction,baselineValue,targetValue",
        "kr-1,obj-1,Activation from 41% to 60%,increase,41,60",
        "kr-2,obj-1,Hold uptime between 99.5% and 99.9%,maintain,99.5,99.9",
      ].join("\n"),
    );
    expect(keyResults.report.assumed).toEqual([
      "This file has no kind column, so every key result arrives as a metric, or as a maintain where its direction says maintain.",
    ]);
    expect(await kinds("key_results")).toEqual({
      "Activation from 41% to 60%": "metric",
      "Hold uptime between 99.5% and 99.9%": "maintain",
    });

    // A second run changes nothing, and says the same.
    const again = await run(
      "key-results",
      "key-results.csv",
      [
        "externalId,goal,title,direction,baselineValue,targetValue",
        "kr-1,obj-1,Activation from 41% to 60%,increase,41,60",
        "kr-2,obj-1,Hold uptime between 99.5% and 99.9%,maintain,99.5,99.9",
      ].join("\n"),
    );
    expect(again.report.created).toBe(0);
  });
});

describe("a spreadsheet that names its kinds", () => {
  it("writes them, and a milestone or a baseline row needs no numbers", async () => {
    const goals = await run(
      "goals",
      "goals.csv",
      [
        "externalId,title,level,kind,startsOn,endsOn,champion,reviewer",
        `obj-1,Pass the SOC 2 Type II audit,company,committed,2026-01-01,2026-03-31,${OWNER_EMAIL},${OWNER_EMAIL}`,
      ].join("\n"),
    );
    expect(goals.report.assumed).toEqual([]);
    expect(await kinds("goals")).toEqual({
      "Pass the SOC 2 Type II audit": "committed",
    });

    const keyResults = await run(
      "key-results",
      "key-results.csv",
      [
        "externalId,goal,title,kind,direction,baselineValue,targetValue",
        "kr-1,obj-1,The SOC 2 Type II report is issued,milestone,,,",
        "kr-2,obj-1,Establish an onboarding NPS baseline,baseline,,,",
        "kr-3,obj-1,Close every audit finding,metric,increase,0,12",
      ].join("\n"),
    );
    expect(keyResults.report.skipped).toBe(0);
    expect(keyResults.report.assumed).toEqual([]);
    expect(await kinds("key_results")).toEqual({
      "Close every audit finding": "metric",
      "Establish an onboarding NPS baseline": "baseline",
      "The SOC 2 Type II report is issued": "milestone",
    });
  });

  it("skips a metric row that leaves out its numbers, and says why", async () => {
    await run("goals", "goals.csv", GOALS);
    const keyResults = await run(
      "key-results",
      "key-results.csv",
      [
        "externalId,goal,title,kind,direction,baselineValue,targetValue",
        "kr-1,obj-1,Activation grows,metric,,,",
      ].join("\n"),
    );
    expect(keyResults.report.skipped).toBe(1);
    expect(keyResults.report.rows[0]?.reason).toBeTruthy();
  });
});
