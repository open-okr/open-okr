/**
 * Space actions (TECHNICAL-PLAN §4.2, §4.14, P3-T01).
 *
 * **Who may administer a space.** The access model has no ambient admin
 * authority: effective access is the maximum over reachable bindings (§4.1),
 * and a workspace admin's `full` binding is on the *workspace* context, not on
 * each space. Read strictly, that leaves a workspace admin holding only the
 * `view` every human member gets, unable to repair a space whose only manager
 * was suspended.
 *
 * So space administration requires **`full` on the space, or `full` on the
 * workspace**, checked explicitly in `requireSpaceAdmin` below. That is a
 * second path, written into the action and audited like the first, not an
 * ambient grant: it applies to space administration only, it is not inherited
 * by anything the space owns, and an agent never reaches it, because an
 * agent-kind member cannot hold the `workspace_standard` tier at all
 * (`resolveMemberAccessLevel`).
 *
 * Recorded on the P3-T01 row in STATUS.md, because §4.1 does not spell it out.
 */
import {
  accessContexts,
  activeOnly,
  SPACE_ROLES,
  spaceMembers,
  spaces,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { accessScopeFilter, getAccessScoped } from "../access/reads.ts";
import { bindImporterInTx } from "../imports/binding.ts";
import { assertLegacyKeyFree, legacyKey } from "../imports/legacy.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { resolveCoordinator, wouldStrandSpace } from "../spaces/roles.ts";
import {
  addSpaceMemberInTx,
  createSpaceInTx,
  removeSpaceMemberInTx,
  resolveSpaceContextId,
} from "../spaces/service.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const spaceRole = z.enum(SPACE_ROLES);

const spaceSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  mission: z.string().nullable(),
  memberCount: z.number().int(),
  /** The reading member's own role, or null when they are not in it. */
  ownRole: spaceRole.nullable(),
});

const spaceDetail = spaceSummary.extend({
  members: z.array(
    z.object({
      memberId: z.uuid(),
      name: z.string(),
      role: spaceRole,
    }),
  ),
  /** The named coordinator, or the manager covering for them (§4.2). */
  coordinatorMemberId: z.uuid().nullable(),
});

export type SpaceSummary = z.infer<typeof spaceSummary>;
export type SpaceDetail = z.infer<typeof spaceDetail>;

/** The acting member's id, or a refusal shaped like every other refusal. */
function actingMemberId(memberId: string | null): string {
  if (!memberId) {
    throw new OperationError(
      "not_found",
      "No such workspace, or you are not a member of it.",
    );
  }
  return memberId;
}

interface RequireSpaceAdminInput {
  readonly workspaceId: string;
  readonly memberId: string | null;
  readonly spaceId: string;
  /** The actor's resolved level on the workspace's own context. */
  readonly workspaceLevel: number;
}

/**
 * Authorises space administration, and returns the space's context id.
 *
 * A workspace admin passes without a space binding; everyone else needs `full`
 * on the space, which is what the `manager` role grants. Both paths still
 * confirm the space exists first, and both refuse with not-found rather than
 * forbidden.
 */
async function requireSpaceAdmin(
  tx: OperationTx,
  input: RequireSpaceAdminInput,
): Promise<string> {
  if (input.workspaceLevel >= ACCESS_LEVELS.full) {
    return resolveSpaceContextId(tx, input.workspaceId, input.spaceId);
  }
  const scoped = await getAccessScoped(tx, {
    workspaceId: input.workspaceId,
    memberId: actingMemberId(input.memberId),
    resourceType: "space",
    resourceId: input.spaceId,
    requires: ACCESS_LEVELS.full,
  });
  return scoped.contextId;
}

/** Every space member, oldest first, which is what the role rules assume. */
async function loadSpaceMembers(
  tx: OperationTx,
  workspaceId: string,
  spaceId: string,
) {
  return tx
    .select({ memberId: spaceMembers.memberId, role: spaceMembers.role })
    .from(spaceMembers)
    .where(
      activeOnly(
        spaceMembers,
        eq(spaceMembers.workspaceId, workspaceId),
        eq(spaceMembers.spaceId, spaceId),
      ),
    )
    .orderBy(spaceMembers.createdAt);
}

