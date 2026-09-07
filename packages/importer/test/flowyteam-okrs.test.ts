/**
 * Objectives and key results, from a real FlowyTeam into a real workspace
 * (TECHNICAL-PLAN §7.2, P6-T03b).
 *
 * Three claims that only a real run can settle. That the level comes from the
 * polymorphic owner and not from the enum the source itself writes wrong. That
 * a child aligned to a parent with a higher id still aligns, which is the
 * second pass earning its place. And that a second run changes nothing, which
 * is what makes a migration something a person can rehearse.
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

const OWNER = "55555555-5555-4555-8555-555555555555";
const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam OKR tests. ${SKIP_REASON}`);
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
    [OWNER, "Import Owner", "okr-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Import Owner",
  });
  workspaceId = provisioned.workspaceId;

  await seeded?.drop();
  await source?.close();
  seeded = await seedSource("okrs");
  source = await openSource({ url: seeded.url });
});

afterAll(async () => {
  await source?.close();
  await seeded?.drop();
  const wb = await workerDb();
  await wb.close();
});

describe.skipIf(!runnable)("importing one company's OKRs", () => {
  it("acceptance: the level comes from the owner, not from objective_type", async () => {
    await run(true);

    const levels = await rows<{ legacy_id: string; level: string }>(
      `select legacy_id, level from goals
        where legacy_type = 'flowyteam' order by legacy_id`,
    );
    expect(
      Object.fromEntries(levels.map((r) => [r.legacy_id, r.level])),
    ).toEqual({
      "objectives:1": "company",
      "objectives:2": "team",
      "objectives:3": "individual",
      "objectives:5": "company",
      "objectives:7": "company",
      "objectives:8": "company",
      "objectives:9": "company",
    });
  });

  it("refuses an owner class FlowyTeam itself does not define", async () => {
    const { report } = await run(true);
    const reasons = domain(report, "objectives")
      ?.skipped.map((row) => row.reason)
      .join(" | ");
    expect(reasons).toContain("App\\Models\\User");
    expect(reasons).toContain("no level to give this objective");
  });

  it("acceptance: a child aligns to a parent created after it", async () => {
    // Objective 5 points at objective 7, which the first pass writes later.
    // A single pass would drop this alignment and nothing would say so.
    const { report } = await run(true);

    expect(domain(report, "alignment")?.created).toBe(3);
    const aligned = await rows<{ child: string; parent: string }>(
      `select c.legacy_id as child, p.legacy_id as parent
         from goals c join goals p on p.id = c.parent_goal_id
        where c.legacy_type = 'flowyteam' order by c.legacy_id`,
    );
    expect(aligned).toEqual([
      { child: "objectives:2", parent: "objectives:1" },
      { child: "objectives:5", parent: "objectives:7" },
    ]);

    // And the pointer FlowyTeam actually uses: an objective that rolls up into
    // a key result, which can only resolve once the key results exist. Running
    // the alignment pass before them dropped every one of these on a live
    // company and reported each as a parent that did not import.
    const toMeasure = await rows<{ child: string; parent: string }>(
      `select g.legacy_id as child, k.legacy_id as parent
         from goals g join key_results k on k.id = g.parent_key_result_id
        where g.legacy_type = 'flowyteam'`,
    );
    expect(toMeasure).toEqual([
      { child: "objectives:9", parent: "key_results:1" },
    ]);
  });

  it("puts an objective from a cycle that did not import on its own dates", async () => {
    // Objective 8 sits in the weekly cycle P6-T03a refuses. It still has dates,
    // so it imports with them rather than being lost with the cycle.
    await run(true);
    const [row] = await rows<{
      timeframe: { startsOn?: string } | null;
      cycle_id: string | null;
    }>(
      `select timeframe, cycle_id from goals where legacy_id = 'objectives:8'`,
    );
    expect(row?.cycle_id).toBeNull();
    expect(row?.timeframe?.startsOn).toBe("2026-01-12");
  });

  it("infers a direction per key result, and defaults the indicator type", async () => {
    await run(true);
    const measures = await rows<{
      legacy_id: string;
      direction: string;
      indicator_type: string;
      unit: string | null;
    }>(
      `select legacy_id, direction, indicator_type, unit from key_results
        where legacy_type = 'flowyteam' order by legacy_id`,
    );
    expect(measures).toEqual([
      {
        legacy_id: "key_results:1",
        direction: "increase",
        indicator_type: "lagging",
        unit: "count",
      },
      {
        legacy_id: "key_results:2",
        direction: "reduce",
        indicator_type: "lagging",
        unit: "%",
      },
      {
        legacy_id: "key_results:3",
        direction: "maintain",
        indicator_type: "lagging",
        unit: "stars",
      },
    ]);
  });

  it("reports the key result whose baseline and target are the same number", async () => {
    const { report } = await run(true);
    // A flag, because the key result is here; the reason is a decision the
    // source could not answer.
    expect(
      domain(report, "key results")
        ?.flags.map((row) => row.reason)
        .join(" | "),
    ).toContain("Imported as a maintain");
    // A skip, because that one genuinely is not here.
    expect(
      domain(report, "key results")
        ?.skipped.map((row) => row.reason)
        .join(" | "),
    ).toContain("did not import");
  });

  it("names a reviewer from the manager, and flags the objective with none", async () => {
    const { report } = await run(true);
    const reasons = domain(report, "objectives")
      ?.flags.map((row) => row.reason)
      .join(" | ");
    expect(reasons).toContain("champion as its own reviewer");

    // Objective 1's lead reports to somebody, so its reviewer is not its
    // champion. That is the difference the flag is about.
    const [one] = await rows<{ same: boolean }>(
      `select (champion_id = reviewer_id) as same from goals
        where legacy_id = 'objectives:1'`,
    );
    expect(one?.same).toBe(false);
  });

  it("replays the value history where the source keeps one as plain records", async () => {
    await run(true);
    // Key result 3 has records and no check-in, which is the older instance's
    // shape: the baseline the create writes, plus the one source record.
    const history = await count(
      `select count(*)::int as n from key_result_values v
         join key_results k on k.id = v.key_result_id
        where k.legacy_id = 'key_results:3'`,
    );
    expect(history).toBeGreaterThanOrEqual(2);
    const [current] = await rows<{ current_value: string }>(
      `select current_value from key_results where legacy_id = 'key_results:3'`,
    );
    expect(Number(current?.current_value)).toBe(4);
  });

  it("defers to a check-in where the key result has both, and says so", async () => {
    // Key result 1 has two records and a check-in. The check-in carries its own
    // date and `goals.recordValue` cannot, so replaying the records afterwards
    // would overwrite a dated movement with an undated one.
    const { report } = await run(true);

    const [current] = await rows<{ current_value: string }>(
      `select current_value from key_results where legacy_id = 'key_results:1'`,
    );
    expect(Number(current?.current_value)).toBe(18);
    expect(
      domain(report, "key result history")
        ?.flags.map((row) => row.reason)
        .join(" | "),
    ).toContain("already carries a check-in");
  });

  it("recomputes the score rather than carrying the source's own", async () => {
    const { report } = await run(true);
    // Objective 1 stored 62.5 in the source and its key results say otherwise.
    expect(report.notes.join(" ")).toContain("recomputed here");
    const [goal] = await rows<{ progress_pct: string | null }>(
      `select progress_pct from goals where legacy_id = 'objectives:1'`,
    );
    expect(Number(goal?.progress_pct ?? 0)).not.toBe(62.5);
  });

  it("acceptance: a second run writes nothing new", async () => {
    await run(true);
    const historyQuery = `select count(*)::int as n from key_result_values v
           join key_results k on k.id = v.key_result_id
          where k.legacy_id = 'key_results:1'`;
    const afterFirstRun = await count(historyQuery);
    const { report } = await run(true);

    for (const name of ["objectives", "key results", "key result history"]) {
      expect(domain(report, name)?.created, `${name} on the second run`).toBe(
        0,
      );
    }
    expect(
      await count(
        `select count(*)::int as n from goals where legacy_type = 'flowyteam'`,
      ),
    ).toBe(7);
    expect(
      await count(
        `select count(*)::int as n from key_results where legacy_type = 'flowyteam'`,
      ),
    ).toBe(3);
    // The history is not replayed a second time, which is the one domain with
    // no legacy key of its own to protect it. Compared against the first run
    // rather than a fixed number, because the check-in mapper writes into the
    // same history and a number here would only measure how many mappers there
    // are today.
    expect(await count(historyQuery)).toBe(afterFirstRun);
  });

  it("writes nothing on a dry run", async () => {
    const { report } = await run(false);
    expect(domain(report, "objectives")?.created).toBe(7);
    expect(
      await count(
        `select count(*)::int as n from goals where legacy_type = 'flowyteam'`,
      ),
    ).toBe(0);
  });
});
