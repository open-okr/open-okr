"use server";

/**
 * The writes the OKR editor on S-13 makes (P8-G12).
 *
 * The explorer was read-only: every control was a link and the empty state
 * pointed somebody at a different screen. These are the server actions behind
 * the inline edits, the add rows and the delete controls, and each one is a
 * thin call onto an action that already exists. Nothing here decides anything:
 * the refusal a member sees is the one the Operation pipeline produced.
 *
 * **Renames, values and removals moved to the OKR tree's cache at P9-T06c**
 * (`lib/okr-tree/actions.ts`), where they change the row at once and carry
 * the values they read, and deleting an objective joined them at P9-T07b-b.
 * What stays here adds a row or a cycle, which re-renders the page because
 * its count and score move with them.
 */

import { callAction, OperationError } from "@openokr/core";
import type { CycleCadence, GoalLevel } from "@openokr/db";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";

interface EditorResult {
  readonly error: string | null;
}

export interface CreatedResult extends EditorResult {
  readonly id: string | null;
}

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

/** The member row behind the current session, for the roles a create needs. */
async function actingMemberId(): Promise<string> {
  const { workspace } = await requireWorkspace();
  return workspace.memberId;
}

const refused = (error: unknown): EditorResult => {
  if (error instanceof OperationError) {
    return { error: error.message };
  }
  throw error;
};

/**
 * The explorer, the Work Map, the dashboard and the cycle screen all count
 * these rows, so the whole layout is revalidated rather than this path.
 */
function refresh(): void {
  revalidatePath("/", "layout");
}

/**
 * A new objective in the current cycle, championed and reviewed by whoever
 * added it.
 *
 * **`guided` is not set, so the phase gate does not refuse this.** METHOD.md
 * §2 blocks drafting inside the guided cycle until the earlier phases pass,
 * and that gate belongs to the cycle screen's own create. A draft written
 * here is still a draft: the publish gates are untouched and the quality
 * verdicts render the moment the title is saved.
 */
export async function addObjective(input: {
  cycleId: string;
  level: GoalLevel;
  title: string;
}): Promise<CreatedResult> {
  const memberId = await actingMemberId();
  try {
    const created = await callAction(await context(), "goals.create", {
      title: input.title,
      cycleId: input.cycleId,
      level: input.level,
      ownerKind: "member",
      memberId,
      championId: memberId,
      reviewerId: memberId,
      weight: 1,
    });
    refresh();
    return { error: null, id: created.id };
  } catch (error) {
    return { ...refused(error), id: null };
  }
}

/**
 * A new key result under an objective.
 *
 * The four measure fields a key result cannot exist without get starting
 * values rather than a form: baseline nought, target a hundred, counted
 * upwards, lagging. Every one of them is editable on the goal detail, and the
 * quality checks judge the row the moment it is saved, so a row that still
 * says nothing measurable says so on screen rather than being refused on the
 * way in.
 */
export async function addKeyResult(input: {
  goalId: string;
  title: string;
  /**
   * The objective's champion and the cycle's last day (design §4.3), so the
   * first commit needs only a title and KR-3 has an owner and a date to read.
   */
  ownerId?: string;
  dueOn?: string;
}): Promise<CreatedResult> {
  try {
    const created = await callAction(await context(), "goals.addKeyResult", {
      goalId: input.goalId,
      title: input.title,
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 0,
      targetValue: 100,
      weight: 1,
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      ...(input.dueOn ? { dueOn: input.dueOn } : {}),
    });
    refresh();
    return { error: null, id: created.id };
  } catch (error) {
    return { ...refused(error), id: null };
  }
}

/**
 * A cycle created from the picker rather than from the cycle screen.
 *
 * `cycles.create` takes a date inside the period and derives the period's own
 * start, end and name from the rhythm, so the form asks for a date and a
 * cadence rather than for two dates somebody could put out of order. The
 * phases and their gates are set up on /cycle afterwards; this creates the
 * frame the picker needs in order to switch to it.
 */
export async function addCycle(input: {
  on: string;
  cadence: CycleCadence;
  name?: string;
}): Promise<CreatedResult> {
  try {
    const created = await callAction(await context(), "cycles.create", {
      on: input.on,
      cadence: input.cadence,
      // Never the first cycle: that one is created by the setup wizard, and
      // claiming it here would re-run the first-cycle path on a workspace
      // that already has a rhythm.
      firstCycle: false,
      ...(input.name ? { name: input.name } : {}),
    });
    refresh();
    return { error: null, id: created.id };
  } catch (error) {
    return { ...refused(error), id: null };
  }
}
