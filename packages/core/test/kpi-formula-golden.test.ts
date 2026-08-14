import {
  aggregateForPeriod,
  cascadeOrder,
  type DependencyEdge,
  evaluateFormula,
  type FormulaNode,
  type KpiAggregate,
  type KpiFrequency,
  type SourceRecord,
  validateFormula,
} from "@openokr/method";
import {
  cellJson,
  cellList,
  cellNumber,
  loadGoldenTables,
} from "@openokr/test-support/golden-table";
import { describe, expect, it } from "vitest";

/**
 * The formula engine, cross-frequency aggregation and the cascade order against
 * their golden masters (P3-T13, design §5 to §7).
 *
 * In `packages/core` for the reason recorded at P3-T05: the golden-table reader
 * lives in `packages/test-support`, which depends on core, so a method test using
 * it would make the workspace graph circular.
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

describe("the formula grammar", () => {
  for (const row of table("kpi.formula").rows) {
    it(row.case as string, () => {
      const formula = cellJson<FormulaNode>(row, "formula");
      const sources = cellJson<Record<string, number | null>>(row, "sources");
      if (!formula) {
        throw new Error("A formula row needs its tree.");
      }
      // Every stored tree goes through the schema first, so a matrix row that
      // was not a valid formula would fail here rather than evaluating anyway.
      expect(validateFormula(formula).ok).toBe(true);

      const result = evaluateFormula(formula, sources ?? {});
      expect(result.value).toBe(cellNumber(row, "expected"));
      expect(result.diagnostic).toBe(
        row.diagnostic === "" ? null : row.diagnostic,
      );
    });
  }

  it("names which reference was missing, not just that one was", () => {
    const result = evaluateFormula(
      { op: "add", l: { k: "a" }, r: { k: "b" } },
      { a: 10, b: null },
    );
    // A diagnostic that said only "a source is missing" would send somebody
    // hunting through a tree of thirty references.
    expect(result.missing).toBe("b");
  });
});

describe("the formula's safety bounds", () => {
  it("refuses something that is not a formula at all", () => {
    for (const value of [null, 42, "a+b", {}, { op: "pow", l: 1, r: 2 }]) {
      expect(validateFormula(value).problem).toBe("not_a_formula");
    }
  });

  it("counts distinct references, in first-seen order", () => {
    const shape = validateFormula({
      op: "add",
      l: { k: "b" },
      r: { op: "mul", l: { k: "a" }, r: { k: "b" } },
    });
    expect(shape.references).toEqual(["b", "a"]);
  });

  it("refuses a tree deeper than the bound", () => {
    // 33 levels: one more than the limit, built as a left-leaning chain.
    let node: FormulaNode = { n: 1 };
    for (let index = 0; index < 32; index += 1) {
      node = { op: "add", l: node, r: { n: 1 } };
    }
    expect(validateFormula(node).problem).toBe("too_deep");
  });

  it("survives a tree deeper than the call stack rather than throwing", () => {
    let node: FormulaNode = { n: 1 };
    for (let index = 0; index < 20_000; index += 1) {
      node = { neg: node };
    }
    // The measurement is iterative on purpose. A recursive walk would overflow
    // here, and an imported formula must not be able to take the process down.
    expect(() => validateFormula(node)).not.toThrow();
    expect(validateFormula(node).problem).toBe("too_deep");
  });
});

describe("cross-frequency aggregation", () => {
  for (const row of table("kpi.aggregate").rows) {
    it(row.case as string, () => {
      const raw = cellJson<[string, number][]>(row, "records") ?? [];
      const records: SourceRecord[] = raw.map(([periodStart, value]) => ({
        periodStart,
        value,
      }));
      expect(
        aggregateForPeriod(
          row.source_frequency as KpiFrequency,
          row.target_frequency as KpiFrequency,
          row.aggregate as KpiAggregate,
          records,
          row.target_period as string,
        ),
      ).toBe(cellNumber(row, "expected"));
    });
  }
});

describe("the dependency cascade", () => {
  for (const row of table("kpi.cascade").rows) {
    it(row.case as string, () => {
      const pairs = cellJson<[string, string][]>(row, "dependencies") ?? [];
      const edges: DependencyEdge[] = pairs.map(([dependent, dependsOn]) => ({
        dependent,
        dependsOn,
      }));
      const result = cascadeOrder(edges, row.changed as string);
      expect(result.rejected).toBe(row.expected_rejected === "yes");
      expect([...result.order]).toEqual(cellList(row, "expected_order"));
    });
  }

  it("is idempotent: replaying the cascade gives the same order", () => {
    const edges: DependencyEdge[] = [
      { dependent: "b", dependsOn: "a" },
      { dependent: "c", dependsOn: "a" },
      { dependent: "d", dependsOn: "b" },
      { dependent: "d", dependsOn: "c" },
    ];
    const once = cascadeOrder(edges, "a").order;
    expect([...cascadeOrder(edges, "a").order]).toEqual([...once]);
  });

  it("recomputes a diamond's join after both branches, never before", () => {
    const order = cascadeOrder(
      [
        { dependent: "b", dependsOn: "a" },
        { dependent: "c", dependsOn: "a" },
        { dependent: "d", dependsOn: "b" },
        { dependent: "d", dependsOn: "c" },
      ],
      "a",
    ).order;
    // Recomputing the join early would fold a stale branch into the answer.
    expect(order.indexOf("d")).toBeGreaterThan(order.indexOf("b"));
    expect(order.indexOf("d")).toBeGreaterThan(order.indexOf("c"));
    expect(order.filter((entry) => entry === "d")).toHaveLength(1);
  });
});
