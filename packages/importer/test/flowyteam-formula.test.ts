/**
 * FlowyTeam's calculated-KPI tokens into the expression tree (P6-T03d).
 *
 * Pure, and worth its own file: a parser is the part of an importer where every
 * case is a string and none of them needs a database. The samples here are real
 * token strings taken from a live instance holding 26248 of them.
 */
import { describe, expect, it } from "vitest";
import {
  parseFormulaTokens,
  resolveFormulaReferences,
} from "../src/flowyteam/mappers/formula.ts";

describe("the token grammar", () => {
  it("reads the simplest real formula", () => {
    // kpi_51 / kpi_50
    const parsed = parseFormulaTokens("kpi_51,op_divide,kpi_50");
    expect(parsed).toEqual({
      ok: true,
      tree: { op: "div", l: { k: "51" }, r: { k: "50" } },
      references: [51, 50],
    });
  });

  it("keeps the precedence eval() would have applied", () => {
    // kpi_1 + kpi_2 * kpi_3 is an addition whose right side is a product, not
    // a product of a sum. Getting this wrong would import a number that looks
    // authoritative and is wrong, which is worse than importing none.
    const parsed = parseFormulaTokens("kpi_1,op_plus,kpi_2,op_multiply,kpi_3");
    expect(parsed).toEqual({
      ok: true,
      tree: {
        op: "add",
        l: { k: "1" },
        r: { op: "mul", l: { k: "2" }, r: { k: "3" } },
      },
      references: [1, 2, 3],
    });
  });

  it("reads a real bracketed formula with a literal", () => {
    // (kpi_54 - kpi_53) / (kpi_77) * 100
    const parsed = parseFormulaTokens(
      "op_open,kpi_54,op_minus,kpi_53,op_close,op_divide,op_open,kpi_77,op_close,op_multiply,100",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.tree).toEqual({
      op: "mul",
      l: {
        op: "div",
        l: { op: "sub", l: { k: "54" }, r: { k: "53" } },
        r: { k: "77" },
      },
      r: { n: 100 },
    });
    expect(parsed.references).toEqual([54, 53, 77]);
  });

  it("is left-associative, the way subtraction has to be", () => {
    const parsed = parseFormulaTokens("kpi_1,op_minus,kpi_2,op_minus,kpi_3");
    expect(parsed.ok && parsed.tree).toEqual({
      op: "sub",
      l: { op: "sub", l: { k: "1" }, r: { k: "2" } },
      r: { k: "3" },
    });
  });

  it("names the token that stopped it rather than guessing", () => {
    expect(parseFormulaTokens("kpi_1,op_wobble,kpi_2")).toEqual({
      ok: false,
      reason:
        'it contains "op_wobble", which is not a KPI, a number or one of the four operators',
    });
  });

  it("refuses the shapes that would evaluate to nonsense", () => {
    expect(parseFormulaTokens("")).toMatchObject({ ok: false });
    expect(parseFormulaTokens("op_open,kpi_1")).toMatchObject({
      ok: false,
      reason: "a bracket is opened and never closed",
    });
    expect(parseFormulaTokens("kpi_1,op_plus")).toMatchObject({
      ok: false,
      reason: "it ends where a value should be",
    });
    expect(parseFormulaTokens("op_plus,kpi_1")).toMatchObject({
      ok: false,
      reason: "it has an operator where a value should be",
    });
    expect(parseFormulaTokens("kpi_1,kpi_2")).toMatchObject({
      ok: false,
      reason: "it has something left over after the expression ends",
    });
  });

  it("refuses a formula of pure arithmetic", () => {
    // It would produce the same number every period, which is a target rather
    // than a calculation, and the target column already holds one.
    expect(parseFormulaTokens("2,op_multiply,3")).toMatchObject({
      ok: false,
      reason: "it references no other KPI",
    });
  });
});

describe("resolving the references", () => {
  const tree = {
    op: "div" as const,
    l: { k: "51" },
    r: { op: "add" as const, l: { k: "50" }, r: { n: 1 } },
  };

  it("swaps every source id for the target's own", () => {
    const resolved = resolveFormulaReferences(
      tree,
      new Map([
        [51, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        [50, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      ]),
    );
    expect(resolved).toEqual({
      ok: true,
      tree: {
        op: "div",
        l: { k: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        r: {
          op: "add",
          l: { k: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
          r: { n: 1 },
        },
      },
    });
  });

  it("names the ones it could not resolve rather than throwing", () => {
    const resolved = resolveFormulaReferences(
      tree,
      new Map([[51, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]]),
    );
    expect(resolved).toEqual({ ok: false, missing: [50] });
  });
});
