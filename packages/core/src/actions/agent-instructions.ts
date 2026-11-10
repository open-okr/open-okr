/**
 * An agent's instructions and the planner that reads them
 * (docs/design/agent-instructions.md, plan 0.7.0 A7, approved 10 November
 * 2026).
 *
 * | Action | What it does |
 * |---|---|
 * | `agents.instructions` | Both stages: the version in use, the stage the cycle asks for now, and each stage's history |
 * | `agents.setInstructions` | A new version of one stage, for a custom agent |
 * | `agents.restoreInstructions` | A new version carrying an older one's text |
 * | `agents.planRun` | The planner: the stage's newest instructions and what the agent can see, turned into checked tasks for `agents.startRun` |
 *
 * The Coach and the Champion stay deterministic (I8): their instructions are
 * read here and refused there.
 */
import { activeOnly, agents, aiPrompts, withContext } from "@openokr/db";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  agentPhaseInTx,
  checkPlannedTasks,
  INSTRUCTION_STAGES,
  INSTRUCTIONS_MAX,
  type InstructionStage,
  instructionHistoryInTx,
  instructionKey,
  plannerMenu,
  plannerViewInTx,
  stageForPhase,
} from "../agents/instructions.ts";
import { findPersonalData } from "../ai/personal-data.ts";
import { OperationError } from "../operations/errors.ts";
import type { OperationTx } from "../operations/operation.ts";
import { actingMemberId } from "./api-tokens.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";
import { ACTIONS, getAction } from "./registry.ts";

const stage = z.enum(INSTRUCTION_STAGES);

const versionOutput = z.object({
  version: z.number().int(),
  text: z.string(),
  savedBy: z.string().nullable(),
  savedAt: z.string().nullable(),
});

async function agentInTx(tx: OperationTx, workspaceId: string, id: string) {
  const [agent] = await tx
    .select()
    .from(agents)
    .where(
      activeOnly(
        agents,
        eq(agents.id, id),
        eq(agents.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!agent) {
    throw new OperationError("not_found", "No such agent.");
  }
  return agent;
}

/** The Coach's and the Champion's decisions are the method's (I8). */
function requireCustom(agent: {
  readonly kind: string;
  readonly name: string;
}) {
  if (agent.kind !== "custom") {
    throw new OperationError(
      "forbidden",
      `${agent.name} follows the method, not instructions, so its instructions are read-only.`,
    );
  }
}

const today = () => new Date().toISOString().slice(0, 10);

export const readAgentInstructions = defineReadAction({
  name: "agents.instructions",
  agentSurface: false,
  summary:
    "An agent's planning and execution instructions: the version in use, the stage the cycle asks for now, and each stage's history.",
  input: z.object({ agentId: z.uuid() }),
  output: z.object({
    editable: z.boolean(),
    currentStage: stage,
    stages: z.array(z.object({ stage, history: z.array(versionOutput) })),
  }),
  access: ACCESS_LEVELS.full,
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const agent = await agentInTx(tx, context.workspaceId, input.agentId);
        const phase = await agentPhaseInTx(tx, context.workspaceId, today());
        const stages = [];
        for (const one of INSTRUCTION_STAGES) {
          stages.push({
            stage: one,
            history: [
              ...(await instructionHistoryInTx(
                tx,
                context.workspaceId,
                agent,
                one,
              )),
            ],
          });
        }
        return {
          editable: agent.kind === "custom",
          currentStage: stageForPhase(phase),
          stages,
        };
      },
    );
  },
});

