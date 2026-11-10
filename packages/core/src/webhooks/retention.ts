/**
 * The delivery log's retention (docs/design/outbound-webhooks.md W10).
 *
 * Thirty days, then gone: a delivery row records an attempt, and an attempt a
 * month old answers no question an administrator still has. The scheduler runs
 * this once a day for each workspace, under the workspace's own tenant
 * setting, so the floor is never lifted to reach it.
 *
 * **Not an Operation.** It deletes delivery bookkeeping, as the outbox purge
 * does, and changes nothing anybody did; an audit row a day per workspace
 * saying "the log got shorter" would bury the ones that matter.
 */
import { withWorkspace } from "@openokr/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { DELIVERY_LOG_DAYS } from "./jobs.ts";

/** Rows removed per statement, so a large backlog never holds one long lock. */
const BATCH = 5_000;

/** Removes one workspace's delivery rows past the window. Returns how many. */
export async function purgeWebhookDeliveries(
  pool: Pool,
  workspaceId: string,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - DELIVERY_LOG_DAYS * 86_400_000);
  const db = drizzle(pool);
  let total = 0;
  for (;;) {
    const removed = await withWorkspace(db, workspaceId, (tx) =>
      // openokr:allow-mutation: retention of delivery bookkeeping, a hard
      // delete as migration 0164's marker says. Not a domain write.
      tx.execute<{ id: string }>(sql`
        delete from webhook_deliveries
         where id in (
           select id from webhook_deliveries
            where workspace_id = ${workspaceId}
              and attempted_at < ${cutoff}
            limit ${BATCH}
         )
        returning id`),
    );
    total += removed.rows.length;
    if (removed.rows.length < BATCH) {
      return total;
    }
  }
}
