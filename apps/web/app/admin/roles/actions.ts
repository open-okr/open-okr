"use server";

import { callAction, OperationError } from "@openokr/core";
import type { RoleDomain } from "@openokr/db";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * The writes behind the roles screen (P8-G13b).
 *
 * Every one needs `full`, which the action declares and the admin layout also
 * enforces before the page renders. Two layers on purpose: the layout decides
 * what somebody sees, and `can()` decides what happens, and a hidden control
 * is cosmetic.
 *
 * **A refusal comes back as a sentence rather than an exception.** Three of
 * these refuse for reasons an administrator can act on: the Owner role cannot
 * be changed, a role somebody still holds cannot be removed, and an agent
 * cannot hold a role at all. Each is a sentence the action wrote, carried to
 * the screen unchanged.
 */

export interface RoleResult {
  readonly error: string | null;
}

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

const refused = (error: unknown): RoleResult => {
  if (error instanceof OperationError) {
    return { error: error.message };
  }
  throw error;
};

/**
 * A level is the maximum over the bindings reaching somebody and the level
 * their role grants, so changing one cell changes what every holder of that
 * role resolves on their next read. The whole layout is revalidated for that
 * reason rather than this page alone.
 */
function refresh(): void {
  revalidatePath("/", "layout");
}

export async function setPermissionAction(input: {
  roleId: string;
  domain: RoleDomain;
  level: 0 | 10 | 40 | 70 | 100;
}): Promise<RoleResult> {
  try {
    await callAction(await context(), "roles.setPermission", input);
  } catch (error) {
    return refused(error);
  }
  refresh();
  return { error: null };
}

export async function createRoleAction(input: {
  name: string;
}): Promise<RoleResult> {
  try {
    await callAction(await context(), "roles.create", { name: input.name });
  } catch (error) {
    return refused(error);
  }
  refresh();
  return { error: null };
}

export async function deleteRoleAction(input: {
  id: string;
}): Promise<RoleResult> {
  try {
    await callAction(await context(), "roles.delete", input);
  } catch (error) {
    return refused(error);
  }
  refresh();
  return { error: null };
}

export async function assignRoleAction(input: {
  memberId: string;
  roleId: string | null;
}): Promise<RoleResult> {
  try {
    await callAction(await context(), "roles.assign", input);
  } catch (error) {
    return refused(error);
  }
  refresh();
  return { error: null };
}
