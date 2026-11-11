/**
 * Adopting workspaces from the console (Q-9, plan 0.8.1).
 *
 * Turning the cloud flag on after workspaces exist left the console reading
 * "0 tenants" until the hourly adopt reached them, and nothing on screen said
 * why. The console now counts the workspaces waiting and offers Adopt now.
 *
 * **The same adopt as `pnpm cloud:adopt`**, `adoptWorkspaces`: one Operation
 * per workspace, each writing that workspace's own `workspace.adopted` audit
 * row, and a second run changes nothing. What the console adds is the grant
 * check at this door and one instance audit row naming the operator, as the
 * default-plan fill does (`default-plan.ts`).
 */
import type { Pool } from "pg";
import { recordInstanceAuditEvent } from "../audit/instance-chain.ts";
import { OperationError } from "../operations/operation.ts";
import { adoptWorkspaces } from "../tenancy/adopt.ts";
import { resolveCloudTenancy } from "../tenancy/settings.ts";
import { listLiveWorkspaces } from "../workspaces/scan.ts";
import { isLiveOperator, listTenantsAsOperator } from "./store.ts";

async function requireLiveOperator(pool: Pool, userId: string): Promise<void> {
  if (!(await isLiveOperator(pool, userId))) {
    throw new OperationError("not_found", "No such page.");
  }
}

/**
 * How many live workspaces have no tenant record, so are not in the console.
 *
 * A count and nothing else: the workspaces are not listed until they are
 * adopted, because a tenant record is what puts a workspace in front of an
 * operator. Zero with the flag off, where adopting would do nothing.
 */
export async function countWorkspacesAwaitingAdoption(
  pool: Pool,
  operatorUserId: string,
): Promise<number> {
  await requireLiveOperator(pool, operatorUserId);
  if (!(await resolveCloudTenancy(pool)).enabled) {
    return 0;
  }
  const [live, tenants] = await Promise.all([
    listLiveWorkspaces(pool),
    listTenantsAsOperator(pool, operatorUserId),
  ]);
  const adopted = new Set(tenants.map((tenant) => tenant.workspaceId));
  return live.filter((workspace) => !adopted.has(workspace.id)).length;
}

/** Adopt now: every waiting workspace, and how many that was. */
export async function adoptWorkspacesAsOperator(
  pool: Pool,
  input: { readonly operatorUserId: string },
): Promise<number> {
  await requireLiveOperator(pool, input.operatorUserId);
  const adopted = await adoptWorkspaces(pool);
  // Written when nothing was left too: the operator pressed it, and the
  // trail says what came of that.
  await recordInstanceAuditEvent(pool, {
    action: "operator.workspaces_adopted",
    payload: { operatorUserId: input.operatorUserId, adopted },
  });
  return adopted;
}
