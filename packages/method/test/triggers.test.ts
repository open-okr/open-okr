import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { examplesFor, QUALITY_EXAMPLES } from "../src/quality.ts";
import {
  deterministicTriggers,
  isTriggerKey,
  TRIGGER_CATALOGUE,
  trigger,
} from "../src/triggers.ts";

/**
 * The trigger catalogue and the §4.6 examples (P4-T01e).
 *
 * These tests read the documents at run time rather than restating them. A
 * catalogue transcribed by hand drifts the moment somebody edits the document
 * and not the code, and the whole point of this file is that a message cannot
 * cite a rule key nothing defines. P4-T01g turns this into `pnpm method:check`
 * and runs it over every document; the reading is here first because the
 * catalogue it protects is here.
 *
 * `packages/method` itself stays pure. A test may read a file; the package
 * never does.
 */

const docs = join(import.meta.dirname, "../../../docs/development-plan");
const design = join(import.meta.dirname, "../../../docs/design");

/** Every `rule.key` in a markdown table's first column. */
const keysInTables = (
  markdown: string,
  sectionStart: string,
  sectionEnd: string,
) => {
  const from = markdown.indexOf(sectionStart);
  const to = markdown.indexOf(sectionEnd, from + 1);
  const body = markdown.slice(from, to === -1 ? undefined : to);
  return body
    .split("\n")
    .map((line) => /^\|\s*`([a-z_]+\.[a-z_]+)`\s*\|/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
};

describe("the trigger catalogue against AI-NATIVE-PLAN.md §6.4", () => {
  const plan = readFileSync(join(docs, "AI-NATIVE-PLAN.md"), "utf8");
  const documented = keysInTables(
    plan,
    "### 6.4 The full trigger catalogue",
    "### 6.5",
  );

  it("finds keys in the document at all, so a silent zero cannot pass", () => {
    expect(documented.length).toBeGreaterThan(40);
  });

  it("defines every key the document lists, and no others", () => {
    const defined = TRIGGER_CATALOGUE.map((entry) => entry.key).sort();
    expect(defined).toEqual([...documented].sort());
  });

  it("keeps every key unique", () => {
    expect(new Set(TRIGGER_CATALOGUE.map((entry) => entry.key)).size).toBe(
      TRIGGER_CATALOGUE.length,
    );
  });

  it("splits ownership the way §6.4's two tables do", () => {
    const coach = TRIGGER_CATALOGUE.filter((entry) => entry.owner === "coach");
    // Every quality trigger belongs to the Coach and every other to the
    // Champion, which is what makes the rule key readable as an owner.
    expect(coach.every((entry) => entry.key.startsWith("quality."))).toBe(true);
    expect(
      TRIGGER_CATALOGUE.filter((entry) => entry.owner === "champion").every(
        (entry) => !entry.key.startsWith("quality."),
      ),
    ).toBe(true);
  });
});

describe("what still fires with the provider off", () => {
  it("is everything except the one judgement about meaning", () => {
    const needsAi = TRIGGER_CATALOGUE.filter((entry) => !entry.deterministic);
    expect(needsAi.map((entry) => entry.key)).toEqual(["quality.conflict"]);
    expect(deterministicTriggers()).toHaveLength(TRIGGER_CATALOGUE.length - 1);
  });
});

describe("the lookup a caller uses before writing a nudge row", () => {
  it("resolves a real key and refuses an invented one", () => {
    expect(trigger("checkin.overdue")?.escalates).toBe(true);
    expect(isTriggerKey("checkin.overdue")).toBe(true);
    expect(trigger("checkin.definitely_not_a_rule")).toBeUndefined();
    expect(isTriggerKey("checkin.definitely_not_a_rule")).toBe(false);
  });
});

describe("METHOD.md §4.6's weak and strong pairs", () => {
  const method = readFileSync(join(docs, "METHOD.md"), "utf8");

  it("carries all four, with the document's own words", () => {
    expect(QUALITY_EXAMPLES).toHaveLength(4);
    for (const pair of QUALITY_EXAMPLES) {
      // Strip the "Objective: " and "KR: " labels the table uses inline.
      const weak = pair.weak.replace(/^(Objective|KR): /, "");
      expect(method).toContain(weak);
      expect(method).toContain(pair.why);
    }
  });

  it("names checks the catalogue actually defines", () => {
    for (const pair of QUALITY_EXAMPLES) {
      expect(pair.firesChecks.length).toBeGreaterThan(0);
      for (const id of pair.firesChecks) {
        expect(examplesFor(id)).toContain(pair);
      }
    }
  });

  it("returns nothing for a check §4.6 has no example for", () => {
    // Four pairs, not twenty-six. A rule card with no example shows its prompt
    // and says nothing more, which is correct rather than a gap.
    expect(examplesFor("OBJ-3")).toEqual([]);
  });

  it("attaches the measurability pair to both checks it trips", () => {
    const pair = QUALITY_EXAMPLES.find((entry) =>
      entry.weak.includes("Improve customer satisfaction"),
    );
    expect(pair?.firesChecks).toEqual(["KR-2", "KR-4"]);
  });
});

describe("the design document's own trigger table", () => {
  const doc = readFileSync(join(design, "p4-t00-agent-design.md"), "utf8");
  const documented = keysInTables(
    doc,
    "## 3. The trigger catalogue",
    "### 3.3",
  );

  it("agrees with the package, so the gate document and the plan cannot drift apart", () => {
    expect(new Set(documented)).toEqual(
      new Set(TRIGGER_CATALOGUE.map((entry) => entry.key)),
    );
  });
});
