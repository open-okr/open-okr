/**
 * How a run uses an agent's instructions (docs/design/agent-instructions.md,
 * plan 0.7.0 A7, "design approved" 10 November 2026).
 *
 * | Piece | Decision |
 * |---|---|
 * | Two stages | Planning in cycle phases 0 to 5, execution in 6 and 7 (I1) |
 * | Versions | `ai_prompts`, keys `agent.<agentId>.planning` and `.execution`; the agent's own column is version 0, so nothing needs a data change (I2) |
 * | The planner's menu | The `core` toolset's reads and writes on the agent surface, never a destructive action (I4) |
 * | What it is shown | Titles, levels, states, progress and confidence in the agent's bindings; no text people wrote (I5) |
 *
 * Pure reads and pure checks. The writes are the actions in
 * `actions/agent-instructions.ts`, through the Operation pipeline.
 */
import {
  activeOnly,
  type agents,
  aiPrompts,
  cycles,
  goals,
  keyResults,
  kpis,
  workspaceMembers,
} from "@openokr/db";
import { asc, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import type { ActionDefinition } from "../actions/define.ts";
import { TOOLSETS } from "../api/mcp/toolset-data.ts";
import type { OperationTx } from "../operations/operation.ts";
import { agentSeesGoal, agentSeesKpi } from "./scope.ts";

export const INSTRUCTION_STAGES = ["planning", "execution"] as const;
export type InstructionStage = (typeof INSTRUCTION_STAGES)[number];

/** Longest instructions a save takes: a page, not a manual. */
export const INSTRUCTIONS_MAX = 4000;

/** The stage a cycle phase asks for (I1): phases 0 to 5 plan, 6 and 7 run. */
export function stageForPhase(phase: number): InstructionStage {
  return phase <= 5 ? "planning" : "execution";
}

export const instructionKey = (agentId: string, stage: InstructionStage) =>
  `agent.${agentId}.${stage}`;

export interface InstructionVersion {
  readonly version: number;
  readonly text: string;
  /** Who saved it; null for version 0, which the agent was made with. */
  readonly savedBy: string | null;
  readonly savedAt: string | null;
}

type AgentRow = typeof agents.$inferSelect;

/** Every version of one stage, newest first, ending with version 0. */
export async function instructionHistoryInTx(
  tx: OperationTx,
  workspaceId: string,
  agent: AgentRow,
  stage: InstructionStage,
): Promise<readonly InstructionVersion[]> {
  const rows = await tx
    .select({
      version: aiPrompts.version,
      text: aiPrompts.systemPrompt,
      savedBy: workspaceMembers.name,
      savedAt: aiPrompts.createdAt,
    })
    .from(aiPrompts)
    .leftJoin(
      workspaceMembers,
      eq(workspaceMembers.id, aiPrompts.createdByMemberId),
    )
    .where(
      activeOnly(
        aiPrompts,
        eq(aiPrompts.workspaceId, workspaceId),
        eq(aiPrompts.promptKey, instructionKey(agent.id, stage)),
      ),
    )
    .orderBy(desc(aiPrompts.version));
  return [
    ...rows.map((row) => ({
      version: row.version,
      text: row.text,
      savedBy: row.savedBy ?? null,
      savedAt: row.savedAt ? new Date(row.savedAt).toISOString() : null,
    })),
    {
      version: 0,
      text:
        stage === "planning"
          ? agent.planningInstructions
          : agent.executionInstructions,
      savedBy: null,
      savedAt: null,
    },
  ];
}

/**
 * The phase the agent works in now: the workspace's current quarterly cycle,
 * the one that has started and is not closed, else phase 6, running, which
 * is what a workspace between cycles is doing.
 */
export async function agentPhaseInTx(
  tx: OperationTx,
  workspaceId: string,
  today: string,
): Promise<number> {
  const [cycle] = await tx
    .select({ phase: cycles.phase })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.mode, "quarterly"),
        inArray(cycles.status, ["planning", "active", "closing"]),
        lte(cycles.startsOn, today),
      ),
    )
    .orderBy(desc(cycles.startsOn))
    .limit(1);
  return cycle?.phase ?? 6;
}

/** One thing the planner is shown (I5). */
export interface PlannerResource {
  readonly kind: "goal" | "key_result" | "kpi";
  readonly id: string;
  readonly title: string;
  /** A goal's level; null otherwise. */
  readonly level: string | null;
  /** A goal's health, a KPI's state; null for a key result. */
  readonly state: string | null;
  readonly progressPct: number | null;
  readonly confidence: number | null;
  /** A key result's objective. */
  readonly goalId: string | null;
}

const VIEW_GOALS = 60;
const VIEW_KPIS = 40;

/**
 * What the planner may see, read through the agent's own bindings (I5):
 * the open goals, their key results and the KPIs its scope reaches. Titles,
 * states and numbers only. No description, comment, check-in note or member,
 * because text a third party wrote is where an injected instruction hides.
 */
