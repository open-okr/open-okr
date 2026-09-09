"use server";

/**
 * The three cycle writes that had no browser caller (P6-G27b, GAP-AUDIT §5).
 *
 * `cycles.create`, `cycles.update` and `cycles.archive` all shipped and none
 * of them was reachable from a screen, so a workspace could plan exactly one
 * cycle: the one provisioning made. This screen's own empty state said an
 * administrator could create one from the rhythm settings, and no screen could.
 */

import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";

export interface CycleResult {
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

const refused = (error: unknown): CycleResult => {
  if (error instanceof OperationError) {
    return { error: error.message };
  }
  throw error;
};

export async function createCycle(input: { on: string }): Promise<CycleResult> {
  try {
    // The cadence is deliberately not passed: the workspace's own rhythm
    // decides it, and a picker here would be a second place to answer a
    // question §4.14 already answers.
    await callAction(await context(), "cycles.create", {
      on: input.on,
      // Not the first cycle: provisioning made that one, and claiming it here
      // would change how the period is anchored.
      firstCycle: false,
    });
  } catch (error) {
    return refused(error);
  }
  revalidatePath("/", "layout");
  return { error: null };
}

export async function updateCycleDates(input: {
  id: string;
  publicationDeadline: string | null;
}): Promise<CycleResult> {
  try {
    await callAction(await context(), "cycles.update", input);
  } catch (error) {
    return refused(error);
  }
  revalidatePath("/", "layout");
  return { error: null };
}

export async function archiveCycle(input: {
  id: string;
}): Promise<CycleResult> {
  try {
    await callAction(await context(), "cycles.archive", input);
  } catch (error) {
    return refused(error);
  }
  // Archiving moves what the scorecard, the Work Map and every cycle-scoped
  // read answer with, and none of those is this page.
  revalidatePath("/", "layout");
  return { error: null };
}
