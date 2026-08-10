/**
 * Agent, run and proposal actions (AI-NATIVE-PLAN.md §6.5, §7, P2-T17).
 * All `full`-access admin governance, matching every other S-36/S-37 card
 * — creating an agent and granting it access to named resources is a
 * workspace decision, never something a member does to themselves.
 *
 * `agents.startRun` accepts an already-decomposed task list rather than
 * calling a real model to plan one: real planning is `extractStructured`
 * (`packages/agents`) against the agent's own `planningInstructions`, and
 * that has no real feature caller yet, the same "mechanism proven, no live
 * caller" scope P2-T13/T14/T15/T16 already carry. What actually processes
 * a task — the write-policy dispatch, the binding check, the append-only
 * log — is `packages/agents/src/run-executor.ts`, not this file, matching
 * TECHNICAL-PLAN §1's own package table: run state machines live there.
 */
import {
  AGENT_AUTONOMIES,
  AGENT_KINDS,
  AGENT_SCHEDULES,
  type AgentTask,
  AI_PROVIDER_KINDS,
  activeOnly,
  agentRuns,
  agents,
  MODEL_TIERS,
  proposedChanges,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { bindGroup, ensureMemberGroup } from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { resolveSubjectContext } from "../access/reads.ts";
import { OperationError } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";
import { callAction } from "./registry.ts";

const agentOutput = z.object({
  id: z.uuid(),
  memberId: z.uuid(),
  name: z.string(),
  kind: z.enum(AGENT_KINDS),
  persona: z.string(),
  planningInstructions: z.string(),
  executionInstructions: z.string(),
  provider: z.enum(AI_PROVIDER_KINDS).nullable(),
  tier: z.enum(MODEL_TIERS).nullable(),
  schedule: z.enum(AGENT_SCHEDULES),
  autonomy: z.enum(AGENT_AUTONOMIES),
  enabled: z.boolean(),
});

const toAgentOutput = (row: typeof agents.$inferSelect) => ({
  id: row.id,
  memberId: row.memberId,
  name: row.name,
  kind: row.kind,
  persona: row.persona,
  planningInstructions: row.planningInstructions,
  executionInstructions: row.executionInstructions,
  provider: row.provider,
  tier: row.tier,
  schedule: row.schedule,
  autonomy: row.autonomy,
  enabled: row.enabled,
});

export const readAgents = defineReadAction({
  name: "agents.list",
  summary: "Every agent this workspace has, seeded or custom.",
  input: z.object({}),
  output: z.array(agentOutput),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const db = drizzle(context.pool);
    const rows = await withWorkspace(db, context.workspaceId, (tx) =>
      tx
        .select()
        .from(agents)
        .where(activeOnly(agents, eq(agents.workspaceId, context.workspaceId))),
    );
    return rows.map(toAgentOutput);
  },
});

export const createAgent = defineWriteAction({
  name: "agents.create",
  summary:
    "Creates an agent: its own member record, kind = 'agent', with no access until bound.",
  input: z.object({
    name: z.string().trim().min(1),
    kind: z.enum(AGENT_KINDS).default("custom"),
    persona: z.string().default(""),
    planningInstructions: z.string().default(""),
    executionInstructions: z.string().default(""),
    provider: z.enum(AI_PROVIDER_KINDS).nullable().default(null),
    tier: z.enum(MODEL_TIERS).nullable().default(null),
    schedule: z.enum(AGENT_SCHEDULES).default("manual"),
    autonomy: z.enum(AGENT_AUTONOMIES).default("propose"),
  }),
  output: agentOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      // openokr:allow-mutation: this is the operation's own execute, on
      // the transaction runOperation opened. The agent's own member row
      // and its agents row commit together — there is no state where one
      // exists without the other.
      const [member] = await tx
        .insert(workspaceMembers)
        .values({
          workspaceId,
          name: input.name,
          kind: "agent",
          status: "active",
        })
        .returning({ id: workspaceMembers.id });
      if (!member) {
        throw new OperationError(
          "not_found",
          "Could not create the agent's member record.",
        );
      }

      // openokr:allow-mutation: same transaction, same reason.
      const [inserted] = await tx
        .insert(agents)
        .values({
          workspaceId,
          memberId: member.id,
          name: input.name,
          kind: input.kind,
          persona: input.persona,
          planningInstructions: input.planningInstructions,
          executionInstructions: input.executionInstructions,
          provider: input.provider,
          tier: input.tier,
          schedule: input.schedule,
          autonomy: input.autonomy,
        })
        .returning();
      if (!inserted) {
        throw new OperationError("not_found", "Could not create the agent.");
      }

      return {
        result: toAgentOutput(inserted),
        activity: {
          kind: "agent.created",
          subjectType: "workspace_member",
          subjectId: member.id,
          payload: { name: input.name, agentKind: input.kind },
        },
        audit: {
          action: "agents.create",
          targetType: "workspace_member",
          targetId: member.id,
          payload: { name: input.name, agentKind: input.kind },
        },
      };
    },
  }),
});

