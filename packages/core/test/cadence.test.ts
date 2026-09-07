import {
  acknowledgementEscalation,
  blockerEscalation,
  canonThresholds,
  escalation,
} from "@openokr/method";
import type { GoldenRow } from "@openokr/test-support/golden-table";
import {
  cellNumber,
  loadGoldenTables,
} from "@openokr/test-support/golden-table";
import { describe, expect, it } from "vitest";
import { cadence, dueInstant } from "../src/cadence/engine.ts";
import { parseLocalDate } from "../src/cycles/generation.ts";

/**
 * The cadence engine against its own golden masters (P3-T06).
 *
 * Read out of `docs/design/p3-t00-cadence-engine.md` at run time, the same way the
 * scoring matrices are. The daylight-saving table is the one that matters most:
 * two Berlin Mondays a week apart store instants 167 hours apart, and arithmetic
 * done on instants would have produced a Sunday deadline for half the year.
 *
 * No database here, deliberately. This file sits in `packages/core` because the
 * engine does, and it needs no harness at all.
 */

const thresholds = canonThresholds();

const tables = loadGoldenTables(
  new URL(
    "../../../docs/design/p3-t00-cadence-engine.md",
    import.meta.url,
  ).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);

const table = (id: string) => {
  const found = tables.get(id);
  if (!found) {
    throw new Error(
      `Golden table "${id}" is not in the design document. A matrix that ` +
        "cannot be found must break the build, not assert nothing.",
    );
  }
  return found;
};

const num = (row: Record<string, string>, column: string): number => {
  const value = cellNumber(row, column);
  if (value === null) {
    throw new Error(`Column "${column}" is blank and this row needs a number.`);
  }
  return value;
};

/** The anchor cell is blank for `daily`, where it is unused. */
const anchorOf = (row: Record<string, string>): number =>
  cellNumber(row, "anchor") ?? 1;

const frequencyOf = (row: Record<string, string>) =>
  row.frequency as "daily" | "weekly" | "biweekly" | "monthly" | "quarterly";

describe("advancing one period", () => {
  for (const row of table("cadence.advance").rows) {
    it(`${row.case}`, () => {
      expect(
        cadence.advance(
          row.current_due as string,
          frequencyOf(row),
          anchorOf(row),
        ),
      ).toBe(row.expected_next);
    });
  }
});

describe("the first due date", () => {
  for (const row of table("cadence.first-due").rows) {
    it(`${row.case}`, () => {
      expect(
        cadence.firstDue(
          row.from_date as string,
          frequencyOf(row),
          anchorOf(row),
        ),
      ).toBe(row.expected_first);
    });
  }
});

describe("advancing after a publication", () => {
  for (const row of table("cadence.after-publication").rows) {
    it(`${row.case}`, () => {
      const result = cadence.nextAfterPublication(
        row.current_due as string,
        row.published_on as string,
        frequencyOf(row),
        anchorOf(row),
        num(row, "tolerance_days"),
      );
      expect(result.next).toBe(row.expected_next);
      expect(result.missedPeriod).toBe(row.expected_missed?.trim() === "yes");
    });
  }
});

describe("staleness", () => {
  for (const row of table("cadence.staleness").rows) {
    it(`${row.case}`, () => {
      expect(
        cadence.isOutdated(
          row.due_date as string,
          row.today as string,
          num(row, "grace_days"),
        ),
      ).toBe(row.expected_outdated?.trim() === "yes");
    });
  }
});

describe("the due instant", () => {
  for (const row of table("cadence.instant").rows) {
    it(`${row.case}`, () => {
      expect(
        dueInstant(
          parseLocalDate(row.due_date as string),
          row.timezone as string,
        ).toISOString(),
      ).toBe(row.expected_instant);
    });
  }

  it("keeps the local deadline at 23:59 across a shift", () => {
    // The claim the Berlin pair exists to make: 167 hours apart in absolute
    // terms, both reading 23:59 locally.
    const before = dueInstant(parseLocalDate("2026-03-23"), "Europe/Berlin");
    const after = dueInstant(parseLocalDate("2026-03-30"), "Europe/Berlin");
    expect((after.getTime() - before.getTime()) / 3_600_000).toBe(167);

    const local = (instant: Date) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Berlin",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(instant);
    expect(local(before)).toBe("23:59");
    expect(local(after)).toBe("23:59");
  });
});

/** The three ladders read the same way, so they are asserted the same way. */
const ladderCase = (
  row: GoldenRow,
  result: { step: number | null; targets: readonly string[] },
) => {
  expect(result.step).toBe(cellNumber(row, "expected_step"));
  const expected = (row.expected_targets ?? "").trim();
  expect(result.targets).toEqual(expected === "" ? [] : expected.split(","));
};

describe("the acknowledgement ladder", () => {
  for (const row of table("cadence.acknowledgement").rows) {
    it(`${row.case}`, () => {
      ladderCase(
        row,
        acknowledgementEscalation(
          num(row, "days_since_publication"),
          thresholds,
        ),
      );
    });
  }
});

describe("the blocker ladder", () => {
  for (const row of table("cadence.blocker").rows) {
    it(`${row.case}`, () => {
      ladderCase(
        row,
        blockerEscalation(num(row, "hours_since_opened"), thresholds),
      );
    });
  }
});

describe("the escalation ladder", () => {
  for (const row of table("cadence.escalation").rows) {
    it(`${row.case}`, () => {
      const result = escalation(
        num(row, "days_past_due"),
        num(row, "grace_days"),
        thresholds,
      );
      const expectedStep = cellNumber(row, "expected_step");
      expect(result.step).toBe(expectedStep);
      const expectedTargets = (row.expected_targets ?? "").trim();
      expect(result.targets).toEqual(
        expectedTargets === "" ? [] : expectedTargets.split(","),
      );
    });
  }
});
