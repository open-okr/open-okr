import { describe, expect, it } from "vitest";
import { checksum } from "../src/migrate.ts";
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

  /**
   * A rewrite the runner sanctions (plan 0.8.0 H5): the gate passes that one
   * file for that one rewrite, and still fails everything else, so the two
   * agree.
   */
  describe("a sanctioned rewrite", () => {
    const rewritten = "-- Why.\nalter table kpis add column y int;\n";
    const sanctions = {
      "0001_a.sql": {
        from: [checksum(sql)],
        to: checksum(rewritten),
        reason: "a test",
      },
    };

    it("passes the rewrite it names, against the copy it names", () => {
      expect(
        compareShipped("0001_a.sql", sql, rewritten, "v0.7.0", sanctions),
      ).toBeNull();
    });

    it("fails any other edit to the same file", () => {
      expect(
        compareShipped(
          "0001_a.sql",
          sql,
          `${rewritten}-- And more.\n`,
          "v0.7.0",
          sanctions,
        ),
      ).toMatch(/differs from v0.7.0/);
    });

    it("fails the rewrite when the shipped copy is not the one it names", () => {
      expect(
        compareShipped(
          "0001_a.sql",
          sql.replace("Why.", "Why not."),
          rewritten,
          "v0.7.0",
          sanctions,
        ),
      ).toMatch(/differs from v0.7.0/);
    });

    it("sanctions nothing under another name", () => {
      expect(
        compareShipped("0002_b.sql", sql, rewritten, "v0.7.0", sanctions),
      ).toMatch(/differs from v0.7.0/);
    });

    it("still fails a sanctioned file that is gone", () => {
      expect(
        compareShipped("0001_a.sql", sql, null, "v0.7.0", sanctions),
      ).toMatch(/is gone/);
    });
  });
});
