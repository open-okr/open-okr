"use server";

/**
 * Creating and managing a space (P6-G18a).
 *
 * **A workspace was stuck with the one space provisioning made.** Six space
 * writes shipped at P3-T01 and only `join` and `leave` ever had a caller:
 * `create`, `update`, `archive`, `addMember`, `setMemberRole` and
 * `removeMember` were registered actions no screen reached, so a second space,
 * a rename, an archive, or naming a manager all needed the command line. The
 * gap audit of 7 September 2026 recorded it as B-09.
 *
 * Every refusal is returned as a sentence rather than thrown, the same shape
 * the cycle workspace uses: a space that cannot be archived because it still
 * holds an open cycle is a normal outcome and the reason is worth reading.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/pool";
import { requireWorkspace } from "../../lib/workspace";
import { NO_SPACE_ERROR, type SpaceWriteState } from "./write-state.ts";

async function run(
  paths: readonly string[],
  fn: (context: {
    pool: ReturnType<typeof getPool>;
    workspaceId: string;
    actor: { kind: "human"; userId: string };
  }) => Promise<unknown>,
): Promise<SpaceWriteState> {
  const { session, workspace } = await requireWorkspace();
  let result: unknown;
  try {
    result = await fn({
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  for (const path of paths) {
    revalidatePath(path);
  }
  const created = (result as { id?: string } | undefined)?.id;
  return created ? { error: null, createdId: created } : NO_SPACE_ERROR;
}

export async function createSpace(
  _previous: SpaceWriteState,
  formData: FormData,
): Promise<SpaceWriteState> {
  const name = String(formData.get("name") ?? "").trim();
  const mission = String(formData.get("mission") ?? "").trim();
  const managerMemberId = String(formData.get("managerMemberId") ?? "");

  return run(["/spaces"], (context) =>
    callAction(context, "spaces.create", {
      name,
      ...(mission ? { mission } : {}),
      // A space with no manager has nobody covering the coordinator's duties
      // (§4.2), so the form offers one and the action accepts none.
      ...(managerMemberId ? { managerMemberId } : {}),
    }),
  );
}

export async function updateSpace(
  _previous: SpaceWriteState,
  formData: FormData,
): Promise<SpaceWriteState> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const mission = String(formData.get("mission") ?? "").trim();

  return run(["/spaces", `/spaces/${id}`], (context) =>
    callAction(context, "spaces.update", {
      id,
      ...(name ? { name } : {}),
      // An empty mission is a real answer and clears it, which is why the
      // action takes a nullable rather than an optional here.
      mission: mission === "" ? null : mission,
    }),
  );
}

export async function archiveSpace(
  _previous: SpaceWriteState,
  formData: FormData,
): Promise<SpaceWriteState> {
  const id = String(formData.get("id") ?? "");
  return run(["/spaces", `/spaces/${id}`], (context) =>
    callAction(context, "spaces.archive", { id }),
  );
}

export async function addSpaceMember(
  _previous: SpaceWriteState,
  formData: FormData,
): Promise<SpaceWriteState> {
  const spaceId = String(formData.get("spaceId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "contributor");
  return run(["/spaces", `/spaces/${spaceId}`], (context) =>
    callAction(context, "spaces.addMember", {
      spaceId,
      memberId,
      role: role as never,
    }),
  );
}

export async function setSpaceMemberRole(
  _previous: SpaceWriteState,
  formData: FormData,
): Promise<SpaceWriteState> {
  const spaceId = String(formData.get("spaceId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "contributor");
  return run(["/spaces", `/spaces/${spaceId}`], (context) =>
    callAction(context, "spaces.setMemberRole", {
      spaceId,
      memberId,
      role: role as never,
    }),
  );
}

export async function removeSpaceMember(
  _previous: SpaceWriteState,
  formData: FormData,
): Promise<SpaceWriteState> {
  const spaceId = String(formData.get("spaceId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  return run(["/spaces", `/spaces/${spaceId}`], (context) =>
    callAction(context, "spaces.removeMember", { spaceId, memberId }),
  );
}
