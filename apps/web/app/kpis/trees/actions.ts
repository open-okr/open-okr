"use server";

/**
 * Naming a driver tree (S-18, METHOD.md §6.3, P3-T14).
 */
import { callAction } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { refusedByField } from "../../../lib/refusal";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { NO_ERROR, type WriteState } from "../../cycle/write-state.ts";

/**
 * A refused write under the field it names, or as the form's sentence
 * (guided-inputs §4.2). A schema's refusal too, which used to reach the
 * error page. Anything else goes on to the error page.
 */
async function refused(error: unknown): Promise<WriteState> {
  const state = refusedByField(error, (await getTranslations()).t);
  if (state === null) {
    throw error;
  }
  return state;
}

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
  const unit = String(formData.get("unit") ?? "").trim();
  const treeId = String(formData.get("treeId") ?? "").trim();
  if (title === "" || parentKpiId === "") {
    const { t } = await getTranslations();
    const message = t("kpis.trees.actions.driverNeedsATitleAndParent");
    // Under the title when that is what is missing. The parent is the KPI
    // the panel was opened under, a hidden field, so the panel says that
    // one under the form.
    return {
      error: null,
      fields: { [title === "" ? "title" : "parentKpiId"]: message },
    };
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
      ...(unit === "" ? {} : { unit }),
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
    return refused(error);
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
    const { t } = await getTranslations();
    return {
      error: null,
      fields: { kpiId: t("kpis.trees.actions.pickAKpiToFile") },
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
      "kpis.update",
      { kpiId, treeId: treeId === "" ? null : treeId },
    );
  } catch (error) {
    return refused(error);
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
    const { t } = await getTranslations();
    return {
      error: null,
      fields: { name: t("kpis.trees.actions.treeNeedsAName") },
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
      "kpis.createTree",
      { name },
    );
  } catch (error) {
    return refused(error);
  }
  revalidatePath("/kpis/trees");
  return NO_ERROR;
}
