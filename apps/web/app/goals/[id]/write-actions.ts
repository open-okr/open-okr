"use server";

/**
 * The goal writes P6-G27 gave a browser path (GAP-AUDIT §5).
 *
 * `goals.moveToCycle` and `goals.unlinkKpi` shipped with the goal and neither
 * had a caller anywhere in `apps/web`. Both are small, both are audited by the
 * pipeline, and both were reachable only from the command line.
 */

import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";

export interface WriteResult {
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

const refused = (error: unknown): WriteResult => {
  if (error instanceof OperationError) {
    return { error: error.message };
  }
  throw error;
};

export async function moveGoalToCycle(input: {
  id: string;
  cycleId: string;
}): Promise<WriteResult> {
  try {
    await callAction(await context(), "goals.moveToCycle", input);
  } catch (error) {
    return refused(error);
  }
  // Both cycles read differently now, and neither is only this page: the
  // scorecard, the cycle screen and the Work Map all count by cycle.
  revalidatePath("/", "layout");
  return { error: null };
}

export async function unlinkKeyResultKpi(input: {
  id: string;
}): Promise<WriteResult> {
  try {
    await callAction(await context(), "goals.unlinkKpi", input);
  } catch (error) {
    return refused(error);
  }
  revalidatePath("/", "layout");
  return { error: null };
}
