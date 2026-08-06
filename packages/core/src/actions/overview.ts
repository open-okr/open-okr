/**
 * `workspace.overview` (TECHNICAL-PLAN §14, P1-T08).
 *
 * The registry's first read action, and what the proving dashboard renders.
 * It exists so the page reads through one declared contract rather than
 * querying tables, which is the property every later surface depends on: REST,
 * OpenAPI, the MCP catalogue, the command line and chat commands all project
 * from this declaration, so they cannot drift from what the browser sees.
 *
 * **The access seam.** A read of a protected aggregate is supposed to go
 * through the access-aware getter, which returns not-found on forbidden and
 * excludes suspended members (§8.1 layer 2). That getter is P2-T02. Until it
 * exists this resolves the member with its own query, shaped the same way as
 * the pipeline's `resolveActor`: filtered on the scoped workspace explicitly,
 * because row-level security is the tenant floor, not the query's predicate.
 * The `own_memberships` policy deliberately shows a person every membership
 * they hold, so a query that leans on the floor alone would answer with
 * whichever workspace the planner met first. Both call sites fold into
 * `can()` when it lands.
 */
import {
  activeOnly,
  withContext,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
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
        const [row] = await tx
          .select({
            workspaceId: workspaces.id,
            name: workspaces.name,
            slug: workspaces.slug,
            state: workspaces.state,
            settings: workspaces.settings,
            memberId: workspaceMembers.id,
            memberName: workspaceMembers.name,
            kind: workspaceMembers.kind,
            status: workspaceMembers.status,
            primaryChannel: workspaceMembers.primaryChannel,
          })
          .from(workspaceMembers)
          .innerJoin(
            workspaces,
            eq(workspaces.id, workspaceMembers.workspaceId),
          )
          .where(
            and(
              activeOnly(
                workspaceMembers,
                eq(workspaceMembers.workspaceId, context.workspaceId),
                eq(workspaceMembers.userId, userId),
              ),
              activeOnly(workspaces),
            ),
          )
          .limit(1);

        // Not-found rather than forbidden, for a non-member and for a
        // suspended member alike. A different answer for each would tell an
        // outsider that the workspace exists (§8.1 layer 2).
        if (row?.status !== "active") {
          throw new OperationError(
            "not_found",
            "No such workspace, or you are not a member of it.",
          );
        }

        const settings = row.settings as Record<string, unknown>;

        return {
          workspace: {
            id: row.workspaceId,
            name: row.name,
            slug: row.slug,
            state: row.state,
            timezone: String(settings.timezone ?? "UTC"),
            language: String(settings.language ?? "en"),
          },
          member: {
            id: row.memberId,
            name: row.memberName,
            kind: row.kind,
            status: row.status,
            primaryChannel: row.primaryChannel,
          },
        };
      },
    );
  },
});
