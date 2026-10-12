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

describe("health in the KPI's own units (P9-T17a)", () => {
  const call = async (name: string, input: object) => {
    const wb = await workerDb();
    return callAction(
      { pool: wb.appPool, ...context() },
      name as never,
      input as never,
    ) as Promise<never>;
  };
  const uptime = async () =>
    (await call("kpis.create", {
      title: "Uptime",
      frequency: "monthly",
      unit: "%",
      targetType: "at_least",
      targetDefault: 99.9,
      greenLow: 99.9,
      redLow: 99.5,
    })) as { id: string };

  it("acceptance: uptime at 95 against 99.9 with red below 99.5 reads unhealthy", async () => {
    const kpi = await uptime();
    const recorded = (await call("kpis.record", {
      kpiId: kpi.id,
      on: "2026-12-03",
      actualValue: 95,
    })) as { state: string; achievementPct: number | null };
    expect(recorded.state).toBe("unhealthy");
    // The ratio is still reported, and is the number that used to call it
    // healthy.
    expect(recorded.achievementPct).toBe(95.1);

    const detail = (await call("kpis.detail", { kpiId: kpi.id })) as {
      kpi: {
        targetType: string;
        greenLow: number | null;
        redLow: number | null;
        basis: string;
        direction: string;
      };
    };
    expect(detail.kpi).toMatchObject({
      targetType: "at_least",
      greenLow: 99.9,
      redLow: 99.5,
      basis: "thresholds",
      direction: "higher_better",
    });
  });

  it("colours each grid period by its own band", async () => {
    const kpi = await uptime();
    for (const [on, actualValue] of [
      ["2026-10-05", 99.95],
      ["2026-11-05", 99.7],
      ["2026-12-05", 99.4],
    ] as const) {
      await call("kpis.record", { kpiId: kpi.id, on, actualValue });
    }
    const grid = (await call("kpis.grid", { periods: 12 })) as {
      kpis: {
        id: string;
        basis: string;
        records: { periodStart: string; band: string | null }[];
      }[];
    };
    const row = grid.kpis.find((entry) => entry.id === kpi.id);
    expect(row?.basis).toBe("thresholds");
    expect(
      Object.fromEntries(
        (row?.records ?? []).map((record) => [record.periodStart, record.band]),
      ),
    ).toEqual({
      "2026-10-01": "healthy",
      "2026-11-01": "watch",
      "2026-12-01": "unhealthy",
    });
  });

  it("reads a range, and a direction alone still picks a type", async () => {
    const range = (await call("kpis.create", {
      title: "Uptime band",
      frequency: "monthly",
      targetType: "range",
      greenLow: 99.9,
      greenHigh: 100,
      redLow: 99.5,
    })) as { id: string };
    const recorded = (await call("kpis.record", {
      kpiId: range.id,
      on: "2026-12-03",
      actualValue: 99.7,
    })) as { state: string };
    expect(recorded.state).toBe("watch");

    const legacy = await makeKpi({ direction: "lower_better" });
    const detail = (await call("kpis.detail", { kpiId: legacy.id })) as {
      kpi: { targetType: string; basis: string };
    };
    expect(detail.kpi).toMatchObject({ targetType: "at_most", basis: "ratio" });
  });

  it("refuses thresholds the type cannot be judged by, in words", async () => {
    await expect(
      call("kpis.create", {
        title: "Half a rule",
        frequency: "monthly",
        targetType: "at_least",
        greenLow: 10,
      }),
    ).rejects.toThrow(/both the green value and the red value/);
    await expect(
      call("kpis.create", {
        title: "A range with no band",
        frequency: "monthly",
        targetType: "range",
      }),
    ).rejects.toThrow(/needs its band/);
    await expect(
      call("kpis.create", {
        title: "Upside down",
        frequency: "monthly",
        targetType: "at_least",
        greenHigh: 5,
        redHigh: 10,
      }),
    ).rejects.toThrow(/below it, not above/);
  });

  it("drops the thresholds a new type does not use, and keeps the KPI judged", async () => {
    const kpi = await uptime();
    await call("kpis.update", {
      kpiId: kpi.id,
      targetType: "at_most",
      greenHigh: 2,
      redHigh: 5,
    });
    const detail = (await call("kpis.detail", { kpiId: kpi.id })) as {
      kpi: {
        targetType: string;
        greenLow: number | null;
        redLow: number | null;
        greenHigh: number | null;
        direction: string;
      };
    };
    expect(detail.kpi).toMatchObject({
      targetType: "at_most",
      greenLow: null,
      redLow: null,
      greenHigh: 2,
      direction: "lower_better",
    });
  });
});

