/**
 * People actions (TECHNICAL-PLAN §4.1, screen S-33, P2-T03).
 *
 * **Self versus others.** `updateOwnProfile` is timezone, avatar and bio: the
 * fields that are nobody else's business. `updateMember` is name, title and
 * manager: the org-structural fields, editable only by someone holding
 * `full` on the workspace's own context, which today means whoever
 * provisioning gave a personal binding to. This split is this task's own
 * reading of "self-versus-others editable field sets" — TECHNICAL-PLAN
 * §4.1 names the property without drawing the line, so it is recorded here
 * and in STATUS.md for a human to confirm rather than assumed silently.
 *
 * **Suspend, restore, convert, erase** all require `full` and, except
 * restore, all refuse to act on the workspace's last full-access holder
 * (`isLastFullAccessHolder` in `../people/lifecycle.ts`).
 */
import { activeOnly, withWorkspace, workspaceMembers } from "@openokr/db";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { OperationError } from "../operations/operation.ts";
import {
  type ErasureExport,
  isLastFullAccessHolder,
  refuseIfLastOwner,
  stripBindings,
} from "../people/lifecycle.ts";
import {
  buildOrgChart,
  possibleManagers,
  wouldCreateManagerCycle,
} from "../people/manager-chain.ts";
import { isKnownTimezone } from "../settings/registry.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const memberSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  title: z.string().nullable(),
  kind: z.enum(["human", "guest", "agent", "placeholder"]),
  status: z.enum(["active", "invited", "suspended"]),
  managerId: z.uuid().nullable(),
  timezone: z.string().nullable(),
});

export const updateOwnProfile = defineWriteAction({
  name: "people.updateOwnProfile",
  summary: "Update the signed-in member's own timezone, avatar or bio.",
  input: z.object({
    timezone: z
      .string()
      .refine(isKnownTimezone, { message: "Unknown timezone." })
      .optional(),
    avatarBlobId: z.uuid().nullable().optional(),
    // Editor JSON, validated and sanitised by the shared module the rich
    // text editor task (P2-T11) delivers. Accepted loosely here rather than
    // ahead of that module existing.
    bio: z.unknown().optional(),
  }),
  output: memberSummary,
  // A write, so at least edit (the registry's own invariant: "a write that
  // only asked for view would be a silent escalation"). Every active member
  // now holds edit on the workspace's own context through workspace_standard
  // (packages/core/src/workspaces/provisioning.ts), which is what makes this
  // reachable by an ordinary member and not just the founding admin.
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("forbidden", "No member to update.");
      }
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.timezone !== undefined) {
        patch.timezone = input.timezone;
      }
      if (input.avatarBlobId !== undefined) {
        patch.avatarBlobId = input.avatarBlobId;
      }
      if (input.bio !== undefined) {
        patch.bio = input.bio;
        patch.bioVersion = sql`coalesce(${workspaceMembers.bioVersion}, 0) + 1`;
      }

      const [updated] = await tx
        .update(workspaceMembers)
        .set(patch)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, actor.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .returning({
          id: workspaceMembers.id,
          name: workspaceMembers.name,
          title: workspaceMembers.title,
          kind: workspaceMembers.kind,
          status: workspaceMembers.status,
          managerId: workspaceMembers.managerId,
          timezone: workspaceMembers.timezone,
        });
      if (!updated) {
        throw new OperationError("not_found", "No such member.");
      }

      return {
        result: updated,
        activity: {
          kind: "member.profile_updated",
          subjectType: "workspace_member",
          subjectId: updated.id,
          // The name at the moment of the edit, not just the id: a feed
          // entry has to read "Jane Doe updated their profile" without a
          // second query, and it has to keep reading that after Jane
          // renames herself or is later erased.
          payload: { name: updated.name },
        },
        audit: {
          action: "people.updateOwnProfile",
          targetType: "workspace_member",
          targetId: updated.id,
        },
      };
    },
  }),
});

