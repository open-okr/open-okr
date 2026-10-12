import { describe, expect, it } from "vitest";
import { compareShipped } from "../src/shipped-migrations.ts";

/**
 * The shipped-migration gate (the sixteen migrations edited on 7 October
 * 2026). It must count a change the way the runner's checksum counts one.
 */
describe("a migration a release shipped", () => {
  const sql = "-- Why.\nalter table kpis add column x int;\n";

  it("passes unchanged, and through a line-ending or trailing-newline change", () => {
    expect(compareShipped("0001_a.sql", sql, sql, "v0.2.0")).toBeNull();
    expect(
      compareShipped("0001_a.sql", sql, sql.replaceAll("\n", "\r\n"), "v0.2.0"),
    ).toBeNull();
    expect(
      compareShipped("0001_a.sql", sql, `${sql}\n\n`, "v0.2.0"),
    ).toBeNull();
  });

  it("fails an edited comment, because the runner refuses it too", () => {
    expect(
      compareShipped(
        "0001_a.sql",
        sql,
        sql.replace("Why.", "Why not."),
        "v0.2.0",
      ),
    ).toMatch(/differs from v0.2.0/);
  });

  it("fails a deleted file", () => {
    expect(compareShipped("0001_a.sql", sql, null, "v0.2.0")).toMatch(
      /is gone/,
    );
  });
});
