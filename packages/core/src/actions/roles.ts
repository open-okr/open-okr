/**
 * Workspace roles and their permission matrix (P8-G13a,
 * docs/design/workspace-roles.md).
 *
 * Five actions: read the matrix, move one cell, add a role, rename or remove
 * one, and give a member a role. Everything an administrator does to the
 * access rules happens through these, so every one of them is a write through
 * the Operation pipeline and lands in the audit chain.
 *
 * **`owner` is refused by name in three of them.** A workspace that can lower
 * or delete its own last administrator is a workspace nobody can repair, and
 * the refusal belongs here rather than in the screen, because the screen is
 * one of several surfaces and the command line is another.
 */

import {
  activeOnly,
  ROLE_DOMAINS,
  rolePermissions,
  withWorkspace,
  workspaceMembers,
  workspaceRoles,
} from "@openokr/db";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { PROTECTED_ROLE_KEY } from "../access/roles.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

/** The §4.1 ladder, plus zero for "this role grants nothing here". */
const LEVELS = [0, 10, 40, 70, 100] as const;

const roleOutput = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Null for a role an administrator added. */
  builtinKey: z.string().nullable(),
  isDefault: z.boolean(),
  /** Whether this role may be edited at all. False for `owner` only. */
  editable: z.boolean(),
  /** One entry per domain, including the ones granting nothing. */
  permissions: z.array(
    z.object({ domain: z.string(), level: z.number().int() }),
  ),
  /** How many members hold it, so a removal can say what it would strand. */
  memberCount: z.number().int(),
});

export const listRoles = defineReadAction({
  name: "roles.list",
  summary: "Every workspace role with its permission matrix.",
  input: z.object({}),
  output: z.object({ roles: z.array(roleOutput) }),
  // `view`, not `full`. Everybody should be able to read what their own role
  // allows; changing one is the privileged half and is guarded below.
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const roles = await tx
        .select({
          id: workspaceRoles.id,
          name: workspaceRoles.name,
          builtinKey: workspaceRoles.builtinKey,
          isDefault: workspaceRoles.isDefault,
        })
        .from(workspaceRoles)
        .where(
          activeOnly(
            workspaceRoles,
            eq(workspaceRoles.workspaceId, context.workspaceId),
          ),
        );

      const permissions = await tx
        .select({
          roleId: rolePermissions.roleId,
          domain: rolePermissions.domain,
          level: rolePermissions.level,
        })
        .from(rolePermissions)
        .where(
          activeOnly(
            rolePermissions,
            eq(rolePermissions.workspaceId, context.workspaceId),
          ),
        );

      const members = await tx
        .select({ roleId: workspaceMembers.roleId })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, context.workspaceId),
          ),
        );

      return {
        roles: roles.map((role) => ({
          id: role.id,
          name: role.name,
          builtinKey: role.builtinKey,
          isDefault: role.isDefault,
          editable: role.builtinKey !== PROTECTED_ROLE_KEY,
          // Every domain, so a screen draws a full matrix without filling the
          // gaps itself and a domain nobody has set reads as the zero it is.
          permissions: ROLE_DOMAINS.map((domain) => ({
            domain,
            level:
              permissions.find(
                (entry) => entry.roleId === role.id && entry.domain === domain,
              )?.level ?? 0,
          })),
          memberCount: members.filter((member) => member.roleId === role.id)
            .length,
        })),
      };
    });
  },
});

/** Loads a role, refusing the protected one when the caller is changing it. */
async function editableRole(
  tx: OperationTx,
  workspaceId: string,
  roleId: string,
): Promise<{ id: string; name: string; builtinKey: string | null }> {
  const [role] = await tx
    .select({
      id: workspaceRoles.id,
      name: workspaceRoles.name,
      builtinKey: workspaceRoles.builtinKey,
    })
    .from(workspaceRoles)
    .where(
      activeOnly(
        workspaceRoles,
        and(
          eq(workspaceRoles.workspaceId, workspaceId),
          eq(workspaceRoles.id, roleId),
        ),
      ),
    )
    .limit(1);
  if (!role) {
    throw new OperationError("not_found", "No such role.");
  }
  if (role.builtinKey === PROTECTED_ROLE_KEY) {
    throw new OperationError(
      "forbidden",
      "The Owner role cannot be changed. A workspace that can lower its own last administrator cannot be repaired.",
    );
  }
  return role;
}

export const setRolePermission = defineWriteAction({
  name: "roles.setPermission",
  summary: "Sets what one role may do in one domain.",
  input: z.object({
    roleId: z.uuid(),
    domain: z.enum(ROLE_DOMAINS),
    level: z.union(LEVELS.map((level) => z.literal(level))),
  }),
  output: z.object({ roleId: z.uuid(), domain: z.string(), level: z.number() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const role = await editableRole(tx, workspaceId, input.roleId);

      const [existing] = await tx
        .select({ id: rolePermissions.id })
        .from(rolePermissions)
        .where(
          activeOnly(
            rolePermissions,
            and(
              eq(rolePermissions.workspaceId, workspaceId),
              eq(rolePermissions.roleId, input.roleId),
              eq(rolePermissions.domain, input.domain),
            ),
          ),
        )
        .limit(1);

      // openokr:allow-mutation: the operation's own execute.
      if (existing) {
        await tx
          .update(rolePermissions)
          .set({ level: input.level, updatedAt: new Date() })
          .where(
            activeOnly(rolePermissions, eq(rolePermissions.id, existing.id)),
          );
      } else {
        await tx.insert(rolePermissions).values({
          workspaceId,
          roleId: input.roleId,
          domain: input.domain,
          level: input.level,
        });
      }

      return {
        result: {
          roleId: input.roleId,
          domain: input.domain,
          level: input.level,
        },
        activity: {
          kind: "role.permission_set",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: {
            role: role.name,
            domain: input.domain,
            level: input.level,
          },
        },
        audit: {
          action: "roles.setPermission",
          targetType: "workspace_role",
          targetId: input.roleId,
          payload: { domain: input.domain, level: input.level },
        },
      };
    },
  }),
});

