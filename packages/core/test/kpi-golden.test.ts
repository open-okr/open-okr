import {
  type KpiCorridor,
  type KpiDirection,
  type KpiFrequency,
  kpiAchievement,
  kpiState,
  normalisePeriod,
  type RecoveryLink,
} from "@openokr/method";
import {
  cellNumber,
  loadGoldenTables,
} from "@openokr/test-support/golden-table";
import { describe, expect, it } from "vitest";

/**
 * The KPI engine's first three sections against their golden masters (P3-T12).
 *
 * In `packages/core` rather than `packages/method`, for the reason recorded at
 * P3-T05: the golden-table reader lives in `packages/test-support`, which depends
 * on core, so a method test using it would make the workspace graph circular.
 *
 * §4 onward of the design document (effective health, the formula grammar, the
 * cascade, the recovery drafter) belong to P3-T13 and P3-T14, and their matrices
 * are deliberately not read here: a suite that loaded them would pass by
 * asserting nothing.
 */

const tables = loadGoldenTables(
  new URL(
    "../../../docs/design/p3-t00-kpi-engine.md",
    import.meta.url,
  ).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);

const table = (id: string) => {
  const found = tables.get(id);
  if (!found) {
    throw new Error(
      `Golden table "${id}" is not in the design document. The suite asserts ` +
        "nothing without it, so this is a build failure rather than a skip.",
    );
  }
  return found;
};

describe("period normalisation", () => {
  for (const row of table("kpi.period").rows) {
    it(row.case as string, () => {
      expect(
        normalisePeriod(row.frequency as KpiFrequency, row.date as string),
      ).toBe(row.expected_period_start);
    });
  }

  it("is idempotent: normalising a period start returns itself", () => {
    // The write path normalises before the unique index sees the value, so a
    // second pass over an already-normalised date must not move it. A weekly
    // rule that stepped back a week on a Monday would silently merge two periods.
    for (const row of table("kpi.period").rows) {
      const once = normalisePeriod(
        row.frequency as KpiFrequency,
        row.date as string,
      );
      expect(normalisePeriod(row.frequency as KpiFrequency, once)).toBe(once);
    }
  });
});

describe("achievement", () => {
  for (const row of table("kpi.achievement").rows) {
    it(row.case as string, () => {
      const result = kpiAchievement(
        row.direction as KpiDirection,
        cellNumber(row, "actual"),
        cellNumber(row, "target"),
      );
      expect(result.pct).toBe(cellNumber(row, "expected_pct"));
      expect(result.diagnostic).toBe(
        row.diagnostic === "" ? null : row.diagnostic,
      );
    });
  }
});

describe("the corridor state", () => {
  for (const row of table("kpi.state").rows) {
    it(row.case as string, () => {
      const healthyPct = cellNumber(row, "healthy_pct");
      const watchPct = cellNumber(row, "watch_pct");
      if (healthyPct === null || watchPct === null) {
        throw new Error("A state row needs both thresholds.");
      }
      const corridor: KpiCorridor = { healthyPct, watchPct };
      expect(
        kpiState(
          cellNumber(row, "achievement_pct"),
          row.recovery as RecoveryLink,
          corridor,
        ),
      ).toBe(row.expected);
    });
  }
});
