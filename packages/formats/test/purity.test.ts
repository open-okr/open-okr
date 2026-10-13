import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/**
 * The package imports nothing (docs/design/guided-inputs.md §4.1).
 *
 * It runs in the browser as somebody types and on the server before a write,
 * the same constraint `packages/method` holds. A source file that imported a
 * package, a Node built-in or another workspace would put that into every
 * browser bundle a field is in, and the second caller would no longer be the
 * same rule.
 */

const SOURCE = fileURLToPath(new URL("../src/", import.meta.url));

const IMPORTED =
  /(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

it("every source file imports only its siblings", async () => {
  const files = (await readdir(SOURCE)).filter((name) => name.endsWith(".ts"));
  expect(files.length).toBeGreaterThan(0);

  const outside: string[] = [];
  for (const name of files) {
    const text = await readFile(join(SOURCE, name), "utf8");
    for (const match of text.matchAll(IMPORTED)) {
      const specifier = match[1] ?? match[2] ?? "";
      if (!specifier.startsWith("./")) {
        outside.push(`${name} imports ${specifier}`);
      }
    }
  }
  expect(outside).toEqual([]);
});
