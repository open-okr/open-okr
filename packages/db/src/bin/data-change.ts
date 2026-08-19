#!/usr/bin/env node
/**
 * `pnpm db:change`: runs every registered data-change script, batched and
 * resumable, skipping any already complete.
 *
 * Connects with DATABASE_ADMIN_URL when set, the same fallback `migrate.ts`
 * uses — the owner role, which owns the tables, with DATABASE_URL as the
 * single-role local fallback.
 */
import { loadEnv } from "@openokr/config";
import pg from "pg";
import { runDataChanges } from "../data-change.ts";
import { backfillMemberTimezone } from "../data-changes/0001_backfill_member_timezone.ts";
import { backfillWorkspaceStandardBinding } from "../data-changes/0002_backfill_workspace_standard_binding.ts";
import { backfillDefaultSpace } from "../data-changes/0003_backfill_default_space.ts";
import { backfillRhythmAndCycle } from "../data-changes/0004_backfill_rhythm_and_cycle.ts";
import { backfillCheckInReviewer } from "../data-changes/0005_backfill_check_in_reviewer.ts";
import { seedChampionAgent } from "../data-changes/0006_seed_champion_agent.ts";

const env = loadEnv();
const url = env.DATABASE_ADMIN_URL ?? env.DATABASE_URL;

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const outcomes = await runDataChanges(client, {
    scripts: [
      backfillMemberTimezone,
      backfillWorkspaceStandardBinding,
      backfillDefaultSpace,
      backfillRhythmAndCycle,
      backfillCheckInReviewer,
      seedChampionAgent,
    ],
  });
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
} finally {
  await client.end();
}