export const setAgentEnabled = defineWriteAction({
  name: "agents.setEnabled",
  summary: "Turns an agent on or off.",
  input: z.object({ id: z.uuid(), enabled: z.boolean() }),
  output: z.object({ id: z.uuid(), enabled: z.boolean() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [existing] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(
          activeOnly(
            agents,
            eq(agents.id, input.id),
            eq(agents.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new OperationError("not_found", "No such agent.");
      }
      // openokr:allow-mutation: this is the operation's own execute.
      await tx
        .update(agents)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(activeOnly(agents, eq(agents.id, existing.id)));

      return {
        result: { id: existing.id, enabled: input.enabled },
        activity: {
          kind: "agent.enabled_changed",
          subjectType: "workspace_member",
          subjectId: existing.id,
          payload: { enabled: input.enabled },
        },
        audit: {
          action: "agents.setEnabled",
          targetType: "workspace_member",
          targetId: existing.id,
          payload: { enabled: input.enabled },
        },
      };
    },
  }),
});

export const bindAgentScope = defineWriteAction({
  name: "agents.bindScope",
  summary:
    "Grants an agent's member group a binding on one named resource — never workspace-wide.",
  input: z.object({
    agentId: z.uuid(),
    resourceType: z.string().trim().min(1),
    resourceId: z.uuid(),
    level: z.number().int().min(ACCESS_LEVELS.view).max(ACCESS_LEVELS.full),
  }),
  output: z.object({
    agentId: z.uuid(),
    resourceType: z.string(),
    resourceId: z.uuid(),
    level: z.number(),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const [agent] = await tx
        .select({ memberId: agents.memberId })
        .from(agents)
        .where(
          activeOnly(
            agents,
            eq(agents.id, input.agentId),
            eq(agents.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!agent) {
        throw new OperationError("not_found", "No such agent.");
      }
      return agent;
    },
    async execute({ tx, workspaceId, loaded }) {
      const context = await resolveSubjectContext(
        tx,
        input.resourceType,
        input.resourceId,
        workspaceId,
      );
      if (!context) {
        throw new OperationError(
          "not_found",
          "No such resource to bind against.",
        );
      }
      const groupId = await ensureMemberGroup(tx, {
        workspaceId,
        memberId: loaded.memberId,
      });
      await bindGroup(tx, {
        workspaceId,
        groupId,
        contextId: context.contextId,
        level:
          input.level as (typeof ACCESS_LEVELS)[keyof typeof ACCESS_LEVELS],
      });

      return {
        result: {
          agentId: input.agentId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          level: input.level,
        },
        activity: {
          kind: "agent.scope_bound",
          subjectType: "workspace_member",
          subjectId: loaded.memberId,
          payload: { resourceType: input.resourceType, level: input.level },
        },
        audit: {
          action: "agents.bindScope",
          targetType: "workspace_member",
          targetId: loaded.memberId,
          payload: {
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            level: input.level,
          },
        },
      };
    },
  }),
});

const runOutput = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  trigger: z.string(),
  status: z.enum(["planning", "running", "completed", "failed", "cancelled"]),
  currentTaskIndex: z.number().int(),
  taskCount: z.number().int(),
  log: z.array(
    z.object({
      at: z.string(),
      taskIndex: z.number().int(),
      kind: z.enum(["denied", "simulated", "proposed", "applied", "error"]),
      message: z.string(),
    }),
  ),
  cost: z.number(),
  error: z.string().nullable(),
});

