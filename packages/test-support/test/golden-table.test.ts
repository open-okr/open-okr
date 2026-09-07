import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  cellBoolean,
  cellJson,
  cellList,
  cellNumber,
  loadGoldenTable,
  loadGoldenTables,
  parseGoldenTables,
} from "../src/golden-table.ts";

/**
 * The P3-T00 design gate's matrices, and the shape each one must keep.
 *
 * This manifest is the guard the Phase 1 exit checklist asked for: a gate that
 * cannot find its input must fail rather than pass. Without it, renaming a
 * table anchor would make every engine suite silently assert nothing, which is
 * exactly the failure mode the soft-delete lint and the audit verifier both hit
 * in Phase 1.
 */
const MANIFEST: Record<
  string,
  Record<string, { columns: string[]; minRows: number }>
> = {
  "p3-t00-scoring-and-health-engine.md": {
    "scoring.kr-progress": {
      columns: [
        "case",
        "direction",
        "baseline",
        "target",
        "current",
        "expected_pct",
      ],
      minRows: 30,
    },
    "scoring.kr-progress-kpi": {
      columns: ["case", "achievement_pct", "expected_pct"],
      minRows: 5,
    },
    "scoring.goal-progress": {
      columns: ["case", "tree", "expected_pct"],
      minRows: 12,
    },
    "scoring.cascade": {
      columns: ["case", "nodes", "expected", "diagnostics"],
      minRows: 4,
    },
    "scoring.health": {
      columns: [
        "case",
        "closed",
        "success_status",
        "latest_status",
        "days_past_due",
        "grace_days",
        "expected",
      ],
      minRows: 13,
    },
    "scoring.rag": {
      columns: ["case", "progress_pct", "pass_pct", "fail_pct", "expected"],
      minRows: 8,
    },
    "scoring.forecast": {
      columns: [
        "case",
        "points",
        "horizon_day",
        "direction",
        "baseline",
        "target",
        "expected_projected",
        "expected_trending",
      ],
      minRows: 12,
    },
    "scoring.score-bands": {
      columns: ["case", "score", "expected_band", "expected_annotation"],
      minRows: 13,
    },
    "scoring.portfolio": {
      columns: ["case", "average", "expected"],
      minRows: 9,
    },
    "scoring.confidence-bands": {
      columns: ["case", "confidence", "expected_band", "escalates_same_day"],
      minRows: 8,
    },
    "scoring.draft-confidence": {
      columns: ["case", "average", "expected"],
      minRows: 12,
    },
  },
  "p3-t00-cadence-engine.md": {
    "cadence.advance": {
      columns: ["case", "frequency", "anchor", "current_due", "expected_next"],
      minRows: 15,
    },
    "cadence.first-due": {
      columns: ["case", "frequency", "anchor", "from_date", "expected_first"],
      minRows: 10,
    },
    "cadence.after-publication": {
      columns: [
        "case",
        "frequency",
        "anchor",
        "current_due",
        "published_on",
        "tolerance_days",
        "expected_next",
        "expected_missed",
      ],
      minRows: 13,
    },
    "cadence.staleness": {
      columns: ["case", "due_date", "today", "grace_days", "expected_outdated"],
      minRows: 9,
    },
    "cadence.instant": {
      columns: ["case", "timezone", "due_date", "expected_instant"],
      minRows: 12,
    },
    "cadence.escalation": {
      columns: [
        "case",
        "days_past_due",
        "grace_days",
        "expected_step",
        "expected_targets",
      ],
      minRows: 14,
    },
    "cadence.acknowledgement": {
      columns: [
        "case",
        "days_since_publication",
        "expected_step",
        "expected_targets",
      ],
      minRows: 5,
    },
    "cadence.blocker": {
      columns: [
        "case",
        "hours_since_opened",
        "expected_step",
        "expected_targets",
      ],
      minRows: 7,
    },
  },
  "p3-t00-kpi-engine.md": {
    "kpi.period": {
      columns: ["case", "frequency", "date", "expected_period_start"],
      minRows: 12,
    },
    "kpi.achievement": {
      columns: [
        "case",
        "direction",
        "actual",
        "target",
        "expected_pct",
        "diagnostic",
      ],
      minRows: 19,
    },
    "kpi.state": {
      columns: [
        "case",
        "achievement_pct",
        "recovery",
        "healthy_pct",
        "watch_pct",
        "expected",
      ],
      minRows: 14,
    },
    "kpi.effective": {
      columns: [
        "case",
        "achievement_pct",
        "start_pct",
        "recovery_progress",
        "healthy_pct",
        "expected_effective",
        "diagnostic",
      ],
      minRows: 7,
    },
    "kpi.formula": {
      columns: ["case", "formula", "sources", "expected", "diagnostic"],
      minRows: 14,
    },
    "kpi.aggregate": {
      columns: [
        "case",
        "source_frequency",
        "target_frequency",
        "aggregate",
        "records",
        "target_period",
        "expected",
      ],
      minRows: 14,
    },
    "kpi.cascade": {
      columns: [
        "case",
        "dependencies",
        "changed",
        "expected_order",
        "expected_rejected",
      ],
      minRows: 8,
    },
    "kpi.recovery-draft": { columns: ["case", "tree", "expected"], minRows: 6 },
    "kpi.recovery-proposal": {
      columns: ["case", "period_states", "expected_propose"],
      minRows: 8,
    },
    "kpi.recovery-close": {
      columns: [
        "case",
        "achievement_pct",
        "recovery",
        "already_proposed",
        "expected_propose_close",
      ],
      minRows: 6,
    },
  },
  "p3-t00-alignment-engine.md": {
    "alignment.penalties": {
      columns: ["finding", "penalty", "rule_key", "severity", "fires"],
      minRows: 5,
    },
    "alignment.score": {
      columns: [
        "case",
        "scope",
        "graph",
        "expected_score",
        "expected_findings",
      ],
      minRows: 16,
    },
    "alignment.health": {
      columns: ["case", "score", "threshold", "expected"],
      minRows: 6,
    },
  },
};

