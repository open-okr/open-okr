import { describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { ACTIONS, actionNames, getAction } from "../src/actions/registry.ts";

/**
 * The action contract registry (TECHNICAL-PLAN §14).
 *
 * Every read and write is declared here once, with its schemas, its required
 * access level and its safety class. REST, OpenAPI, the MCP catalogue, the
 * command line and chat commands are all projections of this list, so a gap
 * here becomes a gap on six surfaces.
 */

describe("the registry", () => {
  it("declares at least the actions this task ships", () => {
    expect(actionNames()).toContain("workspace.rename");
    expect(actionNames()).toContain("workspace.provision");
  });

  it("has no duplicate names", () => {
    const names = actionNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("names every action as domain.verb, which the projections rely on", () => {
    for (const name of actionNames()) {
      expect(name, `${name} is not domain.verb`).toMatch(
        /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/,
      );
    }
  });

  it("gives every action a summary, schemas, an access level and a safety class", () => {
    for (const action of ACTIONS) {
      expect(
        action.summary.length,
        `${action.name} has no summary`,
      ).toBeGreaterThan(0);
      expect(action.input, `${action.name} has no input schema`).toBeDefined();
      expect(
        action.output,
        `${action.name} has no output schema`,
      ).toBeDefined();
      expect(
        Object.values(ACCESS_LEVELS),
        `${action.name} has an unknown access level`,
      ).toContain(action.access);
      expect(["read", "write", "destructive"]).toContain(action.safety);
    }
  });

  it("requires at least edit for anything that writes", () => {
    // A write action that only asked for view would be a silent escalation.
    for (const action of ACTIONS) {
      if (action.safety !== "read") {
        expect(
          action.access,
          `${action.name} writes but only needs view`,
        ).toBeGreaterThanOrEqual(ACCESS_LEVELS.edit);
      }
    }
  });

  it("routes every mutating action through the Operation pipeline", () => {
    // The structural guarantee behind "a mutation without its audit row is
    // impossible": a write action is built from an operation spec, so there is
    // no shape of registry entry that writes without the pipeline.
    for (const action of ACTIONS) {
      if (action.safety !== "read") {
        expect(
          action.runsThroughPipeline,
          `${action.name} bypasses the pipeline`,
        ).toBe(true);
      }
    }
  });

  it("looks an action up by name", () => {
    expect(getAction("workspace.rename")?.name).toBe("workspace.rename");
    expect(getAction("workspace.nonesuch")).toBeUndefined();
  });
});

describe("action input validation", () => {
  it("rejects input that does not match the schema", () => {
    const action = getAction("workspace.rename");
    if (!action) {
      throw new Error("workspace.rename is missing");
    }
    expect(action.input.safeParse({ name: "" }).success).toBe(false);
    expect(action.input.safeParse({}).success).toBe(false);
    expect(action.input.safeParse({ name: "A real name" }).success).toBe(true);
  });

  it("trims and bounds a workspace name rather than storing anything at all", () => {
    const action = getAction("workspace.rename");
    if (!action) {
      throw new Error("workspace.rename is missing");
    }
    expect(action.input.safeParse({ name: "   " }).success).toBe(false);
    expect(action.input.safeParse({ name: "x".repeat(201) }).success).toBe(
      false,
    );
  });
});