const taskSchema = z.object({
  action: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  subjectType: z.string().optional(),
  subjectId: z.uuid().optional(),
});

export const startAgentRun = defineWriteAction({
  name: "agents.startRun",
  summary: "Starts a run for an agent against an already-decomposed task list.",
  input: z.object({
    agentId: z.uuid(),
    trigger: z.string().trim().min(1),
    tasks: z.array(taskSchema).min(1),
  }),
  output: runOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const [agent] = await tx
        .select({ id: agents.id, enabled: agents.enabled })
        .from(agents)
        .where(
          activeOnly(
            agents,
            eq(agents.id, input.agentId),
            eq(agents.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!agent) {
        throw new OperationError("not_found", "No such agent.");
      }
      if (!agent.enabled) {
        throw new OperationError("not_found", "This agent is turned off.");
      }
      return agent;
    },
    async execute({ tx, workspaceId, loaded }) {
      // openokr:allow-mutation: this is the operation's own execute.
      const [run] = await tx
        .insert(agentRuns)
        .values({
          workspaceId,
          agentId: loaded.id,
          trigger: input.trigger,
          status: "running",
          tasks: input.tasks as AgentTask[],
          startedAt: new Date(),
        })
        .returning();
      if (!run) {
        throw new OperationError("not_found", "Could not start the run.");
      }

      return {
        result: {
          id: run.id,
          agentId: run.agentId,
          trigger: run.trigger,
          status: run.status,
          currentTaskIndex: run.currentTaskIndex,
          taskCount: run.tasks.length,
          log: run.log,
          cost: Number(run.cost),
          error: run.error,
        },
        activity: {
          kind: "agent.run_started",
          subjectType: "workspace_member",
          subjectId: loaded.id,
          payload: { trigger: input.trigger, taskCount: input.tasks.length },
        },
        audit: {
          action: "agents.startRun",
          targetType: "workspace_member",
          targetId: loaded.id,
          payload: { trigger: input.trigger, taskCount: input.tasks.length },
        },
      };
    },
  }),
});

export const readAgentRun = defineReadAction({
  name: "agents.readRun",
  summary:
    "One run's status, task progress, cost and its full append-only log.",
  input: z.object({ id: z.uuid() }),
  output: runOutput,
  access: ACCESS_LEVELS.full,
  async handler(context, input) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const [run] = await tx
        .select()
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.id, input.id),
            eq(agentRuns.workspaceId, context.workspaceId),
          ),
        )
        .limit(1);
      if (!run) {
        throw new OperationError("not_found", "No such run.");
      }
      return {
        id: run.id,
        agentId: run.agentId,
        trigger: run.trigger,
        status: run.status,
        currentTaskIndex: run.currentTaskIndex,
        taskCount: run.tasks.length,
        log: run.log,
        cost: Number(run.cost),
        error: run.error,
      };
    });
  },
});

export const cancelAgentRun = defineWriteAction({
  name: "agents.cancelRun",
  summary: "Cancels a run that is still planning or running.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid(), status: z.literal("cancelled") }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [existing] = await tx
        .select({ id: agentRuns.id, status: agentRuns.status })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.id, input.id),
            eq(agentRuns.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (
        !existing ||
        (existing.status !== "planning" && existing.status !== "running")
      ) {
        throw new OperationError(
          "not_found",
          "No cancellable run with that id.",
        );
      }
      // openokr:allow-mutation: this is the operation's own execute.
      await tx
        .update(agentRuns)
        .set({
          status: "cancelled",
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(agentRuns.id, existing.id));

      return {
        result: { id: existing.id, status: "cancelled" as const },
        activity: {
          kind: "agent.run_cancelled",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { runId: existing.id },
        },
        audit: {
          action: "agents.cancelRun",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { runId: existing.id },
        },
      };
    },
  }),
});

const proposalOutput = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  action: z.string(),
  payload: z.record(z.string(), z.unknown()),
  subjectType: z.string().nullable(),
  subjectId: z.uuid().nullable(),
  status: z.enum(["pending", "applied", "dismissed"]),
});

