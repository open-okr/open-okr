import {
  draftRecovery,
  type KpiState,
  kpiEffectiveHealth,
  type RecoveryLink,
  type RecoveryTreeInput,
  shouldProposeRecovery,
  shouldProposeRecoveryClose,
} from "@openokr/method";
import {
  cellJson,
  cellList,
  cellNumber,
  type GoldenRow,
  loadGoldenTables,
} from "@openokr/test-support/golden-table";
import { describe, expect, it } from "vitest";

/**
 * The recovery half of the KPI engine against its golden masters (P3-T14):
 * effective health while recovering, the recovery drafter, and the two
 * proposal predicates.
 *
 * In `packages/core` rather than `packages/method` for the reason recorded at
 * P3-T05 and repeated at P3-T12: the golden-table reader lives in
 * `packages/test-support`, which depends on core, so a method test using it
 * would make the workspace graph circular.
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

const number = (row: GoldenRow, column: string): number => {
  const value = cellNumber(row, column);
  if (value === null) {
    throw new Error(`Column "${column}" needs a number in every row.`);
  }
  return value;
};

describe("effective health while recovering", () => {
  for (const row of table("kpi.effective").rows) {
    it(row.case as string, () => {
      const result = kpiEffectiveHealth({
        achievementPct: cellNumber(row, "achievement_pct"),
        startPct: number(row, "start_pct"),
        recoveryProgress: number(row, "recovery_progress"),
        healthyPct: number(row, "healthy_pct"),
      });
      expect(result.pct).toBe(number(row, "expected_effective"));
      expect(result.diagnostic).toBe(
        row.diagnostic === "" ? null : row.diagnostic,
      );
    });
  }
});

interface ExpectedKeyResult {
  readonly title: string;
  readonly direction: string;
  readonly baseline: number;
  readonly target: number;
  readonly owner?: string;
}

describe("the recovery drafter", () => {
  for (const row of table("kpi.recovery-draft").rows) {
    it(row.case as string, () => {
      const tree = cellJson<RecoveryTreeInput>(row, "tree");
      const expected = cellJson<{
        objective: string;
        keyResults: readonly ExpectedKeyResult[];
      }>(row, "expected");
      if (!tree || !expected) {
        throw new Error("A draft row needs both a tree and an expectation.");
      }

      // Four, the §11 `kpi.recoveryKeyResultCap` default. Passed in rather than
      // read, because `packages/method` never reaches for a stored value.
      const draft = draftRecovery(tree, 4);

      expect(draft.objective).toBe(expected.objective);
      expect(draft.keyResults).toHaveLength(expected.keyResults.length);
      draft.keyResults.forEach((actual, index) => {
        const want = expected.keyResults[index];
        if (!want) {
          throw new Error("More key results than the golden row expects.");
        }
        expect(actual.title).toBe(want.title);
        expect(actual.direction).toBe(want.direction);
        expect(actual.baseline).toBe(want.baseline);
        expect(actual.target).toBe(want.target);
        expect(actual.ownerMemberId ?? null).toBe(want.owner ?? null);
      });
    });
  }
});

describe("the recovery proposal", () => {
  for (const row of table("kpi.recovery-proposal").rows) {
    it(row.case as string, () => {
      const states = cellList(row, "period_states") as KpiState[];
      // Two, the §11 `kpi.recoveryProposalDelayPeriods` default.
      expect(shouldProposeRecovery(states, 2)).toBe(
        row.expected_propose === "yes",
      );
    });
  }
});

describe("the closure proposal", () => {
  for (const row of table("kpi.recovery-close").rows) {
    it(row.case as string, () => {
      expect(
        shouldProposeRecoveryClose({
          achievementPct: cellNumber(row, "achievement_pct"),
          recovery: row.recovery as RecoveryLink,
          alreadyProposed: row.already_proposed === "yes",
          healthyPct: 90,
        }),
      ).toBe(row.expected_propose_close === "yes");
    });
  }
});
