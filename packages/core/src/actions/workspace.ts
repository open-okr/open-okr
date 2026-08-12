/**
 * Workspace actions (TECHNICAL-PLAN §14).
 *
 * Two to start with, chosen because between them they exercise every stage of
 * the pipeline: `workspace.provision` is the bootstrap case with a system
 * actor and no workspace to load, and `workspace.rename` is the ordinary case
 * with a human actor, a freshly loaded row and a side effect.
 */
import { activeOnly, workspaces } from "@openokr/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { OperationError } from "../operations/operation.ts";
import { createWorkspace } from "../workspaces/provisioning.ts";
import { defineWriteAction } from "./define.ts";

const workspaceSummary = z.object({
  workspaceId: z.uuid(),
  name: z.string(),
  slug: z.string(),
});

export const renameWorkspace = defineWriteAction({
  name: "workspace.rename",
  summary: "Change a workspace's display name.",
  input: z.object({
    // Trimmed before the bound is checked, so a name of spaces is refused
    // rather than stored.
    name: z.string().trim().min(1).max(200),
  }),
  output: workspaceSummary,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    // Freshly loaded, inside the transaction that will do the writing. The
    // rename needs the old name for its audit payload, and loading it here
    // rather than trusting a value from the caller is what makes the trail
    // describe what actually changed.
    async load({ tx, workspaceId }) {
      const [current] = await tx
        .select({ name: workspaces.name, slug: workspaces.slug })
        .from(workspaces)
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .limit(1);
      if (!current) {
        throw new OperationError("not_found", "No such workspace.");
      }
      return current;
    },
    async execute({ tx, workspaceId, loaded }) {
      const [updated] = await tx
        .update(workspaces)
        .set({ name: input.name, updatedAt: new Date() })
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .returning({ name: workspaces.name, slug: workspaces.slug });

      if (!updated) {
        throw new OperationError("not_found", "No such workspace.");
      }

      return {
        result: { workspaceId, name: updated.name, slug: updated.slug },
        activity: {
          kind: "workspace.renamed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { from: loaded.name, to: updated.name },
        },
        audit: {
          action: "workspace.rename",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { from: loaded.name, to: updated.name },
        },
        outbox: [
          {
            topic: "workspace.renamed",
            payload: { workspaceId, from: loaded.name, to: updated.name },
            // One delivery per rename. Renaming back and forth is two
            // distinct events, so the key includes both ends.
            idempotencyKey: `workspace.renamed:${workspaceId}:${loaded.name}:${updated.name}`,
          },
        ],
      };
    },
  }),
});

export const setWorkspaceState = defineWriteAction({
  name: "workspace.setState",
  summary:
    "Set the workspace to active, read-only or frozen (TECHNICAL-PLAN §4.1, the freeze overlay).",
  input: z.object({ state: z.enum(["active", "read_only", "frozen"]) }),
  output: workspaceSummary.extend({
    state: z.enum(["active", "read_only", "frozen"]),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    // On the freeze overlay's own recovery list (packages/core/src/
    // operations/freeze.ts): the one write that must survive a freeze is
    // the one that lifts it, so this action itself never refuses on the
    // workspace's own state, only on the caller's access level.
    async load({ tx, workspaceId }) {
      const [current] = await tx
        .select({
          name: workspaces.name,
          slug: workspaces.slug,
          state: workspaces.state,
        })
        .from(workspaces)
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .limit(1);
      if (!current) {
        throw new OperationError("not_found", "No such workspace.");
      }
      return current;
    },
    async execute({ tx, workspaceId, loaded }) {
      const [updated] = await tx
        .update(workspaces)
        .set({ state: input.state, updatedAt: new Date() })
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .returning({
          name: workspaces.name,
          slug: workspaces.slug,
          state: workspaces.state,
        });
      if (!updated) {
        throw new OperationError("not_found", "No such workspace.");
      }

      return {
        result: {
          workspaceId,
          name: updated.name,
          slug: updated.slug,
          state: updated.state,
        },
        activity: {
          kind: "workspace.state_changed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { from: loaded.state, to: updated.state },
        },
        audit: {
          action: "workspace.set_state",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { from: loaded.state, to: updated.state },
        },
      };
    },
  }),
});

/**
 * Provisioning, declared here so an audit row reading `workspace.provision`
 * resolves back to a contract like every other action.
 *
 * Its handler does not use `defineWriteAction`'s operation wrapper, because
 * the workspace it runs in does not exist until the operation runs. The
 * pipeline is still the only thing that writes: `createWorkspace` is itself an
 * operation, which is what `runsThroughPipeline` records.
 */
export const provisionWorkspace = {
  name: "workspace.provision" as const,
  summary:
    "Create a workspace and its first member for a newly registered person.",
  input: z.object({
    user: z.object({ id: z.string().min(1), name: z.string().min(1) }),
    name: z.string().trim().min(1).max(200).optional(),
    timezone: z.string().optional(),
  }),
  output: workspaceSummary.extend({ memberId: z.uuid() }),
  access: ACCESS_LEVELS.full,
  safety: "write" as const,
  runsThroughPipeline: true,
  async handler(
    context: { pool: import("pg").Pool },
    rawInput: unknown,
  ): Promise<{
    workspaceId: string;
    memberId: string;
    name: string;
    slug: string;
  }> {
    const input = provisionWorkspace.input.parse(rawInput);
    return createWorkspace(context.pool, input);
  },
};