export const listSpaces = defineReadAction({
  name: "spaces.list",
  summary: "Every space this member can see, with their own role in each.",
  input: z.object({}),
  output: z.array(spaceSummary),
  access: ACCESS_LEVELS.view,
  async handler(context): Promise<SpaceSummary[]> {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const [member] = await tx
          .select({ id: workspaceMembers.id })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, context.workspaceId),
              eq(workspaceMembers.userId, userId),
              eq(workspaceMembers.status, "active"),
            ),
          )
          .limit(1);
        if (!member) {
          throw new OperationError("not_found", "No such workspace.");
        }

        const rows = await tx
          .select({
            id: spaces.id,
            name: spaces.name,
            mission: spaces.mission,
            ownRole: spaceMembers.role,
            memberCount: sql<number>`(
              select count(*)::int from space_members sm
               where sm.space_id = ${spaces.id}
                 and sm.workspace_id = ${context.workspaceId}
                 and sm.deleted_at is null
            )`,
          })
          // openokr:allow-raw-read: this *is* the getter's list form. Every row
          // is filtered by accessScopeFilter below, the same EXISTS over the
          // same three tiers getAccessScoped resolves for one row. Reading
          // through the single-row getter instead would mean one query per
          // space.
          .from(spaces)
          .innerJoin(
            accessContexts,
            activeOnly(
              accessContexts,
              eq(accessContexts.workspaceId, context.workspaceId),
              eq(accessContexts.resourceType, "space"),
              eq(accessContexts.resourceId, spaces.id),
            ),
          )
          .leftJoin(
            spaceMembers,
            activeOnly(
              spaceMembers,
              eq(spaceMembers.spaceId, spaces.id),
              eq(spaceMembers.memberId, member.id),
            ),
          )
          .where(
            and(
              activeOnly(spaces, eq(spaces.workspaceId, context.workspaceId)),
              accessScopeFilter(accessContexts.id, {
                workspaceId: context.workspaceId,
                memberId: member.id,
                minLevel: ACCESS_LEVELS.view,
              }),
            ),
          )
          .orderBy(spaces.name);

        return rows.map((row) => ({
          id: row.id,
          name: row.name,
          mission: row.mission,
          memberCount: Number(row.memberCount),
          ownRole: row.ownRole ?? null,
        }));
      },
    );
  },
});

export const readSpace = defineReadAction({
  name: "spaces.read",
  summary: "One space with its members and who runs its weekly session.",
  input: z.object({ id: z.uuid() }),
  output: spaceDetail,
  access: ACCESS_LEVELS.view,
  async handler(context, input): Promise<SpaceDetail> {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such space.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const [member] = await tx
          .select({ id: workspaceMembers.id })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, context.workspaceId),
              eq(workspaceMembers.userId, userId),
              eq(workspaceMembers.status, "active"),
            ),
          )
          .limit(1);
        if (!member) {
          throw new OperationError("not_found", "No such space.");
        }

        // The one enforcement point. Not-found on forbidden, which is why the
        // read below can then load the row's own columns.
        await getAccessScoped(tx, {
          workspaceId: context.workspaceId,
          memberId: member.id,
          resourceType: "space",
          resourceId: input.id,
          requires: ACCESS_LEVELS.view,
        });

        const [space] = await tx
          .select({
            id: spaces.id,
            name: spaces.name,
            mission: spaces.mission,
          })
          // openokr:allow-raw-read: getAccessScoped above just confirmed access
          // to this space; this loads the display columns the getter does not
          // return.
          .from(spaces)
          .where(
            activeOnly(
              spaces,
              eq(spaces.id, input.id),
              eq(spaces.workspaceId, context.workspaceId),
            ),
          )
          .limit(1);
        if (!space) {
          throw new OperationError("not_found", "No such space.");
        }

        const members = await tx
          .select({
            memberId: spaceMembers.memberId,
            role: spaceMembers.role,
            name: workspaceMembers.name,
          })
          .from(spaceMembers)
          .innerJoin(
            workspaceMembers,
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.id, spaceMembers.memberId),
            ),
          )
          .where(
            activeOnly(
              spaceMembers,
              eq(spaceMembers.workspaceId, context.workspaceId),
              eq(spaceMembers.spaceId, input.id),
            ),
          )
          .orderBy(spaceMembers.createdAt);

        const own = members.find((row) => row.memberId === member.id);

        return {
          id: space.id,
          name: space.name,
          mission: space.mission,
          memberCount: members.length,
          ownRole: own?.role ?? null,
          members: members.map((row) => ({
            memberId: row.memberId,
            name: row.name,
            role: row.role,
          })),
          coordinatorMemberId: resolveCoordinator(members) ?? null,
        };
      },
    );
  },
});

