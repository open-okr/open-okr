#!/usr/bin/env node
/**
 * `pnpm db:lint`: fails any migration that creates a business table without
 * the tenant floor or the soft-delete default. Extra directories (test
 * fixtures) can be passed as arguments.
 *
 * Reports how many files it read, and fails when that is zero. A gate that
 * cannot find its input must not report success: a renamed directory would
 * otherwise turn this into a permanent pass.
 */
import { join } from "node:path";
import { lintMigrationDirs } from "../migration-lint.ts";

const migrations = join(import.meta.dirname, "../../migrations");
const dirs = [migrations, ...process.argv.slice(2)];

const { results, filesChecked, emptyDirs } = await lintMigrationDirs(dirs);

if (results.length > 0) {
  for (const result of results) {
    process.stderr.write(`${result.file}\n`);
    for (const problem of result.problems) {
      process.stderr.write(`  ${problem}\n`);
    }
  }
  process.exit(1);
}

// Per directory, not in total. A renamed migrations directory used to leave
// the total non-zero because the fixture directory still had files, so the
// gate reported success having read none of the real schema.
if (emptyDirs.length > 0) {
  for (const dir of emptyDirs) {
    process.stderr.write(
      `No .sql files found under ${dir}. The lint checked nothing there, which is not a pass.\n`,
    );
  }
  process.exit(1);
}

process.stdout.write(
  `Migration lint passed. ${filesChecked} file(s) checked.\n`,
);
