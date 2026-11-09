"use server";

/**
 * An agent's instructions and its planned runs, from Admin, Agents
 * (docs/design/agent-instructions.md, plan 0.7.0 A7).
 *
 * The planner needs a model, which only the host can build, so the drafter is
 * made here for the agent's own tier, `deep` where it names none, as a custom
 * agent's run does (AI-NATIVE-PLAN §6.5).
 */
import { callAction, OperationError } from "@openokr/core";
import type { ModelTier } from "@openokr/db";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { drafterFor } from "../../../lib/drafter";
import { refusalOf, refusedState } from "../../../lib/refusal";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

export interface InstructionsState {
  readonly error?: string;
  readonly fields?: Readonly<Record<string, string>>;
  readonly saved?: number;
}

export async function saveInstructionsAction(
  _previous: InstructionsState,
  form: FormData,
): Promise<InstructionsState> {
  const { t } = await getTranslations();
  const stage = String(form.get("stage") ?? "");
  try {
    const { version } = await callAction(
      await context(),
      "agents.setInstructions",
      {
        agentId: String(form.get("agentId") ?? ""),
        stage: stage === "execution" ? "execution" : "planning",
        text: String(form.get("text") ?? ""),
      },
    );
    revalidatePath("/admin/agents");
    return { saved: version };
  } catch (error) {
    const refused = refusedState(error, t, ["text"]);
    if (refused === null) {
      throw error;
    }
    return refused;
  }
}

export async function restoreInstructionsAction(input: {
  readonly agentId: string;
  readonly stage: "planning" | "execution";
  readonly version: number;
}): Promise<{ readonly error: string | null }> {
  try {
    await callAction(await context(), "agents.restoreInstructions", input);
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === null) {
      throw error;
    }
    return { error: refusal };
  }
  revalidatePath("/admin/agents");
  return { error: null };
}

export type PlannedTask = {
  readonly action: string;
  readonly input: Record<string, unknown>;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly why: string;
};

export type PlanAnswer =
  | { readonly kind: "planned"; readonly tasks: readonly PlannedTask[] }
  | { readonly kind: "refused"; readonly reason: string };

export async function planRunAction(
  agentId: string,
  tier: ModelTier | null,
): Promise<PlanAnswer> {
  const base = await context();
  const drafter = await drafterFor(
    base.workspaceId,
    // A custom agent plans on its own tier, `deep` where it names none, and
    // never on the embedding tier, which cannot write a plan.
    tier && tier !== "embed" ? tier : "deep",
    base.actor.userId,
    { agentId },
  );
  try {
    const answer = await callAction(
      { ...base, ...(drafter ? { drafter } : {}) },
      "agents.planRun",
      { agentId },
    );
    return answer.kind === "planned"
      ? { kind: "planned", tasks: answer.tasks }
      : { kind: "refused", reason: answer.reason };
  } catch (error) {
    if (error instanceof OperationError) {
      return { kind: "refused", reason: error.message };
    }
    throw error;
  }
}

export async function startPlannedRunAction(
  agentId: string,
  tasks: readonly PlannedTask[],
): Promise<{ readonly error: string | null }> {
  const { t } = await getTranslations();
  try {
    await callAction(await context(), "agents.startRun", {
      agentId,
      trigger: t("admin.agents.instructions.plannedTrigger"),
      tasks: tasks.map(({ why: _why, ...task }) => task),
    });
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === null) {
      throw error;
    }
    return { error: refusal };
  }
  revalidatePath("/admin/agents");
  return { error: null };
}
