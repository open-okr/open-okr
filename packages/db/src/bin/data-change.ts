#!/usr/bin/env node
/**
 * `pnpm db:change`: runs every registered data-change script, batched and
 * resumable, skipping any already complete.
 *
 * `pnpm db:change --status` runs nothing. It reads the ledger and names each
 * script that has not run or has not finished, which is what
 * `./openokr status` shows (PLAN §5.1, plan 0.7.0 P9).
 *
 * Connects with DATABASE_ADMIN_URL when set, the same fallback `migrate.ts`
 * uses — the owner role, which owns the tables, with DATABASE_URL as the
 * single-role local fallback.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { dataChangeStatus, runDataChanges } from "../data-change.ts";
import { registeredDataChanges } from "../data-changes/registry.ts";

const env = loadEnv();
const url = env.DATABASE_ADMIN_URL ?? env.DATABASE_URL;
const scripts = registeredDataChanges(process.env.OPENOKR_ENCRYPTION_KEY);
const statusOnly = process.argv.slice(2).includes("--status");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (statusOnly) {
    const status = await dataChangeStatus(client, scripts);
    const open = status.filter((one) => one.state !== "complete");
    process.stdout.write(
      open.length === 0
        ? `Data changes: all ${status.length} complete.\n`
        : `Data changes: ${open.length} of ${status.length} not complete. ` +
            `Run them with \`pnpm db:change\`, or \`./openokr data-change\` ` +
            `on Docker Compose.\n${open
              .map((one) => `  ${one.name}: ${one.state}. ${one.summary}`)
              .join("\n")}\n`,
    );
  } else {
    const outcomes = await runDataChanges(client, { scripts });
    process.stdout.write(
      outcomes.length === 0
        ? "Nothing to run. Every registered script is already complete.\n"
        : `Ran ${outcomes.length} script(s):\n${outcomes
            .map(
              (outcome) =>
                `  ${outcome.name}: ${outcome.batches} batch(es), ${outcome.rowsChanged} row(s) changed`,
            )
            .join("\n")}\n`,
    );
  }
} finally {
  await client.end();
}
