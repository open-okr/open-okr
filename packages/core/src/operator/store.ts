/**
 * Reading as a cloud operator (P8-T03a).
 *
 * Design: `docs/design/p8-t01b-operator-console.md`.
 *
 * This directory and `packages/core/src/tenancy` are the only two the
 * boundary gate lets touch `tenants`. Everything here runs under
 * `withOperator`, which applies `app.operator_user_id` and no workspace
 * setting, so what comes back is whatever the operator policies in migration
 * 0084 name: the tenant rows, the workspace rows, the operator table, and the
 * usage view. No content table has such a policy, and none ever should.
 */
import {
  activeOnly,
  instanceOperators,
  tenants,
  withInstanceAdmin,
  withOperator,
  workspaces,
} from "@openokr/db";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

export interface OperatorWorkspaceRow {
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  readonly workspaceState: string;
  readonly tenantState: string;
  readonly planKey: string | null;
  readonly seats: number | null;
  readonly region: string;
  readonly closedAt: Date | null;
}

/** Whether this person holds a live grant. */
export async function isLiveOperator(
  pool: Pool,
  userId: string,
): Promise<boolean> {
  const db = drizzle(pool);
  const [row] = await withInstanceAdmin(db, (tx) =>
    tx
      .select({ userId: instanceOperators.userId })
      .from(instanceOperators)
      .where(
        and(
          eq(instanceOperators.userId, userId),
          isNull(instanceOperators.revokedAt),
        ),
      )
      .limit(1),
  );
  return Boolean(row);
}

/**
 * Every tenant this instance holds, as an operator sees it.
 *
 * Metadata only. A name and a slug cross, because they are how a support
 * request is matched to a customer and the customer chose them as an
 * identifier. Nothing else does.
 *
 * A revoked operator gets an empty list rather than an error, because the
 * policy is what answers and a revoked grant matches no row. That is the
 * behaviour worth having: revocation takes effect at the database on the next
 * query, not at the next sign-in.
 */
export async function listTenantsAsOperator(
  pool: Pool,
  operatorUserId: string,
): Promise<readonly OperatorWorkspaceRow[]> {
  const db = drizzle(pool);
  const rows = await withOperator(db, operatorUserId, (tx) =>
    tx
      .select({
        workspaceId: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        workspaceState: workspaces.state,
        tenantState: tenants.state,
        planKey: tenants.planKey,
        seats: tenants.seats,
        region: tenants.region,
        closedAt: tenants.closedAt,
      })
      .from(tenants)
      .innerJoin(workspaces, eq(workspaces.id, tenants.workspaceId))
      // `activeOnly` scopes the tenant row, and the joined workspace gets
      // its own predicate: the helper takes one table and this reads two,
      // each carrying its own `deleted_at`.
      .where(activeOnly(tenants, isNull(workspaces.deletedAt)))
      .orderBy(workspaces.name),
  );
  return rows;
}
