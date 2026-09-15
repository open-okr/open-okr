/**
 * The closure retention sweep (P8-T02c).
 *
 * Design: `docs/design/p8-t01a-tenant-lifecycle.md` §6.
 *
 * **It deletes nothing by default, and that is the whole design.** P7-T08c
 * set the precedent for every retention decision in this product:
 *
 * > A number out of the box would delete data on every instance that never
 * > chose one, on the first sweep after an upgrade, and nobody would have
 * > asked for it. So "not configured" must never mean "delete everything".
 *
 * `cloud.closureRetentionDays` is zero until an operator sets it, and zero
 * means never erase. The sweep reads the setting first and returns before it
 * has looked at a single row.
 *
 * **The sweep does not erase.** It names the workspaces that are due and the
 * data-change runner does the work, because a backfill runner is batched,
 * resumable and idempotent by ledger, and a cron job deleting rows is none of
 * those. Erasing a workspace is the least reversible thing this product can
 * do and it gets the machinery built for exactly that.
 */
import { activeOnly, tenants, withInstanceAdmin } from "@openokr/db";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { resolveCloudTenancy } from "./settings.ts";

interface DueForErasure {
  readonly workspaceId: string;
  readonly closedAt: Date;
}

export interface SweepResult {
  /** Why the sweep did what it did, for the log line it writes. */
  readonly reason: "not_a_cloud" | "retention_off" | "swept";
  readonly retentionDays: number;
  readonly due: readonly DueForErasure[];
}

export interface SweepOptions {
  /** Injected so a test can stand a long way past a closure. */
  readonly now?: Date;
}

/**
 * Names the closed workspaces whose retention window has passed.
 *
 * Reads across every tenant, so it runs above the tenant floor. It is a
 * scheduler job rather than a request, and it asks one question of one
 * column; the rows it returns carry an id and an instant and nothing else,
 * so nothing about any customer's content passes through here.
 */
export async function sweepClosedTenants(
  pool: Pool,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const cloud = await resolveCloudTenancy(pool);

  if (!cloud.enabled) {
    return { reason: "not_a_cloud", retentionDays: 0, due: [] };
  }
  if (cloud.closureRetentionDays <= 0) {
    // Read the setting, touch no row, and say so. A sweep that silently did
    // nothing and a sweep that found nothing look identical in a log, and
    // only one of them is a configuration somebody should know about.
    return {
      reason: "retention_off",
      retentionDays: cloud.closureRetentionDays,
      due: [],
    };
  }

  const now = options.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - cloud.closureRetentionDays * 24 * 60 * 60 * 1000,
  );

  const db = drizzle(pool);
  const due = await withInstanceAdmin(db, (tx) =>
    tx
      .select({
        workspaceId: tenants.workspaceId,
        closedAt: tenants.closedAt,
      })
      .from(tenants)
      .where(
        activeOnly(
          tenants,
          and(
            eq(tenants.state, "closed"),
            isNotNull(tenants.closedAt),
            lte(tenants.closedAt, cutoff),
          ),
        ),
      ),
  );

  return {
    reason: "swept",
    retentionDays: cloud.closureRetentionDays,
    due: due.map((row) => ({
      workspaceId: row.workspaceId,
      // Narrowed by the `isNotNull` above, which the query builder's type
      // cannot see. Migration 0082's check constraint also guarantees it for
      // every closed row.
      closedAt: row.closedAt as Date,
    })),
  };
}