export const createSpace = defineWriteAction({
  name: "spaces.create",
  summary: "Creates a space, with an optional first manager.",
  input: z.object({
    name: z.string().trim().min(1).max(80),
    mission: z.string().trim().max(280).optional(),
    managerMemberId: z.uuid().optional(),
    /**
     * The source system's identifier for this space, when an import made it
     * (P6-T03a).
     *
     * Set only by the importer. A second create carrying a key something
     * already holds is refused rather than quietly turned into an update: the
     * importer looks the key up first and updates the row it finds instead.
     */
    legacy: legacyKey.optional(),
  }),
  output: z.object({ id: z.uuid(), name: z.string() }),
  // Creating org structure is a workspace-admin act. Nothing in §4.2 says an
  // ordinary member may add spaces, and the default space plus admin-created
  // ones cover every Phase 3 surface.
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      await assertLegacyKeyFree(tx, workspaceId, spaces, input.legacy, "space");

      const created = await createSpaceInTx(tx, {
        workspaceId,
        name: input.name,
        mission: input.mission ?? null,
        managerMemberId: input.managerMemberId ?? actor.memberId ?? undefined,
        ...(input.legacy ? { legacy: input.legacy } : {}),
      });

      // An import can finish writing into the space it just created. The
      // reasoning is in `packages/core/src/imports/binding.ts`.
      await bindImporterInTx(tx, {
        workspaceId,
        memberId: input.legacy ? actor.memberId : null,
        contextId: created.contextId,
        alreadyBound: input.managerMemberId ?? actor.memberId,
      });

      return {
        result: { id: created.id, name: created.name },
        activity: {
          kind: "space.created",
          subjectType: "space",
          subjectId: created.id,
          spaceId: created.id,
          contextId: created.contextId,
          payload: { name: created.name },
        },
        audit: {
          action: "spaces.create",
          targetType: "space",
          targetId: created.id,
          payload: { name: created.name },
        },
      };
    },
  }),
});

export const updateSpace = defineWriteAction({
  name: "spaces.update",
  summary: "Renames a space or rewrites its mission.",
  input: z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(80).optional(),
    mission: z.string().trim().max(280).nullable().optional(),
  }),
  output: z.object({ id: z.uuid(), name: z.string() }),
  // A space manager passes on their own space binding; a workspace admin passes
  // through requireSpaceAdmin. Declaring `full` here would lock managers out.
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const contextId = await requireSpaceAdmin(tx, {
        workspaceId,
        memberId: actor.memberId,
        spaceId: input.id,
        workspaceLevel: actor.level,
      });

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) {
        patch.name = input.name;
      }
      if (input.mission !== undefined) {
        patch.mission = input.mission === null ? null : input.mission || null;
      }

      const [updated] = await tx
        .update(spaces)
        .set(patch)
        .where(
          activeOnly(
            spaces,
            eq(spaces.id, input.id),
            eq(spaces.workspaceId, workspaceId),
          ),
        )
        .returning({ id: spaces.id, name: spaces.name });

      if (!updated) {
        throw new OperationError("not_found", "No such space.");
      }

      return {
        result: updated,
        activity: {
          kind: "space.updated",
          subjectType: "space",
          subjectId: updated.id,
          spaceId: updated.id,
          contextId,
          payload: { name: updated.name },
        },
        audit: {
          action: "spaces.update",
          targetType: "space",
          targetId: updated.id,
          payload: { name: updated.name },
        },
      };
    },
  }),
});

