import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Languages design §12 formats sweep:
 * Asserts that no raw "en-GB", "ms-MY", or argument-less toLocale*String()
 * exists in apps/web or packages sources outside the approved allow-list.
 */
describe("formats sweep (§12)", () => {
  it("finds no unapproved en-GB, ms-MY or argument-less toLocale*String() in product code", () => {
    let output = "";
    const repoRoot = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
    }).trim();
    try {
      // Grep across apps/web and packages/*/src from repository root
      output = execSync(
        `git grep -nE '"en-GB"|"ms-MY"|toLocale(Date|Time)?String\\(\\)' -- 'apps/web' 'packages/*/src' ':!apps/web/test/formats-sweep.test.ts'`,
        { cwd: repoRoot, encoding: "utf-8" },
      );
    } catch (e: unknown) {
      // Exit code 1 means 0 lines matched, which is fine
      output = (e as { stdout?: string }).stdout ?? "";
    }

    const lines = output.trim().split("\n").filter(Boolean);

    const violations: string[] = [];

    for (const line of lines) {
      // Allow-list checks:
      // 1. Files inherently defining the locale tags / registry
      if (
        line.startsWith("packages/formats/src/locales.ts:") ||
        line.startsWith("packages/formats/src/messages.ts:") ||
        line.startsWith("packages/ui/src/fields/date-format.ts:")
      ) {
        continue;
      }

      // 2. Machine use comments or evaluation report comment
      if (
        line.includes("// machine use:") ||
        line.includes("/* machine use:") ||
        line.includes("// engineer evaluation report") ||
        line.includes("machine use:")
      ) {
        continue;
      }

      // Check if previous line in file had machine use comment
      const match = /^([^:]+):(\d+):/.exec(line);
      if (match?.[1] && match[2]) {
        const file = match[1];
        const lineNum = Number.parseInt(match[2], 10);
        try {
          const prevLine = execSync(`sed -n '${lineNum - 1}p' "${file}"`, {
            cwd: repoRoot,
            encoding: "utf-8",
          }).trim();
          if (prevLine.includes("machine use:")) {
            continue;
          }
        } catch {
          // Ignore
        }
      }

      violations.push(line);
    }

    expect(
      violations,
      `Unapproved hard-coded locales or toLocale*String() calls found outside allow-list:\n${violations.join("\n")}`,
    ).toEqual([]);
  });
});
