"use server";

import { callAction } from "@openokr/core";
import type { RoleDomain } from "@openokr/db";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/pool";
import { refusedState } from "../../../lib/refusal";
import { getTranslations } from "../../../lib/translations";
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
  /** A refused new role's name, shown under its box (guided-inputs §4.2). */
  readonly fields?: Readonly<Record<string, string>>;
}

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

/**
 * A refusal under the field a write drew when it names it, the new role's
 * name, and as the matrix's sentence otherwise: a cell, a delete and an
 * assignment are clicks with no box of their own. A schema's refusal too,
 * which used to reach the error page (guided-inputs §4.2, plan U1b).
 */
const refused = async (
  error: unknown,
  drawn: readonly string[] = [],
): Promise<RoleResult> => {
  const state = refusedState(error, (await getTranslations()).t, drawn);
  if (state === null) {
    throw error;
  }
  return {
    error: state.error ?? null,
    ...(state.fields ? { fields: state.fields } : {}),
  };
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
    return refused(error, ["name"]);
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