export const archiveSpace = defineWriteAction({
  name: "spaces.archive",
  summary: "Archives a space. Its goals and history stay readable.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  safety: "destructive",
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const contextId = await requireSpaceAdmin(tx, {
        workspaceId,
        memberId: actor.memberId,
        spaceId: input.id,
        workspaceLevel: actor.level,
      });

      const [archived] = await tx
        .update(spaces)
        .set({ deletedAt: new Date() })
        .where(
          activeOnly(
            spaces,
            eq(spaces.id, input.id),
            eq(spaces.workspaceId, workspaceId),
          ),
        )
        .returning({ id: spaces.id, name: spaces.name });

      if (!archived) {
        throw new OperationError("not_found", "No such space.");
      }

      return {
        result: { id: archived.id },
        activity: {
          kind: "space.archived",
          subjectType: "space",
          subjectId: archived.id,
          spaceId: archived.id,
          contextId,
          payload: { name: archived.name },
        },
        audit: {
          action: "spaces.archive",
          targetType: "space",
          targetId: archived.id,
          payload: { name: archived.name },
        },
      };
    },
  }),
});

export const addSpaceMember = defineWriteAction({
  name: "spaces.addMember",
  summary: "Adds a member to a space in a role, granting that role's access.",
  input: z.object({
    spaceId: z.uuid(),
    memberId: z.uuid(),
    role: spaceRole.default("member"),
  }),
  output: z.object({ spaceId: z.uuid(), memberId: z.uuid(), role: spaceRole }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const contextId = await requireSpaceAdmin(tx, {
        workspaceId,
        memberId: actor.memberId,
        spaceId: input.spaceId,
        workspaceLevel: actor.level,
      });

      const [target] = await tx
        .select({ id: workspaceMembers.id, name: workspaceMembers.name })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.id, input.memberId),
            eq(workspaceMembers.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!target) {
        throw new OperationError("not_found", "No such member.");
      }

      await addSpaceMemberInTx(tx, {
        workspaceId,
        spaceId: input.spaceId,
        memberId: input.memberId,
        role: input.role,
        contextId,
      });

      return {
        result: {
          spaceId: input.spaceId,
          memberId: input.memberId,
          role: input.role,
        },
        activity: {
          kind: "space.member_added",
          subjectType: "space",
          subjectId: input.spaceId,
          spaceId: input.spaceId,
          contextId,
          payload: { name: target.name, role: input.role },
        },
        audit: {
          action: "spaces.addMember",
          targetType: "space",
          targetId: input.spaceId,
          payload: {
            memberId: input.memberId,
            name: target.name,
            role: input.role,
          },
        },
      };
    },
  }),
});

export const setSpaceMemberRole = defineWriteAction({
  name: "spaces.setMemberRole",
  summary: "Changes a space member's role, replacing what that role grants.",
  input: z.object({
    spaceId: z.uuid(),
    memberId: z.uuid(),
    role: spaceRole,
  }),
  output: z.object({ spaceId: z.uuid(), memberId: z.uuid(), role: spaceRole }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const contextId = await requireSpaceAdmin(tx, {
        workspaceId,
        memberId: actor.memberId,
        spaceId: input.spaceId,
        workspaceLevel: actor.level,
      });

      const members = await loadSpaceMembers(tx, workspaceId, input.spaceId);
      const existing = members.find((row) => row.memberId === input.memberId);
      if (!existing) {
        throw new OperationError(
          "not_found",
          "That member is not in this space.",
        );
      }

      // Demoting the last manager would leave a space with members and nobody
      // who can administer it. A workspace admin could still repair it, but a
      // write that knowingly creates the broken state is worth refusing.
      if (
        existing.role === "manager" &&
        input.role !== "manager" &&
        wouldStrandSpace(members, input.memberId)
      ) {
        throw new OperationError(
          "forbidden",
          "This space would have no manager. Appoint another one first.",
        );
      }

      await addSpaceMemberInTx(tx, {
        workspaceId,
        spaceId: input.spaceId,
        memberId: input.memberId,
        role: input.role,
        contextId,
      });

      return {
        result: {
          spaceId: input.spaceId,
          memberId: input.memberId,
          role: input.role,
        },
        activity: {
          kind: "space.member_role_changed",
          subjectType: "space",
          subjectId: input.spaceId,
          spaceId: input.spaceId,
          contextId,
          payload: { from: existing.role, to: input.role },
        },
        audit: {
          action: "spaces.setMemberRole",
          targetType: "space",
          targetId: input.spaceId,
          payload: {
            memberId: input.memberId,
            from: existing.role,
            to: input.role,
          },
        },
      };
    },
  }),
});

