/**
 * `workspace.overview` (TECHNICAL-PLAN §14, P1-T08).
 *
 * The registry's first read action, and what the proving dashboard renders.
 * It exists so the page reads through one declared contract rather than
 * querying tables, which is the property every later surface depends on: REST,
 * OpenAPI, the MCP catalogue, the command line and chat commands all project
 * from this declaration, so they cannot drift from what the browser sees.
 *
 * **The access seam.** A read of a protected aggregate goes through the
 * access-aware getter, which returns not-found on forbidden and excludes
 * suspended members (§8.1 layer 2). The member is still resolved with its own
 * query first, because the getter takes a member id and this handler starts
 * with only a user id: filtered on the scoped workspace explicitly, since
 * row-level security is the tenant floor, not the query's predicate. The
 * `own_memberships` policy deliberately shows a person every membership they
 * hold, so a query that leans on the floor alone would answer with whichever
 * workspace the planner met first.
 */
import {
  activeOnly,
  withContext,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { OperationError } from "../operations/operation.ts";
import { defineReadAction } from "./define.ts";

const overviewOutput = z.object({
  workspace: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    state: z.enum(["active", "read_only", "frozen"]),
    /** Resolved at provisioning from the §4.14 settings map. */
    timezone: z.string(),
    language: z.string(),
  }),
  member: z.object({
    id: z.uuid(),
    name: z.string(),
    kind: z.enum(["human", "guest", "agent", "placeholder"]),
    status: z.enum(["active", "invited", "suspended"]),
    primaryChannel: z.string(),
  }),
});

export type WorkspaceOverview = z.infer<typeof overviewOutput>;

export const workspaceOverview = defineReadAction({
  name: "workspace.overview",
  summary: "The current workspace and the member reading it.",
  input: z.object({}),
  output: overviewOutput,
  access: ACCESS_LEVELS.view,
  async handler(context): Promise<WorkspaceOverview> {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;

    if (!userId) {
      throw new OperationError(
        "not_found",
        "No such workspace, or you are not a member of it.",
      );
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const [member] = await tx
          .select({
            id: workspaceMembers.id,
            name: workspaceMembers.name,
            kind: workspaceMembers.kind,
            status: workspaceMembers.status,
            primaryChannel: workspaceMembers.primaryChannel,
          })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, context.workspaceId),
              eq(workspaceMembers.userId, userId),
            ),
          )
          .limit(1);

        // Not-found rather than forbidden, for a non-member and for a
        // suspended member alike. A different answer for each would tell an
        // outsider that the workspace exists (§8.1 layer 2).
        if (member?.status !== "active") {
          throw new OperationError(
            "not_found",
            "No such workspace, or you are not a member of it.",
          );
        }

        // The one enforcement point: a member with no reachable binding on
        // the workspace's own context is refused here exactly like a
        // stranger would be, rather than trusting membership alone.
        await getAccessScoped(tx, {
          workspaceId: context.workspaceId,
          memberId: member.id,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });

        const [workspace] = await tx
          .select({
            id: workspaces.id,
            name: workspaces.name,
            slug: workspaces.slug,
            state: workspaces.state,
            settings: workspaces.settings,
          })
          // openokr:allow-raw-read: access to this workspace was just
          // confirmed by getAccessScoped above; this loads the row's own
          // display fields, which the getter itself does not return.
          .from(workspaces)
          .where(activeOnly(workspaces, eq(workspaces.id, context.workspaceId)))
          .limit(1);

        if (!workspace) {
          throw new OperationError(
            "not_found",
            "No such workspace, or you are not a member of it.",
          );
        }

        const settings = workspace.settings as Record<string, unknown>;

        return {
          workspace: {
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug,
            state: workspace.state,
            timezone: String(settings.timezone ?? "UTC"),
            language: String(settings.language ?? "en"),
          },
          member: {
            id: member.id,
            name: member.name,
            kind: member.kind,
            status: member.status,
            primaryChannel: member.primaryChannel,
          },
        };
      },
    );
  },
});
