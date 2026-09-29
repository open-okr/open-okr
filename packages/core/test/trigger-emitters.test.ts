import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TRIGGER_CATALOGUE } from "@openokr/method";
import { describe, expect, it } from "vitest";

/**
 * Every §6.4 trigger has something that emits it (completeness review H-11).
 *
 * Twelve of the forty-five catalogue keys had a row in AI-NATIVE-PLAN §6.4
 * and nothing that ever sent them, and `pnpm method:check` passed throughout,
 * because it compares the document with the package, not with the code that
 * speaks. This compares the catalogue with the emitters: every key appears as
 * a literal in the code that builds nudges, or carries a written reason here.
 *
 * Both directions, the way the other coverage gates here work: an exemption
 * for a key that now has an emitter fails too, so the list cannot rot into a
 * set of excuses nobody rereads.
 */

const EXEMPT: Readonly<Record<string, string>> = {
  "session.due_soon":
    "emitted by dueSessionNudges in nudges/rituals.ts, which builds the key from sessionLifecycleStage's answer",
  "session.open":
    "emitted by dueSessionNudges in nudges/rituals.ts, which builds the key from sessionLifecycleStage's answer",
  "session.missed":
    "emitted by dueSessionNudges in nudges/rituals.ts, which builds the key from sessionLifecycleStage's answer",
  "quality.draft_failing":
    "not a nudge row: §6.4 addresses it to the author, inline, and the Draft Coach shows it as they type",
  "quality.gate_blocked":
    "not a nudge row: workflow.publish refuses with each red gate named to whoever pressed publish, and a refused write commits nothing a nudge could be recorded in",
};

const roots = ["../src", "../../agents/src"].map((relative) =>
  fileURLToPath(new URL(relative, import.meta.url)),
);

function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sources(path));
    } else if (entry.name.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found;
}

const code = roots
  .flatMap(sources)
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

describe("the §6.4 catalogue against its emitters", () => {
  const keys = TRIGGER_CATALOGUE.map((entry) => entry.key);

  it("finds an emitter or a written reason for every trigger", () => {
    const silent = keys.filter(
      (key) => !code.includes(`"${key}"`) && EXEMPT[key] === undefined,
    );
    expect(silent).toEqual([]);
  });

  it("holds no exemption for a key that is emitted, or that the catalogue does not have", () => {
    const stale = Object.keys(EXEMPT).filter(
      (key) => !keys.includes(key) || code.includes(`"${key}"`),
    );
    expect(stale).toEqual([]);
  });

  it("still builds the session keys the way the exemption says", () => {
    expect(code).toMatch(/`session\.\$\{stage\}`/);
  });
});
