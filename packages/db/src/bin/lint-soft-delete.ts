#!/usr/bin/env node
/**
 * `pnpm db:lint`: fails any drizzle read, update or delete of a
 * soft-deletable table that states no scope. The registry of soft-deletable
 * tables comes from the shipped schema sources in `packages/db/src/schema`;
 * application code across `apps/` and `packages/` is scanned.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  collectSoftDeletableTables,
  lintSoftDeleteUsage,
  type SourceFile,
} from "../soft-delete-lint.ts";

const repoRoot = join(import.meta.dirname, "../../../..");
const schemaDir = join(repoRoot, "packages/db/src/schema");

/** Directories whose contents are never linted. */
const EXCLUDED = new Set([
  "node_modules",
  "dist",
  ".next",
  ".turbo",
  // Tests and fixtures verify raw behaviour on purpose; the harness and the
  // db package itself implement the scope rather than consume it.
  "test",
  "fixtures",
]);

const collectFiles = async (dir: string): Promise<string[]> => {
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
    if (EXCLUDED.has(entry.name) || entry.name.startsWith(".")) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !path.startsWith(join(repoRoot, "packages/db/src"))
    ) {
      files.push(path);
    }
  }
  return files;
};

const schemaSources = await Promise.all(
  (await collectFiles(schemaDir)).map((path) => readFile(path, "utf8")),
);
const tables = collectSoftDeletableTables(schemaSources);

const sources: SourceFile[] = [];
for (const root of ["apps", "packages"]) {
  for (const path of await collectFiles(join(repoRoot, root))) {
    sources.push({
      path: relative(repoRoot, path),
      text: await readFile(path, "utf8"),
    });
  }
}

const violations = lintSoftDeleteUsage(sources, tables);

if (violations.length > 0) {
  for (const violation of violations) {
    process.stderr.write(
      `${violation.path}:${violation.line} ${violation.message}\n`,
    );
  }
  process.exit(1);
}

process.stdout.write(
  `Soft-delete lint passed. ${tables.size} soft-deletable table(s), ${sources.length} file(s) checked.\n`,
);