describe("the tree's links (§6.3, P9-T17b-a)", () => {
  it("reads formula where the parent's formula uses the child, and influence otherwise", async () => {
    const wb = await workerDb();
    const call = (name: string, input: object) =>
      callAction(
        { pool: wb.appPool, ...context() },
        name as never,
        input as never,
      ) as Promise<never>;
    const tree = (await call("kpis.createTree", {
      name: "Unit economics",
    })) as {
      id: string;
    };
    const margin = await makeKpi({ title: "Operating margin" });
    const revenue = await makeKpi({ title: "Revenue" });
    const cost = await makeKpi({ title: "Support cost" });
    const nps = await makeKpi({ title: "Onboarding NPS" });
    for (const [id, parent] of [
      [margin.id, null],
      [revenue.id, margin.id],
      [cost.id, margin.id],
      [nps.id, margin.id],
    ] as const) {
      await call("kpis.update", {
        kpiId: id,
        treeId: tree.id,
        parentKpiId: parent,
      });
    }
    await call("kpis.setFormula", {
      kpiId: margin.id,
      formula: { op: "sub", l: { k: revenue.id }, r: { k: cost.id } },
      on: "2026-08-01",
    });

    const read = (await call("kpis.tree", { treeId: tree.id })) as {
      nodes: { id: string; link: string | null }[];
    };
    const linkOf = (id: string) =>
      read.nodes.find((node) => node.id === id)?.link;
    expect(linkOf(margin.id)).toBeNull();
    expect(linkOf(revenue.id)).toBe("formula");
    expect(linkOf(cost.id)).toBe("formula");
    expect(linkOf(nps.id)).toBe("influence");
  });
});

