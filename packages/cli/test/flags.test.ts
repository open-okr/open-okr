import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CliCommand } from "../src/contract.ts";
import { findCommand, loadContract } from "../src/contract.ts";
import { coerce, commandHelp, parseFlags } from "../src/flags.ts";

/**
 * Typed flags (P5-T07c-a).
 *
 * The test-plan line this file exists for: a flag whose type or enum the schema
 * refuses fails **before any request**, and names the flag. Every case below
 * runs with no server, no profile and no network, which is the proof.
 */

const listGoals: CliCommand = {
  name: "goals list",
  action: "goals.list",
  method: "GET",
  path: "/goals/list",
  scope: "read",
  summary: "Goals in a cycle.",
  pages: false,
  flags: [
    { name: "space-id", field: "spaceId", type: "string", required: false },
    {
      name: "level",
      field: "level",
      type: "string",
      required: false,
      enum: ["company", "team"],
    },
    {
      name: "include-closed",
      field: "includeClosed",
      type: "boolean",
      required: false,
    },
    { name: "limit", field: "limit", type: "integer", required: false },
    { name: "weight", field: "weight", type: "number", required: false },
    { name: "items", field: "items", type: "array", required: false },
    { name: "body", field: "body", type: "object", required: false },
  ],
};

const createGoal: CliCommand = {
  name: "goals create",
  action: "goals.create",
  method: "POST",
  path: "/goals/create",
  scope: "write",
  summary: "Create a goal.",
  pages: false,
  flags: [
    { name: "title", field: "title", type: "string", required: true },
    { name: "level", field: "level", type: "string", required: true },
  ],
};

const parse = (command: CliCommand, line: string) =>
  parseFlags(command, line === "" ? [] : line.split(" "));

describe("reading a value", () => {
  it("takes a string as it is", () => {
    expect(coerce(listGoals.flags[0] as never, "abc")).toEqual({
      value: "abc",
    });
  });

  it("refuses a value that is not in the enum, and lists what is", () => {
    const result = coerce(listGoals.flags[1] as never, "marketing");
    expect(result).toEqual({
      error: '--level must be one of company, team, not "marketing".',
    });
  });

  it("reads a boolean, and refuses anything that is not one", () => {
    expect(coerce(listGoals.flags[2] as never, "true")).toEqual({
      value: true,
    });
    expect(coerce(listGoals.flags[2] as never, "false")).toEqual({
      value: false,
    });
    // Bare `--include-closed` arrives as an empty value and means true.
    expect(coerce(listGoals.flags[2] as never, "")).toEqual({ value: true });
    expect(coerce(listGoals.flags[2] as never, "yes")).toEqual({
      error: '--include-closed takes true or false, not "yes".',
    });
  });

  it("refuses a fraction where the schema says whole", () => {
    expect(coerce(listGoals.flags[3] as never, "10")).toEqual({ value: 10 });
    expect(coerce(listGoals.flags[3] as never, "10.5")).toEqual({
      error: '--limit takes a whole number, not "10.5".',
    });
    expect(coerce(listGoals.flags[4] as never, "10.5")).toEqual({
      value: 10.5,
    });
    expect(coerce(listGoals.flags[4] as never, "ten")).toEqual({
      error: '--weight takes a number, not "ten".',
    });
  });

  it("tells an array from an object", () => {
    expect(coerce(listGoals.flags[5] as never, '["a"]')).toEqual({
      value: ["a"],
    });
    expect(coerce(listGoals.flags[5] as never, '{"a":1}')).toEqual({
      error: "--items takes a JSON array.",
    });
    expect(coerce(listGoals.flags[6] as never, '{"a":1}')).toEqual({
      value: { a: 1 },
    });
    expect(coerce(listGoals.flags[6] as never, "not json")).toEqual({
      error: "--body takes JSON. Pass it inline or as @file.json.",
    });
  });
});

