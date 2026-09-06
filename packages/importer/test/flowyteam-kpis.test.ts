/**
 * Indicators into KPIs, from a real FlowyTeam into a real workspace
 * (TECHNICAL-PLAN §7.2, P6-T03d).
 *
 * The acceptance criterion is that a calculated KPI recomputes to the source's
 * own value, which is the one claim a parser test cannot make: it needs the
 * records loaded, the formula stored as a tree and the engine run over both.
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

const OWNER = "77777777-7777-4777-8777-777777777777";
const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam KPI tests. ${SKIP_REASON}`);
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

/**
 * A `date` column as the day it names.
 *
 * The driver parses it into a Date at local midnight, so `toISOString` reads a
 * day earlier anywhere east of Greenwich. The local parts are the only ones
 * that mean what the column says.
 */
function localDay(value: unknown): string {
  const date = new Date(String(value));
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
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
    [OWNER, "Import Owner", "kpi-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Import Owner",
  });
  workspaceId = provisioned.workspaceId;

  await seeded?.drop();
  await source?.close();
  seeded = await seedSource("kpis");
  source = await openSource({ url: seeded.url });
});

afterAll(async () => {
  await source?.close();
  await seeded?.drop();
  const wb = await workerDb();
  await wb.close();
});

describe.skipIf(!runnable)("importing one company's KPIs", () => {
  it("maps the categories, and skips the one with no name", async () => {
    const { report } = await run(true);
    expect(domain(report, "KPI categories")?.created).toBe(1);
    const [category] = await rows<{ name: string }>(
      `select name from kpi_categories where legacy_id = 'indicator_types:1'`,
    );
    expect(category?.name).toBe("Commercial");
  });

  it("maps frequency, direction, aggregate and unit", async () => {
    await run(true);
    const [kpi] = await rows<{
      frequency: string;
      direction: string;
      aggregate: string;
      unit: string | null;
      indicator_type: string;
      tier: string;
    }>(
      `select frequency, direction, aggregate, unit, indicator_type, tier
         from kpis where legacy_id = 'indicators:2'`,
    );
    expect(kpi).toMatchObject({
      frequency: "monthly",
      // FlowyTeam's `down` is lower-is-better here.
      direction: "lower_better",
      aggregate: "sum",
      unit: "USD",
      // Neither exists in the source, so both are defaults and both are flagged.
      indicator_type: "lagging",
      tier: "output",
    });
  });

  it("flags every KPI as a defaulted lagging output", async () => {
    const { report } = await run(true);
    expect(
      domain(report, "KPIs")
        ?.flags.map((row) => row.reason)
        .join(" | "),
    ).toContain("defaults rather than decisions");
  });

  it("refuses a frequency this product does not measure on", async () => {
    const { report } = await run(true);
    const reasons = domain(report, "KPIs")
      ?.skipped.map((row) => `${row.source}: ${row.reason}`)
      .join(" | ");
    expect(reasons).toContain("indicators:5");
    expect(reasons).toContain("not a frequency this product measures on");
  });

  it("writes a child whose parent has a higher id", async () => {
    // Indicator 6 points at indicator 7. Reading in id order would refuse it,
    // which is why the mapper orders by depth.
    await run(true);
    const [child] = await rows<{ parent: string | null }>(
      `select p.legacy_id as parent
         from kpis k left join kpis p on p.id = k.parent_kpi_id
        where k.legacy_id = 'indicators:6'`,
    );
    expect(child?.parent).toBe("indicators:7");
  });

  it("flags an indicator the source gives no direction", async () => {
    const { report } = await run(true);
    expect(
      domain(report, "KPIs")
        ?.flags.map((row) => row.reason)
        .join(" | "),
    ).toContain("no direction");
  });

  it("records each value in the period its date falls in", async () => {
    await run(true);
    const records = await rows<{ period_start: string; actual_value: string }>(
      `select r.period_start, r.actual_value from kpi_records r
         join kpis k on k.id = r.kpi_id
        where k.legacy_id = 'indicators:1' order by r.period_start`,
    );
    expect(records).toHaveLength(2);
    // Recorded on the 14th, normalised to the month it falls in.
    expect(localDay(records[0]?.period_start)).toBe("2026-01-01");
    expect(Number(records[0]?.actual_value)).toBe(90000);
  });

  it("acceptance: a calculated KPI recomputes to the source's own value", async () => {
    await run(true);
    // Margin = (Revenue - Cost) / Revenue * 100. For January that is
    // (90000 - 38000) / 90000 * 100, which is 57.78 to two places.
    const [margin] = await rows<{ actual_value: string | null }>(
      `select r.actual_value from kpi_records r
         join kpis k on k.id = r.kpi_id
        where k.legacy_id = 'indicators:3'
        order by r.period_start desc limit 1`,
    );
    const expected = ((95000 - 42000) / 95000) * 100;
    expect(Number(margin?.actual_value)).toBeCloseTo(expected, 2);
  });

  it("drops a formula it cannot read, and keeps the KPI", async () => {
    const { report } = await run(true);
    const reasons = domain(report, "KPI formulas")
      ?.skipped.map((row) => row.reason)
      .join(" | ");
    expect(reasons).toContain("op_wobble");
    expect(reasons).toContain("imported with its recorded values");

    // The KPI itself is here.
    expect(
      await count(
        `select count(*)::int as n from kpis where legacy_id = 'indicators:4'`,
      ),
    ).toBe(1);
  });

  it("leaves every KPI without a tree", async () => {
    const { report } = await run(true);
    expect(report.notes.join(" ")).toContain("no named driver tree");
    expect(
      await count(
        `select count(*)::int as n from kpis
          where legacy_type = 'flowyteam' and tree_id is not null`,
      ),
    ).toBe(0);
  });

  it("acceptance: a second run writes nothing new", async () => {
    await run(true);
    const before = await count(`select count(*)::int as n from kpi_records`);
    const { report } = await run(true);

    for (const name of ["KPI categories", "KPIs", "KPI records"]) {
      expect(domain(report, name)?.created, `${name} on the second run`).toBe(
        0,
      );
    }
    expect(await count(`select count(*)::int as n from kpi_records`)).toBe(
      before,
    );
    expect(
      await count(
        `select count(*)::int as n from kpis where legacy_type = 'flowyteam'`,
      ),
    ).toBe(6);
  });

  it("writes nothing on a dry run", async () => {
    const { report } = await run(false);
    expect(domain(report, "KPIs")?.created).toBe(6);
    expect(await count(`select count(*)::int as n from kpis`)).toBe(0);
  });
});