describe("the named owner and an optional tier (§6.2, P9-T17b-b)", () => {
  const call = async (name: string, input: object) => {
    const wb = await workerDb();
    return callAction(
      { pool: wb.appPool, ...context() },
      name as never,
      input as never,
    ) as Promise<never>;
  };
  const me = async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, OWNER],
    );
    return rows[0]?.id as string;
  };
  type Detail = {
    kpi: {
      namedOwnerId: string | null;
      namedOwnerName: string | null;
      tier: string | null;
    };
  };

  it("names a person, and has no tier unless one is chosen", async () => {
    const owner = await me();
    const kpi = (await call("kpis.create", {
      title: "Net revenue retention",
      frequency: "monthly",
      ownerMemberId: owner,
    })) as { id: string };
    const detail = (await call("kpis.detail", {
      kpiId: kpi.id,
      periods: 12,
    })) as Detail;
    expect(detail.kpi).toMatchObject({
      namedOwnerId: owner,
      namedOwnerName: "Owner",
      tier: null,
    });

    await call("kpis.update", {
      kpiId: kpi.id,
      tier: "outcome",
      ownerMemberId: null,
    });
    const after = (await call("kpis.detail", {
      kpiId: kpi.id,
      periods: 12,
    })) as Detail;
    expect(after.kpi).toMatchObject({ namedOwnerId: null, tier: "outcome" });
  });

  it("owns a member's own KPI by that member, unless another is named", async () => {
    const owner = await me();
    const kpi = (await call("kpis.create", {
      title: "Deals closed",
      frequency: "monthly",
      ownerKind: "member",
      memberId: owner,
    })) as { id: string };
    const detail = (await call("kpis.detail", {
      kpiId: kpi.id,
      periods: 12,
    })) as Detail;
    expect(detail.kpi.namedOwnerId).toBe(owner);
  });

  it("refuses an agent as the owner, because §6.2 says a person", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 and kind = 'agent' limit 1",
      [workspaceId],
    );
    await expect(
      call("kpis.create", {
        title: "Uptime",
        frequency: "monthly",
        ownerMemberId: rows[0]?.id,
      }),
    ).rejects.toThrow(/owned by a person, not an agent/);
  });

  it("accepts a person who has not signed in yet, as an import leaves them", async () => {
    const imported = (await call("people.importMember", {
      name: "Kofi Imported",
      email: "kofi.imported@example.com",
      legacy: { type: "csv", id: "kofi-imported" },
    })) as { memberId: string };
    const kpi = (await call("kpis.create", {
      title: "Tickets closed",
      frequency: "monthly",
      ownerMemberId: imported.memberId,
    })) as { id: string };
    const detail = (await call("kpis.detail", {
      kpiId: kpi.id,
      periods: 12,
    })) as Detail;
    expect(detail.kpi.namedOwnerId).toBe(imported.memberId);
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

describe("the corridor a KPI is read by (completeness review H-17, UAT BUG-011)", () => {
  const detail = async (kpiId: string) => {
    const wb = await workerDb();
    return (
      await callAction({ pool: wb.appPool, ...context() }, "kpis.detail", {
        kpiId,
        periods: 24,
      })
    ).kpi;
  };

  it("is the workspace's kpi.healthyThreshold and kpi.watchThreshold", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "rhythm.update", {
      overrides: { "kpi.healthyThreshold": 85, "kpi.watchThreshold": 60 },
    });
    const kpi = await makeKpi({ title: "Net revenue retention" });
    const read = await detail(kpi.id);
    expect(read.healthyPct).toBe(85);
    expect(read.watchPct).toBe(60);
    expect(read.corridorFollowsWorkspace).toBe(true);
  });

  it("recolours a KPI that follows it when the workspace moves its thresholds", async () => {
    const wb = await workerDb();
    const kpi = await makeKpi({ title: "Net revenue retention" });
    await callAction({ pool: wb.appPool, ...context() }, "kpis.record", {
      kpiId: kpi.id,
      on: "2026-08-11",
      actualValue: 87,
      targetValue: 100,
    });
    expect((await detail(kpi.id)).state).toBe("watch");

    await callAction({ pool: wb.appPool, ...context() }, "rhythm.update", {
      overrides: { "kpi.healthyThreshold": 85 },
    });
    const read = await detail(kpi.id);
    expect(read.healthyPct).toBe(85);
    expect(read.state).toBe("healthy");
  });

  it("leaves a KPI with its own corridor where it was, until it is cleared", async () => {
    const wb = await workerDb();
    const kpi = await makeKpi({ title: "Net revenue retention" });
    await callAction({ pool: wb.appPool, ...context() }, "kpis.update", {
      kpiId: kpi.id,
      healthyPct: 95,
    });
    await callAction({ pool: wb.appPool, ...context() }, "rhythm.update", {
      overrides: { "kpi.healthyThreshold": 85 },
    });
    expect((await detail(kpi.id)).healthyPct).toBe(95);

    await callAction({ pool: wb.appPool, ...context() }, "kpis.update", {
      kpiId: kpi.id,
      healthyPct: null,
    });
    const read = await detail(kpi.id);
    expect(read.healthyPct).toBe(85);
    expect(read.corridorFollowsWorkspace).toBe(true);
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

/**
 * The recovery loop against real rows (P3-T14, METHOD.md §6.5, design §8 and §9).
 *
 * `kpi-recovery-golden.test.ts` proves the rules with no database at all. What
 * is checked here is the half a pure test cannot: that the tree handed to the
 * walk is what the rows say, that the objective is a real goal with a real
 * access context, and that effective health moves when the recovery does.
 */
describe("recovery OKRs", () => {
  const DRIVERS = [
    {
      title: "Activation rate",
      direction: "higher_better",
      value: 41,
      target: 60,
    },
    {
      title: "Onboarding time",
      direction: "lower_better",
      value: 9,
      target: 4,
    },
    { title: "Support cost", direction: "lower_better", value: 18, target: 11 },
  ] as const;

  /** The workspace's owner, who owns every driver here (§6.5 needs one). */
  const ownerMemberId = async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, OWNER],
    );
    return rows[0]?.id as string;
  };

  const makeChild = async (input: {
    parentKpiId: string;
    title: string;
    indicatorType: "leading" | "lagging";
    direction?: "higher_better" | "lower_better";
    targetDefault?: number;
  }) => {
    const wb = await workerDb();
    return callAction({ pool: wb.appPool, ...context() }, "kpis.create", {
      title: input.title,
      indicatorType: input.indicatorType,
      tier: "input",
      aggregate: "sum",
      ownerKind: "workspace",
      ownerMemberId: await ownerMemberId(),
      frequency: "monthly",
      direction: input.direction ?? "higher_better",
      parentKpiId: input.parentKpiId,
      ...(input.targetDefault === undefined
        ? {}
        : { targetDefault: input.targetDefault }),
    });
  };

  const record = async (kpiId: string, actualValue: number) => {
    const wb = await workerDb();
    return callAction({ pool: wb.appPool, ...context() }, "kpis.record", {
      kpiId,
      on: "2026-08-11",
      actualValue,
    });
  };

  const currentCycleId = async (): Promise<string> => {
    const wb = await workerDb();
    const cycle = await callAction(
      { pool: wb.appPool, ...context() },
      "cycles.current",
      { mode: "quarterly" },
    );
    return cycle?.id as string;
  };

  /** An unhealthy root with three leading children, values recorded. */
  const unhealthyTree = async () => {
    const root = await makeKpi({
      title: "Operating margin",
      frequency: "monthly",
      targetDefault: 100,
    });
    // Sixty percent of target, which is below the seventy percent watch floor.
    await record(root.id, 60);
    for (const driver of DRIVERS) {
      const child = await makeChild({
        parentKpiId: root.id,
        title: driver.title,
        indicatorType: "leading",
        direction: driver.direction,
        targetDefault: driver.target,
      });
      await record(child.id, driver.value);
    }
    return root;
  };

  /**
   * The acceptance criterion: "Given an unhealthy KPI, when the owner launches
   * recovery, then a goal exists whose key results are its leading drivers, the
   * KPI reads recovering, and the recovery board shows it with its progress."
   */
  it("drafts a committed objective, the KPI first, then its three drivers (P9-T18a)", async () => {
    const wb = await workerDb();
    const root = await unhealthyTree();
    expect((await record(root.id, 60)).state).toBe("unhealthy");

    const launched = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.launchRecovery",
      { kpiId: root.id, cycleId: await currentCycleId() },
    );

    // The KPI and three drivers: the cap of four counts the KPI.
    expect(launched.keyResultIds).toHaveLength(4);
    // The achievement at launch is the floor every later projection is measured
    // from, so it is stamped rather than recomputed afterwards.
    expect(launched.startedPct).toBe(60);

    const goal = await wb.admin.query<{ title: string; kind: string }>(
      "select title, kind from goals where id = $1",
      [launched.goalId],
    );
    // No number in it, and committed (§6.5).
    expect(goal.rows[0]).toEqual({
      title: "Operating margin back where the business can rely on it",
      kind: "committed",
    });

    const written = await wb.admin.query<{
      title: string;
      baseline_value: string;
      target_value: string;
      direction: string;
      kpi_id: string | null;
    }>(
      "select title, baseline_value, target_value, direction, kpi_id from key_results where goal_id = $1 order by position",
      [launched.goalId],
    );
    // The KPI itself first, from its reading to its healthy boundary: 90% of
    // a target of 100 on the ratio fallback.
    expect(written.rows.map((row) => row.title)).toEqual([
      "Operating margin from 60 to 90",
      "Improve Activation rate from 41 to 60",
      "Improve Onboarding time from 9 to 4",
      "Improve Support cost from 18 to 11",
    ]);
    expect(written.rows[0]?.kpi_id).toBe(root.id);
    expect(written.rows.slice(1).every((row) => row.kpi_id === null)).toBe(
      true,
    );
    expect(written.rows.map((row) => Number(row.baseline_value))).toEqual([
      60, 41, 9, 18,
    ]);
    expect(written.rows.map((row) => Number(row.target_value))).toEqual([
      90, 60, 4, 11,
    ]);
    // A lower-is-better driver becomes a key result that reduces.
    expect(written.rows.map((row) => row.direction)).toEqual([
      "increase",
      "increase",
      "reduce",
      "reduce",
    ]);

    const kpi = await wb.admin.query<{
      state: string;
      recovery_started_pct: string;
    }>("select state, recovery_started_pct from kpis where id = $1", [root.id]);
    // The real band, with the recovery beside it rather than in its place
    // (§6.4, P9-T17b-a).
    expect(kpi.rows[0]?.state).toBe("unhealthy");
    expect(Number(kpi.rows[0]?.recovery_started_pct)).toBe(60);
    const read = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.detail",
      { kpiId: root.id, periods: 12 },
    );
    expect(read.kpi).toMatchObject({ state: "unhealthy", recovering: true });
  });

  it("descends through lagging children to their nearest leading descendants", async () => {
    const wb = await workerDb();
    const root = await makeKpi({ title: "Revenue", targetDefault: 100 });
    await record(root.id, 60);
    const lagging = await makeChild({
      parentKpiId: root.id,
      title: "Pipeline",
      indicatorType: "lagging",
      targetDefault: 50,
    });
    await record(lagging.id, 30);
    const leading = await makeChild({
      parentKpiId: lagging.id,
      title: "Qualified leads",
      indicatorType: "leading",
      targetDefault: 140,
    });
    await record(leading.id, 80);

    const draft = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.recoveryDraft",
      { kpiId: root.id },
    );
    expect(draft?.keyResults.map((keyResult) => keyResult.title)).toEqual([
      "Revenue from 60 to 90",
      "Improve Qualified leads from 80 to 140",
    ]);
  });

  it("drafts a KPI with no leading driver as the KPI alone, not a placeholder", async () => {
    const wb = await workerDb();
    const root = await makeKpi({ title: "Revenue", targetDefault: 100 });
    await record(root.id, 60);

    const draft = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.recoveryDraft",
      { kpiId: root.id },
    );
    // "define the first leading driver to move" failed KR-2; the KPI itself
    // does not (METHOD-REVIEW §3.6).
    expect(draft?.keyResults).toHaveLength(1);
    expect(draft?.keyResults[0]?.title).toBe("Revenue from 60 to 90");
    expect(draft?.keyResults[0]?.sourceKpiId).toBe(root.id);
  });

  it("refuses a second recovery while the first is open", async () => {
    const wb = await workerDb();
    const root = await unhealthyTree();
    const cycleId = await currentCycleId();
    await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.launchRecovery",
      { kpiId: root.id, cycleId },
    );
    await expect(
      callAction({ pool: wb.appPool, ...context() }, "kpis.launchRecovery", {
        kpiId: root.id,
        cycleId,
      }),
    ).rejects.toThrow(/already has a recovery/i);
  });

  it("raises effective health as the recovery progresses while the real number lags", async () => {
    const wb = await workerDb();
    const root = await unhealthyTree();
    const launched = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.launchRecovery",
      { kpiId: root.id, cycleId: await currentCycleId() },
    );

    const before = await wb.admin.query<{
      achievement_pct: string;
      effective_pct: string;
    }>("select achievement_pct, effective_pct from kpis where id = $1", [
      root.id,
    ]);
    const startedAt = Number(before.rows[0]?.effective_pct);
    expect(startedAt).toBeGreaterThanOrEqual(60);

    // Move the first driver all the way to its target. The KPI's own key
    // result, first since P9-T18a, reads the KPI and moves only with it.
    const firstDriver = launched.keyResultIds[1] as string;
    await callAction({ pool: wb.appPool, ...context() }, "goals.recordValue", {
      id: firstDriver,
      value: 60,
    });

    const after = await wb.admin.query<{
      achievement_pct: string;
      effective_pct: string;
      state: string;
    }>("select achievement_pct, effective_pct, state from kpis where id = $1", [
      root.id,
    ]);
    // The real number has not moved: nobody recorded a new margin.
    expect(Number(after.rows[0]?.achievement_pct)).toBe(60);
    // The projection has risen with the recovery's own progress.
    expect(Number(after.rows[0]?.effective_pct)).toBeGreaterThan(startedAt);
    // And the state still says where the metric really is: the projection
    // never stands in for the reading (§6.4, NW-Q3-05).
    expect(after.rows[0]?.state).toBe("unhealthy");
  });

  it("reads the recovery's own key result from the reading to the boundary, not the KPI's achievement (§6.5)", async () => {
    const wb = await workerDb();
    const root = await unhealthyTree();
    const launched = await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.launchRecovery",
      { kpiId: root.id, cycleId: await currentCycleId() },
    );
    const own = launched.keyResultIds[0] as string;
    const progressOf = async () =>
      Number(
        (
          await wb.admin.query<{ progress_pct: string }>(
            "select progress_pct from key_results where id = $1",
            [own],
          )
        ).rows[0]?.progress_pct,
      );
    // From 60 to 90: nothing recovered on the day it starts, where the KPI's
    // achievement against its target of 100 reads 60.
    expect(await progressOf()).toBe(0);
    // Halfway back, then all the way to the boundary.
    await record(root.id, 75);
    expect(await progressOf()).toBe(50);
    await record(root.id, 90);
    expect(await progressOf()).toBe(100);
  });

  it("proposes closing the recovery exactly once, on the real number", async () => {
    const wb = await workerDb();
    const root = await unhealthyTree();
    await callAction(
      { pool: wb.appPool, ...context() },
      "kpis.launchRecovery",
      { kpiId: root.id, cycleId: await currentCycleId() },
    );

    // Back inside the healthy corridor on the real measurement.
    await record(root.id, 92);
    const first = await wb.admin.query<{ recovery_close_proposed_at: string }>(
      "select recovery_close_proposed_at from kpis where id = $1",
      [root.id],
    );
    const stamp = first.rows[0]?.recovery_close_proposed_at;
    expect(stamp).not.toBeNull();

    // A second recompute must not propose again.
    await record(root.id, 95);
    const second = await wb.admin.query<{ recovery_close_proposed_at: string }>(
      "select recovery_close_proposed_at from kpis where id = $1",
      [root.id],
    );
    expect(second.rows[0]?.recovery_close_proposed_at).toEqual(stamp);
  });

  /** A review that scores the recovery, decides it, and closes its cycle. */
  const closeWith = async (
    cycleId: string,
    goalId: string,
    decision: "keep" | "achieved",
  ) => {
    const wb = await workerDb();
    const ctx = { pool: wb.appPool, ...context() };
    const [space] = await callAction(ctx, "spaces.list", {});
    const { rows } = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 and user_id = $2",
      [workspaceId, OWNER],
    );
    const session = await callAction(ctx, "sessions.create", {
      spaceId: space?.id as string,
      cycleId,
      kind: "quarterly",
      title: "Quarterly review",
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
      facilitatorId: rows[0]?.id as string,
    });
    await callAction(ctx, "sessions.open", { id: session.id });
    const goal = await callAction(ctx, "goals.read", { id: goalId });
    for (const keyResult of goal.keyResults) {
      await callAction(ctx, "sessions.scoreKeyResult", {
        sessionId: session.id,
        keyResultId: keyResult.id,
        score: 0.5,
        reason: "Half way.",
      });
    }
    await callAction(ctx, "sessions.addRetroNote", {
      sessionId: session.id,
      columnKey: "worked",
      text: "The recovery read the real number.",
      anonymous: false,
    });
    await callAction(ctx, "sessions.decideObjective", {
      sessionId: session.id,
      goalId,
      decision,
      why: "The room decided it.",
    });
    await callAction(ctx, "sessions.close", { id: session.id });
    await callAction(ctx, "cycles.close", { cycleId });
  };

  it("follows a kept recovery into the next cycle's draft (P9-T22c-e-b)", async () => {
    const wb = await workerDb();
    const ctx = { pool: wb.appPool, ...context() };
    const root = await unhealthyTree();
    const cycleId = await currentCycleId();
    const launched = await callAction(ctx, "kpis.launchRecovery", {
      kpiId: root.id,
      cycleId,
    });
    await callAction(ctx, "cycles.create", {
      on: new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10),
      mode: "quarterly",
      firstCycle: false,
    });
    await closeWith(cycleId, launched.goalId, "keep");

    const { rows } = await wb.admin.query<{ linked: string; draft: string }>(
      `select i.recovery_goal_id as linked, g.id as draft from kpis i
         join goals g on g.carried_from_goal_id = $2
        where i.id = $1`,
      [root.id, launched.goalId],
    );
    // The KPI's link is on the draft now being run, not last cycle's.
    expect(rows[0]?.linked).toBe(rows[0]?.draft);
  });

  it("ends a recovery the room closes as achieved, so the KPI leaves the board (NW-Q4-11)", async () => {
    const wb = await workerDb();
    const ctx = { pool: wb.appPool, ...context() };
    const root = await unhealthyTree();
    const cycleId = await currentCycleId();
    const launched = await callAction(ctx, "kpis.launchRecovery", {
      kpiId: root.id,
      cycleId,
    });
    await closeWith(cycleId, launched.goalId, "achieved");

    const { rows } = await wb.admin.query<{
      closed: boolean;
      outcome: string;
    }>(
      "select closed_at is not null as closed, success_status as outcome from goals where id = $1",
      [launched.goalId],
    );
    expect(rows[0]).toEqual({ closed: true, outcome: "achieved" });
    const board = await callAction(ctx, "kpis.recoveryBoard", {});
    const card = board.cards.find((one) => one.kpiId === root.id);
    expect(card).toMatchObject({
      recovering: false,
      recovery: { goalId: launched.goalId, closed: true },
    });
  });
});