export const listProposedChanges = defineReadAction({
  name: "proposals.list",
  summary: "Every pending proposal waiting in the review inbox.",
  input: z.object({
    status: z.enum(["pending", "applied", "dismissed"]).default("pending"),
  }),
  output: z.array(proposalOutput),
  access: ACCESS_LEVELS.full,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const rows = await withWorkspace(db, context.workspaceId, (tx) =>
      tx
        .select()
        .from(proposedChanges)
        .where(
          and(
            eq(proposedChanges.workspaceId, context.workspaceId),
            eq(proposedChanges.status, input.status),
          ),
        ),
    );
    return rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      action: row.action,
      payload: row.payload as Record<string, unknown>,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      status: row.status,
    }));
  },
});

export const bulkApplyProposedChanges = defineWriteAction({
  name: "proposals.bulkApply",
  summary:
    "Applies one or more pending proposals through the normal Operation pipeline, with the deciding member as the actor.",
  input: z.object({ ids: z.array(z.uuid()).min(1) }),
  output: z.object({
    applied: z.array(z.uuid()),
    failed: z.array(z.object({ id: z.uuid(), error: z.string() })),
  }),
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    async load({ tx, workspaceId }) {
      return tx
        .select()
        .from(proposedChanges)
        .where(
          and(
            eq(proposedChanges.workspaceId, workspaceId),
            eq(proposedChanges.status, "pending"),
          ),
        );
    },
    async execute({ tx, workspaceId, actor, loaded }) {
      const targets = loaded.filter((row) => input.ids.includes(row.id));
      const applied: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];

      for (const proposal of targets) {
        try {
          // Deliberately outside this transaction: the proposal being
          // applied is a real, independent domain write with its own
          // Operation pipeline transaction, audit row and outbox rows.
          // Folding it into this operation's own transaction would make
          // one proposal's failure roll back every other proposal in the
          // same bulk-apply call, and roll back the decision itself.
          await callAction(
            {
              pool: context.pool,
              workspaceId,
              actor: {
                kind: actor.kind,
                userId: context.actor.userId,
                memberId: actor.memberId ?? undefined,
              },
            },
            proposal.action as never,
            proposal.payload as never,
          );
          applied.push(proposal.id);
        } catch (error) {
          failed.push({ id: proposal.id, error: (error as Error).message });
        }
      }

      if (applied.length > 0) {
        // openokr:allow-mutation: this is the operation's own execute, on
        // the transaction runOperation opened. Only the proposal rows'
        // own decision fields change here; the proposal's real effect
        // already committed in its own transaction above. Scoped to
        // `applied` specifically — a row that failed above must stay
        // pending, not be marked applied alongside the ones that succeeded.
        await tx
          .update(proposedChanges)
          .set({
            status: "applied",
            decidedByMemberId: actor.memberId,
            decidedAt: new Date(),
          })
          .where(
            and(
              eq(proposedChanges.workspaceId, workspaceId),
              inArray(proposedChanges.id, applied),
            ),
          );
      }

      return {
        result: { applied: applied, failed },
        activity: {
          kind: "proposed_change.bulk_applied",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { appliedCount: applied.length, failedCount: failed.length },
        },
        audit: {
          action: "proposals.bulkApply",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { applied, failed: failed.map((f) => f.id) },
        },
      };
    },
  }),
});

export const bulkDismissProposedChanges = defineWriteAction({
  name: "proposals.bulkDismiss",
  summary: "Dismisses one or more pending proposals without applying them.",
  input: z.object({ ids: z.array(z.uuid()).min(1) }),
  output: z.object({ dismissed: z.array(z.uuid()) }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      // openokr:allow-mutation: this is the operation's own execute.
      // Scoped to input.ids and status "pending" both — a proposal already
      // applied or dismissed must not be re-decided by naming its id again.
      const rows = await tx
        .update(proposedChanges)
        .set({
          status: "dismissed",
          decidedByMemberId: actor.memberId,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(proposedChanges.workspaceId, workspaceId),
            eq(proposedChanges.status, "pending"),
            inArray(proposedChanges.id, input.ids),
          ),
        )
        .returning({ id: proposedChanges.id });
      const dismissed = rows.map((row) => row.id);

      return {
        result: { dismissed },
        activity: {
          kind: "proposed_change.bulk_dismissed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { dismissedCount: dismissed.length },
        },
        audit: {
          action: "proposals.bulkDismiss",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { dismissed },
        },
      };
    },
  }),
});
