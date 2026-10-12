/**
 * The workspace role catalogue and its defaults (P8-G13a,
 * docs/design/workspace-roles.md).
 *
 * A role is a level per domain. It sits above the relationship model in
 * `contexts.ts` rather than replacing it: `can()` still takes the maximum, and
 * a champion's binding still outranks a role that grants less. What a role
 * adds is a sentence an administrator can read and change, in place of a rule
 * that could only be stated by reading the binding table.
 *
 * The four built-in roles below are what a workspace is born with. Every one
 * of them can be edited afterwards except `owner`, because a workspace that
 * can lower its own last administrator is a workspace nobody can repair.
 */

import {
  activeOnly,
  type BuiltinRoleKey,
  ROLE_DOMAINS,
  type RoleDomain,
  rolePermissions,
  type WorkspaceTx,
  workspaceMembers,
  workspaceRoles,
} from "@openokr/db";
import { and, eq } from "drizzle-orm";
import { ACCESS_LEVELS } from "./levels.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/** Zero is a real answer: the role grants nothing on that domain. */
type RoleLevel = 0 | 10 | 40 | 70 | 100;

interface BuiltinRole {
  readonly key: BuiltinRoleKey;
  readonly name: string;
  /** The role a member gets when nothing else says otherwise. */
  readonly isDefault: boolean;
  readonly permissions: Readonly<Record<RoleDomain, RoleLevel>>;
}

const { view, comment, edit, full } = ACCESS_LEVELS;

/**
 * The seeded matrix.
 *
 * **Member holds `edit` on `goal`, and that widens access on purpose.** Before
 * roles, a member edited the objectives of the spaces they belonged to,
 * through a `space_standard` binding. After this the role decides and the
 * space does not, which is the change this work was asked for. An
 * administrator who wants the old shape lowers this row to `view` and grants
 * the edit through bindings instead.
 */
const BUILTIN_ROLES: readonly BuiltinRole[] = [
  {
    key: "owner",
    name: "Owner",
    isDefault: false,
    permissions: {
      goal: full,
      kpi: full,
      initiative: full,
      task: full,
      comment: full,
      space: full,
      workspace: full,
    },
  },
  {
    key: "admin",
    name: "Admin",
    isDefault: false,
    permissions: {
      goal: full,
      kpi: full,
      initiative: full,
      task: full,
      comment: full,
      space: full,
      // Not `full`: the workspace context is what carries the settings and the
      // ability to hand the workspace over, and that is the owner's.
      workspace: edit,
    },
  },
  {
    key: "member",
    name: "Member",
    isDefault: true,
    permissions: {
      goal: edit,
      kpi: edit,
      initiative: edit,
      task: edit,
      comment,
      space: view,
      workspace: view,
    },
  },
  {
    key: "viewer",
    name: "Viewer",
    isDefault: false,
    permissions: {
      goal: view,
      kpi: view,
      initiative: view,
      task: view,
      comment: view,
      space: view,
      workspace: view,
    },
  },
];

/** The one role that may never be edited or deleted. */
export const PROTECTED_ROLE_KEY: BuiltinRoleKey = "owner";

export interface SeedRolesInput {
  readonly workspaceId: string;
}

/**
 * Gives a workspace its four roles and their matrix, once.
 *
 * Idempotent by the `builtin_key` index: a second call finds each role and
 * writes nothing, which is what provisioning needs because it is retried on a
 * workspace whose creation failed part way through.
 */
