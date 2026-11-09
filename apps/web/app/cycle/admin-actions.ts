"use server";

/**
 * The three cycle writes that had no browser caller (P6-G27b, GAP-AUDIT §5).
 *
 * `cycles.create`, `cycles.update` and `cycles.archive` all shipped and none
 * of them was reachable from a screen, so a workspace could plan exactly one
 * cycle: the one provisioning made. This screen's own empty state said an
 * administrator could create one from the rhythm settings, and no screen could.
 */

import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { refusedState } from "../../lib/refusal";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";

export interface CycleResult {
  readonly error: string | null;
  /** Each refused field's message, shown under it (guided-inputs §4.2). */
  readonly fields?: Readonly<Record<string, string>>;
  /** The cycle a create made, so the screen can open it. */
  readonly id?: string;
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
 * A refusal as the card shows it: under the one date it draws for this write
 * when it names that date, and as the card's sentence otherwise. A schema's
 * refusal too, which used to reach the error page (plan U1b).
 */
const refused = async (
  error: unknown,
  drawn: readonly string[],
): Promise<CycleResult> => {
  const state = refusedState(error, (await getTranslations()).t, drawn);
  if (state === null) {
    throw error;
  }
  return {
    error: state.error ?? null,
    ...(state.fields ? { fields: state.fields } : {}),
  };
};

export async function createCycle(input: {
  on: string;
  mode: "annual" | "quarterly";
}): Promise<CycleResult> {
  let id: string;
  try {
    // **The horizon is passed, the cadence is not** (completeness review
    // M-06). Passing neither made the quarter every time, so an annual cycle
    // could not be made from the browser at all. The screen knows which of
    // §2.1's two horizons the reader is looking at; the cadence inside the
    // quarterly one is the workspace's own, and the action reads it.
    const created = await callAction(await context(), "cycles.create", {
      on: input.on,
      mode: input.mode,
      // Not the first cycle: provisioning made that one, and claiming it here
      // would change how the period is anchored.
      firstCycle: false,
    });
    id = created.id;
  } catch (error) {
    return refused(error, ["on"]);
  }
  revalidatePath("/", "layout");
  return { error: null, id };
}

export async function updateCycleDates(input: {
  id: string;
  publicationDeadline: string | null;
}): Promise<CycleResult> {
  try {
    await callAction(await context(), "cycles.update", input);
  } catch (error) {
    return refused(error, ["publicationDeadline"]);
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
    return refused(error, []);
  }
  // Archiving moves what the scorecard, the Work Map and every cycle-scoped
  // read answer with, and none of those is this page.
  revalidatePath("/", "layout");
  return { error: null };
}
