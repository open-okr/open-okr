/**
 * What the connector can tell about a source before it reads any of it (P6-T02).
 *
 * Two claims worth proving against a real server rather than a fake. That a
 * database which is not FlowyTeam is refused by name instead of failing later on
 * a missing column, and that an instance missing an optional table imports
 * everything else rather than nothing. The second is not hypothetical: a live
 * FlowyTeam this connector was written against has no discussion tables.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_TABLES, introspect } from "../src/flowyteam/introspect.ts";
import {
  openSource,
  type Source,
  SourceError,
} from "../src/flowyteam/source.ts";
import {
  available,
  type SeededSource,
  SKIP_REASON,
  seedSource,
} from "./support/flowyteam-source.ts";

const runnable = await available();
if (!runnable) {
  console.warn(`Skipping the FlowyTeam introspection tests. ${SKIP_REASON}`);
}

describe.skipIf(!runnable)("introspecting a FlowyTeam source", () => {
  let seeded: SeededSource;
  let source: Source;

  beforeAll(async () => {
    seeded = await seedSource("introspect");
    source = await openSource({ url: seeded.url });
  });

  afterAll(async () => {
    await source?.close();
    await seeded?.drop();
  });

  it("acceptance: names the version from the migrations that were applied", async () => {
    const found = await introspect(source);
    expect(found.database).toBe(seeded.database);
    expect(found.version.migrationCount).toBe(3);
    expect(found.version.latestMigration).toContain("oauth_clients");
    expect(found.version.appliedOn).toBe("2026_07_14");
  });

  it("reports every domain as complete when every table is there", async () => {
    const found = await introspect(source);
    expect([...found.completeDomains].sort()).toEqual([
      "kpis",
      "okrs",
      "organisation",
      "points",
      "rhythm",
      "work",
    ]);
    expect(found.tableCount).toBeGreaterThan(CORE_TABLES.length);
  });
});

describe.skipIf(!runnable)("an instance that is missing things", () => {
  it("records an absent optional table against its domain, and imports the rest", async () => {
    // What `flowy_prod` actually looks like: an older instance with no
    // discussion tables. Every other domain still imports.
    const seeded = await seedSource("older", {
      without: ["objective_discussions", "keyresult_discussions"],
    });
    const source = await openSource({ url: seeded.url });
    try {
      const found = await introspect(source);
      expect(found.domains.okrs).toEqual([
        "objective_discussions",
        "keyresult_discussions",
      ]);
      expect(found.completeDomains).toContain("work");
      expect(found.completeDomains).not.toContain("okrs");
    } finally {
      await source.close();
      await seeded.drop();
    }
  });

  it("refuses a database that is not FlowyTeam, by naming what is missing", async () => {
    const seeded = await seedSource("notflowy", { without: [] });
    // Drop a core table through the administrator connection, which is the one
    // thing the connector itself could never do.
    await seeded.run("drop table objectives");
    const source = await openSource({ url: seeded.url });
    try {
      await expect(introspect(source)).rejects.toThrow(
        /does not look like a FlowyTeam database.*objectives/s,
      );
      await expect(introspect(source)).rejects.toThrow(SourceError);
    } finally {
      await source.close();
      await seeded.drop();
    }
  });
});
