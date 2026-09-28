/**
 * Every live workspace, for the scheduler and the maintenance commands
 * (completeness review H-02).
 *
 * A scheduled run has no acting member, so there is no access getter to go
 * through, and listing the tenants is the one thing it must do before it can
 * scope anything. It used to be a bare pool query, which worked only because
 * the Compose install connected as a superuser: under the restricted
 * application role the tenant floor hid every workspace, and the scheduler
 * ran for nobody. `withSystemScan` opens that one table for reading, inside
 * one transaction, and every run then opens its own workspace like a request.
 */
import { activeOnly, withSystemScan, workspaces } from "@openokr/db";
import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

export interface LiveWorkspace {
  readonly id: string;
  readonly slug: string;
  /** The workspace's own clock, `UTC` when it has none. */
  readonly timezone: string;
}

export async function listLiveWorkspaces(
  pool: Pool,
): Promise<readonly LiveWorkspace[]> {
  const rows = await withSystemScan(drizzle(pool), (tx) =>
    tx
      .select({
        id: workspaces.id,
        slug: workspaces.slug,
        settings: workspaces.settings,
      })
      // openokr:allow-raw-read: the system scan has no acting member to authorise; it lists tenants before any is known.
      .from(workspaces)
      .where(activeOnly(workspaces))
      .orderBy(asc(workspaces.createdAt)),
  );
  return rows.map((row) => {
    const timezone = row.settings.timezone;
    return {
      id: row.id,
      slug: row.slug,
      timezone:
        typeof timezone === "string" && timezone !== "" ? timezone : "UTC",
    };
  });
}