export const removeSpaceMember = defineWriteAction({
  name: "spaces.removeMember",
  summary: "Removes a member from a space and takes back its access.",
  input: z.object({ spaceId: z.uuid(), memberId: z.uuid() }),
  output: z.object({ spaceId: z.uuid(), memberId: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  safety: "destructive",
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const contextId = await requireSpaceAdmin(tx, {
        workspaceId,
        memberId: actor.memberId,
        spaceId: input.spaceId,
        workspaceLevel: actor.level,
      });

      const members = await loadSpaceMembers(tx, workspaceId, input.spaceId);
      const existing = members.find((row) => row.memberId === input.memberId);
      if (!existing) {
        throw new OperationError(
          "not_found",
          "That member is not in this space.",
        );
      }
      if (wouldStrandSpace(members, input.memberId)) {
        throw new OperationError(
          "forbidden",
          "This space would have no manager. Appoint another one first.",
        );
      }

      await removeSpaceMemberInTx(tx, {
        workspaceId,
        spaceId: input.spaceId,
        memberId: input.memberId,
        contextId,
      });

      return {
        result: { spaceId: input.spaceId, memberId: input.memberId },
        activity: {
          kind: "space.member_removed",
          subjectType: "space",
          subjectId: input.spaceId,
          spaceId: input.spaceId,
          contextId,
          payload: { role: existing.role },
        },
        audit: {
          action: "spaces.removeMember",
          targetType: "space",
          targetId: input.spaceId,
          payload: { memberId: input.memberId, role: existing.role },
        },
      };
    },
  }),
});

export const joinSpace = defineWriteAction({
  name: "spaces.join",
  summary: "Joins a space as an ordinary member.",
  input: z.object({ spaceId: z.uuid() }),
  output: z.object({ spaceId: z.uuid(), role: spaceRole }),
  // `edit` on the workspace, which every human member holds through
  // workspace_standard. The space itself only needs to be visible, which is
  // checked below at `view` rather than declared here: a write action that
  // declared `view` would violate the registry's own invariant.
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actingMemberId(actor.memberId);
      const scoped = await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "space",
        resourceId: input.spaceId,
        requires: ACCESS_LEVELS.view,
      });

      await addSpaceMemberInTx(tx, {
        workspaceId,
        spaceId: input.spaceId,
        memberId,
        role: "member",
        contextId: scoped.contextId,
      });

      return {
        result: { spaceId: input.spaceId, role: "member" as const },
        activity: {
          kind: "space.joined",
          subjectType: "space",
          subjectId: input.spaceId,
          spaceId: input.spaceId,
          contextId: scoped.contextId,
          payload: {},
        },
        audit: {
          action: "spaces.join",
          targetType: "space",
          targetId: input.spaceId,
          payload: { memberId },
        },
      };
    },
  }),
});

export const leaveSpace = defineWriteAction({
  name: "spaces.leave",
  summary: "Leaves a space. The space stays visible and rejoinable.",
  input: z.object({ spaceId: z.uuid() }),
  output: z.object({ spaceId: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actingMemberId(actor.memberId);
      const scoped = await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "space",
        resourceId: input.spaceId,
        requires: ACCESS_LEVELS.view,
      });

      const members = await loadSpaceMembers(tx, workspaceId, input.spaceId);
      if (!members.some((row) => row.memberId === memberId)) {
        throw new OperationError("not_found", "You are not in this space.");
      }
      if (wouldStrandSpace(members, memberId)) {
        throw new OperationError(
          "forbidden",
          "You are this space's only manager. Appoint another one first.",
        );
      }

      await removeSpaceMemberInTx(tx, {
        workspaceId,
        spaceId: input.spaceId,
        memberId,
        contextId: scoped.contextId,
      });

      return {
        result: { spaceId: input.spaceId },
        activity: {
          kind: "space.left",
          subjectType: "space",
          subjectId: input.spaceId,
          spaceId: input.spaceId,
          contextId: scoped.contextId,
          payload: {},
        },
        audit: {
          action: "spaces.leave",
          targetType: "space",
          targetId: input.spaceId,
          payload: { memberId },
        },
      };
    },
  }),
});
