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
  type AgentRunLogEntry,
  type AgentTask,
  AI_PROVIDER_KINDS,
  activeOnly,
  agentRuns,
  agents,
  MODEL_TIERS,
  proposedChanges,
  type WorkspaceTx,
  withWorkspace,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { bindGroup, ensureMemberGroup } from "../access/contexts.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { resolveSubjectContext } from "../access/reads.ts";
import { championInTx } from "../agents/champion.ts";
import { coachInTx } from "../agents/coach.ts";
import { type NudgeCadence, runDueNudgesInTx } from "../nudges/run.ts";
import { OperationError } from "../operations/operation.ts";
import { DEFAULT_AGENT_RUN_COST_CAP_USD } from "../settings/registry.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";
import { callAction } from "./registry.ts";

/**
 * What each run records as its trigger (P4-T05b, P4-T06a).
 *
 * One string per cadence, so `agent_runs` can be read by clock: an
 * administrator asking "did the countdown fire this week" gets an answer, which
 * a single `schedule.champion` trigger could not give. The first four match
 * AI-NATIVE-PLAN.md §6.2's own rows for the Champion; `quality` is the Coach's,
 * from §6.1.
 *
 * `satisfies` rather than a plain object, so adding a cadence without a trigger
 * string fails the build here rather than writing an empty trigger into a run
 * row. It has already earned that once.
 */
const RUN_TRIGGERS = {
  hourly: "schedule.hourly",
  daily: "schedule.daily",
  weekly: "schedule.weekly",
  cycle: "schedule.cycle",
  quality: "schedule.quality",
} as const satisfies Record<NudgeCadence, string>;

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

/**
 * The Champion's hourly run (P4-T05a).
 *
 * AI-NATIVE-PLAN.md §6.2: "Hourly: the nudge queue, what is due now, per
 * member, per channel." The run is a write action for the same reason
 * `nudges.run` is: the nudge rows, the inbox rows, the run row and the audit
 * row commit together or not at all.
 *
 * With the provider off this run is the whole product. It fires every trigger,
 * escalates by the ladder and drafts nothing, which is what "deterministic
 * first" means when it is a line of code rather than a principle.
 */
