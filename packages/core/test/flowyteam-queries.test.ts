import { describe, expect, it } from "vitest";
import {
  FLOWYTEAM_QUERIES,
  flowyteamQueryCatalogue,
} from "../src/imports/flowyteam/queries.ts";

/** The `companies` table has no company_id: its own row is `id = :company`. */
function hasCompanyPredicate(sql: string): boolean {
  if (COMPANY_PREDICATE.test(sql)) {
    return true;
  }
  const from = /\bfrom\s+`?([a-z_]+)`?/i.exec(sql)?.[1];
  return from === "companies" && /\bwhere id = :company\b/.test(sql);
}

const entries = Object.entries(FLOWYTEAM_QUERIES);

/** `company_id = :company`, with an optional table alias in front. */
const COMPANY_PREDICATE = /\b(?:[a-z_]+\.)?company_id = :company\b/;

describe("the FlowyTeam query catalogue", () => {
  it("names every statement once, as domain.what", () => {
    const names = entries.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name, name).toMatch(/^[a-zA-Z]+\.[A-Za-z0-9_.]+$/);
    }
    expect(flowyteamQueryCatalogue().entries.length).toBe(names.length);
  });

  it("gives every company entry a company_id = :company predicate", () => {
    const missing = entries
      .filter(([, entry]) => entry.scope === "company")
      .filter(([, entry]) => !hasCompanyPredicate(entry.sql))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("uses :company only as that predicate, and only in company entries", () => {
    for (const [name, entry] of entries) {
      const uses = entry.sql.match(/:company/g)?.length ?? 0;
      if (entry.scope !== "company") {
        expect(uses, name).toBe(0);
        continue;
      }
      const predicates =
        entry.sql.match(/(?:company_id|\bid) = :company\b/g)?.length ?? 0;
      expect(uses, name).toBe(predicates);
      // A positional value never carries the company.
      expect(entry.sql, name).not.toMatch(/company_id = \?/);
    }
  });

  it("keeps schema entries to the structure of the database", () => {
    for (const [name, entry] of entries) {
      if (entry.scope !== "schema") {
        continue;
      }
      expect(entry.sql, name).toMatch(/information_schema|from migrations/);
      expect(entry.sql, name).not.toContain(":company");
    }
  });

  it("lets a reference entry select only id", () => {
    const references = entries.filter(([, e]) => e.scope === "reference");
    expect(references.length).toBeGreaterThan(0);
    for (const [name, entry] of references) {
      const list = /^\s*select\s+(.+?)\s+from\b/is.exec(entry.sql)?.[1];
      expect(list, name).toMatch(/^(?:[a-z]+\.)?id(?:\s+as\s+id)?$/i);
      expect(entry.sql, name).not.toContain(":company");
    }
  });

  it("sends one statement per call", () => {
    for (const [name, entry] of entries) {
      const body = entry.sql.trim().replace(/;\s*$/, "");
      expect(body, name).not.toContain(";");
    }
  });

  it("marks the statements that read across companies mysql-only", () => {
    const names = entries
      .filter(([, entry]) => entry.scope === "mysql-only")
      .map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining(["companies.list", "companies.count"]),
    );
  });

  it("derives a version that is stable and moves with the SQL", () => {
    const first = flowyteamQueryCatalogue();
    expect(flowyteamQueryCatalogue().version).toBe(first.version);
    expect(first.version).toMatch(/^[0-9a-f]{64}$/);
    const reordered = flowyteamQueryCatalogue(
      Object.fromEntries([...entries].reverse()),
    );
    expect(reordered.version).toBe(first.version);
    const changed = flowyteamQueryCatalogue({
      ...FLOWYTEAM_QUERIES,
      "schema.tables": {
        scope: "schema",
        sql: "select 1 from information_schema.tables",
      },
    });
    expect(changed.version).not.toBe(first.version);
  });
});
