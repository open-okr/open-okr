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

const { results, filesChecked } = await lintMigrationDirs(dirs);

if (results.length > 0) {
  for (const result of results) {
    process.stderr.write(`${result.file}\n`);
    for (const problem of result.problems) {
      process.stderr.write(`  ${problem}\n`);
    }
  }
  process.exit(1);
}

if (filesChecked === 0) {
  process.stderr.write(
    `No migrations found under ${migrations}. The lint checked nothing, which is not a pass.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `Migration lint passed. ${filesChecked} file(s) checked.\n`,
);
