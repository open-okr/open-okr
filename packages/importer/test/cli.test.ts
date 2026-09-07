/**
 * The command's arguments and its report (P6-T01b).
 *
 * Two pure functions, and the reason they are tested at all is that a command
 * gets these wrong quietly: a misspelled flag that does nothing looks like the
 * command ignoring the file, and a report that counts a dry run's rows as
 * written looks like an import that happened.
 */
import type { RunReport } from "@openokr/core";
import { describe, expect, it } from "vitest";
import { parseArgs, render, UsageError } from "../src/index";

const required = [
  "--entity",
  "goals",
  "--file",
  "goals.csv",
  "--workspace",
  "acme",
  "--as",
  "ada@example.com",
];

describe("the arguments", () => {
  it("reads the four it needs, and defaults to a dry run", () => {
    expect(parseArgs(required)).toEqual({
      entity: "goals",
      file: "goals.csv",
      workspace: "acme",
      as: "ada@example.com",
      write: false,
    });
  });

  it("reads --flag=value as well as --flag value", () => {
    expect(
      parseArgs([
        "--entity=goals",
        "--file=goals.csv",
        "--workspace=acme",
        "--as=ada@example.com",
      ]).entity,
    ).toBe("goals");
  });

  it("only writes when the word is there", () => {
    expect(parseArgs([...required, "--write"]).write).toBe(true);
    // §7 spells `--dry-run`, so it is accepted and changes nothing.
    expect(parseArgs([...required, "--dry-run"]).write).toBe(false);
  });

  it("names the argument that is missing, with the usage", () => {
    expect(() => parseArgs(["--entity", "goals"])).toThrow(UsageError);
    expect(() => parseArgs(["--entity", "goals"])).toThrow(
      /--file is required/,
    );
  });

  it("refuses an entity that has no template, listing the ones that do", () => {
    expect(() =>
      parseArgs([...required.slice(0, 1), "objectives", ...required.slice(2)]),
    ).toThrow(/--entity is one of: goals, key-results/);
  });

  it("refuses a flag with no value rather than swallowing the next flag", () => {
    expect(() => parseArgs(["--entity", "--file", "goals.csv"])).toThrow(
      /--entity needs a value/,
    );
  });

  it("refuses something that is not a flag at all", () => {
    expect(() => parseArgs([...required, "goals.csv"])).toThrow(
      /I do not know what "goals.csv" is/,
    );
  });
});

const report = (over: Partial<RunReport> = {}): RunReport => ({
  entity: "goals",
  file: "goals.csv",
  mode: "dry_run",
  rowsRead: 3,
  created: 2,
  updated: 0,
  skipped: 1,
  unmappedHeaders: [],
  rows: [
    { line: 2, outcome: "created", externalId: "obj-1" },
    { line: 3, outcome: "created", externalId: "obj-2" },
    {
      line: 4,
      outcome: "skipped",
      externalId: "obj-3",
      reason: 'level says "divisional".',
    },
  ],
  ...over,
});

describe("the report", () => {
  it("says nothing was written for a dry run, and lists the skips", () => {
    const text = render(report(), "run-1");
    expect(text).toContain("Nothing was written");
    expect(text).toContain("2 to create");
    expect(text).toContain('line 4: skipped. level says "divisional".');
    expect(text).toContain("Run run-1.");
    // Two rows were created and neither is listed: a hundred lines saying a
    // row worked is not a report.
    expect(text).not.toContain("line 2");
  });

  it("says created rather than to create for a real run", () => {
    const text = render(report({ mode: "real" }), "run-2");
    expect(text).toContain("2 created");
    expect(text).not.toContain("to create");
    expect(text).not.toContain("Nothing was written");
  });

  it("names the columns nothing claimed, and how to claim them", () => {
    const text = render(
      report({ unmappedHeaders: ["Strategic pillar", "Notes"] }),
      "run-3",
    );
    expect(text).toContain("Strategic pillar, Notes");
    expect(text).toContain("--map");
  });
});
