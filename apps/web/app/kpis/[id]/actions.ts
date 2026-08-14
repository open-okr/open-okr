"use server";

/**
 * The KPI detail's writes (S-21, P3-T14).
 *
 * The formula arrives as a tree the builder assembled, never as a string this
 * file parses: the engine takes a tree and there is no second representation
 * for the two to disagree about.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { NO_ERROR, type WriteState } from "../../cycle/write-state.ts";

type Operator = "add" | "sub" | "mul" | "div";

/**
 * Folds the chosen sources into one left-leaning tree with a single operator.
 *
 * That is the whole grammar this builder offers, and it is a deliberate floor
 * rather than the engine's limit: the engine takes any tree, and a builder that
 * exposed nesting would need a canvas nobody has designed. Sum, difference,
 * product and ratio over a list cover what a driver tree actually measures.
 */
function fold(operator: Operator, references: readonly string[]) {
  const [first, ...rest] = references;
  if (!first) {
    return null;
  }
  let node: unknown = { k: first };
  for (const reference of rest) {
    node = { op: operator, l: node, r: { k: reference } };
  }
  return node;
}

export async function setFormula(
  kpiId: string,
  operator: Operator,
  references: readonly string[],
  today: string,
): Promise<WriteState> {
  const formula = fold(operator, references);
  if (!formula) {
    return { error: "A formula needs at least one source KPI." };
  }
  if (references.length === 1) {
    return {
      error:
        "One source is a copy, not a calculation. Pick a second, or leave this KPI entered by hand.",
    };
  }
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "kpis.setFormula",
      { kpiId, formula, on: today },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath(`/kpis/${kpiId}`);
  revalidatePath("/kpis");
  return NO_ERROR;
}
