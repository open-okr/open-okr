#!/usr/bin/env node
/**
 * `pnpm db:change`: runs every registered data-change script, batched and
 * resumable, skipping any already complete.
 *
 * `pnpm db:change --status` runs nothing. It reads the ledger and names each
 * script that has not run or has not finished, which is what
 * `./openokr status` shows (PLAN §5.1, plan 0.7.0 P9).
 *
 * `--max-seconds <n>` stops between batches once `n` seconds have passed and
 * says what is left, and runs nothing when another run holds the lock. The
 * Helm chart's hook runs it that way after every install and upgrade (plan
 * 0.8.0 H10c). `../data-change-command.ts` has the whole table, exit codes
 * included.
 *
 * Connects with DATABASE_ADMIN_URL when set, the same fallback `migrate.ts`
 * uses — the owner role, which owns the tables, with DATABASE_URL as the
 * single-role local fallback.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import {
  dataChangeCommand,
  parseDataChangeArgs,
} from "../data-change-command.ts";
import { registeredDataChanges } from "../data-changes/registry.ts";

// Before anything connects, so a mistyped flag sends nothing anywhere.
const command = parseDataChangeArgs(process.argv.slice(2));
if ("usage" in command) {
  process.stderr.write(`${command.usage}\n`);
  process.exit(2);
}

const env = loadEnv();
const url = env.DATABASE_ADMIN_URL ?? env.DATABASE_URL;
const scripts = registeredDataChanges(process.env.OPENOKR_ENCRYPTION_KEY);

const client = new pg.Client({ connectionString: url });
await client.connect();
let code: number;
try {
  code = await dataChangeCommand(client, scripts, command, {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
} finally {
  await client.end();
}
process.exit(code);
