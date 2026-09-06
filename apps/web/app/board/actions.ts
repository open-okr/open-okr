"use server";

/**
 * The board's writes (S-27, S-28, P5-T11).
 *
 * Thin wrappers over the registry, so the sentence a person reads when a write
 * is refused is the one `packages/core` wrote. None of them touches a key
 * result: finishing work moves no number, which is the work-layer design's §1.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "../cycle/write-state.ts";

const STATUSES = ["backlog", "todo", "in_progress", "done"] as const;

async function run(
  fn: (context: {
    pool: ReturnType<typeof getPool>;
    workspaceId: string;
    actor: { kind: "human"; userId: string };
  }) => Promise<unknown>,
  paths: readonly string[] = ["/board"],
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  try {
    await fn({
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
  return NO_ERROR;
}

export async function createTaskAction(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const title = String(formData.get("title") ?? "").trim();
  const spaceId = String(formData.get("spaceId") ?? "");
  const status = String(formData.get("status") ?? "backlog");
  const keyResultId = String(formData.get("keyResultId") ?? "").trim();
  const dueOn = String(formData.get("dueOn") ?? "").trim();

  if (title === "") {
    return { error: "A task needs a title. What has to happen?" };
  }
  if (spaceId === "") {
    return { error: "A task lives in a space." };
  }
  const column = STATUSES.find((one) => one === status) ?? "backlog";

  return run((context) =>
    callAction(context, "tasks.create", {
      spaceId,
      title,
      status: column,
      ...(keyResultId === "" ? {} : { keyResultId }),
      ...(dueOn === "" ? {} : { dueOn }),
    }),
  );
}

/**
 * Moves one card, which is the only write a drag makes.
 *
 * The server decides the position from the card it was dropped after; the
 * browser never sends one. A client that computed its own position would be a
 * second opinion about an order that has exactly one.
 */
export async function moveTaskAction(
  id: string,
  status: string,
  afterTaskId: string | null,
): Promise<WriteState> {
  const column = STATUSES.find((one) => one === status);
  if (!column) {
    return { error: "That is not a column this board has." };
  }
  return run((context) =>
    callAction(context, "tasks.move", {
      id,
      status: column,
      afterTaskId,
    }),
  );
}

export async function setTaskStatusAction(
  id: string,
  status: string,
): Promise<WriteState> {
  return moveTaskAction(id, status, null);
}

export async function assignTaskAction(
  id: string,
  memberId: string,
): Promise<WriteState> {
  return run(
    (context) => callAction(context, "tasks.assign", { id, memberId }),
    ["/board", `/tasks/${id}`],
  );
}

export async function unassignTaskAction(
  id: string,
  memberId: string,
): Promise<WriteState> {
  return run(
    (context) => callAction(context, "tasks.unassign", { id, memberId }),
    ["/board", `/tasks/${id}`],
  );
}

export async function addChecklistItemAction(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (id === "" || title === "") {
    return { error: "A checklist line needs some words." };
  }
  return run(
    (context) => callAction(context, "tasks.addChecklistItem", { id, title }),
    ["/board", `/tasks/${id}`],
  );
}

export async function setChecklistItemAction(
  id: string,
  itemId: string,
  done: boolean,
): Promise<WriteState> {
  return run(
    (context) =>
      callAction(context, "tasks.setChecklistItem", { id, itemId, done }),
    ["/board", `/tasks/${id}`],
  );
}

export async function setDueOnAction(
  id: string,
  dueOn: string,
): Promise<WriteState> {
  return run(
    (context) =>
      callAction(context, "tasks.update", {
        id,
        dueOn: dueOn === "" ? null : dueOn,
      }),
    ["/board", `/tasks/${id}`, "/review"],
  );
}
