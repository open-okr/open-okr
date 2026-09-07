"use server";

/**
 * The initiative screen's writes (S-26, P5-T10b).
 *
 * Every one is a thin wrapper over a registry action, which is the whole point:
 * the refusals a reader sees here are written in `packages/core`, so the browser
 * and an agent calling the same tool are told the same thing.
 *
 * **Nothing here writes progress.** `initiatives.update` has no such field, and
 * this file cannot invent one. The work-layer design's §1 is the reason: an
 * initiative's progress is the share of its own tasks that are done (P5-T11),
 * and it never becomes a key result's progress.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "../cycle/write-state.ts";

async function run(
  fn: (context: {
    pool: ReturnType<typeof getPool>;
    workspaceId: string;
    actor: { kind: "human"; userId: string };
  }) => Promise<unknown>,
  paths: readonly string[] = ["/initiatives"],
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

const CAPACITIES = ["fits", "tight", "exceeds"] as const;
const STATUSES = ["planned", "active", "done", "dropped"] as const;

type Capacity = (typeof CAPACITIES)[number];
type Status = (typeof STATUSES)[number];

const asCapacity = (value: string): Capacity | null =>
  CAPACITIES.find((one) => one === value) ?? null;

const asStatus = (value: string): Status | null =>
  STATUSES.find((one) => one === value) ?? null;

export async function createInitiativeAction(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const title = String(formData.get("title") ?? "").trim();
  const spaceId = String(formData.get("spaceId") ?? "");
  const ownerId = String(formData.get("ownerId") ?? "");
  const startsOn = String(formData.get("startsOn") ?? "").trim();
  const endsOn = String(formData.get("endsOn") ?? "").trim();
  const keyResultId = String(formData.get("keyResultId") ?? "").trim();

  if (title === "") {
    return { error: "An initiative needs a title. What work is this?" };
  }
  if (spaceId === "" || ownerId === "") {
    return { error: "An initiative needs a space and somebody who owns it." };
  }

  return run((context) =>
    callAction(context, "initiatives.create", {
      spaceId,
      title,
      ownerId,
      ...(startsOn === "" ? {} : { startsOn }),
      ...(endsOn === "" ? {} : { endsOn }),
      ...(keyResultId === "" ? {} : { keyResultIds: [keyResultId] }),
    }),
  );
}

/**
 * One field at a time, from the row itself.
 *
 * S-26 asks for inline editing, and the smallest honest version of that is a
 * select that submits on change. A refusal comes back as a sentence rather than
 * a reverted control, so a reader who lacks edit access learns why.
 */
export async function setStatusAction(
  id: string,
  status: string,
): Promise<WriteState> {
  const value = asStatus(status);
  if (!value) {
    return { error: "That is not a status an initiative has." };
  }
  return run(
    (context) =>
      callAction(context, "initiatives.update", { id, status: value }),
    ["/initiatives", `/initiatives/${id}`],
  );
}

export async function setCapacityAction(
  id: string,
  capacity: string,
): Promise<WriteState> {
  // The empty string is "nobody has judged it", which is a different fact from
  // `fits` and the one gate five reads differently.
  const value = capacity === "" ? null : asCapacity(capacity);
  if (capacity !== "" && !value) {
    return { error: "That is not one of the three capacity verdicts." };
  }
  return run(
    (context) =>
      callAction(context, "initiatives.update", { id, capacity: value }),
    ["/initiatives", `/initiatives/${id}`, "/cycle"],
  );
}

export async function linkKeyResultAction(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  const keyResultId = String(formData.get("keyResultId") ?? "");
  if (id === "" || keyResultId === "") {
    return { error: "Pick the key result this work will move." };
  }
  return run(
    (context) =>
      callAction(context, "initiatives.linkKeyResult", { id, keyResultId }),
    ["/initiatives", `/initiatives/${id}`, "/cycle"],
  );
}

export async function unlinkKeyResultAction(
  id: string,
  keyResultId: string,
): Promise<WriteState> {
  return run(
    (context) =>
      callAction(context, "initiatives.unlinkKeyResult", { id, keyResultId }),
    ["/initiatives", `/initiatives/${id}`, "/cycle"],
  );
}
