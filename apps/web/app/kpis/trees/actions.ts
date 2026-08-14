"use server";

/**
 * Naming a driver tree (S-18, METHOD.md §6.3, P3-T14).
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { NO_ERROR, type WriteState } from "../../cycle/write-state.ts";

export async function addDriver(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const title = String(formData.get("title") ?? "").trim();
  const parentKpiId = String(formData.get("parentKpiId") ?? "").trim();
  const indicatorType = String(formData.get("indicatorType") ?? "leading");
  const direction = String(formData.get("direction") ?? "higher_better");
  const frequency = String(formData.get("frequency") ?? "monthly");
  const targetRaw = String(formData.get("targetDefault") ?? "").trim();
  const treeId = String(formData.get("treeId") ?? "").trim();
  if (title === "" || parentKpiId === "") {
    return { error: "A driver needs a title and a parent to drive." };
  }
  const target = Number(targetRaw);

  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  try {
    const created = await callAction(context, "kpis.create", {
      title,
      parentKpiId,
      frequency: frequency as
        | "daily"
        | "weekly"
        | "monthly"
        | "quarterly"
        | "yearly",
      direction: direction as "higher_better" | "lower_better",
      indicatorType: indicatorType as "leading" | "lagging",
      // A driver sits below whatever it drives, and the tier the spec names for
      // something a team can act on this week is input.
      tier: indicatorType === "leading" ? "input" : "output",
      aggregate: "sum",
      ownerKind: "workspace",
      ...(targetRaw !== "" && Number.isFinite(target)
        ? { targetDefault: target }
        : {}),
    });
    if (treeId !== "") {
      // A driver belongs to the tree it hangs in. Saying so here means nobody
      // has to file it by hand afterwards.
      await callAction(context, "kpis.update", {
        kpiId: created.id,
        treeId,
      });
    }
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/kpis/trees");
  revalidatePath("/kpis");
  return NO_ERROR;
}

export async function fileIntoTree(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const kpiId = String(formData.get("kpiId") ?? "").trim();
  const treeId = String(formData.get("treeId") ?? "").trim();
  if (kpiId === "") {
    return { error: "Pick a KPI to file." };
  }
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "kpis.update",
      { kpiId, treeId: treeId === "" ? null : treeId },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/kpis/trees");
  return NO_ERROR;
}

export async function addTree(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const name = String(formData.get("name") ?? "").trim();
  if (name === "") {
    return { error: "A tree needs a name. What does its root measure?" };
  }
  const { session, workspace } = await requireWorkspace();
  try {
    await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "kpis.createTree",
      { name },
    );
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidatePath("/kpis/trees");
  return NO_ERROR;
}
