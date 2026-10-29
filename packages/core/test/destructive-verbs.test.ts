import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "../src/index.ts";

/**
 * A tool that takes something away is destructive (MCP UAT BUG-003).
 *
 * The destructive class is what an AI client reads to ask before running a
 * tool, and what a token's `destructive` scope admits. Eighteen tools that
 * erase, remove, revoke, disconnect, detach or unlink were classed as plain
 * writes, so a write-only token ran them and no client asked first;
 * `people.erase` cannot be undone. The verb in the name is the rule, so a new
 * tool that removes something is held to it without anybody remembering.
 */

const REMOVING_VERB =
  /\.(erase|delete|remove|archive|revoke|disconnect|detach|unlink)($|[A-Z])/;

describe("tools that remove things", () => {
  it("are all classed destructive, and need the destructive scope", () => {
    const misclassed = MCP_TOOLS.filter((tool) => REMOVING_VERB.test(tool.name))
      .filter(
        (tool) =>
          tool.annotations.destructiveHint !== true ||
          tool.scope !== "destructive",
      )
      .map((tool) => tool.name);
    expect(misclassed).toEqual([]);
  });

  it("include people.erase, which cannot be undone", () => {
    const erase = MCP_TOOLS.find((tool) => tool.name === "people.erase");
    expect(erase?.annotations.destructiveHint).toBe(true);
    expect(erase?.scope).toBe("destructive");
  });
});
