#!/usr/bin/env node
/**
 * `pnpm db:lint`: fails any migration that creates a business table without
 * the tenant floor or the soft-delete default. Extra directories (test
 * fixtures) can be passed as arguments.
 */
import { join } from "node:path";
import { lintMigrationDirs } from "../migration-lint.ts";

const dirs = [
  join(import.meta.dirname, "../../migrations"),
  ...process.argv.slice(2),
];

const results = await lintMigrationDirs(dirs);

if (results.length > 0) {
  for (const result of results) {
    process.stderr.write(`${result.file}\n`);
    for (const problem of result.problems) {
      process.stderr.write(`  ${problem}\n`);
    }
  }
  process.exit(1);
}

process.stdout.write("Migration lint passed.\n");