function designPath(file: string): string {
  return fileURLToPath(
    new URL(`../../../docs/design/${file}`, import.meta.url),
  );
}

describe("the P3-T00 golden matrices", () => {
  for (const [file, expected] of Object.entries(MANIFEST)) {
    describe(file, () => {
      it("holds exactly the matrices the manifest names", () => {
        const found = [...loadGoldenTables(designPath(file)).keys()].sort();
        expect(found).toEqual(Object.keys(expected).sort());
      });

      for (const [id, shape] of Object.entries(expected)) {
        it(`${id} keeps its columns and its cases`, () => {
          const table = loadGoldenTable(designPath(file), id);
          expect(table.columns).toEqual(shape.columns);
          expect(table.rows.length).toBeGreaterThanOrEqual(shape.minRows);
          for (const row of table.rows) {
            expect(row.case ?? row.finding).toBeTruthy();
          }
        });
      }
    });
  }

  it("gives every case a distinct name inside its matrix", () => {
    for (const file of Object.keys(MANIFEST)) {
      for (const table of loadGoldenTables(designPath(file)).values()) {
        const names = table.rows.map((row) => row.case ?? row.finding ?? "");
        expect(new Set(names).size, `${table.id} has a duplicate case`).toBe(
          names.length,
        );
      }
    }
  });

  it("parses every JSON cell in the matrices that carry one", () => {
    const jsonColumns = new Set([
      "tree",
      "nodes",
      "expected",
      "graph",
      "formula",
      "sources",
      "records",
      "dependencies",
      "points",
    ]);

    for (const file of Object.keys(MANIFEST)) {
      for (const table of loadGoldenTables(designPath(file)).values()) {
        for (const column of table.columns) {
          if (!jsonColumns.has(column)) {
            continue;
          }
          // `expected` is a plain string in some matrices and JSON in others,
          // so only the ones that look structured are parsed.
          for (const row of table.rows) {
            const raw = row[column] ?? "";
            if (!raw.startsWith("{") && !raw.startsWith("[")) {
              continue;
            }
            expect(
              () => cellJson(row, column),
              `${table.id} column ${column}: ${raw}`,
            ).not.toThrow();
          }
        }
      }
    }
  });
});

