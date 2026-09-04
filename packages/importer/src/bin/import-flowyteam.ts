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
 * **A dry run unless `--write` is given**, the same default the spreadsheet
 * command has and the right one for a command that writes a company's history
 * on one keystroke. The dry run resolves every source id against the target, so
 * what it reports is what a real run would write rather than what the source
 * holds.
 *
 * Today it imports the organisation, the OKRs, check-ins, KPIs, the work graph
 * and the conversation on it: people, spaces, membership, cycles, objectives,
 * key results, key result history, KPI categories and records, initiatives,
 * tasks, checklists, task comments and watchers. Task files arrive at P6-T04c,
 * because the bytes are on the source application's own disk and a read-only
 * MySQL connection cannot reach them.
 *
 * Exit codes follow `pnpm okr`: 2 for a usage error decided before anything is
 * sent, 1 for the source or the instance refusing.
 */
import { LocalDiskStorage } from "@openokr/adapters";
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
      write: args.write,
      // The instance's own byte store, which is where a copied file lands. Only
      // the driver, not `createAdapters`: an importer has no use for a job
      // queue or a realtime listener, and starting them would leave two
      // processes listening on the same channels.
      storage: new LocalDiskStorage({
        root: env.OPENOKR_STORAGE_ROOT,
        // Never used on this path: signing builds a download URL and nothing
        // here downloads. Passed because the driver requires one.
        signingSecret: env.BETTER_AUTH_SECRET,
      }),
      ...(args.filesRoot ? { filesRoot: args.filesRoot } : {}),
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
