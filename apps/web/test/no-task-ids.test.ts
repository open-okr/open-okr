import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nothing a user or an API client reads names a plan task (completeness
 * review H-24).
 *
 * A task id is a note between the people building this. It reached the
 * product anyway: "Not in this build. Arrives in Phase 5" on the first screen
 * of every install, "arrives at P6-G16" on the scorecard, "(P8-T02c)" in the
 * public API's own description of an action. Each looked like a finished
 * product telling its user it was unfinished. The end-to-end accessibility
 * walk checks every rendered screen for the same thing; this checks the text
 * that reaches a client without a screen: the message catalogues and the
 * generated contracts.
 */

const ROOT = join(import.meta.dirname, "../../..");
const TASK_ID = /\bP[1-8]-[TG]\d+[a-z]?\b/;

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(join(ROOT, path), "utf8"));

/** Every string anywhere in a parsed JSON document, with where it was. */
function* strings(value: unknown, at = "$"): Generator<[string, string]> {
  if (typeof value === "string") {
    yield [at, value];
  } else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      yield* strings(item, `${at}[${index}]`);
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      yield* strings(item, `${at}.${key}`);
    }
  }
}

describe("the message catalogues", () => {
  for (const locale of ["en", "ms"]) {
    it(`${locale} names no plan task`, async () => {
      const catalogue = (await readJson(
        `packages/ui/src/i18n/messages/${locale}.json`,
      )) as Record<string, string>;
      const named = Object.entries(catalogue)
        .filter(([, text]) => TASK_ID.test(text))
        .map(([key]) => key);
      expect(named).toEqual([]);
    });
  }
});

describe("the generated contracts", () => {
  for (const contract of [
    "contract/openapi.json",
    "contract/cli.json",
    "contract/mcp.json",
  ]) {
    it(`${contract} names no plan task`, async () => {
      const named = [...strings(await readJson(contract))]
        .filter(([, text]) => TASK_ID.test(text))
        .map(([at, text]) => `${at}: ${text.slice(0, 80)}`);
      expect(named).toEqual([]);
    });
  }
});
