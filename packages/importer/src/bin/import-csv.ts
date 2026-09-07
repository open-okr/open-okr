#!/usr/bin/env node
/**
 * `pnpm import:csv`: a spreadsheet into a workspace (TECHNICAL-PLAN §7, P6-T01a).
 *
 * **A dry run unless told otherwise.** CLAUDE.md's own line for this command
 * says "dry-run by default", and it is the right default for the one command in
 * this product that writes a thousand rows on one keystroke. `--write` is the
 * word that makes it real.
 *
 * **`--as` names the person the import acts as, and there is no way around
 * it.** Every write goes through the Operation pipeline, which resolves an
 * acting member and authorises against their bindings; a command that invented
 * an ambient administrator would be the one service account with no owner that
 * CLAUDE.md forbids. The audit rows name whoever ran it.
 *
 * Everything below the argument parsing belongs to `packages/core`: the
 * readers, the templates, the mapping and the runner are shared with the
 * wizard, so the report a terminal prints and the report a screen shows come
 * from one engine (P6-T01b).
 *
 * Exit codes follow `pnpm okr`: 2 for a usage error decided before anything is
 * sent, 1 for the instance refusing or for rows the file could not import.
 */
import { readFile } from "node:fs/promises";
import { loadEnv } from "@openokr/config";
import {
  parseMappingFile,
  resolveImportTarget,
  runImport,
} from "@openokr/core";
import { Pool } from "pg";
import { parseArgs, render, USAGE, UsageError } from "../cli.ts";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const args = parseArgs(argv);
  const mapping = args.map
    ? parseMappingFile(await readFile(args.map, "utf8"), args.map)
    : undefined;
  if (mapping?.entity && mapping.entity !== args.entity) {
    throw new UsageError(
      `That mapping is for ${mapping.entity} and this run is for ${args.entity}.`,
    );
  }

  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const target = await resolveImportTarget(pool, {
      workspaceSlug: args.workspace,
      actorEmail: args.as,
    });

    const { report, runId } = await runImport({
      pool,
      workspaceId: target.workspaceId,
      userId: target.userId,
      entity: args.entity,
      file: args.file,
      ...(mapping ? { mapping } : {}),
      dryRun: !args.write,
    });

    process.stdout.write(`${render(report, runId)}\n`);
    if (report.skipped > 0) {
      // A file that partly imported is not a success, and a script wrapping
      // this command should be able to tell without parsing the report.
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
