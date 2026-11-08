/**
 * Gives every live workspace a tenant record, once the cloud flag is on
 * (docs/design/hosting-profiles.md §5).
 *
 * The record is written at provisioning, so a workspace made before the flag has
 * none, and the console lists from `tenants`. Without this, a company that starts
 * on one workspace and later turns the flag on would find its operator console
 * empty and its own workspace missing from it.
 *
 * Adopted workspaces get no plan: whatever people they have already joined under no
 * limit, and a plan is somebody's decision.
 */
import type { Pool } from "pg";
import { runOperation } from "../operations/operation.ts";
import { listLiveWorkspaces } from "../workspaces/scan.ts";
import { resolveCloudTenancy } from "./settings.ts";
import { readTenant, seedTenantInTx } from "./store.ts";

export async function adoptWorkspaces(pool: Pool): Promise<number> {
  const cloud = await resolveCloudTenancy(pool);
  if (!cloud.enabled) {
    return 0;
  }
  let adopted = 0;
  for (const { id } of await listLiveWorkspaces(pool)) {
    if (await readTenant(pool, id)) {
      continue;
    }
    await runOperation(
      { pool },
      {
        action: "workspace.adopted",
        workspaceId: id,
        actor: { kind: "system" },
        // No member is acting: the deployment turned the flag on, and this is the
        // scheduler catching up with it.
        bootstrap: true,
        async execute({ tx, workspaceId }) {
          await seedTenantInTx(tx, { workspaceId, cloud });
          return {
            result: undefined,
            activity: {
              kind: "workspace.adopted",
              subjectType: "workspace",
              subjectId: workspaceId,
              payload: {},
            },
            audit: {
              action: "workspace.adopted",
              targetType: "workspace",
              targetId: workspaceId,
              payload: { region: cloud.region },
            },
          };
        },
      },
    );
    adopted += 1;
  }
  return adopted;
}
