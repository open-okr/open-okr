import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * KPIs against a real database (P3-T12, METHOD.md §6.4, design §1 to §3).
 *
 * The arithmetic is covered by the golden masters in `kpi-golden.test.ts`. What is
 * checked here is what only rows can settle: that a period is normalised before
 * the unique index sees it, that re-recording updates rather than duplicating,
 * that two concurrent writers cannot both insert the same period, and that the
 * corridor state written to the column matches the engine.
 */

const OWNER = "kpi-owner";

let workspaceId: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

const makeKpi = async (input: {
  title?: string;
  frequency?: "daily" | "weekly" | "monthly" | "quarterly" | "yearly";
  direction?: "higher_better" | "lower_better";
  targetDefault?: number;
}) => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "kpis.create", {
    title: input.title ?? "Activation rate",
    indicatorType: "lagging",
    tier: "output",
    aggregate: "sum",
    ownerKind: "workspace",
    frequency: input.frequency ?? "monthly",
    direction: input.direction ?? "higher_better",
    ...(input.targetDefault === undefined
      ? {}
      : { targetDefault: input.targetDefault }),
  });
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Owner", "kpi-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the acceptance criterion", () => {
  /**
   * "Given a monthly KPI with a target and default corridors, when a value at
   * eighty percent of target is recorded, then the cell shows the watch state and
   * re-recording updates rather than duplicating."
   */
  it("shows watch at eighty percent, and re-recording updates the same row", async () => {
    const wb = await workerDb();
    const kpi = await makeKpi({ frequency: "monthly", targetDefault: 100 });

    const first = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.record",
      { kpiId: kpi.id, on: "2026-08-11", actualValue: 80 },
    );
    expect(first.created).toBe(true);
    // Any date inside August lands on the first, never on the day typed.
    expect(first.periodStart).toBe("2026-08-01");
    expect(first.achievementPct).toBe(80);
    // Default corridors are 90 and 70, so eighty percent is watch.
    expect(first.state).toBe("watch");

    const second = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.record",
      { kpiId: kpi.id, on: "2026-08-28", actualValue: 95 },
    );
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.state).toBe("healthy");

    const rows = await wb.admin.query(
      "select id from kpi_records where kpi_id = $1 and deleted_at is null",
      [kpi.id],
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe("period normalisation on the write path", () => {
  it("buckets every frequency from a date inside the period", async () => {
    const wb = await workerDb();
    const cases = [
      { frequency: "daily" as const, on: "2026-08-11", expected: "2026-08-11" },
      {
        frequency: "weekly" as const,
        on: "2026-08-16",
        expected: "2026-08-10",
      },
      {
        frequency: "monthly" as const,
        on: "2026-08-31",
        expected: "2026-08-01",
      },
      {
        frequency: "quarterly" as const,
        on: "2026-12-31",
        expected: "2026-10-01",
      },
      {
        frequency: "yearly" as const,
        on: "2026-08-11",
        expected: "2026-01-01",
      },
    ];
    for (const entry of cases) {
      const kpi = await makeKpi({
        title: `Measure ${entry.frequency}`,
        frequency: entry.frequency,
        targetDefault: 100,
      });
      const result = await callAction(
        { pool: wb.appPool, ...context() },
        "kpis.record",
        { kpiId: kpi.id, on: entry.on, actualValue: 50 },
      );
      expect(result.periodStart).toBe(entry.expected);
    }
  });

  it("treats two dates in the same week as one period", async () => {
    const wb = await workerDb();
    const kpi = await makeKpi({ frequency: "weekly", targetDefault: 100 });
    const monday = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.record",
      { kpiId: kpi.id, on: "2026-08-10", actualValue: 10 },
    );
    const sunday = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.record",
      { kpiId: kpi.id, on: "2026-08-16", actualValue: 20 },
    );
    expect(sunday.id).toBe(monday.id);
    expect(sunday.created).toBe(false);
  });
});

describe("uniqueness under concurrent writes", () => {
  it("lets two writers race and leaves exactly one row", async () => {
    const wb = await workerDb();
    const kpi = await makeKpi({ frequency: "monthly", targetDefault: 100 });

    // The race the grid loses if the write is a read-then-insert: both callers
    // see no row for the period and both try to create one.
    const results = await Promise.allSettled([
      callAction({ pool: wb.appPool, ...context() }, "kpis.record", {
        kpiId: kpi.id,
        on: "2026-09-04",
        actualValue: 41,
      }),
      callAction({ pool: wb.appPool, ...context() }, "kpis.record", {
        kpiId: kpi.id,
        on: "2026-09-19",
        actualValue: 42,
      }),
    ]);

    // Neither is allowed to fail with a constraint violation: `on conflict` makes
    // the loser an update rather than an error.
    expect(results.every((entry) => entry.status === "fulfilled")).toBe(true);

    const rows = await wb.admin.query<{ actual_value: string }>(
      "select actual_value from kpi_records where kpi_id = $1 and deleted_at is null",
      [kpi.id],
    );
    expect(rows.rows).toHaveLength(1);
    // Whichever landed second wins, and both values are plausible answers.
    expect(["41", "42"]).toContain(
      rows.rows[0]?.actual_value?.replace(/\.0+$/, ""),
    );
  });
});