export async function plannerViewInTx(
  tx: OperationTx,
  agentMemberId: string,
): Promise<readonly PlannerResource[]> {
  const scope = { memberId: agentMemberId };
  const goalRows = await tx
    .select({
      id: goals.id,
      title: goals.title,
      level: goals.level,
      health: goals.health,
      progressPct: goals.progressPct,
    })
    .from(goals)
    .where(activeOnly(goals, isNull(goals.closedAt), agentSeesGoal(scope)))
    .orderBy(asc(goals.title))
    .limit(VIEW_GOALS);
  const keyResultRows =
    goalRows.length === 0
      ? []
      : await tx
          .select({
            id: keyResults.id,
            goalId: keyResults.goalId,
            title: keyResults.title,
            progressPct: keyResults.progressPct,
            confidence: keyResults.confidence,
          })
          .from(keyResults)
          .where(
            activeOnly(
              keyResults,
              inArray(
                keyResults.goalId,
                goalRows.map((goal) => goal.id),
              ),
            ),
          );
  const kpiRows = await tx
    .select({
      id: kpis.id,
      title: kpis.title,
      state: kpis.state,
      achievementPct: kpis.achievementPct,
    })
    .from(kpis)
    .where(activeOnly(kpis, agentSeesKpi(scope)))
    .orderBy(asc(kpis.title))
    .limit(VIEW_KPIS);

  const number = (value: string | null) =>
    value === null ? null : Number(value);
  return [
    ...goalRows.map((goal) => ({
      kind: "goal" as const,
      id: goal.id,
      title: goal.title,
      level: goal.level,
      state: goal.health,
      progressPct: number(goal.progressPct),
      confidence: null,
      goalId: null,
    })),
    ...keyResultRows.map((keyResult) => ({
      kind: "key_result" as const,
      id: keyResult.id,
      title: keyResult.title,
      level: null,
      state: null,
      progressPct: number(keyResult.progressPct),
      confidence: number(keyResult.confidence),
      goalId: keyResult.goalId,
    })),
    ...kpiRows.map((kpi) => ({
      kind: "kpi" as const,
      id: kpi.id,
      title: kpi.title,
      level: null,
      state: kpi.state,
      progressPct: number(kpi.achievementPct),
      confidence: null,
      goalId: null,
    })),
  ];
}

/** One action the planner may choose (I4). */
export interface PlannerChoice {
  readonly name: string;
  readonly summary: string;
  readonly safety: "read" | "write";
}

/**
 * The planner's menu (I4): the `core` toolset's actions on the agent surface,
 * reads and writes, and never a destructive action. Agents carry no toolsets
 * of their own, so the everyday set every agent connection starts from is the
 * menu. Writes become proposals in `propose` mode, as every step's do.
 */
export function plannerMenu(
  actions: readonly ActionDefinition[],
): readonly PlannerChoice[] {
  return actions
    .filter(
      (action) =>
        TOOLSETS.core.has(action.name) &&
        action.agentSurface !== false &&
        (action.safety === "read" || action.safety === "write") &&
        !action.name.startsWith("agents.") &&
        !action.name.startsWith("proposals."),
    )
    .map((action) => ({
      name: action.name,
      summary: action.summary,
      safety: action.safety as "read" | "write",
    }));
}

/** A task as the run executor takes it. */
export interface PlannedTask {
  readonly action: string;
  readonly input: Record<string, unknown>;
  readonly subjectType?: string;
  readonly subjectId?: string;
}

/**
 * The model's tasks, each checked before a run is offered (I3, I4): its
 * action must be on the menu, and its input must parse with that action's
 * own schema. The first that does not refuses the whole plan, naming the task
 * and why, because a plan with a hole in it is not the plan that was asked.
 */
export function checkPlannedTasks(
  tasks: readonly {
    readonly action: string;
    readonly input: Record<string, unknown>;
    readonly subjectType?: string | null;
    readonly subjectId?: string | null;
  }[],
  menu: readonly PlannerChoice[],
  actionNamed: (name: string) => ActionDefinition | undefined,
):
  | { readonly ok: true; readonly tasks: readonly PlannedTask[] }
  | { readonly ok: false; readonly refused: string } {
  if (tasks.length === 0) {
    return { ok: false, refused: "The plan has no tasks." };
  }
  const allowed = new Set(menu.map((choice) => choice.name));
  const checked: PlannedTask[] = [];
  for (const [index, task] of tasks.entries()) {
    const label = `Task ${index + 1}, ${task.action},`;
    const action = actionNamed(task.action);
    if (!action) {
      return { ok: false, refused: `${label} is not an action.` };
    }
    if (action.safety === "destructive") {
      return {
        ok: false,
        refused: `${label} is destructive, and an agent's plan never includes one.`,
      };
    }
    if (!allowed.has(task.action)) {
      return {
        ok: false,
        refused: `${label} is not one of the actions this agent's plan may use.`,
      };
    }
    // Strict: a field the action does not take is a model that misread it,
    // and Zod would otherwise drop it and run the rest.
    const schema =
      action.input instanceof z.ZodObject
        ? action.input.strict()
        : action.input;
    const parsed = schema.safeParse(task.input);
    if (!parsed.success) {
      return {
        ok: false,
        refused: `${label} does not have the input that action takes.`,
      };
    }
    checked.push({
      action: task.action,
      input: task.input,
      ...(task.subjectType ? { subjectType: task.subjectType } : {}),
      ...(task.subjectId ? { subjectId: task.subjectId } : {}),
    });
  }
  return { ok: true, tasks: checked };
}
