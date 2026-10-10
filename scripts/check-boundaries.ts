#!/usr/bin/env node
/**
 * The architecture boundary gate.
 *
 * Fails the build when a vendor SDK is imported outside `packages/adapters`,
 * when application code reaches past a port into a concrete driver, or when a
 * write path causes a side effect directly instead of enqueuing an outbox
 * row. The rules themselves live in `packages/config/src/boundaries.ts`,
 * where they are unit tested.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BoundarySourceFile,
  checkBoundaries,
} from "../packages/config/src/boundaries.ts";
import {
  compareRawFields,
  countRawFields,
} from "../packages/config/src/raw-fields.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  "coverage",
  // Test files carry example violations as fixtures: the suite for these very
  // rules is full of "imports openai from core" strings. The boundaries exist
  // to protect what ships, so the scan covers shipped code.
  "test",
  "fixtures",
  "e2e",
]);

const collect = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    },
  );

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collect(path)));
    } else if (
      /\.(ts|tsx|js|mjs)$/.test(entry.name) &&
      !/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(entry.name)
    ) {
      files.push(path);
    }
  }
  return files;
};

const sources: BoundarySourceFile[] = [];
for (const root of ["apps", "packages"]) {
  for (const path of await collect(join(repoRoot, root))) {
    sources.push({
      // Forward slashes, so the rules match the same way on every platform.
      path: relative(repoRoot, path).split("\\").join("/"),
      text: await readFile(path, "utf8"),
    });
  }
}

/**
 * Tables that carry a row-level security policy, read from the migrations.
 *
 * **Derived rather than listed**, so a table added tomorrow is covered
 * tomorrow. A second list would be a second thing to keep true, and the whole
 * defect class this feeds exists because nobody could tell a guarded table
 * from an unguarded one by looking.
 */
const guardedTables = new Set<string>();
const migrationsDir = join(repoRoot, "packages/db/migrations");
for (const name of await readdir(migrationsDir)) {
  if (!name.endsWith(".sql")) {
    continue;
  }
  const sql = await readFile(join(migrationsDir, name), "utf8");
  for (const match of sql.matchAll(/create policy\s+\w+\s+on\s+(\w+)/gi)) {
    if (match[1]) {
      guardedTables.add(match[1]);
    }
  }
  for (const match of sql.matchAll(
    /alter table\s+(\w+)\s+enable row level security/gi,
  )) {
    if (match[1]) {
      guardedTables.add(match[1]);
    }
  }
}

if (guardedTables.size === 0) {
  process.stderr.write(
    "No policy-guarded tables were found under packages/db/migrations. " +
      "The unscoped-query rule would check nothing, which is not a pass.\n",
  );
  process.exit(1);
}

const violations = checkBoundaries(sources, { guardedTables });

/**
 * The raw-field ratchet (docs/design/guided-inputs.md §6). Every screen file
 * in `apps/web` may draw as many raw `<input>`, `<textarea>` and `<select>`
 * elements as the baseline says, and the baseline only goes down.
 */
const FIELD_BASELINE = join(repoRoot, "scripts/raw-fields-baseline.json");
const fieldCounts = new Map<string, number>();
for (const source of sources) {
  if (source.path.startsWith("apps/web/") && source.path.endsWith(".tsx")) {
    const count = countRawFields(source.text);
    if (count > 0) {
      fieldCounts.set(source.path, count);
    }
  }
}
const baselineText = await readFile(FIELD_BASELINE, "utf8").catch(() => null);
const fieldBaseline = JSON.parse(baselineText ?? "{}") as Record<string, number>;
const fieldFindings = compareRawFields(fieldCounts, fieldBaseline);

if (process.argv.includes("--update-field-baseline")) {
  // The first baseline is whatever the tree holds. Every later one may only
  // be lower, file by file.
  const raised = (baselineText === null ? [] : fieldFindings).filter(
    (finding) => (fieldCounts.get(finding.path) ?? 0) > (fieldBaseline[finding.path] ?? 0),
  );
  if (raised.length > 0) {
    process.stderr.write(
      [
        "The field baseline only goes down. These files draw more raw fields than it allows:",
        ...raised.map((finding) => `  ${finding.path} ${finding.message}`),
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  const entries = [...fieldCounts.entries()].sort(([a], [b]) => a.localeCompare(b));
  await writeFile(
    FIELD_BASELINE,
    `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`,
  );
  process.stdout.write(
    `Field baseline written: ${entries.length} file(s), ${entries.reduce((sum, [, n]) => sum + n, 0)} raw field(s).\n`,
  );
  process.exit(0);
}

if (violations.length > 0 || fieldFindings.length > 0) {
  const lines = violations.map(
    (violation) =>
      `  ${violation.path}:${violation.line} [${violation.rule}] ${violation.message}`,
  );
  const fieldLines = fieldFindings.map(
    (finding) => `  ${finding.path} [raw-field] ${finding.message}`,
  );
  process.stderr.write(
    [
      `Boundary check failed. ${violations.length + fieldFindings.length} violation(s):`,
      ...lines,
      ...fieldLines,
      "",
      "These boundaries are what keep the ports meaningful and side effects",
      "atomic with their writes, and every field on the field kit. See",
      "CLAUDE.md, hard rules, and docs/design/guided-inputs.md.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const rawFields = [...fieldCounts.values()].reduce((sum, n) => sum + n, 0);
process.stdout.write(
  `Boundary check passed. ${sources.length} file(s) checked, and ${rawFields} raw field(s) in ${fieldCounts.size} screen file(s) are within the field-kit baseline.\n`,
);