describe("achievement and the corridor", () => {
  it("is direction-aware in both directions", async () => {
    const wb = await workerDb();
    const higher = await makeKpi({
      title: "Activation",
      direction: "higher_better",
      targetDefault: 100,
    });
    const lower = await makeKpi({
      title: "Cost per ticket",
      direction: "lower_better",
      targetDefault: 100,
    });

    const up = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.record",
      { kpiId: higher.id, on: "2026-08-11", actualValue: 80 },
    );
    const down = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.record",
      { kpiId: lower.id, on: "2026-08-11", actualValue: 80 },
    );

    // The same numbers, opposite verdicts. That is the whole point of §6.4.
    expect(up.achievementPct).toBe(80);
    expect(up.state).toBe("watch");
    expect(down.achievementPct).toBe(125);
    expect(down.state).toBe("healthy");
  });

  it("reports no data until an actual is recorded", async () => {
    const wb = await workerDb();
    const kpi = await makeKpi({ targetDefault: 100 });
    const grid = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.grid",
      { periods: 12 },
    );
    const row = grid.kpis.find((entry) => entry.id === kpi.id);
    expect(row?.state).toBe("no_data");
    expect(row?.achievementPct).toBeNull();
  });

  it("gives a negative target no ratio and says why", async () => {
    const wb = await workerDb();
    const kpi = await makeKpi({ direction: "higher_better" });
    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.record",
      { kpiId: kpi.id, on: "2026-08-11", actualValue: -1, targetValue: -3 },
    );
    // Decision D-15: there is no correct ratio over a negative target.
    expect(result.achievementPct).toBeNull();
    expect(result.diagnostic).toBe("negative_target");
    expect(result.state).toBe("no_data");
  });

  it("measures a period without its own target against the standing one", async () => {
    const wb = await workerDb();
    const kpi = await makeKpi({ targetDefault: 200 });
    const result = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.record",
      { kpiId: kpi.id, on: "2026-08-11", actualValue: 100 },
    );
    expect(result.achievementPct).toBe(50);
  });
});

describe("the grid read", () => {
  it("groups by category and puts the uncategorised last", async () => {
    const wb = await workerDb();
    const category = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.createCategory",
      { name: "Revenue" },
    );
    await callAction({ pool: wb.appPool, ...context() }, "kpis.create", {
      title: "Monthly recurring revenue",
      frequency: "monthly",
      direction: "higher_better",
      indicatorType: "lagging",
      tier: "output",
      aggregate: "sum",
      ownerKind: "workspace",
      categoryId: category.id,
    });
    await makeKpi({ title: "Unfiled measure" });

    const grid = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.grid",
      { periods: 6 },
    );
    expect(grid.categories.map((entry) => entry.name)).toEqual([
      "Revenue",
      "Uncategorised",
    ]);
    expect(grid.categories.at(-1)?.id).toBeNull();
    expect(grid.kpis).toHaveLength(2);
  });

  it("returns the periods newest first", async () => {
    const wb = await workerDb();
    const kpi = await makeKpi({ frequency: "monthly", targetDefault: 100 });
    for (const on of ["2026-06-15", "2026-07-15", "2026-08-15"]) {
      await callAction({ pool: wb.appPool, ...context() }, "kpis.record", {
        kpiId: kpi.id,
        on,
        actualValue: 50,
      });
    }
    const grid = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.grid",
      { periods: 12 },
    );
    const row = grid.kpis.find((entry) => entry.id === kpi.id);
    expect(row?.records.map((record) => record.periodStart)).toEqual([
      "2026-08-01",
      "2026-07-01",
      "2026-06-01",
    ]);
  });
});

describe("refusals", () => {
  it("refuses a watch band above the healthy band", async () => {
    const wb = await workerDb();
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "kpis.create", {
        title: "Backwards corridor",
        frequency: "monthly",
        direction: "higher_better",
        indicatorType: "lagging",
        tier: "output",
        aggregate: "sum",
        ownerKind: "workspace",
        healthyPct: 70,
        watchPct: 90,
      }),
    ).rejects.toThrow(/cannot sit above/i);
  });

  it("refuses a typed value on a calculated KPI", async () => {
    const wb = await workerDb();
    const kpi = await makeKpi({ targetDefault: 100 });
    // Calculated KPIs cannot be created through the action yet, because nothing
    // evaluates a formula until P3-T13. The refusal is still real, so the flag is
    // set directly to reach it.
    await wb.admin.query(
      "update kpis set is_calculated = true, formula = '{}'::jsonb where id = $1",
      [kpi.id],
    );
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "kpis.record", {
        kpiId: kpi.id,
        on: "2026-08-11",
        actualValue: 10,
      }),
    ).rejects.toThrow(/calculated/i);
  });
});
