/**
 * The source tables no domain reads, and the count that makes a run say so
 * (completeness review M-16).
 *
 * The connector used to check that about fifteen tables existed and then read
 * none of them and say nothing, which is the silent drop CLAUDE.md forbids.
 * Three claims are proved here. That the list of unread tables is the truth
 * about the code in both directions: every table a domain is said to want is
 * read somewhere, and no table on the unread list is. That a count follows the
 * one company being imported, including through a parent for the two tables
 * with no company column, and names nothing that holds no rows. And that a
 * table which cannot be tied to a company is still counted, and says so.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_TABLES, EXPECTED_TABLES } from "../src/flowyteam/introspect.ts";
import { openSource, type Source } from "../src/flowyteam/source.ts";
import { countUnread, UNREAD_TABLES } from "../src/flowyteam/unread.ts";
import {
  available,
  SEEDED,
  type SeededSource,
  SKIP_REASON,
  seedSource,
} from "./support/flowyteam-source.ts";

const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam unread-table tests. ${SKIP_REASON}`);
}

/** What company 7 holds in each unread table, in the order the report names them. */
const COMPANY_SEVEN = [
  ["employee_teams", 2],
  ["performance_settings", 1],
  ["objective_accesses", 1],
  ["objective_discussions", 3],
  ["keyresult_discussions", 2],
  ["keyresult_indicator", 2],
  ["checkins", 2],
  ["key_result_files", 1],
  ["indicator_accesses", 1],
  ["indicator_calculates", 2],
  ["task_boards", 1],
  ["task_category", 2],
  ["project_time_logs", 1],
  ["performance_records", 1],
  ["reward_settings", 1],
  ["scores", 2],
] as const;

// ── The list, against the code ──────────────────────────────────────────

/**
 * Every table named in a `from` or `join` in the connector's own source.
 *
 * Comments are stripped first, because a comment saying where a value comes
 * from is not a read. `unread.ts` is left out on purpose: counting a table for
 * the report is the opposite of importing it, and its statements name the
 * table through a variable anyway.
 */
function tablesTheCodeReads(): ReadonlySet<string> {
  const root = fileURLToPath(new URL("../src/flowyteam", import.meta.url));
  const read = new Set<string>();
  for (const entry of readdirSync(root, { recursive: true })) {
    const file = String(entry);
    if (!file.endsWith(".ts") || file === "unread.ts") {
      continue;
    }
    const code = readFileSync(join(root, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const match of code.matchAll(
      /\b(?:from|join)\s+`?([a-z_][a-z0-9_]*)`?/gi,
    )) {
      read.add((match[1] as string).toLowerCase());
    }
  }
  return read;
}

describe("the tables no domain reads", () => {
  const read = tablesTheCodeReads();
  const unread = UNREAD_TABLES.map((entry) => entry.table);

  it("names every table a domain is said to want in a statement somewhere", () => {
    const wanted = [...CORE_TABLES, ...Object.values(EXPECTED_TABLES).flat()];
    expect(wanted.filter((table) => !read.has(table))).toEqual([]);
  });

  /**
   * The direction that would lie to an operator. A table a mapper starts
   * reading and nobody takes off this list would be reported as not imported
   * while every one of its rows came across.
   */
  it("reads no table it reports as unread", () => {
    expect(unread.filter((table) => read.has(table))).toEqual([]);
  });

  it("names each table once, and never one a domain is said to want", () => {
    expect(new Set(unread).size).toBe(unread.length);
    const wanted = new Set<string>([
      ...CORE_TABLES,
      ...Object.values(EXPECTED_TABLES).flat(),
    ]);
    expect(unread.filter((table) => wanted.has(table))).toEqual([]);
  });

  it("says in a sentence what each one holds and why it is not imported", () => {
    for (const entry of UNREAD_TABLES) {
      expect(entry.table, entry.table).toMatch(/^[a-z_][a-z0-9_]*$/);
      expect(entry.holds.length, entry.table).toBeGreaterThan(40);
      expect(entry.holds, entry.table).toMatch(/^[A-Z].*\.$/);
      // Plain English in this repository: no em dash.
      expect(entry.holds, entry.table).not.toContain(
        String.fromCharCode(0x2014),
      );
    }
  });
});

// ── The count, against a real MySQL ─────────────────────────────────────

describe.skipIf(!runnable)("counting them for one company", () => {
  let seeded: SeededSource;
  let source: Source;

  beforeAll(async () => {
    seeded = await seedSource("unread");
    // The second company's own rows: a score, and a team membership that
    // belongs to it only through a team it holds. Neither may reach company 7.
    await seeded.run(
      "insert into teams (id, company_id, team_name) values (50, 9, 'Elsewhere')",
    );
    await seeded.run(
      "insert into employee_teams (id, team_id, user_id) values (50, 50, 4)",
    );
    await seeded.run(
      "insert into scores (id, company_id, employee_id, performance_cycle_id, score, reason) values (50, 9, 4, 1, 3, 'Elsewhere')",
    );
    source = await openSource({ url: seeded.url });
  });

  afterAll(async () => {
    await source?.close();
    await seeded?.drop();
  });

  it("acceptance: names every unread table the company holds rows in, with the count", async () => {
    const found = await countUnread(source, SEEDED.first.id);
    expect(found.map((entry) => [entry.table, entry.rows])).toEqual(
      COMPANY_SEVEN,
    );
    // Every one is this company's own count, including the two tables that
    // carry no company column and are counted through their parent.
    expect(new Set(found.map((entry) => entry.scope))).toEqual(
      new Set(["company"]),
    );
    for (const entry of found) {
      expect(entry.holds).toBe(
        UNREAD_TABLES.find((one) => one.table === entry.table)?.holds,
      );
    }
  });

  it("says nothing about a table that holds no rows for the company", async () => {
    const found = await countUnread(source, SEEDED.second.id);
    expect(
      found.map((entry) => [entry.table, entry.rows, entry.scope]),
    ).toEqual([
      ["employee_teams", 1, "company"],
      ["scores", 1, "company"],
    ]);
  });
});

describe.skipIf(!runnable)("an instance that differs", () => {
  it("counts a table it cannot tie to a company across the whole source, and says so", async () => {
    // An older instance, and a table that has lost the column a count needs.
    const seeded = await seedSource("unread_older", {
      without: ["objective_discussions", "keyresult_discussions"],
    });
    await seeded.run(
      "insert into scores (id, company_id, employee_id, performance_cycle_id, score, reason) values (50, 9, 4, 1, 3, 'Elsewhere')",
    );
    await seeded.run("alter table scores drop column company_id");
    const source = await openSource({ url: seeded.url });
    try {
      const found = await countUnread(source, SEEDED.first.id);
      const tables = found.map((entry) => entry.table);

      // A table the instance does not have is not a table with rows.
      expect(tables).not.toContain("objective_discussions");
      expect(tables).not.toContain("keyresult_discussions");

      // Both companies' scores, and marked as such rather than passed off as
      // company 7's.
      expect(found.find((entry) => entry.table === "scores")).toMatchObject({
        rows: 3,
        scope: "source",
      });
      expect(
        found.filter((entry) => entry.scope === "source").map((e) => e.table),
      ).toEqual(["scores"]);
    } finally {
      await source.close();
      await seeded.drop();
    }
  });
});
