/**
 * Indicators into KPIs, from a real FlowyTeam into a real workspace
 * (TECHNICAL-PLAN §7.2, P6-T03d).
 *
 * The acceptance criterion is that a calculated KPI recomputes to the source's
 * own value, which is the one claim a parser test cannot make: it needs the
 * records loaded, the formula stored as a tree and the engine run over both.
 */
import {
  callAction,
  provisionWorkspaceForUser,
  type Source,
} from "@openokr/core";
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

async function run(write: boolean, only?: readonly string[]) {
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

/** What a reconciliation says, without the reasons' wording. */
function counts(
  report: Awaited<ReturnType<typeof run>>["report"],
  name: string,
) {
  const one = domain(report, name);
  return {
    read: one?.read,
    created: one?.created,
    matched: one?.matched,
    combined: one?.combined,
    recomputed: one?.recomputed,
    skipped: one?.skipped.map((row) => row.source).sort(),
  };
}

const COMPANY = "App\\\\Models\\\\Company";
const TEAM = "App\\\\Models\\\\Team";
const EMPLOYEE = "App\\\\Models\\\\EmployeeDetails";

describe.skipIf(!runnable)(
  "KPI records, owners and formulas (2026-11-23)",
  () => {
    async function seedSamePeriod() {
      await seeded.run(
        `insert into indicators (id, company_id, title, occurance, direction, aggregate, calculated, model_id, model_type) values
         (20, 7, 'Weekly visits', 'weekly', 'up', 'sum', 0, 7, '${COMPANY}'),
         (21, 7, 'Daily peak',    'daily',  'up', 'max', 0, 7, '${COMPANY}')`,
      );
      await seeded.run(
        `insert into indicator_records (id, company_id, indicator_id, period_key, current_value, target_value) values
         (101, 7, 20, '2026-01-19', 1, null),
         (102, 7, 20, '2026-01-20', 2, null),
         (103, 7, 20, '2026-01-22', 4, null),
         (104, 7, 20, '2026-01-26', 5, null),
         (105, 7, 21, '2026-02-03', 3, 10),
         (106, 7, 21, '2026-02-03', 8, 10)`,
      );
    }

    async function recordsOf(legacyId: string) {
      return rows<{
        period_start: string;
        actual_value: string | null;
        target_value: string | null;
        legacy_id: string | null;
      }>(
        `select r.period_start, r.actual_value, r.target_value, r.legacy_id
         from kpi_records r join kpis k on k.id = r.kpi_id
        where k.legacy_id = '${legacyId}' and r.deleted_at is null
        order by r.period_start`,
      );
    }

    it("Given several source records in one period, when imported, then they are one record combined by the KPI's aggregate", async () => {
      await seedSamePeriod();
      const { report } = await run(true);

      const weekly = await recordsOf("indicators:20");
      expect(weekly.map((row) => localDay(row.period_start))).toEqual([
        "2026-01-19",
        "2026-01-26",
      ]);
      // 1 + 2 + 4 by sum, under the lowest source id.
      expect(Number(weekly[0]?.actual_value)).toBe(7);
      expect(weekly[0]?.legacy_id).toBe("indicator_records:101");
      expect(weekly[1]?.legacy_id).toBe("indicator_records:104");

      // Two values on one day of a daily max KPI: the larger, and the shared target.
      const daily = await recordsOf("indicators:21");
      expect(daily).toHaveLength(1);
      expect(Number(daily[0]?.actual_value)).toBe(8);
      expect(Number(daily[0]?.target_value)).toBe(10);

      const records = domain(report, "KPI records");
      expect(records?.combined).toBe(3);
      expect(records?.clean).toBe(true);
      const flags = records?.flags.map((row) => `${row.source}: ${row.reason}`);
      expect(flags).toContainEqual(
        expect.stringContaining(
          "indicator_records:101: Combined with indicator_records:102, indicator_records:103 into one weekly record for the period starting 2026-01-19, by sum: 7",
        ),
      );
      // Not reported as already here.
      expect(records?.matched).toBe(0);
    });

    it("Given an indicator whose team or employee row is gone, when imported, then it lands at workspace level and is named in the report", async () => {
      await seeded.run(
        `insert into indicators (id, company_id, title, occurance, direction, aggregate, calculated, model_id, model_type) values
         (22, 7, 'Team gone',      'monthly', 'up', 'sum', 0, 99, '${TEAM}'),
         (23, 7, 'Employee gone',  'monthly', 'up', 'sum', 0, 99, '${EMPLOYEE}'),
         (24, 7, 'Team not named', 'monthly', 'up', 'sum', 0, 4,  '${TEAM}')`,
      );
      await seeded.run(
        `insert into indicator_records (id, company_id, indicator_id, period_key, current_value) values
         (107, 7, 22, '2026-01-10', 3)`,
      );
      const { report } = await run(true);

      const owners = await rows<{ legacy_id: string; owner_kind: string }>(
        `select legacy_id, owner_kind from kpis
        where legacy_id in ('indicators:22', 'indicators:23') order by legacy_id`,
      );
      expect(owners).toEqual([
        { legacy_id: "indicators:22", owner_kind: "workspace" },
        { legacy_id: "indicators:23", owner_kind: "workspace" },
      ]);
      const kpis = domain(report, "KPIs");
      const flagged = kpis?.flags
        .filter((row) => row.reason.includes("no longer exists in FlowyTeam"))
        .map((row) => row.source)
        .sort();
      expect(flagged).toEqual(["indicators:22", "indicators:23"]);
      // Team 4 is still in the source; it did not import for another reason.
      expect(kpis?.skipped).toContainEqual({
        source: "indicators:24",
        reason: "The space that owns this indicator did not import.",
      });
      expect(await recordsOf("indicators:22")).toHaveLength(1);
    });

    it("Given a calculated KPI with typed source values, when imported twice, then neither run writes them and both say so the same way", async () => {
      await seeded.run(
        `insert into indicator_records (id, company_id, indicator_id, period_key, current_value) values
         (108, 7, 3, '2026-01-14', 99)`,
      );
      const first = await run(true);
      const margin = await recordsOf("indicators:3");
      // January is computed from Revenue and Cost, never the typed 99.
      expect(margin.map((row) => Number(row.actual_value))).not.toContain(99);
      expect(Number(margin[0]?.actual_value)).toBeCloseTo(
        ((90000 - 38000) / 90000) * 100,
        2,
      );
      const records = domain(first.report, "KPI records");
      expect(records?.recomputed).toBe(1);
      expect(records?.flags).toContainEqual({
        source: "indicators:3",
        reason: expect.stringContaining("recomputed from the formula"),
      });

      const second = await run(true);
      expect(counts(second.report, "KPI records")).toEqual({
        ...counts(first.report, "KPI records"),
        created: 0,
        matched:
          (counts(first.report, "KPI records").created ?? 0) +
          (counts(first.report, "KPI records").matched ?? 0),
      });
      expect(
        domain(second.report, "KPI records")?.skipped.map((row) => row.reason),
      ).not.toContainEqual(expect.stringContaining("cannot be typed in"));
    });

    it("Given an import, then every typed record carries its source id, and a workspace imported before that gains it without a second row", async () => {
      await seedSamePeriod();
      await run(true);
      expect(
        await count(
          `select count(*)::int as n from kpi_records r join kpis k on k.id = r.kpi_id
          where not k.is_calculated and r.legacy_id is null`,
        ),
      ).toBe(0);
      const [january] = await recordsOf("indicators:1");
      expect(january?.legacy_id).toBe("indicator_records:1");

      // A workspace imported before records carried a key.
      const before = await count(`select count(*)::int as n from kpi_records`);
      const wb = await workerDb();
      await wb.admin.query(
        "update kpi_records set legacy_type = null, legacy_id = null",
      );

      const dry = await run(false);
      expect(domain(dry.report, "KPI records")?.created).toBe(0);
      const again = await run(true);
      expect(domain(again.report, "KPI records")?.created).toBe(0);
      expect(await count(`select count(*)::int as n from kpi_records`)).toBe(
        before,
      );
      const [refilled] = await recordsOf("indicators:1");
      expect(refilled?.legacy_id).toBe("indicator_records:1");
    });

    it("Given a source cycle in a period the workspace already has, when dry run and real run both run, then they report the same rows", async () => {
      await seedSamePeriod();
      await callAction(
        {
          pool,
          workspaceId,
          actor: { kind: "human", userId: OWNER },
        },
        "cycles.create",
        { on: "2026-07-01", cadence: "quarterly", firstCycle: false },
      );
      await seeded.run(
        `insert into performance_cycles (id, company_id, name, cycle_type, type, started_at, finished_at) values
         (6, 7, 'FY26 Q3', 'quarterly', 'org', '2026-07-06', '2026-09-30')`,
      );

      const dry = await run(false, ["kpis"]);
      expect(domain(dry.report, "cycles")?.skipped).toContainEqual({
        source: "performance_cycles:6",
        reason: "Q3 2026 already exists in this workspace.",
      });
      const real = await run(true, ["kpis"]);
      for (const name of ["cycles", "KPIs", "KPI records", "KPI formulas"]) {
        expect(counts(dry.report, name), name).toEqual(
          counts(real.report, name),
        );
      }
    });
  },
);
