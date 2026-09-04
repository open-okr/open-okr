/**
 * The FlowyTeam command's arguments, the report it prints, and the legacy
 * identifier map (P6-T02).
 *
 * All three are pure and none needs a database. They are the parts of a command
 * that go wrong in ways nobody notices: a flag silently ignored, a report that
 * says nothing was skipped when something was, an identifier that collides
 * between two source tables.
 */
import { describe, expect, it } from "vitest";
import { UsageError } from "../src/cli.ts";
import { parseFlowyteamArgs } from "../src/flowyteam/cli.ts";
import {
  LEGACY_TABLES,
  LEGACY_TYPE,
  legacyIdFor,
  legacyKeyFor,
  parseLegacyId,
} from "../src/flowyteam/legacy.ts";
import {
  DomainTally,
  describeDomain,
} from "../src/flowyteam/mappers/reconcile.ts";
import { buildReport, render } from "../src/flowyteam/report.ts";

const REQUIRED = [
  "--source",
  "mysql://root@localhost:3306/flowyteam",
  "--workspace",
  "acme",
  "--as",
  "ada@example.com",
];

describe("pnpm import:flowyteam's arguments", () => {
  it("takes the four it needs, in either spelling", () => {
    expect(parseFlowyteamArgs([...REQUIRED, "--company", "7"])).toEqual({
      source: "mysql://root@localhost:3306/flowyteam",
      workspace: "acme",
      as: "ada@example.com",
      company: 7,
      write: false,
    });
    expect(
      parseFlowyteamArgs([
        "--source=mysql://root@localhost:3306/flowyteam",
        "--workspace=acme",
        "--as=ada@example.com",
        "--company=7",
      ]).company,
    ).toBe(7);
  });

  it("leaves the company undefined, because the run is what lists them", () => {
    // A parser cannot say "here are the companies"; only something holding the
    // connection can. So `--company` is optional here and required there.
    expect(parseFlowyteamArgs(REQUIRED).company).toBeUndefined();
  });

  it("refuses each missing argument by name", () => {
    for (const drop of ["--source", "--workspace", "--as"]) {
      const at = REQUIRED.indexOf(drop);
      const argv = [...REQUIRED.slice(0, at), ...REQUIRED.slice(at + 2)];
      expect(() => parseFlowyteamArgs(argv), drop).toThrow(
        new RegExp(`${drop} is required`),
      );
    }
  });

  it("refuses a company that is not a number", () => {
    expect(() =>
      parseFlowyteamArgs([...REQUIRED, "--company", "acme"]),
    ).toThrow(/company id, which is a number/);
  });

  it("accepts --dry-run, which is the only mode there is", () => {
    expect(() => parseFlowyteamArgs([...REQUIRED, "--dry-run"])).not.toThrow();
  });

  it("is a dry run unless --write is given", () => {
    expect(parseFlowyteamArgs(REQUIRED).write).toBe(false);
    expect(parseFlowyteamArgs([...REQUIRED, "--write"]).write).toBe(true);
  });

  it("reads --only as a comma-separated list", () => {
    expect(parseFlowyteamArgs(REQUIRED).only).toBeUndefined();
    expect(
      parseFlowyteamArgs([...REQUIRED, "--only", "objectives"]).only,
    ).toEqual(["objectives"]);
    expect(
      parseFlowyteamArgs([...REQUIRED, "--only", "work, Files ,collaboration"])
        .only,
    ).toEqual(["work", "files", "collaboration"]);
  });

  /**
   * A typo has to be a usage error rather than a smaller import. Somebody who
   * types `--only objetives` has asked for objectives, and a run that imports
   * nothing while reporting success is the worst answer available.
   */
  it("refuses a domain it does not have, and names the ones it does", () => {
    expect(() =>
      parseFlowyteamArgs([...REQUIRED, "--only", "objetives"]),
    ).toThrow(UsageError);
    expect(() =>
      parseFlowyteamArgs([...REQUIRED, "--only", "objetives"]),
    ).toThrow(/is not a domain this imports/);
    expect(() =>
      parseFlowyteamArgs([...REQUIRED, "--only", "objetives"]),
    ).toThrow(/organisation, objectives, checkins, kpis, work/);
  });

  it("refuses an empty --only rather than reading it as all of them", () => {
    expect(() => parseFlowyteamArgs([...REQUIRED, "--only", ","])).toThrow(
      /needs at least one domain/,
    );
  });

  it("reads --files-root, and leaves it absent when nobody gave one", () => {
    expect(parseFlowyteamArgs(REQUIRED).filesRoot).toBeUndefined();
    expect(
      parseFlowyteamArgs([...REQUIRED, "--files-root", "/srv/flowy/storage"])
        .filesRoot,
    ).toBe("/srv/flowy/storage");
  });
});

const INTROSPECTION = {
  database: "flowyteam",
  tableCount: 322,
  version: {
    latestMigration: "2026_07_14_000001_add_client_secret_plain",
    appliedOn: "2026_07_14",
    migrationCount: 812,
  },
  domains: { okrs: ["objective_discussions"], work: [] },
  completeDomains: ["work"],
};