export async function seedBuiltinRoles<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: SeedRolesInput,
): Promise<Readonly<Record<BuiltinRoleKey, string>>> {
  const ids: Partial<Record<BuiltinRoleKey, string>> = {};

  for (const role of BUILTIN_ROLES) {
    const [existing] = await tx
      .select({ id: workspaceRoles.id })
      .from(workspaceRoles)
      .where(
        activeOnly(
          workspaceRoles,
          eq(workspaceRoles.workspaceId, input.workspaceId),
          eq(workspaceRoles.builtinKey, role.key),
        ),
      )
      .limit(1);

    if (existing) {
      ids[role.key] = (existing as { id: string }).id;
      continue;
    }

    // openokr:allow-mutation: called only from inside an Operation's execute,
    // on the transaction that Operation opened.
    const [created] = await tx
      .insert(workspaceRoles)
      .values({
        workspaceId: input.workspaceId,
        name: role.name,
        builtinKey: role.key,
        isDefault: role.isDefault,
      })
      .returning({ id: workspaceRoles.id });

    const roleId = (created as { id: string }).id;
    ids[role.key] = roleId;

    // openokr:allow-mutation: same reason as the role insert above, and the
    // same transaction.
    await tx.insert(rolePermissions).values(
      ROLE_DOMAINS.map((domain) => ({
        workspaceId: input.workspaceId,
        roleId,
        domain,
        level: role.permissions[domain],
      })),
    );
  }

  return ids as Readonly<Record<BuiltinRoleKey, string>>;
}

/**
 * The workspace's default role, or null when it has none.
 *
 * Null is a real answer and not an error: a workspace provisioned before
 * P8-G13a has no roles until the backfill runs, and somebody joining it in
 * between must still be able to join. They hold their bindings, exactly as
 * every member did before roles existed, and the backfill gives them a role
 * with everybody else.
 */
export async function defaultRoleId<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: workspaceRoles.id })
    .from(workspaceRoles)
    .where(
      activeOnly(
        workspaceRoles,
        and(
          eq(workspaceRoles.workspaceId, workspaceId),
          eq(workspaceRoles.isDefault, true),
        ),
      ),
    )
    .limit(1);
  return (row as { id: string } | undefined)?.id ?? null;
}

/**
 * A built-in role by its key, or null when an administrator deleted it.
 *
 * For the support session (UAT BUG-021), which takes the built-in role whose
 * reach matches the level the customer granted.
 */
export async function builtinRoleId<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  key: BuiltinRoleKey,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: workspaceRoles.id })
    .from(workspaceRoles)
    .where(
      activeOnly(
        workspaceRoles,
        and(
          eq(workspaceRoles.workspaceId, workspaceId),
          eq(workspaceRoles.builtinKey, key),
        ),
      ),
    )
    .limit(1);
  return (row as { id: string } | undefined)?.id ?? null;
}

export interface MoveAdministratorRoleInput {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly administrator: boolean;
}

/**
 * Puts a member on the Admin role, or back on the workspace default
 * (P8-G13a).
 *
 * Called by `people.setAdministrator`, which until this existed changed only
 * the binding. A level is the maximum over bindings and the role, so a founder
 * stepping down kept Owner and kept full access, and the action silently did
 * nothing.
 *
 * **It never takes Owner away from somebody who is not stepping down**, and it
 * never promotes past Admin: Owner is held by whoever provisioned the
 * workspace or by whoever an operator moved it to, and promoting through this
 * action would make a second owner by a side door.
 *
 * A workspace with no roles yet, which is one provisioned before this and not
 * yet backfilled, is left alone. Nothing to move, and the binding still says
 * what it said.
 */
export async function moveAdministratorRole<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: MoveAdministratorRoleInput): Promise<void> {
  const [role] = await tx
    .select({ id: workspaceRoles.id })
    .from(workspaceRoles)
    .where(
      activeOnly(
        workspaceRoles,
        and(
          eq(workspaceRoles.workspaceId, input.workspaceId),
          input.administrator
            ? eq(workspaceRoles.builtinKey, "admin")
            : eq(workspaceRoles.isDefault, true),
        ),
      ),
    )
    .limit(1);
  const roleId = (role as { id: string } | undefined)?.id;
  if (!roleId) {
    return;
  }

  // openokr:allow-mutation: called only from inside an Operation's execute,
  // on the transaction that Operation opened.
  await tx
    .update(workspaceMembers)
    .set({ roleId, updatedAt: new Date() })
    .where(
      activeOnly(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.id, input.memberId),
        ),
      ),
    );
}
