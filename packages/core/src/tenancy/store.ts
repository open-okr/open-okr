/**
 * Reading and writing the tenant row (P8-T02a).
 *
 * Design: `docs/design/p8-t01a-tenant-lifecycle.md`.
 *
 * This module and the operator console are the only places allowed to touch
 * `tenants`, and `pnpm check:boundaries` is what enforces it. The rule is not
 * tidiness: a plan key read on the product path forks self-host from cloud,
 * and the fork stays invisible until a self-hosted instance meets the null.
 */
import { activeOnly, type Tenant, tenants, withWorkspace } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { CloudTenancy } from "./settings.ts";

/** The drizzle transaction handed to a `withWorkspace` callback. */
type AnyTx = Parameters<Parameters<typeof withWorkspace>[2]>[0];

export interface SeedTenantInput {
  readonly workspaceId: string;
  /** Resolved by the caller before the transaction opened. */
  readonly cloud: CloudTenancy;
}

/**
 * Contributes the tenant row to the workspace-provisioning transaction.
 *
 * One statement, in the shape the agents, the default space and the rhythm
 * settings already use (TECHNICAL-PLAN §4.14: "each module contributes its
 * rows to those Operations as it lands").
 *
 * **Returns without writing when the cloud is off**, which is the whole of
 * the self-hosted path. The branch is present and cheap rather than absent,
 * because an absent branch is the one nobody tests.
 *
 * Plan and seats are left null on purpose. Null plan is the free tier, so
 * the free tier needs no catalogue row, and null seats is unlimited, so a
 * signup is never refused for a plan nobody has chosen yet.
 */
export async function seedTenantInTx(
  tx: AnyTx,
  input: SeedTenantInput,
): Promise<void> {
  if (!input.cloud.enabled) {
    return;
  }
  // openokr:allow-mutation: this helper writes on the transaction its caller
  // already opened, which is `workspace.provision`'s own Operation. The same
  // arrangement `seedCoachInTx` and `createSpaceInTx` use, and for the same
  // reason: the audit, activity and outbox rows belong to the whole
  // provisioning, not to each module's statement inside it.
  await tx.insert(tenants).values({
    workspaceId: input.workspaceId,
    state: "active",
    region: input.cloud.region,
  });
}

export interface ReadTenantOptions {
  /**
   * Which workspace's floor to read under. Defaults to the workspace being
   * asked about, which is the ordinary case: a workspace reading its own
   * row. Naming a different one is how a test proves the policy answers
   * rather than the reader.
   */
  readonly asWorkspaceId?: string;
}

/**
 * One workspace's tenant row, or nothing.
 *
 * Nothing is the correct answer twice over and the caller cannot tell which:
 * a self-hosted instance has no row, and a workspace belonging to somebody
 * else is refused by the policy. Both come back undefined rather than as an
 * error, so no caller learns to wrap this in a try.
 */
export async function readTenant(
  pool: Pool,
  workspaceId: string,
  options: ReadTenantOptions = {},
): Promise<Tenant | undefined> {
  const db = drizzle(pool);
  const [row] = await withWorkspace(
    db,
    options.asWorkspaceId ?? workspaceId,
    (tx) =>
      tx
        .select()
        .from(tenants)
        .where(activeOnly(tenants, eq(tenants.workspaceId, workspaceId)))
        .limit(1),
  );
  return row;
}
