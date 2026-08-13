import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Calculated KPIs against a real database (P3-T13, design §5 to §7).
 *
 * The grammar, the aggregation and the cascade order are covered by the golden
 * masters. What is checked here is the task's acceptance criterion and everything
 * else only rows can settle: that the edge table is rebuilt from the formula, that
 * a cycle is refused before it reaches the table, and that a null result writes no
 * value but does record why.
 */

const OWNER = "formula-owner";

let workspaceId: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

const makeKpi = async (title: string, frequency = "monthly") => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "kpis.create", {
    title,
    frequency: frequency as "daily" | "monthly",
    direction: "higher_better",
    indicatorType: "lagging",
    tier: "output",
    aggregate: "sum",
    ownerKind: "workspace",
    targetDefault: 100,
  });
};

const record = async (kpiId: string, on: string, actualValue: number) => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "kpis.record", {
    kpiId,
    on,
    actualValue,
  });
};

const setFormula = async (
  kpiId: string,
  formula: unknown,
  on = "2026-08-11",
) => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "kpis.setFormula", {
    kpiId,
    formula,
    on,
  });
};

const actualOf = async (kpiId: string, periodStart: string) => {
  const wb = await workerDb();
  const rows = await wb.admin.query<{
    actual_value: string | null;
    diagnostic: string | null;
  }>(
    "select actual_value, diagnostic from kpi_records where kpi_id = $1 and period_start = $2 and deleted_at is null",
    [kpiId, periodStart],
  );
  return {
    actual:
      rows.rows[0]?.actual_value === null || rows.rows[0] === undefined
        ? null
        : Number(rows.rows[0].actual_value),
    diagnostic: rows.rows[0]?.diagnostic ?? null,
  };
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Owner", "formula-owner@example.com"],
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
   * "Given a monthly KPI defined as the sum of two others, when one source's
   * value changes, then the dependent recomputes for that period, anything
   * depending on it follows, and a self-referencing formula is rejected."
   */
  it("recomputes the dependent and its own dependent, and refuses self-reference", async () => {
    const a = await makeKpi("Source A");
    const b = await makeKpi("Source B");
    const sum = await makeKpi("A plus B");
    const doubled = await makeKpi("Twice the sum");

    await record(a.id, "2026-08-11", 10);
    await record(b.id, "2026-08-11", 5);

    await setFormula(sum.id, {
      op: "add",
      l: { k: a.id },
      r: { k: b.id },
    });
    await setFormula(doubled.id, {
      op: "mul",
      l: { k: sum.id },
      r: { n: 2 },
    });

    expect((await actualOf(sum.id, "2026-08-01")).actual).toBe(15);
    expect((await actualOf(doubled.id, "2026-08-01")).actual).toBe(30);

    // One source changes. Both levels follow, in order.
    await record(a.id, "2026-08-20", 40);

    expect((await actualOf(sum.id, "2026-08-01")).actual).toBe(45);
    expect((await actualOf(doubled.id, "2026-08-01")).actual).toBe(90);

    // And the formula that would make a KPI its own source is refused.
    await expect(setFormula(sum.id, { k: sum.id })).rejects.toThrow(
      /cannot be calculated from itself/i,
    );
  });
});

