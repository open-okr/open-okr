"use server";

/**
 * The recovery board's writes (S-19, METHOD.md §6.5, P3-T14, P9-T18b).
 *
 * §6.5 offers three responses to an unhealthy KPI, and the board offers all
 * three. Launching a recovery is one click by design: the draft is computed
 * from the tree, so there is nothing to fill in. What the click cannot decide
 * is which cycle the objective belongs to, and that is resolved here rather
 * than in the browser. Fixing it now and adding a key result are work created
 * through their own actions, then recorded as the KPI's answer.
 */
import { callAction, OperationError } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { NO_ERROR, type WriteState } from "../../cycle/write-state.ts";

export async function launchRecovery(kpiId: string): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  try {
    const cycle = await callAction(context, "cycles.current", {
      mode: "quarterly",
    });
    if (!cycle) {
      // §4.1 gives a goal a cycle or a stated timeframe and never neither.
      // Inventing a window here would put dates on the team's behalf.
      const { t } = await getTranslations();
      return { error: t("kpis.recovery.actions.noCurrentCycle") };
    }
    await callAction(context, "kpis.launchRecovery", {
      kpiId,
      cycleId: cycle.id,
    });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidateBoard();
  return NO_ERROR;
}

function revalidateBoard() {
  revalidatePath("/kpis/recovery");
  revalidatePath("/kpis/trees");
  revalidatePath("/kpis");
  revalidatePath("/goals");
  revalidatePath("/board");
}

/**
 * Creates the work, then records it as the KPI's answer.
 *
 * Two actions rather than one, so the task and the key result keep every rule
 * of their own writes: who may add work to a space, the policy on a key result
 * added mid-cycle. The second can only refuse what the first already allowed,
 * so the gap between them is a task nobody linked, never a link to nothing.
 */
async function respond(
  kpiId: string,
  create: (
    context: Parameters<typeof callAction>[0],
  ) => Promise<
    | { kind: "fix_now"; taskId: string }
    | { kind: "key_result"; keyResultId: string }
  >,
): Promise<WriteState> {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  try {
    const answer = await create(context);
    await callAction(context, "kpis.recordResponse", { kpiId, ...answer });
  } catch (error) {
    if (error instanceof OperationError) {
      return { error: error.message };
    }
    throw error;
  }
  revalidateBoard();
  return NO_ERROR;
}

const field = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "").trim();

/**
 * §6.5's first response: day-to-day work with an owner and a date, and no
 * recovery OKR. The owner and the date are both required, because a fix
 * nobody owns by no particular day is the "monitor it" §6.5 rules out.
 */
export async function fixKpiNow(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const { t } = await getTranslations();
  const kpiId = field(formData, "kpiId");
  const title = field(formData, "title");
  const spaceId = field(formData, "spaceId");
  const ownerId = field(formData, "ownerId");
  const dueOn = field(formData, "dueOn");
  if (title === "") {
    return { error: t("kpis.recovery.actions.fixNeedsATitle") };
  }
  if (spaceId === "") {
    return { error: t("kpis.recovery.actions.fixLivesInASpace") };
  }
  if (ownerId === "" || dueOn === "") {
    return { error: t("kpis.recovery.actions.fixNeedsAnOwnerAndADate") };
  }
  return respond(kpiId, async (context) => {
    const task = await callAction(context, "tasks.create", {
      spaceId,
      title,
      status: "todo",
      dueOn,
      assigneeIds: [ownerId],
    });
    return { kind: "fix_now", taskId: task.id };
  });
}

/**
 * §6.5's second response, where the key result already exists: somebody
 * names it as the KPI's answer rather than writing a second one that claims
 * the same movement (NW-Q3-04, where a recovery's driver is the key result).
 */
export async function nameKpiKeyResult(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const kpiId = field(formData, "kpiId");
  const keyResultId = field(formData, "keyResultId");
  if (keyResultId === "") {
    const { t } = await getTranslations();
    return { error: t("kpis.recovery.actions.chooseAKeyResult") };
  }
  return respond(kpiId, async () => ({ kind: "key_result", keyResultId }));
}

/**
 * §6.5's second response: a key result for the KPI on an objective that
 * already exists, read from the KPI itself. Mid-cycle it is a key result
 * added mid-cycle, with whatever the practice asks of one.
 */
export async function answerKpiWithKeyResult(
  _previous: WriteState,
  formData: FormData,
): Promise<WriteState> {
  const { t } = await getTranslations();
  const kpiId = field(formData, "kpiId");
  const goalId = field(formData, "goalId");
  const title = field(formData, "title");
  const direction =
    field(formData, "direction") === "reduce" ? "reduce" : "increase";
  const baseline = Number(field(formData, "baseline"));
  const target = Number(field(formData, "target"));
  const reason = field(formData, "reason");
  if (goalId === "") {
    return { error: t("kpis.recovery.actions.chooseAnObjective") };
  }
  if (title === "") {
    return { error: t("kpis.recovery.actions.keyResultNeedsATitle") };
  }
  if (
    field(formData, "baseline") === "" ||
    field(formData, "target") === "" ||
    !Number.isFinite(baseline) ||
    !Number.isFinite(target)
  ) {
    return { error: t("kpis.recovery.actions.keyResultNeedsNumbers") };
  }
  return respond(kpiId, async (context) => {
    const keyResult = await callAction(context, "goals.addKeyResult", {
      goalId,
      title,
      kind: "metric",
      direction,
      indicatorType: "lagging",
      baselineValue: baseline,
      targetValue: target,
      weight: 1,
      kpiId,
      ...(reason === "" ? {} : { reason }),
    });
    return { kind: "key_result", keyResultId: keyResult.id };
  });
}
