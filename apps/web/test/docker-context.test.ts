import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * What the Docker build context leaves out (UAT 0.8.0 Q-11).
 *
 * The acceptance test found an untracked `apps/web/.env` symlink in the build
 * context: `.dockerignore` named only the root's env files, so a nested one
 * holding real values would have been copied into the build stage. Docker
 * reads these patterns itself, so this holds the lines rather than imitating
 * its matcher.
 */
const patterns = readFileSync(
  new URL("../../../.dockerignore", import.meta.url),
  "utf8",
)
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));

describe("the Docker build context", () => {
  it("leaves out every env file, at any depth", () => {
    expect(patterns).toEqual(
      expect.arrayContaining([".env", ".env.*", "**/.env", "**/.env.*"]),
    );
  });

  it("keeps the example, and only the root's", () => {
    expect(patterns.filter((line) => line.startsWith("!"))).toEqual([
      "!.env.example",
    ]);
  });
});
