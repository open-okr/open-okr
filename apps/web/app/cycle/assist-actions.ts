"use server";

/**
 * The planning and drafting assists, from the browser (P4-T15a).
 *
 * Three suggestions and one write. The suggestions are reads that commit
 * nothing; the write is the ordinary `goals.create` with `aiGenerated` set,
 * which is what "provenance recorded" means: an objective a reader kept from a
 * draft says so, and one they typed says so too.
 *
 * The drafter is built here rather than passed in, because a provider belongs to
 * the host. Absent means the provider is off, and every assist below then
 * answers null and the surface offers nothing.
 */
import { callAction, richTextFromPlainText } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { drafterFor } from "../../lib/drafter";
import { requireWorkspace } from "../../lib/workspace";

async function assistContext() {
  const { session, workspace } = await requireWorkspace();
  const base = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const drafter = await drafterFor(workspace.workspaceId);
  return drafter ? { ...base, drafter } : base;
}

/** Whether any assist can run at all, so the surface knows to offer them. */
export async function assistsAvailableAction(): Promise<boolean> {
  const { workspace } = await requireWorkspace();
  return (await drafterFor(workspace.workspaceId)) !== null;
}

export async function draftObjectiveAction(input: {
  readonly ambition: string;
  readonly cycleId: string;
  readonly level: "company" | "department" | "team" | "individual";
}) {
  return callAction(await assistContext(), "goals.draftObjective", input);
}

export async function suggestMeasureAction(input: {
  readonly goalId: string;
  readonly title: string;
  readonly unit?: string;
}) {
  return callAction(await assistContext(), "goals.suggestMeasure", input);
}

export async function suggestParentAction(goalId: string) {
  return callAction(await assistContext(), "goals.suggestParent", { goalId });
}

/**
 * Creates the drafted objective and its measures, marked as AI-written.
 *
 * One call rather than a form post, because the reader is applying a preview
 * they have already read: the objective and its key results arrive together or
 * the objective arrives on its own with an error saying which measure failed.
 * Each key result is its own Operation, which is what `goals.addKeyResult` is,
 * so a measure the rules refuse does not take the objective with it.
 */
export async function applyDraftedObjectiveAction(input: {
  readonly cycleId: string;
  readonly title: string;
  readonly description: string;
  readonly level: "company" | "department" | "team" | "individual";
  readonly championId: string;
  readonly reviewerId: string;
  readonly keyResults: readonly {
    readonly title: string;
    readonly unit: string | null;
    readonly direction: "increase" | "reduce" | "maintain" | "move";
    readonly indicatorType: "leading" | "lagging";
    readonly baseline: number;
    readonly target: number;
  }[];
}): Promise<{ readonly goalId: string; readonly refused: readonly string[] }> {
  const context = await assistContext();
  const created = await callAction(context, "goals.create", {
    title: input.title,
    ...(input.description.trim() === ""
      ? {}
      : { description: richTextFromPlainText(input.description) }),
    cycleId: input.cycleId,
    level: input.level,
    ownerKind: "workspace" as const,
    championId: input.championId,
    reviewerId: input.reviewerId,
    weight: 1,
    // The provenance. Set because the reader kept the draft; a reader who
    // rewrote it uses the ordinary form, which does not set this.
    aiGenerated: true,
  });

  const refused: string[] = [];
  for (const measure of input.keyResults) {
    try {
      await callAction(context, "goals.addKeyResult", {
        goalId: created.id,
        title: measure.title,
        ...(measure.unit ? { unit: measure.unit } : {}),
        direction: measure.direction,
        indicatorType: measure.indicatorType,
        baselineValue: measure.baseline,
        targetValue: measure.target,
        weight: 1,
      });
    } catch (error) {
      // Named rather than swallowed. A measure the rules refuse is worth
      // showing, and the objective it belongs to is already there to hold it.
      refused.push(
        `${measure.title}: ${error instanceof Error ? error.message : "refused"}`,
      );
    }
  }

  revalidatePath("/cycle");
  return { goalId: created.id, refused };
}

/** Aligns this objective to the suggested parent. An ordinary update. */
export async function alignToParentAction(
  goalId: string,
  parentGoalId: string,
): Promise<void> {
  await callAction(await assistContext(), "goals.update", {
    id: goalId,
    parentGoalId,
  });
  revalidatePath("/cycle");
}
