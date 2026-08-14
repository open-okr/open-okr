"use server";

/**
 * Closing a cycle out by hand (METHOD.md §8.9, P3-T15).
 *
 * P4-T12 makes both of these part of the review's own close, where they belong:
 * a facilitator finishes the quarterly review and the product records the
 * result and hands the next cycle its inheritance. Until that session exists,
 * an action nobody can reach is an action nobody can check, so both get a
 * control here.
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
  revalidatePath("/scorecard");
  revalidatePath("/cycle");
  return NO_ERROR;
}

export async function recordPerformance(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const cycleId = String(formData.get("cycleId") ?? "").trim();
  if (cycleId === "") {
    return { error: "Pick the cycle whose result you are recording." };
  }
  return run((context) => callAction(context, "cycles.snapshot", { cycleId }));
}

export async function handOver(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const fromCycleId = String(formData.get("fromCycleId") ?? "").trim();
  const toCycleId = String(formData.get("toCycleId") ?? "").trim();
  if (fromCycleId === "" || toCycleId === "") {
    return { error: "Name the cycle that is closing and the one that opens." };
  }
  return run((context) =>
    callAction(context, "cycles.feedForward", { fromCycleId, toCycleId }),
  );
}
