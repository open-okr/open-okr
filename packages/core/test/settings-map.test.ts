import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SETTINGS_REGISTRY } from "../src/settings/registry.ts";

/**
 * The settings registry and TECHNICAL-PLAN §4.14's map agree (completeness
 * review M-25).
 *
 * §4.14 says "a setting that is not in it does not exist", and seven settings
 * the registry resolved were in no row of it: the second factor, the storage
 * quota, the orphaned-upload age, message log retention, the chat window,
 * onboarding and demo data. Nothing compared the two, so each one arrived
 * with its task and the map never heard.
 */
const plan = readFileSync(
  fileURLToPath(
    new URL(
      "../../../docs/development-plan/TECHNICAL-PLAN.md",
      import.meta.url,
    ),
  ),
  "utf8",
);
const start = plan.indexOf("### 4.14 The settings map");
const end = plan.indexOf("\n## 5.", start);
const map = plan.slice(start, end);

describe("the §4.14 settings map", () => {
  it("is found, so a moved heading cannot make this agree with anything", () => {
    expect(start).toBeGreaterThan(-1);
    expect(map.length).toBeGreaterThan(2000);
  });

  it("names every registered setting", () => {
    const unnamed = SETTINGS_REGISTRY.map((entry) => entry.key).filter(
      (key) => !map.includes(`\`${key}\``),
    );
    expect(unnamed).toEqual([]);
  });
});