describe("the golden-table reader", () => {
  const sample = [
    "prose above",
    "",
    "<!-- golden: sample.one -->",
    "",
    "| case | value | note |",
    "|---|---|---|",
    "| a case | 12 | |",
    "| another | | something |",
    "",
    "prose between",
    "",
    "<!-- golden: sample.two -->",
    "| case | flag | list |",
    "|---|---|---|",
    "| yes case | yes | a,b |",
    "| no case | no | |",
  ].join("\n");

  it("reads two tables separated by prose", () => {
    const tables = parseGoldenTables(sample);
    expect([...tables.keys()]).toEqual(["sample.one", "sample.two"]);
    expect(tables.get("sample.one")?.rows).toHaveLength(2);
  });

  it("keeps an empty cell empty rather than dropping the column", () => {
    const rows = parseGoldenTables(sample).get("sample.one")?.rows ?? [];
    expect(rows[1]).toEqual({ case: "another", value: "", note: "something" });
  });

  it("reads a blank numeric cell as no value, never as zero", () => {
    const rows = parseGoldenTables(sample).get("sample.one")?.rows ?? [];
    expect(cellNumber(rows[0] as Record<string, string>, "value")).toBe(12);
    expect(cellNumber(rows[1] as Record<string, string>, "value")).toBeNull();
  });

  it("reads yes and no as booleans", () => {
    const rows = parseGoldenTables(sample).get("sample.two")?.rows ?? [];
    expect(cellBoolean(rows[0] as Record<string, string>, "flag")).toBe(true);
    expect(cellBoolean(rows[1] as Record<string, string>, "flag")).toBe(false);
  });

  it("reads a comma-separated cell as a list, and a blank one as empty", () => {
    const rows = parseGoldenTables(sample).get("sample.two")?.rows ?? [];
    expect(cellList(rows[0] as Record<string, string>, "list")).toEqual([
      "a",
      "b",
    ]);
    expect(cellList(rows[1] as Record<string, string>, "list")).toEqual([]);
  });

  it("refuses an anchor with no table under it", () => {
    expect(() =>
      parseGoldenTables("<!-- golden: nothing.here -->\n\njust prose\n"),
    ).toThrow(/has no table under its anchor/);
  });

  it("refuses a table with a header and no rows", () => {
    expect(() =>
      parseGoldenTables("<!-- golden: empty.one -->\n| a | b |\n|---|---|\n"),
    ).toThrow(/header and no rows/);
  });

  it("refuses a row whose cell count disagrees with the header", () => {
    expect(() =>
      parseGoldenTables(
        "<!-- golden: ragged.one -->\n| a | b |\n|---|---|\n| 1 |\n",
      ),
    ).toThrow(/cells against 2 columns/);
  });

  it("refuses a duplicate anchor", () => {
    const twice = [
      "<!-- golden: same.id -->",
      "| a |",
      "|---|",
      "| 1 |",
      "",
      "<!-- golden: same.id -->",
      "| a |",
      "|---|",
      "| 2 |",
    ].join("\n");
    expect(() => parseGoldenTables(twice)).toThrow(/declared twice/);
  });

  it("names the tables it did find when the wanted one is absent", () => {
    const path = designPath("p3-t00-alignment-engine.md");
    expect(() => loadGoldenTable(path, "alignment.nope")).toThrow(
      /alignment\.health, alignment\.penalties, alignment\.score/,
    );
  });
});