export const updateMember = defineWriteAction({
  name: "people.updateMember",
  summary: "Update another member's name, title or manager (org fields).",
  input: z.object({
    memberId: z.uuid(),
    name: z.string().trim().min(1).max(200).optional(),
    title: z.string().trim().max(200).nullable().optional(),
    managerId: z.uuid().nullable().optional(),
  }),
  output: memberSummary,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      if (input.managerId) {
        const cycle = await wouldCreateManagerCycle(tx, {
          workspaceId,
          memberId: input.memberId,
          proposedManagerId: input.managerId,
        });
        if (cycle) {
          throw new OperationError(
            "forbidden",
            "That would make a manager chain that loops back on itself.",
          );
        }
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) {
        patch.name = input.name;
      }
      if (input.title !== undefined) {
        patch.title = input.title;
      }
      if (input.managerId !== undefined) {
        patch.managerId = input.managerId;
      }

      const [updated] = await tx
        .update(workspaceMembers)
        .set(patch)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .returning({
          id: workspaceMembers.id,
          name: workspaceMembers.name,
          title: workspaceMembers.title,
          kind: workspaceMembers.kind,
          status: workspaceMembers.status,
          managerId: workspaceMembers.managerId,
          timezone: workspaceMembers.timezone,
        });
      if (!updated) {
        throw new OperationError("not_found", "No such member.");
      }

      return {
        result: updated,
        activity: {
          kind: "member.updated",
          subjectType: "workspace_member",
          subjectId: updated.id,
          payload: { name: updated.name },
        },
        audit: {
          action: "people.updateMember",
          targetType: "workspace_member",
          targetId: updated.id,
        },
      };
    },
  }),
});

const statusChangeOutput = z.object({
  id: z.uuid(),
  status: z.enum(["active", "invited", "suspended"]),
});

export const suspendMember = defineWriteAction({
  name: "people.suspend",
  summary: "Suspend a member, removing every access they had.",
  input: z.object({ memberId: z.uuid() }),
  output: statusChangeOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      refuseIfLastOwner(
        await isLastFullAccessHolder(tx, workspaceId, input.memberId),
      );

      const [updated] = await tx
        .update(workspaceMembers)
        .set({
          status: "suspended",
          suspendedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .returning({
          id: workspaceMembers.id,
          status: workspaceMembers.status,
          name: workspaceMembers.name,
        });
      if (!updated) {
        throw new OperationError("not_found", "No such member.");
      }

      return {
        result: { id: updated.id, status: updated.status },
        activity: {
          kind: "member.suspended",
          subjectType: "workspace_member",
          subjectId: updated.id,
          payload: { name: updated.name },
        },
        audit: {
          action: "people.suspend",
          targetType: "workspace_member",
          targetId: updated.id,
        },
      };
    },
  }),
});

export const restoreMember = defineWriteAction({
  name: "people.restore",
  summary: "Restore a suspended member's access.",
  input: z.object({ memberId: z.uuid() }),
  output: statusChangeOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [updated] = await tx
        .update(workspaceMembers)
        .set({ status: "active", suspendedAt: null, updatedAt: new Date() })
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.status, "suspended"),
          ),
        )
        .returning({
          id: workspaceMembers.id,
          status: workspaceMembers.status,
          name: workspaceMembers.name,
        });
      if (!updated) {
        throw new OperationError(
          "not_found",
          "No such suspended member to restore.",
        );
      }

      return {
        result: { id: updated.id, status: updated.status },
        activity: {
          kind: "member.restored",
          subjectType: "workspace_member",
          subjectId: updated.id,
          payload: { name: updated.name },
        },
        audit: {
          action: "people.restore",
          targetType: "workspace_member",
          targetId: updated.id,
        },
      };
    },
  }),
});

