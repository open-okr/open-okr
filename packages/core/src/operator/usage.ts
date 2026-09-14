/**
 * Taking and reading the per-tenant usage snapshot (P8-T03b).
 *
 * **This is the third way out of a problem the first two could not solve.**
 * The P8-T01b design asked for counts an operator could read with no policy
 * on any content table, answered by a view. `force row level security`
 * applies to the table owner too, and migrations run as the owner rather than
 * as a superuser, so a view and a security-definer function over one are both
 * filtered and always count zero. P8-T03a wrote that view, measured zero, and
 * cut it rather than ship it.
 *
 * Giving the owner BYPASSRLS would disable the floor for every table to make
 * one count work, and is the privileged connection the design gate refused.
 * Counters maintained on every write are a second source of truth that
 * drifts invisibly.
 *
 * So the counts are taken **properly**, one workspace at a time through the
 * tenant setting, by a job that enumerates workspaces above the floor exactly
 * as the scheduler's own `listWorkspaces` already does. The operator reads
 * the result and never a content table.
 */
import {
  activeOnly,
  activities,
  blobs,
  checkIns,
  goals,
  operatorWorkspaceUsage,
  withInstanceAdmin,
  withOperator,
  withWorkspace,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { and, count, eq, max, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

export interface UsageSnapshot {
  readonly workspaceId: string;
  readonly memberCount: number;
  readonly goalCount: number;
  readonly checkInCount: number;
  readonly storageBytes: number;
  readonly lastActivityAt: Date | null;
  readonly measuredAt: Date;
}

/**
 * Counts one workspace, inside that workspace's own tenant context.
 *
 * Every count here runs under the ordinary floor, so it sees exactly what a
 * member of that workspace would see and nothing from anywhere else. That is
 * the point: no policy is loosened and no role is privileged to make a count
 * work.
 */
async function measureOne(
  pool: Pool,
  workspaceId: string,
): Promise<Omit<UsageSnapshot, "measuredAt">> {
  const db = drizzle(pool);
  return withWorkspace(db, workspaceId, async (tx) => {
    // Humans only. The Coach and the Champion are members of every workspace
    // and counting them would make every workspace look two people larger
    // than it is. A suspended member is a leaver and is not counted either,
    // which matches how P8-T01b counts a seat.
    const [members] = await tx
      .select({ n: count() })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          and(
            eq(workspaceMembers.kind, "human"),
            eq(workspaceMembers.status, "active"),
          ),
        ),
      );
    const [goalRows] = await tx
      .select({ n: count() })
      .from(goals)
      .where(activeOnly(goals));
    const [checkInRows] = await tx
      .select({ n: count() })
      .from(checkIns)
      .where(activeOnly(checkIns));
    const [bytes] = await tx
      .select({ total: sum(blobs.filesize) })
      .from(blobs)
      .where(activeOnly(blobs));
    const [activity] = await tx
      .select({ at: max(activities.at) })
      .from(activities);

    return {
      workspaceId,
      memberCount: members?.n ?? 0,
      goalCount: goalRows?.n ?? 0,
      checkInCount: checkInRows?.n ?? 0,
      // `sum` is numeric and the driver hands it back as a string, and null
      // when there are no rows. A silent NaN here would read as a workspace
      // storing nothing.
      storageBytes: Number(bytes?.total ?? 0),
      lastActivityAt: activity?.at ?? null,
    };
  });
}

export interface MeasureResult {
  readonly measured: number;
}

/**
 * Refreshes the snapshot for every live workspace.
 *
 * Enumerating workspaces is a raw read above the floor, the same thing
 * `listWorkspaces` in the scheduler does for the agent cadences and with the
 * same reason: a scheduled job has no acting member, and finding out which
 * workspaces exist is the one thing it must do before it can scope anything
 * at all.
 *
 * One workspace at a time rather than one query, deliberately. A single query
 * across every tenant would need to step around the floor, which is the thing
 * this whole design exists to avoid.
 */
export async function measureAllWorkspaces(pool: Pool): Promise<MeasureResult> {
  const db = drizzle(pool);
  // Under instance administration rather than as a raw read on the pool.
  // The floor hides every workspace from an unscoped application
  // connection, so the first version of this measured zero workspaces and
  // wrote nothing. Migration 0086 gives `workspaces` the select policy
  // `tenants` already had, which is a smaller privilege than the
  // role-with-BYPASSRLS that the audit chain command asks for.
  const live = await withInstanceAdmin(db, (tx) =>
    tx
      .select({ id: workspaces.id })
      // openokr:allow-raw-read: there is no acting member here and so no
      // access getter to go through. A scheduled measurement has to find out
      // which workspaces exist before it can scope anything at all, which is
      // the same reason listWorkspaces in the scheduler reads raw. Ids only,
      // and every count below runs inside the workspace proper.
      .from(workspaces)
      .where(activeOnly(workspaces))
      .orderBy(workspaces.createdAt),
  );
  const measuredAt = new Date();
  for (const row of live) {
    const snapshot = await measureOne(pool, row.id);
    // openokr:allow-mutation: a snapshot is a derived measurement, not a
    // domain change. It has no acting member, nothing to authorise and no
    // side effect to enqueue, and an audit row saying the instance counted
    // its own rows would be noise in a trail that exists to record what
    // people did. The marker sits above the statement rather than above the
    // insert, because that is where the rule looks.
    await withInstanceAdmin(db, (tx) =>
      tx
        .insert(operatorWorkspaceUsage)
        .values({ ...snapshot, measuredAt })
        // A snapshot is replaced, never appended. Keeping the old one would
        // be a second history nobody reads.
        .onConflictDoUpdate({
          target: operatorWorkspaceUsage.workspaceId,
          set: { ...snapshot, measuredAt },
        }),
    );
  }

  return { measured: live.length };
}

/**
 * The snapshot, as an operator sees it.
 *
 * Reached under `withOperator`, so a revoked grant returns nothing and no
 * content table is touched on the way.
 */
export async function readUsageAsOperator(
  pool: Pool,
  operatorUserId: string,
  workspaceId?: string,
): Promise<readonly UsageSnapshot[]> {
  const db = drizzle(pool);
  return withOperator(db, operatorUserId, (tx) => {
    const query = tx
      .select({
        workspaceId: operatorWorkspaceUsage.workspaceId,
        memberCount: operatorWorkspaceUsage.memberCount,
        goalCount: operatorWorkspaceUsage.goalCount,
        checkInCount: operatorWorkspaceUsage.checkInCount,
        storageBytes: operatorWorkspaceUsage.storageBytes,
        lastActivityAt: operatorWorkspaceUsage.lastActivityAt,
        measuredAt: operatorWorkspaceUsage.measuredAt,
      })
      .from(operatorWorkspaceUsage);
    return workspaceId
      ? query.where(eq(operatorWorkspaceUsage.workspaceId, workspaceId))
      : query;
  });
}