const COMPANY = {
  id: 7,
  name: "Northwind Trading",
  username: "c7",
  timezone: "Asia/Jakarta",
  status: "active",
};

describe("the report a dry run produces", () => {
  const report = buildReport({
    connectedTo: "root@db.example/flowyteam",
    introspection: INTROSPECTION,
    company: COMPANY,
    counts: { objectives: 2, key_results: 3 },
    mode: "dry_run",
  });

  it("acceptance: it is empty, and says why in words", () => {
    expect(report.written).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.notes.join(" ")).toContain("Nothing was written");
  });

  it("names the domain that will import nothing, and what it is missing", () => {
    expect(report.notes.join(" ")).toContain(
      "The okrs domain will import nothing",
    );
    expect(report.notes.join(" ")).toContain("objective_discussions");
  });

  it("offers the company timezone rather than applying it", () => {
    expect(report.notes.join(" ")).toContain("never applied silently");
  });

  it("prints the schema summary the acceptance criterion asks for", () => {
    const printed = render(report, "run-1");
    expect(printed).toContain("Company 7, Northwind Trading");
    expect(printed).toContain("322 tables");
    expect(printed).toContain("812 migrations applied");
    // Padded to the widest table name, so the numbers line up in a column.
    expect(printed).toMatch(/objectives\s+2\n\s+key_results\s+3/);
    expect(printed).toContain(
      "Would write: 0. Would skip: 0. Nothing was written.",
    );
    expect(printed).toContain("Run run-1");
  });
});

describe("the legacy identifier map", () => {
  it("qualifies an id by the source table it came from", () => {
    expect(legacyIdFor("objectives", 41)).toBe("objectives:41");
    expect(legacyIdFor("indicators", 41)).toBe("indicators:41");
    expect(legacyKeyFor("objectives", "41")).toEqual({
      type: LEGACY_TYPE,
      id: "objectives:41",
    });
  });

  it("round-trips, because the report names rows by it", () => {
    const parsed = parseLegacyId(legacyIdFor("key_results", 9));
    expect(parsed).toEqual({ table: "key_results", id: "9" });
    expect(parseLegacyId("nocolon")).toBeNull();
    expect(parseLegacyId(":9")).toBeNull();
    expect(parseLegacyId("tasks:")).toBeNull();
  });

  it("refuses an id that is not one, rather than making a key out of it", () => {
    expect(() => legacyIdFor("tasks", 0)).toThrow(/no usable id/);
    expect(() => legacyIdFor("tasks", "")).toThrow(/no usable id/);
  });

  it("sends each source table to the target table §7.2 names", () => {
    expect(LEGACY_TABLES.objectives).toBe("goals");
    expect(LEGACY_TABLES.indicators).toBe("kpis");
    // Projects, not boards: a board is a column layout, and 17724 tasks on a
    // live instance carry a project against 3668 that carry a board.
    expect(LEGACY_TABLES.projects).toBe("initiatives");
    expect(LEGACY_TABLES.sub_tasks).toBe("checklist_items");
    // A file becomes a blob and not an attachment: an attachment is already
    // unique on its subject and its blob while live, so the blob is what needs
    // an identity of its own (P6-T04c).
    expect(LEGACY_TABLES.task_files).toBe("blobs");
    expect(LEGACY_TABLES.task_files_inline).toBe("blobs");

    // Two source tables may share a target, and exactly two do: an uploaded
    // file and an image sitting inline in comment markup both become blobs.
    // Anything else sharing one would mean two source tables silently sharing
    // an identifier space, which is why this counts rather than only warning.
    const targets = Object.values(LEGACY_TABLES);
    const shared = targets.filter(
      (target, index) => targets.indexOf(target) !== index,
    );
    expect(shared).toEqual(["blobs"]);
  });
});

describe("one domain's reconciliation", () => {
  it("is clean only when everything read is accounted for and nothing skipped", () => {
    const tidy = new DomainTally("members");
    tidy.sawRow();
    tidy.sawRow();
    tidy.wrote(true);
    tidy.wrote(false);
    expect(tidy.finish()).toMatchObject({
      read: 2,
      created: 1,
      matched: 1,
      clean: true,
    });
  });

  it("is not clean when a row was skipped, even though the skip was reported", () => {
    const messy = new DomainTally("cycles");
    messy.sawRow();
    messy.skip("performance_cycles:3", "This is a weekly cycle.");
    const done = messy.finish();
    expect(done.clean).toBe(false);
    expect(describeDomain(done)).toContain("1 skipped");
  });

  it("is not clean when a row was read and never accounted for", () => {
    // The shape a mapper bug makes: a row read, no write, no skip. The counts
    // would look harmless and the flag is what catches it.
    const lossy = new DomainTally("spaces");
    lossy.sawRow();
    lossy.sawRow();
    lossy.wrote(true);
    expect(lossy.finish().clean).toBe(false);
  });
});
