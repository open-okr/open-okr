"use server";

/**
 * The drafting surface's writes (P3-T04).
 *
 * Same shape as the workflow writes next door: turn a form submission into one
 * registry call, let the Operation pipeline do the rest, and hand a refusal back
 * as a sentence rather than throwing it into the error boundary.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../lib/auth";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { NO_ERROR, type WriteState } from "./write-state.ts";

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
  revalidatePath("/cycle");
  return NO_ERROR;
}

export async function createGoal(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const cycleId = String(formData.get("cycleId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const contributionStatement = String(
    formData.get("contributionStatement") ?? "",
  ).trim();
  const level = String(formData.get("level") ?? "company");
  const championId = String(formData.get("championId") ?? "");
  const reviewerId = String(formData.get("reviewerId") ?? "");

  if (title === "") {
    const { t } = await getTranslations();
    return { error: t("cycle.actions.objectiveNeedsASentence") };
  }

  return run((context) =>
    callAction(context, "goals.create", {
      cycleId,
      title,
      level: level as "company" | "department" | "team" | "individual",
      ownerKind: "workspace",
      // Omitted rather than sent empty when nobody was chosen (P8-G13d):
      // `goals.create` then names whoever is drafting, and an empty string
      // would fail the uuid schema instead.
      ...(championId ? { championId } : {}),
      // "" is the "No reviewer" option, or no picker at all where the
      // practice turns reviewers off (P9-T04), and either means none.
      reviewerId: reviewerId === "" ? null : reviewerId,
      weight: 1,
      ...(contributionStatement === "" ? {} : { contributionStatement }),
    }),
  );
}

export async function addKeyResult(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const goalId = String(formData.get("goalId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const baselineValue = Number(formData.get("baselineValue"));
  const targetValue = Number(formData.get("targetValue"));
  const { t } = await getTranslations();

  if (title === "") {
    return { error: t("cycle.actions.keyResultNeedsASentence") };
  }
  if (!Number.isFinite(baselineValue) || !Number.isFinite(targetValue)) {
    // METHOD.md KR-3: both are required. A missing baseline is the second most
    // common defect in a draft, so the refusal says which one is missing.
    return { error: t("cycle.actions.keyResultNeedsBaselineAndTarget") };
  }

  const ownerId = String(formData.get("ownerId") ?? "");
  const dueOn = String(formData.get("dueOn") ?? "");
  // Empty is "measured by hand". A KPI named here is checked on the server,
  // which refuses one this workspace does not hold (completeness review M-07).
  const kpiId = String(formData.get("kpiId") ?? "");

  return run((context) =>
    callAction(context, "goals.addKeyResult", {
      goalId,
      title,
      // KR-3 fails without an owner and a date, and the form used to send
      // neither, so every key result drafted here failed it (H-09).
      ...(ownerId === "" ? {} : { ownerId }),
      ...(dueOn === "" ? {} : { dueOn }),
      ...(kpiId === "" ? {} : { kpiId }),
      direction: String(formData.get("direction") ?? "increase") as
        | "increase"
        | "reduce"
        | "maintain"
        | "move",
      indicatorType: String(formData.get("indicatorType") ?? "leading") as
        | "leading"
        | "lagging",
      baselineValue,
      targetValue,
      weight: 1,
      ...(unit === "" ? {} : { unit }),
    }),
  );
}

export async function recordValue(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const id = String(formData.get("id") ?? "");
  const value = Number(formData.get("value"));
  if (!Number.isFinite(value)) {
    const { t } = await getTranslations();
    return { error: t("cycle.actions.valueHasToBeANumber") };
  }
  return run((context) =>
    callAction(context, "goals.recordValue", { id, value }),
  );
}

/** A drafted key result's owner and due date, which KR-3 asks for (H-09). */
export async function setKeyResultOwnerAndDate(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const ownerId = String(formData.get("ownerId") ?? "");
  const dueOn = String(formData.get("dueOn") ?? "");
  return run((context) =>
    callAction(context, "goals.updateKeyResult", {
      id: String(formData.get("id") ?? ""),
      ownerId: ownerId === "" ? null : ownerId,
      dueOn: dueOn === "" ? null : dueOn,
    }),
  );
}
