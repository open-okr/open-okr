import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The three things S-20 asked for and the grid never had (P6-G30).
 *
 * The row sparkline, the category subtotal and the filter row. The page's own
 * "Not here yet" card named all three and named P3-T13 as the blocker; P3-T13
 * landed, which is why this row exists at all.
 *
 * The rendering is small and pure, so what is checked here is the decision in
 * each one rather than the markup.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const extras = at("../app/kpis/grid-extras.tsx");
const page = at("../app/kpis/page.tsx");

describe("the subtotal", () => {
  test("is a tally of corridor states, not a sum of values", () => {
    // **UIUX-PLAN asks for subtotals and METHOD.md defines none.** There is no
    // aggregate rule for a category, and `aggregateForPeriod` folds one KPI
    // across frequencies rather than several KPIs together. Adding a revenue
    // figure to a response time would be a number nobody measured.
    expect(extras).toContain("tally of corridor states, not a sum of values");
    expect(extras).toContain('states.filter((state) => state === "healthy")');
    expect(extras).not.toContain("reduce((sum");
  });

  test("names §6.4's five states and no others", () => {
    for (const state of [
      "healthy",
      "watch",
      "unhealthy",
      "recovering",
      "no_data",
    ]) {
      expect(extras, state).toContain(`"${state}"`);
    }
  });
});

describe("the sparkline", () => {
  test("draws nothing from one point, and says which", () => {
    // Two points are the fewest a trend can be made of. A single dot stretched
    // across a box reads as a flat trend, which is a claim nobody made.
    expect(extras).toContain("values.length < 2");
    expect(extras).toContain("One value so far");
    expect(extras).toContain("No values yet");
  });

  test("needs no chart library", () => {
    // Twelve points and one path. A dependency for that would need asking
    // about, and CLAUDE.md says so.
    expect(extras).toContain("<polyline");
    expect(extras).not.toContain("recharts");
  });
});

describe("the filters", () => {
  test("live in the url, following the explorer's pattern", () => {
    // A combination survives a reload and can be sent to somebody, which local
    // state loses on both counts.
    expect(extras).toContain("new URLSearchParams(query)");
    expect(page).toContain("searchParams: Promise<{");
    for (const param of ["frequency", "owner", "category", "state"]) {
      expect(page, param).toContain(`param="${param}"`);
    }
  });

  test("filter the rows and not the categories", () => {
    // A filter that went to the database would make the subtotals answer for
    // the filtered set while the category list came from the whole one.
    expect(page).toContain("const shown = grid.kpis.filter(");
    expect(page).toContain("kpis={shown}");
  });
});

describe("the page", () => {
  test("no longer promises any of it", () => {
    expect(page).not.toContain("Not here yet");
    expect(page).not.toContain("at P6-G30");
  });

  test("shows a formula on a calculated row", () => {
    // A chip needs a formula to name, and the grid read returned none until
    // this row.
    expect(page).toContain("kpi.isCalculated ?");
    expect(page).toContain("kpi.formula");
  });
});