export const runChampion = defineWriteAction({
  name: "agents.runChampion",
  summary:
    "Runs the Champion's nudge queue once, recording what fired in its run log.",
  input: z.object({
    /** Defaults to the moment the request arrives. Overridden by tests. */
    now: z.string().optional(),
    /**
     * Which of §6.2's four cadences to run, defaulting to the hourly nudge
     * queue so every caller written before P4-T05b keeps its behaviour.
     */
    cadence: z.enum(["hourly", "daily", "weekly", "cycle"]).optional(),
  }),
  output: z.object({
    runId: z.uuid(),
    status: z.string(),
    recorded: z.number().int(),
    suppressed: z.number().int(),
    ruleKeys: z.array(z.string()),
    /** Goals the daily sweep flipped to `outdated`. Zero for the other three. */
    staleFlipped: z.number().int(),
    /** Changes written into the review queue, pending a human (P4-T05c-a). */
    proposed: z.number().int(),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const champion = await championInTx(tx as WorkspaceTx, workspaceId);
      if (!champion) {
        throw new OperationError(
          "not_found",
          "This workspace has no Champion.",
        );
      }
      const [agent] = await tx
        .select({ id: agents.id, enabled: agents.enabled })
        .from(agents)
        .where(activeOnly(agents, eq(agents.id, champion.agentId)))
        .limit(1);
      if (!agent?.enabled) {
        throw new OperationError("not_found", "The Champion is turned off.");
      }
      const [workspace] = await tx
        .select({ settings: workspaces.settings })
        // openokr:allow-raw-read: the action already requires `full` on the
        // workspace, and this reads the settings column the getter does not
        // return.
        .from(workspaces)
        .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
        .limit(1);
      const stored = workspace?.settings?.agentRunCostCapUsd;
      return {
        agentId: agent.id,
        // A workspace provisioned before the setting existed has no key to
        // read, and falls back to the same constant a fresh one stores.
        costCapUsd:
          typeof stored === "number" ? stored : DEFAULT_AGENT_RUN_COST_CAP_USD,
      };
    },
    async execute({ tx, workspaceId, loaded }) {
      const at = input.now ? new Date(input.now) : new Date();
      const cadence: NudgeCadence = input.cadence ?? "hourly";
      const trigger = RUN_TRIGGERS[cadence];
      const log: AgentRunLogEntry[] = [];
      const stamp = at.toISOString();

      // The cap is checked before the work, not after it. A run that spent
      // first and reported the cap afterwards would have already spent.
      // Nothing here costs anything with the provider off, so this only ever
      // stops a run a workspace has explicitly forbidden by setting zero.
      if (loaded.costCapUsd <= 0) {
        log.push({
          at: stamp,
          taskIndex: 0,
          kind: "denied",
          message: `Halted before starting: the cost cap is ${loaded.costCapUsd} and a run may not spend.`,
        });
        // openokr:allow-mutation: the operation's own execute.
        const [halted] = await tx
          .insert(agentRuns)
          .values({
            workspaceId,
            agentId: loaded.agentId,
            trigger,
            // Cancelled, not failed. A limit the workspace chose is not an
            // error, and paging somebody about their own setting is how a
            // product teaches people to ignore it.
            status: "cancelled",
            tasks: [],
            log,
            startedAt: at,
            finishedAt: at,
          })
          .returning({ id: agentRuns.id });
        const haltedId = (halted as { id: string }).id;
        return {
          result: {
            runId: haltedId,
            status: "cancelled",
            recorded: 0,
            suppressed: 0,
            ruleKeys: [] as string[],
            staleFlipped: 0,
            proposed: 0,
          },
          activity: {
            // The catalogue already has this kind, from the manual cancel
            // path. A halt is a cancel with a reason in the log, and inventing
            // a second kind for it would split one thing across two feeds.
            kind: "agent.run_cancelled",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { trigger, reason: "cost_cap" },
          },
          audit: {
            action: "agents.runChampion",
            targetType: "workspace",
            targetId: workspaceId,
            payload: {
              status: "cancelled",
              capUsd: loaded.costCapUsd,
              trigger,
            },
          },
        };
      }

      // The run row is written **before** the work, not after it (P4-T05c-a).
      //
      // A proposal's `run_id` is not null, so a run that inserted its own row
      // last could not attach one: the proposal would have nothing to point at.
      // It is also the more honest shape. A run that crashes now leaves a
      // `running` row that says something started and did not finish, where
      // before it left nothing at all and read as a run that never happened.
      // openokr:allow-mutation: the operation's own execute.
      const [started] = await tx
        .insert(agentRuns)
        .values({
          workspaceId,
          agentId: loaded.agentId,
          trigger,
          status: "running",
          tasks: [],
          log: [],
          startedAt: at,
        })
        .returning({ id: agentRuns.id });
      const runId = (started as { id: string }).id;

      const run = await runDueNudgesInTx(tx as WorkspaceTx, {
        workspaceId,
        at,
        cadence,
        runId,
      });

      // One entry per rule, because a log that said "3 nudges" could not
      // answer why any one of them was sent. That question is the whole
      // reason the run log exists.
      for (const [index, ruleKey] of run.ruleKeys.entries()) {
        log.push({
          at: stamp,
          taskIndex: index,
          kind: "applied",
          message: `${ruleKey}: delivered`,
        });
      }
      log.push({
        at: stamp,
        taskIndex: run.ruleKeys.length,
        kind: "applied",
        message: `${run.recorded} delivered, ${run.suppressed} held with a reason.`,
      });
      if (run.staleFlipped > 0) {
        // The one thing a run does that is not a message. It earns its own line
        // for the same reason each rule key does: a count of nudges cannot say
        // that four goals also went outdated.
        log.push({
          at: stamp,
          taskIndex: run.ruleKeys.length + 1,
          kind: "applied",
          message: `cadence.staleness: ${run.staleFlipped} goals flipped to outdated.`,
        });
      }

      if (run.proposed > 0) {
        // A proposal is not a message, so it earns its own line rather than
        // being counted among the nudges. A reader asking "did the agent want
        // to change anything" is asking a different question from "did it
        // speak".
        log.push({
          at: stamp,
          taskIndex: run.ruleKeys.length + 2,
          kind: "applied",
          message: `${run.proposed} change(s) proposed, pending a human.`,
        });
      }

      // openokr:allow-mutation: the operation's own execute. The row was
      // inserted above so the proposals could reference it; this closes it.
      await tx
        .update(agentRuns)
        .set({ status: "completed", log, finishedAt: at })
        // Not `activeOnly`: `agent_runs` carries no `deleted_at` at all, by
        // 0018's own decision that a run is a fact rather than a document.
        .where(eq(agentRuns.id, runId));

      return {
        result: {
          runId,
          status: "completed",
          recorded: run.recorded,
          suppressed: run.suppressed,
          ruleKeys: [...run.ruleKeys],
          staleFlipped: run.staleFlipped,
          proposed: run.proposed,
        },
        activity: {
          kind: "agent.run_completed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: {
            trigger,
            recorded: run.recorded,
          },
        },
        audit: {
          action: "agents.runChampion",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { status: "completed", recorded: run.recorded, trigger },
        },
      };
    },
  }),
});

