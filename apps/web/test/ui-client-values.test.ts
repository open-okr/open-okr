import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/**
 * A server module calls no function from a "use client" module of
 * `packages/ui` (guided-inputs change 6b).
 *
 * Next.js hands a server component a reference in place of anything a
 * client module exports, so calling it throws in the production build, and
 * only there: Vitest and the development server both run it. The Work Map
 * printed confidence with `formatConfidence` while it lived in
 * `confidence-input.tsx`, and every page from the Work Map on failed once a
 * confidence existed to print. A component is fine to render; a value is not
 * fine to use.
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function filesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...filesUnder(path));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

const isClient = (source: string) => /^\s*"use client"/.test(source);

/** A server module that imports one, and why that is safe. */
const EXCEPTIONS: Readonly<Record<string, string>> = {
  // Re-exported as `fieldInputClass` for `admin/sso/sso-form.tsx`, a client
  // component, which is the only place that renders it.
  "apps/web/app/(auth)/auth-card.tsx FIELD_CONTROL_CLASS":
    "used by a client component only",
};

it("no server module uses a value a client module of packages/ui exports", () => {
  const clientValues = new Set<string>();
  for (const file of filesUnder(join(ROOT, "packages/ui/src"))) {
    const source = readFileSync(file, "utf8");
    if (!isClient(source)) {
      continue;
    }
    for (const match of source.matchAll(
      /export (?:const|function|let) ([a-z][A-Za-z0-9_]*|[A-Z][A-Z0-9_]+)\b/g,
    )) {
      clientValues.add(match[1] ?? "");
    }
  }
  expect(clientValues.size).toBeGreaterThan(0);

  const offenders: string[] = [];
  for (const file of filesUnder(join(ROOT, "apps/web"))) {
    const source = readFileSync(file, "utf8");
    if (isClient(source) || file.includes(`${join("apps", "web", "test")}`)) {
      continue;
    }
    for (const match of source.matchAll(
      /import\s*\{([^}]*)\}\s*from\s*"@openokr\/ui"/g,
    )) {
      for (const raw of (match[1] ?? "").split(",")) {
        const name = raw.trim();
        if (name === "" || name.startsWith("type ")) {
          continue;
        }
        const relative = file.slice(ROOT.length);
        if (clientValues.has(name) && !EXCEPTIONS[`${relative} ${name}`]) {
          offenders.push(`${relative} imports ${name}`);
        }
      }
    }
  }
  expect(offenders).toEqual([]);
});