/** Writes one new version; shared by save and restore. */
async function saveVersionInTx(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly agentId: string;
    readonly stage: InstructionStage;
    readonly text: string;
    readonly memberId: string | null;
  },
): Promise<number> {
  const [latest] = await tx
    .select({ version: aiPrompts.version })
    .from(aiPrompts)
    .where(
      activeOnly(
        aiPrompts,
        eq(aiPrompts.workspaceId, input.workspaceId),
        eq(aiPrompts.promptKey, instructionKey(input.agentId, input.stage)),
      ),
    )
    .orderBy(desc(aiPrompts.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;
  // openokr:allow-mutation: the calling Operation's own transaction.
  await tx.insert(aiPrompts).values({
    workspaceId: input.workspaceId,
    promptKey: instructionKey(input.agentId, input.stage),
    version,
    systemPrompt: input.text,
    createdByMemberId: input.memberId,
  });
  return version;
}

/** The checks A9 applies to a prompt, on an administrator's own words (I7). */
function requireClean(text: string): void {
  const found = findPersonalData(text);
  if (found.emails + found.phones > 0) {
    throw new OperationError(
      "forbidden",
      "Instructions are sent to a model, so they cannot carry an email address or a phone number. Name the person instead.",
      undefined,
      "text",
    );
  }
}

export const setAgentInstructions = defineWriteAction({
  name: "agents.setInstructions",
  agentSurface: false,
  summary:
    "Saves a new version of a custom agent's planning or execution instructions.",
  input: z.object({
    agentId: z.uuid(),
    stage,
    text: z.string().trim().max(INSTRUCTIONS_MAX),
  }),
  output: z.object({ version: z.number().int() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const agent = await agentInTx(tx, workspaceId, input.agentId);
      requireCustom(agent);
      requireClean(input.text);
      const version = await saveVersionInTx(tx, {
        workspaceId,
        agentId: agent.id,
        stage: input.stage,
        text: input.text,
        memberId: actor.memberId ?? null,
      });
      return {
        result: { version },
        activity: {
          kind: "agent.instructions_saved",
          subjectType: "workspace_member",
          subjectId: agent.id,
          payload: { stage: input.stage, version },
        },
        audit: {
          action: "agents.setInstructions",
          targetType: "workspace_member",
          targetId: agent.id,
          payload: { stage: input.stage, version },
        },
      };
    },
  }),
});

export const restoreAgentInstructions = defineWriteAction({
  name: "agents.restoreInstructions",
  agentSurface: false,
  summary:
    "Makes an older version of a custom agent's instructions the one in use, as a new version.",
  input: z.object({
    agentId: z.uuid(),
    stage,
    version: z.number().int().min(0),
  }),
  output: z.object({ version: z.number().int() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const agent = await agentInTx(tx, workspaceId, input.agentId);
      requireCustom(agent);
      const history = await instructionHistoryInTx(
        tx,
        workspaceId,
        agent,
        input.stage,
      );
      const older = history.find((one) => one.version === input.version);
      if (!older) {
        throw new OperationError("not_found", "No such version.");
      }
      const version = await saveVersionInTx(tx, {
        workspaceId,
        agentId: agent.id,
        stage: input.stage,
        text: older.text,
        memberId: actor.memberId ?? null,
      });
      return {
        result: { version },
        activity: {
          kind: "agent.instructions_saved",
          subjectType: "workspace_member",
          subjectId: agent.id,
          payload: {
            stage: input.stage,
            version,
            restoredFrom: input.version,
          },
        },
        audit: {
          action: "agents.restoreInstructions",
          targetType: "workspace_member",
          targetId: agent.id,
          payload: { stage: input.stage, version, restoredFrom: input.version },
        },
      };
    },
  }),
});

const taskOutput = z.object({
  action: z.string(),
  input: z.record(z.string(), z.unknown()),
  subjectType: z.string().optional(),
  subjectId: z.string().optional(),
  why: z.string(),
});

export const planAgentRun = defineReadAction({
  name: "agents.planRun",
  agentSurface: false,
  summary:
    "Plans a custom agent's next run from its instructions for the cycle's stage and what it can see, and checks every task. Starts nothing: agents.startRun takes the tasks.",
  input: z.object({ agentId: z.uuid() }),
  output: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("planned"),
      stage,
      instructionsVersion: z.number().int(),
      tasks: z.array(taskOutput),
    }),
    z.object({ kind: z.literal("refused"), stage, reason: z.string() }),
  ]),
  access: ACCESS_LEVELS.full,
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    const prepared = await withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        await actingMemberId(tx, context.workspaceId, userId);
        const agent = await agentInTx(tx, context.workspaceId, input.agentId);
        requireCustom(agent);
        const phase = await agentPhaseInTx(tx, context.workspaceId, today());
        const current = stageForPhase(phase);
        const [newest] = await instructionHistoryInTx(
          tx,
          context.workspaceId,
          agent,
          current,
        );
        return {
          agent,
          stage: current,
          instructions: newest ?? { version: 0, text: "" },
          resources: await plannerViewInTx(tx, agent.memberId),
        };
      },
    );

    // I9: no provider, or egress closed, no planned run.
    const drafter = context.drafter;
    if (!drafter?.planRun) {
      throw new OperationError(
        "forbidden",
        "Planning a run needs an AI provider, and none is configured for this agent.",
      );
    }
    const menu = plannerMenu(ACTIONS);
    const planned = await drafter.planRun({
      agentName: prepared.agent.name,
      stage: prepared.stage,
      instructions: prepared.instructions.text,
      resources: prepared.resources,
      menu: menu.map((choice) => ({
        name: choice.name,
        summary: choice.summary,
      })),
    });
    if (!planned) {
      return {
        kind: "refused" as const,
        stage: prepared.stage,
        reason: "The model did not return a plan this product can read.",
      };
    }
    const checked = checkPlannedTasks(planned.tasks, menu, getAction);
    if (!checked.ok) {
      return {
        kind: "refused" as const,
        stage: prepared.stage,
        reason: checked.refused,
      };
    }
    return {
      kind: "planned" as const,
      stage: prepared.stage,
      instructionsVersion: prepared.instructions.version,
      tasks: checked.tasks.map((task, index) => ({
        ...task,
        why: planned.tasks[index]?.why ?? "",
      })),
    };
  },
});