describe("the edge table", () => {
  it("is rebuilt from the formula, dropping the edges it no longer has", async () => {
    const wb = await workerDb();
    const a = await makeKpi("Source A");
    const b = await makeKpi("Source B");
    const sum = await makeKpi("Calculated");

    await setFormula(sum.id, { op: "add", l: { k: a.id }, r: { k: b.id } });
    const two = await wb.admin.query(
      "select id from kpi_dependencies where dependent_kpi_id = $1 and deleted_at is null",
      [sum.id],
    );
    expect(two.rows).toHaveLength(2);

    await setFormula(sum.id, { k: a.id });
    const one = await wb.admin.query<{ depends_on_kpi_id: string }>(
      "select depends_on_kpi_id from kpi_dependencies where dependent_kpi_id = $1 and deleted_at is null",
      [sum.id],
    );
    expect(one.rows).toHaveLength(1);
    expect(one.rows[0]?.depends_on_kpi_id).toBe(a.id);
  });

  it("refuses a cycle before it reaches the table", async () => {
    const wb = await workerDb();
    const a = await makeKpi("A");
    const b = await makeKpi("B");

    await setFormula(a.id, { k: b.id });
    // b from a would close the loop.
    await expect(setFormula(b.id, { k: a.id })).rejects.toThrow(/cycle/i);

    const rows = await wb.admin.query(
      "select id from kpi_dependencies where deleted_at is null",
    );
    // Only the first edge survives. A cycle never lands, so no read has to
    // defend against one.
    expect(rows.rows).toHaveLength(1);
  });

  it("refuses a reference to a KPI that does not exist here", async () => {
    const a = await makeKpi("A");
    await expect(
      setFormula(a.id, { k: "00000000-0000-4000-8000-0000000000ff" }),
    ).rejects.toThrow(/does not exist/i);
  });

  it("refuses something that is not a formula", async () => {
    const a = await makeKpi("A");
    await expect(setFormula(a.id, { op: "pow", l: 1, r: 2 })).rejects.toThrow(
      /not a formula/i,
    );
  });
});

describe("a null result", () => {
  it("writes no value and records why", async () => {
    const a = await makeKpi("Source A");
    const b = await makeKpi("Source B");
    const sum = await makeKpi("A plus B");

    // Only one source has a value.
    await record(a.id, "2026-08-11", 10);
    await setFormula(sum.id, { op: "add", l: { k: a.id }, r: { k: b.id } });

    const cell = await actualOf(sum.id, "2026-08-01");
    // A fabricated 10 would read as measured. Null plus a diagnostic is the
    // honest answer, and the grid can say which source is missing.
    expect(cell.actual).toBeNull();
    expect(cell.diagnostic).toBe("missing_source");

    const grid = await callAction(
      { pool: (await workerDb()).appPool, ...context() },
      "kpis.grid",
      { periods: 12 },
    );
    expect(grid.kpis.find((entry) => entry.id === sum.id)?.state).toBe(
      "no_data",
    );
  });

  it("reports a division by zero rather than a zero", async () => {
    const a = await makeKpi("Numerator");
    const b = await makeKpi("Denominator");
    const ratio = await makeKpi("Ratio");

    await record(a.id, "2026-08-11", 10);
    await record(b.id, "2026-08-11", 0);
    await setFormula(ratio.id, { op: "div", l: { k: a.id }, r: { k: b.id } });

    const cell = await actualOf(ratio.id, "2026-08-01");
    // Zero would read as a real `unhealthy` (decision D-9).
    expect(cell.actual).toBeNull();
    expect(cell.diagnostic).toBe("divide_by_zero");
  });
});

describe("cross-frequency references", () => {
  it("folds a daily source into a monthly dependent with the source's aggregate", async () => {
    const daily = await makeKpi("Daily signups", "daily");
    const monthly = await makeKpi("Monthly signups");

    for (const [on, value] of [
      ["2026-08-01", 10],
      ["2026-08-02", 20],
      ["2026-08-03", 30],
      // Outside the target month, so excluded.
      ["2026-07-31", 99],
    ] as const) {
      await record(daily.id, on, value);
    }

    await setFormula(monthly.id, { k: daily.id });
    expect((await actualOf(monthly.id, "2026-08-01")).actual).toBe(60);
  });
});

describe("a calculated KPI", () => {
  it("cannot be typed into", async () => {
    const a = await makeKpi("Source");
    const derived = await makeKpi("Derived");
    await record(a.id, "2026-08-11", 10);
    await setFormula(derived.id, { k: a.id });

    await expect(record(derived.id, "2026-08-11", 999)).rejects.toThrow(
      /calculated/i,
    );
  });
});