/**
 * One Coach run (P4-T06a).
 *
 * §6.1's continuous half already happens without this: P4-T02a evaluates every
 * goal against the §4 catalogue inside the transaction that writes it, and
 * stores the score and the flags. This is the other half, the one that turns a
 * standing verdict into a message somebody receives.
 *
 * Deliberately its own action rather than a `cadence` on `agents.runChampion`.
 * They are two agents with two personas, two scopes and two run logs, and an
 * administrator reading `/admin/agents` has to be able to see which of them
 * spoke. The **implementation** is shared all the way down: one
 * `runDueNudgesInTx`, one suppression decision, one row writer.
 *
 * With the AI provider off this run is the whole Coach. Every trigger it fires
 * is deterministic, which is what §6.1's own matrix claims and what this makes
 * true in code.
 */
export const runCoach = defineWriteAction({
  name: "agents.runCoach",
  summary:
    "Runs the Coach's quality pass once, recording what fired in its run log.",
  input: z.object({
    /** Defaults to the moment the request arrives. Overridden by tests. */
    now: z.string().optional(),
  }),
  output: z.object({
    runId: z.uuid(),
    status: z.string(),
    recorded: z.number().int(),
    suppressed: z.number().int(),
    ruleKeys: z.array(z.string()),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async load({ tx, workspaceId }) {
      const coach = await coachInTx(tx as WorkspaceTx, workspaceId);
      if (!coach) {
        throw new OperationError("not_found", "This workspace has no Coach.");
      }
      const [agent] = await tx
        .select({ id: agents.id, enabled: agents.enabled })
        .from(agents)
        .where(activeOnly(agents, eq(agents.id, coach.agentId)))
        .limit(1);
      if (!agent?.enabled) {
        throw new OperationError("not_found", "The Coach is turned off.");
      }
      return { agentId: agent.id };
    },
    async execute({ tx, workspaceId, loaded }) {
      const at = input.now ? new Date(input.now) : new Date();
      const stamp = at.toISOString();
      const log: AgentRunLogEntry[] = [];

      // No cost cap check, and that is not an omission. This run reads stored
      // verdicts and stored findings and calls no provider, so it cannot spend.
      // P4-T06b's semantic sweep is the Coach's first paid run and is where the
      // cap belongs.
      // openokr:allow-mutation: the operation's own execute.
      const [started] = await tx
        .insert(agentRuns)
        .values({
          workspaceId,
          agentId: loaded.agentId,
          trigger: RUN_TRIGGERS.quality,
          status: "running",
          tasks: [],
          log: [],
          startedAt: at,
        })
        .returning({ id: agentRuns.id });
      const runId = (started as { id: string }).id;

      const run = await runDueNudgesInTx(tx as WorkspaceTx, {
        workspaceId,
        at,
        cadence: "quality",
        runId,
      });

      for (const [index, ruleKey] of run.ruleKeys.entries()) {
        log.push({
          at: stamp,
          taskIndex: index,
          kind: "applied",
          message: `${ruleKey}: delivered`,
        });
      }
      log.push({
        at: stamp,
        taskIndex: run.ruleKeys.length,
        kind: "applied",
        message: `${run.recorded} delivered, ${run.suppressed} held with a reason.`,
      });

      // openokr:allow-mutation: the operation's own execute. Not `activeOnly`:
      // `agent_runs` carries no `deleted_at`.
      await tx
        .update(agentRuns)
        .set({ status: "completed", log, finishedAt: at })
        .where(eq(agentRuns.id, runId));

      return {
        result: {
          runId,
          status: "completed",
          recorded: run.recorded,
          suppressed: run.suppressed,
          ruleKeys: [...run.ruleKeys],
        },
        activity: {
          kind: "agent.run_completed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: {
            trigger: RUN_TRIGGERS.quality,
            recorded: run.recorded,
          },
        },
        audit: {
          action: "agents.runCoach",
          targetType: "workspace",
          targetId: workspaceId,
          payload: {
            status: "completed",
            recorded: run.recorded,
            trigger: RUN_TRIGGERS.quality,
          },
        },
      };
    },
  }),
});

