#!/usr/bin/env node
/**
 * `pnpm import:flowyteam`: a FlowyTeam company, read-only (TECHNICAL-PLAN §7,
 * P6-T02).
 *
 * **It cannot write to the source, and that is the point of the task.** The
 * session is opened read-only and every statement is checked against an allow
 * list of reads before it is sent, so neither a write nor a lock leaves this
 * process. `packages/importer/test/flowyteam-source.test.ts` proves it by
 * attempting a real insert against a real MySQL and reading the server's own
 * refusal.
 *
 * **It cannot write to the target either, yet.** The mappers arrive at P6-T03
 * and P6-T04. What this command does today is connect, say which FlowyTeam the
 * source is, name the one company and count what it holds. `--write` is refused
 * by name rather than accepted and quietly ignored.
 *
 * Exit codes follow `pnpm okr`: 2 for a usage error decided before anything is
 * sent, 1 for the source or the instance refusing.
 */
import { loadEnv } from "@openokr/config";
import { resolveImportTarget } from "@openokr/core";
import { Pool } from "pg";
import { UsageError } from "../cli.ts";
import { FLOWYTEAM_USAGE, parseFlowyteamArgs } from "../flowyteam/cli.ts";
import { render } from "../flowyteam/report.ts";
import { runFlowyteamImport } from "../flowyteam/run.ts";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${FLOWYTEAM_USAGE}\n`);
    return;
  }

  const args = parseFlowyteamArgs(argv);
  const env = loadEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const target = await resolveImportTarget(pool, {
      workspaceSlug: args.workspace,
      actorEmail: args.as,
    });

    const { report, runId } = await runFlowyteamImport({
      pool,
      workspaceId: target.workspaceId,
      userId: target.userId,
      url: args.source,
      companyId: args.company,
    });

    process.stdout.write(`${render(report, runId)}\n`);
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
