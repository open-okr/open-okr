import { describe, expect, it } from "vitest";
import {
  filterWorkspaces,
  isFiltered,
  planFilterValue,
  readWorkspaceFilter,
} from "../lib/operator-workspace-list.ts";

/**
 * S-45's search and filters (UIUX-PLAN S-45, operator-console.md §8):
 * search by name or slug, filter by state and by plan.
 */
const ROWS = [
  {
    workspaceId: "a",
    name: "Northwind Traders",
    slug: "northwind",
    tenantState: "active",
    planKey: "team",
  },
  {
    workspaceId: "b",
    name: "Contoso",
    slug: "contoso-hq",
    tenantState: "suspended",
    planKey: null,
  },
  {
    workspaceId: "c",
    name: "Fabrikam",
    slug: "fabrikam",
    tenantState: "closed",
    planKey: "team",
  },
  {
    workspaceId: "d",
    name: "Adventure Works",
    slug: "aw",
    tenantState: "active",
    // A plan whose key reads like the sentinel for "no plan" must still be
    // told apart from no plan at all.
    planKey: "none",
  },
] as const;

function ids(rows: readonly { workspaceId: string }[]): string[] {
  return rows.map((row) => row.workspaceId);
}

describe("readWorkspaceFilter", () => {
  it("reads nothing as no filter", () => {
    const filter = readWorkspaceFilter({});
    expect(filter).toEqual({ query: "", state: null, plan: null });
    expect(isFiltered(filter)).toBe(false);
  });

  it("trims the search and ignores a state it does not know", () => {
    const filter = readWorkspaceFilter({ q: "  north  ", state: "deleted" });
    expect(filter.query).toBe("north");
    expect(filter.state).toBeNull();
    expect(isFiltered(filter)).toBe(true);
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(readWorkspaceFilter({ state: ["suspended", "active"] }).state).toBe(
      "suspended",
    );
  });

  it("tells no plan apart from a plan key", () => {
    expect(readWorkspaceFilter({ plan: "none" }).plan).toEqual({
      kind: "none",
    });
    expect(readWorkspaceFilter({ plan: "key:none" }).plan).toEqual({
      kind: "key",
      key: "none",
    });
    // Anything else is not a plan filter, rather than a guess.
    expect(readWorkspaceFilter({ plan: "team" }).plan).toBeNull();
    expect(readWorkspaceFilter({ plan: "key:" }).plan).toBeNull();
  });

  it("caps the search at the length the box allows", () => {
    expect(readWorkspaceFilter({ q: "x".repeat(500) }).query).toHaveLength(200);
  });
});

describe("planFilterValue", () => {
  it("round-trips through readWorkspaceFilter", () => {
    for (const key of [null, "team", "none", "key:odd"]) {
      const plan = readWorkspaceFilter({ plan: planFilterValue(key) }).plan;
      expect(plan).toEqual(
        key === null ? { kind: "none" } : { kind: "key", key },
      );
    }
  });
});

describe("filterWorkspaces", () => {
  it("returns every row with no filter", () => {
    expect(ids(filterWorkspaces(ROWS, readWorkspaceFilter({})))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("searches the name and the slug, ignoring case", () => {
    expect(
      ids(filterWorkspaces(ROWS, readWorkspaceFilter({ q: "NORTH" }))),
    ).toEqual(["a"]);
    expect(
      ids(filterWorkspaces(ROWS, readWorkspaceFilter({ q: "hq" }))),
    ).toEqual(["b"]);
  });

  it("filters by state", () => {
    expect(
      ids(filterWorkspaces(ROWS, readWorkspaceFilter({ state: "active" }))),
    ).toEqual(["a", "d"]);
  });

  it("filters by plan, and by no plan", () => {
    expect(
      ids(filterWorkspaces(ROWS, readWorkspaceFilter({ plan: "key:team" }))),
    ).toEqual(["a", "c"]);
    expect(
      ids(filterWorkspaces(ROWS, readWorkspaceFilter({ plan: "none" }))),
    ).toEqual(["b"]);
    expect(
      ids(filterWorkspaces(ROWS, readWorkspaceFilter({ plan: "key:none" }))),
    ).toEqual(["d"]);
  });

  it("combines the search and both filters", () => {
    expect(
      ids(
        filterWorkspaces(
          ROWS,
          readWorkspaceFilter({ q: "a", state: "active", plan: "key:team" }),
        ),
      ),
    ).toEqual(["a"]);
  });
});