export const createRole = defineWriteAction({
  name: "roles.create",
  summary: "Adds a role, starting from the levels given.",
  input: z.object({
    name: z.string().trim().min(1).max(60),
    permissions: z
      .array(
        z.object({
          domain: z.enum(ROLE_DOMAINS),
          level: z.union(LEVELS.map((level) => z.literal(level))),
        }),
      )
      .optional(),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      // **A name already taken is a sentence, not a crash** (P8-G13b, found
      // by the end-to-end suite). The unique index refuses a second role with
      // the same name, and without this the refusal arrives as a raw database
      // error rather than an `OperationError`: the server action rethrows it,
      // the screen falls to its error boundary, and an administrator who
      // typed a name that exists loses the whole page instead of being told
      // which name to change.
      const [taken] = await tx
        .select({ id: workspaceRoles.id })
        .from(workspaceRoles)
        .where(
          activeOnly(
            workspaceRoles,
            and(
              eq(workspaceRoles.workspaceId, workspaceId),
              sql`lower(${workspaceRoles.name}) = lower(${input.name})`,
            ),
          ),
        )
        .limit(1);
      if (taken) {
        throw new OperationError(
          "forbidden",
          `A role called "${input.name}" already exists. Give this one another name.`,
        );
      }

      // openokr:allow-mutation: the operation's own execute.
      const [created] = await tx
        .insert(workspaceRoles)
        .values({ workspaceId, name: input.name })
        .returning({ id: workspaceRoles.id });
      const roleId = (created as { id: string }).id;

      // A domain the caller said nothing about grants nothing, written out
      // rather than left absent, so the matrix a screen reads back is full.
      await tx.insert(rolePermissions).values(
        ROLE_DOMAINS.map((domain) => ({
          workspaceId,
          roleId,
          domain,
          level:
            input.permissions?.find((entry) => entry.domain === domain)
              ?.level ?? 0,
        })),
      );

      return {
        result: { id: roleId },
        activity: {
          kind: "role.created",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { name: input.name },
        },
        audit: {
          action: "roles.create",
          targetType: "workspace_role",
          targetId: roleId,
          payload: { name: input.name },
        },
      };
    },
  }),
});

export const deleteRole = defineWriteAction({
  name: "roles.delete",
  summary: "Removes a role that nobody holds.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  safety: "destructive",
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const role = await editableRole(tx, workspaceId, input.id);

      // **Refused while anybody holds it**, rather than moving them to the
      // default. Somebody holding a role is somebody whose access would change
      // without their administrator deciding what it should become.
      const held = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.roleId, input.id),
            ),
          ),
        )
        .limit(1);
      if (held.length > 0) {
        throw new OperationError(
          "forbidden",
          "Somebody still holds this role. Give them another one first.",
        );
      }

      // openokr:allow-mutation: the operation's own execute.
      await tx
        .update(workspaceRoles)
        .set({ deletedAt: new Date() })
        .where(activeOnly(workspaceRoles, eq(workspaceRoles.id, input.id)));

      return {
        result: { id: input.id },
        activity: {
          kind: "role.deleted",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { name: role.name },
        },
        audit: {
          action: "roles.delete",
          targetType: "workspace_role",
          targetId: input.id,
          payload: { name: role.name },
        },
      };
    },
  }),
});

export const assignRole = defineWriteAction({
  name: "roles.assign",
  summary: "Gives a member a role, or takes their role away.",
  input: z.object({ memberId: z.uuid(), roleId: z.uuid().nullable() }),
  output: z.object({ memberId: z.uuid(), roleId: z.uuid().nullable() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [member] = await tx
        .select({ id: workspaceMembers.id, kind: workspaceMembers.kind })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.id, input.memberId),
            ),
          ),
        )
        .limit(1);
      if (!member) {
        throw new OperationError("not_found", "No such member.");
      }
      // An agent holds nothing but its own named bindings
      // (AI-NATIVE-PLAN §1.3), so a workspace-wide role is refused rather
      // than stored and quietly ignored by the resolver.
      if (member.kind !== "human") {
        throw new OperationError(
          "forbidden",
          "Only a person holds a role. An agent holds only the bindings it was given.",
        );
      }

      if (input.roleId !== null) {
        const [role] = await tx
          .select({ id: workspaceRoles.id })
          .from(workspaceRoles)
          .where(
            activeOnly(
              workspaceRoles,
              and(
                eq(workspaceRoles.workspaceId, workspaceId),
                eq(workspaceRoles.id, input.roleId),
              ),
            ),
          )
          .limit(1);
        if (!role) {
          throw new OperationError("not_found", "No such role.");
        }
      }

      // openokr:allow-mutation: the operation's own execute.
      await tx
        .update(workspaceMembers)
        .set({ roleId: input.roleId, updatedAt: new Date() })
        .where(
          activeOnly(workspaceMembers, eq(workspaceMembers.id, input.memberId)),
        );

      return {
        result: { memberId: input.memberId, roleId: input.roleId },
        activity: {
          kind: "role.assigned",
          subjectType: "member",
          subjectId: input.memberId,
          payload: {},
        },
        audit: {
          action: "roles.assign",
          targetType: "member",
          targetId: input.memberId,
          payload: { roleId: input.roleId },
        },
      };
    },
  }),
});