describe("file inputs", () => {
  it("reads a value from a file the flag names", () => {
    const directory = mkdtempSync(join(tmpdir(), "okr-cli-"));
    const file = join(directory, "body.json");
    writeFileSync(file, '{"title":"From a file"}', "utf8");

    expect(coerce(listGoals.flags[6] as never, `@${file}`)).toEqual({
      value: { title: "From a file" },
    });
  });

  it("says which file it could not read", () => {
    const result = coerce(listGoals.flags[0] as never, "@nowhere/at/all.json");
    expect(result).toEqual({
      error: "--space-id: Cannot read nowhere/at/all.json.",
    });
  });

  it("lets a value start with an at sign, doubled", () => {
    expect(coerce(listGoals.flags[0] as never, "@@literal")).toEqual({
      value: "@literal",
    });
  });
});

describe("a line of flags", () => {
  it("maps flags onto the action's own field names", () => {
    const result = parse(listGoals, "--space-id abc --include-closed true");
    expect(result).toEqual({
      kind: "ok",
      input: { spaceId: "abc", includeClosed: true },
      globals: { help: false },
    });
  });

  it("takes --flag=value as well as --flag value", () => {
    const result = parse(listGoals, "--space-id=abc");
    expect(result.kind === "ok" && result.input).toEqual({ spaceId: "abc" });
  });

  it("treats a bare boolean flag as true", () => {
    const result = parse(listGoals, "--include-closed --space-id abc");
    expect(result.kind === "ok" && result.input).toEqual({
      includeClosed: true,
      spaceId: "abc",
    });
  });

  it("refuses a flag the command does not have, and lists what it does", () => {
    const result = parse(listGoals, "--spaceID abc");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("--spaceid");
      expect(result.message).toContain("--space-id");
    }
  });

  it("names every required flag that is missing", () => {
    const result = parse(createGoal, "--title Something");
    expect(result).toEqual({
      kind: "error",
      message: "goals create needs --level.",
    });
  });

  it("does not ask for required flags when the line is asking for help", () => {
    const result = parse(createGoal, "--help");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.globals.help).toBe(true);
    }
  });

  it("keeps the tool's own flags out of the action's input", () => {
    const result = parse(
      listGoals,
      "--profile staging --space-id abc --cursor xyz",
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.input).toEqual({ spaceId: "abc" });
      expect(result.globals.profile).toBe("staging");
      expect(result.globals.cursor).toBe("xyz");
    }
  });

  it("refuses a loose word rather than guessing what it belongs to", () => {
    const result = parse(listGoals, "abc");
    expect(result.kind).toBe("error");
  });

  it("says when a flag that needs a value has none", () => {
    const result = parse(listGoals, "--space-id");
    expect(result).toEqual({
      kind: "error",
      message: "--space-id needs a value.",
    });
  });
});

describe("help", () => {
  it("names the method, the scope and every flag", () => {
    const text = commandHelp(listGoals);
    expect(text).toContain("GET /api/v1/goals/list");
    expect(text).toContain("read scope");
    expect(text).toContain("--level");
    expect(text).toContain("one of company, team");
  });
});

describe("the committed command list", () => {
  /**
   * The tie between this tool and the generator. If the artifact's shape moves,
   * this fails here rather than in somebody's terminal.
   */
  it("loads, and holds the commands the registry declares", () => {
    const contract = loadContract();
    expect(contract.version).toBe("v1");
    expect(contract.commands.length).toBeGreaterThan(200);

    const found = findCommand(contract, ["goals", "list", "--level", "team"]);
    expect(found?.command.action).toBe("goals.list");
    expect(found?.consumed).toBe(2);

    const level = found?.command.flags.find((flag) => flag.name === "level");
    expect(level?.enum).toContain("team");
  });

  it("has a write on POST and a read on GET, from the safety class", () => {
    const contract = loadContract();
    const list = findCommand(contract, ["goals", "list"])?.command;
    const create = findCommand(contract, ["goals", "create"])?.command;
    expect(list?.method).toBe("GET");
    expect(create?.method).toBe("POST");
    expect(create?.scope).toBe("write");
  });
});
