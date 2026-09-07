/**
 * The whole pipeline (TECHNICAL-PLAN §7.1, P6-T04d).
 *
 * Three claims worth a real database. That `--only` runs what somebody asked
 * for **and what it depends on**, and says which it added, because a domain
 * imported on its own with its prerequisites missing is an import that reports
 * success and writes almost nothing. That two importers can load the same
 * workspace and leave both sets of rows intact and telling apart by
 * `legacy_type`, which is the claim the whole legacy-key design rests on. And
 * that a full run twice over changes nothing the second time.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionWorkspaceForUser, runImport } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  DOMAIN_KEYS,
  selectDomains,
  UnknownDomainError,
} from "../src/flowyteam/domains.ts";
import { runFlowyteamImport } from "../src/flowyteam/run.ts";
import { openSource, type Source } from "../src/flowyteam/source.ts";
import {
  available,
  SEEDED,
  type SeededSource,
  SKIP_REASON,
  seedSource,
} from "./support/flowyteam-source.ts";

const OWNER = "44444444-4444-4444-8444-444444444444";
const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam pipeline tests. ${SKIP_REASON}`);
}

let pool: Pool;
let workspaceId: string;
let seeded: SeededSource;
let source: Source;
let scratch: string;

async function rows<T extends Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  const wb = await workerDb();
  const result = await wb.admin.query<T>(sql);
  return result.rows;
}

async function count(sql: string): Promise<number> {
  const [row] = await rows<{ n: number }>(sql);
  return Number(row?.n ?? 0);
}

async function run(
  write: boolean,
  only?: readonly string[],
): Promise<Awaited<ReturnType<typeof runFlowyteamImport>>> {
  return runFlowyteamImport({
    pool,
    workspaceId,
    userId: OWNER,
    url: seeded.url,
    companyId: SEEDED.first.id,
    source,
    write,
    ...(only ? { only } : {}),
  });
}

// ── The selection, which needs no database ──────────────────────────────

describe("selecting domains", () => {
  it("runs every domain when nothing is named", () => {
    expect(selectDomains(undefined).domains.map((one) => one.key)).toEqual(
      DOMAIN_KEYS,
    );
    expect(selectDomains([]).added).toEqual([]);
  });

  it("brings a named domain's prerequisites, and names what it added", () => {
    const selection = selectDomains(["objectives"]);
    expect(selection.domains.map((one) => one.key)).toEqual([
      "organisation",
      "objectives",
    ]);
    expect(selection.added).toEqual(["organisation"]);
  });

  it("follows a chain of prerequisites the whole way down", () => {
    const selection = selectDomains(["files"]);
    // Files need the comments they rewrite, which need the tasks they hang
    // on, which need the key results they point at, which need the people.
    expect(selection.domains.map((one) => one.key)).toEqual([
      "organisation",
      "objectives",
      "work",
      "collaboration",
      "files",
    ]);
    // Check-ins and KPIs are not on that chain and are not run.
    expect(selection.domains.map((one) => one.key)).not.toContain("checkins");
    expect([...selection.added].sort()).toEqual([
      "collaboration",
      "objectives",
      "organisation",
      "work",
    ]);
  });

  it("keeps the dependency order however the flags were typed", () => {
    expect(
      selectDomains(["files", "organisation", "work"]).domains.map(
        (one) => one.key,
      ),
    ).toEqual(["organisation", "objectives", "work", "collaboration", "files"]);
  });

  it("adds nothing when a domain's prerequisites were named too", () => {
    expect(selectDomains(["organisation", "objectives"]).added).toEqual([]);
  });

  it("refuses a domain it does not have rather than importing less", () => {
    expect(() => selectDomains(["objetives"])).toThrow(UnknownDomainError);
    expect(() => selectDomains(["objetives"])).toThrow(
      /is not a domain this imports/,
    );
  });

  /**
   * The table's order is what makes one backwards pass enough. A domain that
   * required something after it would break the selection silently, so this
   * asserts the invariant rather than trusting the file to stay sorted.
   */
  it("is declared in dependency order", () => {
    const seen = new Set<string>();
    for (const domain of selectDomains(undefined).domains) {
      for (const required of domain.requires) {
        expect(seen).toContain(required);
      }
      seen.add(domain.key);
    }
  });
});

// ── The run, which needs both databases ─────────────────────────────────