export const convertToGuest = defineWriteAction({
  name: "people.convertToGuest",
  summary: "Convert a member to a guest, stripping their prior bindings.",
  input: z.object({ memberId: z.uuid() }),
  output: z.object({ id: z.uuid(), kind: z.literal("guest") }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      refuseIfLastOwner(
        await isLastFullAccessHolder(tx, workspaceId, input.memberId),
      );

      await stripBindings(tx, workspaceId, input.memberId);

      const [updated] = await tx
        .update(workspaceMembers)
        .set({ kind: "guest", updatedAt: new Date() })
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .returning({ id: workspaceMembers.id, name: workspaceMembers.name });
      if (!updated) {
        throw new OperationError("not_found", "No such member.");
      }

      return {
        result: { id: updated.id, kind: "guest" as const },
        activity: {
          kind: "member.converted_to_guest",
          subjectType: "workspace_member",
          subjectId: updated.id,
          payload: { name: updated.name },
        },
        audit: {
          action: "people.convertToGuest",
          targetType: "workspace_member",
          targetId: updated.id,
        },
      };
    },
  }),
});

export const eraseMember = defineWriteAction({
  name: "people.erase",
  summary:
    "Anonymise a member: their history stays attributable to a " +
    "placeholder identity, and their personal data is exported first.",
  input: z.object({ memberId: z.uuid() }),
  output: z.object({
    id: z.uuid(),
    export: z.object({
      memberId: z.uuid(),
      erasedAt: z.string(),
      priorProfile: z.object({
        name: z.string(),
        title: z.string().nullable(),
        bio: z.unknown(),
        timezone: z.string().nullable(),
      }),
    }),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const [before] = await tx
        .select({
          name: workspaceMembers.name,
          title: workspaceMembers.title,
          bio: workspaceMembers.bio,
          timezone: workspaceMembers.timezone,
        })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!before) {
        throw new OperationError("not_found", "No such member.");
      }
      return before;
    },
    async execute({ tx, workspaceId, loaded }) {
      refuseIfLastOwner(
        await isLastFullAccessHolder(tx, workspaceId, input.memberId),
      );

      const erasedAt = new Date();
      const [updated] = await tx
        .update(workspaceMembers)
        .set({
          name: "Erased member",
          title: null,
          bio: null,
          bioVersion: null,
          avatarBlobId: null,
          timezone: null,
          quietHours: null,
          userId: null,
          status: "suspended",
          suspendedAt: erasedAt,
          updatedAt: erasedAt,
        })
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .returning({ id: workspaceMembers.id });
      if (!updated) {
        throw new OperationError("not_found", "No such member.");
      }

      const exported: ErasureExport = {
        memberId: updated.id,
        erasedAt: erasedAt.toISOString(),
        priorProfile: {
          name: loaded.name,
          title: loaded.title,
          bio: loaded.bio,
          timezone: loaded.timezone,
        },
      };

      return {
        result: { id: updated.id, export: exported },
        activity: {
          kind: "member.erased",
          subjectType: "workspace_member",
          subjectId: updated.id,
          // The name from before erasure: the whole point of erasure is
          // that the row no longer carries it, so the feed entry has to.
          payload: { name: loaded.name },
        },
        audit: {
          action: "people.erase",
          targetType: "workspace_member",
          targetId: updated.id,
        },
      };
    },
  }),
});

export const directory = defineReadAction({
  name: "people.directory",
  summary: "Every active member of the workspace.",
  input: z.object({}),
  output: z.array(memberSummary),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, (tx) =>
      tx
        .select({
          id: workspaceMembers.id,
          name: workspaceMembers.name,
          title: workspaceMembers.title,
          kind: workspaceMembers.kind,
          status: workspaceMembers.status,
          managerId: workspaceMembers.managerId,
          timezone: workspaceMembers.timezone,
        })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, context.workspaceId),
            eq(workspaceMembers.status, "active"),
          ),
        ),
    );
  },
});

export const orgChart = defineReadAction({
  name: "people.orgChart",
  summary: "The manager chain as a tree.",
  input: z.object({}),
  output: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      title: z.string().nullable(),
      children: z.array(z.unknown()),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, (tx) =>
      buildOrgChart(tx, context.workspaceId),
    );
  },
});

export const possibleManagersFor = defineReadAction({
  name: "people.possibleManagers",
  summary: "Every member who could safely become this member's manager.",
  input: z.object({ memberId: z.uuid() }),
  output: z.array(z.object({ id: z.uuid(), name: z.string() })),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, (tx) =>
      possibleManagers(tx, context.workspaceId, input.memberId),
    );
  },
});