/**
 * The run log, as a list (P4-T05a).
 *
 * `agents.readRun` answers "what happened in this run" and needs an id to do
 * it. Nobody has an id until they have seen a list, which is why an
 * administrator could not read an agent's history until now.
 *
 * Newest first, and capped, because this table grows by one row an hour per
 * workspace forever. A screen that offered every run since provisioning would
 * be unreadable within a month.
 */
export const listAgentRuns = defineReadAction({
  name: "agents.listRuns",
  summary: "Recent agent runs with their logs, newest first.",
  input: z.object({
    limit: z.number().int().min(1).max(100).optional(),
  }),
  output: z.array(
    z.object({
      id: z.uuid(),
      agentId: z.uuid(),
      agentName: z.string(),
      trigger: z.string(),
      status: z.string(),
      log: z.array(
        z.object({
          at: z.string(),
          taskIndex: z.number().int(),
          kind: z.string(),
          message: z.string(),
        }),
      ),
      cost: z.number(),
      error: z.string().nullable(),
      startedAt: z.string().nullable(),
      finishedAt: z.string().nullable(),
    }),
  ),
  access: ACCESS_LEVELS.full,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const rows = await withWorkspace(db, context.workspaceId, (tx) =>
      tx
        .select({
          id: agentRuns.id,
          agentId: agentRuns.agentId,
          agentName: agents.name,
          trigger: agentRuns.trigger,
          status: agentRuns.status,
          log: agentRuns.log,
          cost: agentRuns.cost,
          error: agentRuns.error,
          startedAt: agentRuns.startedAt,
          finishedAt: agentRuns.finishedAt,
        })
        .from(agentRuns)
        .innerJoin(agents, eq(agents.id, agentRuns.agentId))
        .where(eq(agentRuns.workspaceId, context.workspaceId))
        .orderBy(desc(agentRuns.createdAt))
        .limit(input.limit ?? 20),
    );
    return rows.map((row) => ({
      ...row,
      log: [...row.log],
      cost: Number(row.cost),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    }));
  },
});