describe.skipIf(!runnable)("the whole pipeline", () => {
  beforeEach(async () => {
    const wb = await workerDb();
    pool = wb.appPool;
    await wb.truncateAllTables();
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3)",
      [OWNER, "Import Owner", "pipeline-owner@example.com"],
    );
    const provisioned = await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Import Owner",
    });
    workspaceId = provisioned.workspaceId;

    await seeded?.drop();
    await source?.close();
    seeded = await seedSource("pipeline");
    source = await openSource({ url: seeded.url });
    scratch = await mkdtemp(join(tmpdir(), "openokr-pipeline-"));
  });

  afterAll(async () => {
    await source?.close();
    await seeded?.drop();
    if (scratch) {
      await rm(scratch, { recursive: true, force: true });
    }
    const wb = await workerDb();
    await wb.close();
  });

  it("--only objectives runs the organisation first and says so", async () => {
    const { report } = await run(true, ["objectives"]);

    expect(report.selected).toEqual(["organisation", "objectives"]);
    expect(report.addedForDependencies).toEqual(["organisation"]);
    // The people and spaces the objectives need are here.
    expect(
      await count(
        "select count(*)::int as n from workspace_members where legacy_type = 'flowyteam'",
      ),
    ).toBeGreaterThan(0);
    expect(
      await count(
        "select count(*)::int as n from goals where legacy_type = 'flowyteam'",
      ),
    ).toBeGreaterThan(0);
    // And nothing from a domain nobody asked for.
    expect(
      await count(
        "select count(*)::int as n from tasks where legacy_type = 'flowyteam'",
      ),
    ).toBe(0);
    expect(
      await count(
        "select count(*)::int as n from comments where legacy_type = 'flowyteam'",
      ),
    ).toBe(0);
  });

  it("says in the report why a domain nobody asked for ran", async () => {
    const { report } = await run(false, ["objectives"]);
    expect(report.notes.join(" ")).toContain(
      "--only did not name organisation",
    );
    expect(report.notes.join(" ")).toContain("depends on it");
  });

  it("--only collaboration reaches back through work to the people", async () => {
    const { report } = await run(true, ["collaboration"]);
    expect(report.selected).toEqual([
      "organisation",
      "objectives",
      "work",
      "collaboration",
    ]);
    expect(
      await count(
        "select count(*)::int as n from comments where legacy_type = 'flowyteam'",
      ),
    ).toBeGreaterThan(0);
    // Check-ins were never on the chain.
    expect(
      await count(
        "select count(*)::int as n from check_ins where legacy_type = 'flowyteam'",
      ),
    ).toBe(0);
  });

  /**
   * The claim the whole legacy-key design rests on: two importers, one
   * workspace, and afterwards you can still say which rows came from where.
   */
  it("a spreadsheet and a company coexist and stay distinguishable", async () => {
    await run(true);

    const flowyGoals = await count(
      "select count(*)::int as n from goals where legacy_type = 'flowyteam'",
    );
    expect(flowyGoals).toBeGreaterThan(0);

    // A spreadsheet naming the same champion the company import created, so
    // the two really do land in one workspace rather than beside each other.
    const [champion] = await rows<{ email: string }>(
      `select coalesce(placeholder_email, '') as email
         from workspace_members
        where legacy_type = 'flowyteam' and placeholder_email is not null
        limit 1`,
    );
    const email = champion?.email ?? "";
    expect(email).not.toBe("");

    const file = join(scratch, "goals.csv");
    await writeFile(
      file,
      [
        "externalId,title,level,champion,reviewer,startsOn,endsOn",
        `SHEET-1,A goal from a spreadsheet,company,${email},${email},2026-01-01,2026-03-31`,
        `SHEET-2,Another from the same sheet,company,${email},${email},2026-01-01,2026-03-31`,
      ].join("\n"),
      "utf8",
    );

    const { report } = await runImport({
      pool,
      workspaceId,
      userId: OWNER,
      entity: "goals",
      file,
      dryRun: false,
    });
    // Named, so a failure here says which row and why rather than "2".
    expect(
      report.rows
        .filter((row) => row.outcome === "skipped")
        .map((row) => `line ${row.line}: ${row.reason}`),
    ).toEqual([]);

    // Both sets are here, and each says where it came from.
    expect(
      await count(
        "select count(*)::int as n from goals where legacy_type = 'csv'",
      ),
    ).toBe(2);
    expect(
      await count(
        "select count(*)::int as n from goals where legacy_type = 'flowyteam'",
      ),
    ).toBe(flowyGoals);
    // No row belongs to both, and none lost its origin.
    expect(
      await count(
        "select count(*)::int as n from goals where legacy_id is not null and legacy_type is null",
      ),
    ).toBe(0);

    // A second company run leaves the spreadsheet's rows alone.
    await run(true);
    expect(
      await count(
        "select count(*)::int as n from goals where legacy_type = 'csv'",
      ),
    ).toBe(2);
  });

  it("acceptance: a full run twice over changes nothing the second time", async () => {
    const first = await run(true);
    expect(first.report.selected).toEqual(DOMAIN_KEYS);

    const before = await rows<{ table_name: string; n: number }>(
      `select 'goals' as table_name, count(*)::int as n from goals
        union all select 'key_results', count(*)::int from key_results
        union all select 'check_ins', count(*)::int from check_ins
        union all select 'kpis', count(*)::int from kpis
        union all select 'initiatives', count(*)::int from initiatives
        union all select 'tasks', count(*)::int from tasks
        union all select 'checklist_items', count(*)::int from checklist_items
        union all select 'comments', count(*)::int from comments
        union all select 'workspace_members', count(*)::int from workspace_members
        union all select 'spaces', count(*)::int from spaces
        order by table_name`,
    );

    const second = await run(true);
    const after = await rows<{ table_name: string; n: number }>(
      `select 'goals' as table_name, count(*)::int as n from goals
        union all select 'key_results', count(*)::int from key_results
        union all select 'check_ins', count(*)::int from check_ins
        union all select 'kpis', count(*)::int from kpis
        union all select 'initiatives', count(*)::int from initiatives
        union all select 'tasks', count(*)::int from tasks
        union all select 'checklist_items', count(*)::int from checklist_items
        union all select 'comments', count(*)::int from comments
        union all select 'workspace_members', count(*)::int from workspace_members
        union all select 'spaces', count(*)::int from spaces
        order by table_name`,
    );
    expect(after).toEqual(before);
    // Nothing created, and every row read still accounted for.
    expect(second.report.written).toBe(0);
    expect(second.report.skipped).toBe(first.report.skipped);
  });

  it("the summary names every skip and every flag", async () => {
    const { report } = await run(true);

    const skips = report.reconciliation.flatMap((one) => one.skipped);
    const flags = report.reconciliation.flatMap((one) => one.flags);
    expect(report.skipped).toBe(skips.length);
    expect(report.flagged).toBe(flags.length);
    // Every one carries a source and a reason somebody can act on, rather
    // than a count on its own.
    for (const row of [...skips, ...flags]) {
      expect(row.source).not.toBe("");
      expect(row.reason.length).toBeGreaterThan(20);
    }
  });
});
