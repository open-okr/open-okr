/**
 * The run executor: the state machine that actually processes an agent
 * run's task list (AI-NATIVE-PLAN.md §6.5, §7, TECHNICAL-PLAN §1's own
 * package table — "run state machines" live in `packages/agents`, not in
 * `packages/core/src/actions/agents.ts`, which only starts and reads a run).
 *
 * `processNextTask` handles exactly one task per call and returns. It is not
 * a loop: the caller decides whether and when the next task runs. This is
 * what makes "a run resumes correctly after a restart" true by construction —
 * every call re-reads the run's persisted state from the database rather
 * than closing over anything in memory, so a crash between calls loses
 * nothing but a scheduling opportunity, never task state.
 *
 * **How a run moves (completeness review M-11).** `agents.startRun` writes
 * the run and an outbox row for its first step in one transaction. The relay
 * delivers that row to `continueAgentRun` below, through the host, which
 * resolves the agent's AI provider and takes one step. A step that leaves
 * tasks behind writes the next row in its own transaction. Dispatch never
 * calls the job queue port's own enqueue method directly (the boundary
 * gate's own rule, `packages/adapters/src/ports/jobs.ts`). Until M-11 nothing
 * read those rows, so a run never got past the task it was started on.
 */
import type { GuardedAIProvider } from "@openokr/adapters";
import {
  ACCESS_LEVELS,
  type AgentRunStepJob,
  type AgentRunStepOutcome,
  agentRunStep,
  callAction,
  defaultMetrics,
  getAction,
  isOverAgentBudget,
  isOverHardCap,
  METRIC,
  OperationError,
  type OperationTx,
  resolveAgentRunCostCap,
  resolveMemberAccessLevel,
  resolveSubjectContext,
  runOperation,
} from "@openokr/core";
import {
  type AgentRun,
  type AgentRunLogEntry,
  activeOnly,
  agentRuns,
  agents,
  type ModelTier,
  proposedChanges,
  withWorkspace,
} from "@openokr/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

export interface ProcessNextTaskInput {
  readonly workspaceId: string;
  readonly runId: string;
  /**
   * The task this step is for, as the outbox row names it (M-11).
   *
   * A step for an index the run has already passed is refused rather than
   * taken, so a row delivered twice cannot run the next task in its place,
   * and two relays holding two rows for one run cannot both take the same
   * task. Absent means "whatever is next", which is what a test driving a run
   * by hand wants.
   */
  readonly taskIndex?: number;
}

/**
 * The provider and model this agent's tier routes to (M-11).
 *
 * Resolved by the host through its one choke point,
 * `apps/web/lib/ai-provider.ts`, so the workspace's egress controls come with
 * it: this package never builds a provider. Guarded, so `permits` says
 * whether the workspace's privacy settings let a request reach it at all.
 */
export interface AgentRunModel {
  readonly provider: GuardedAIProvider;
  readonly modelId: string;
}

export interface ProcessNextTaskOptions {
  /**
   * The run's model, or null when this workspace has none for the agent's
   * tier.
   *
   * **Required, and null stops the run.** A custom agent is its instructions
   * and a model, and unlike the Coach and the Champion it has no
   * deterministic form to fall back to: "an air-gapped installation points at
   * a local model or turns AI off, including the agents" (AI-NATIVE-PLAN
   * §1.5). Optional would have meant a caller that forgot to ask got a run
   * with no check at all.
   */
  readonly model: AgentRunModel | null;
}

export interface ProcessNextTaskResult {
  /** True once this call left the run completed, failed or cancelled. */
  readonly finished: boolean;
  readonly status: AgentRun["status"];
  readonly logEntry: AgentRunLogEntry;
}

const DENIED_MESSAGE = "No such resource, or this agent has no access to it.";

/**
 * The tier a run asks for when its agent names none.
 *
 * AI-NATIVE-PLAN §3.4 gives `deep` to "agent reasoning", and a run is the
 * agent reasoning. An agent that names its own tier gets that one.
 */
const DEFAULT_AGENT_RUN_TIER: ModelTier = "deep";

/**
 * Why a run may not use the model it was given, or null when it may.
 *
 * `assist` is the purpose the drafter asks for too: a run works on the items
 * its own bindings name, which is an assist's shape rather than retrieval
 * across the workspace. A workspace whose egress level lets nothing reach the
 * provider has no agent runs, exactly as it has no drafter.
 */
function modelRefusal(model: AgentRunModel | null): string | null {
  if (model === null) {
    return "no AI provider is configured for this agent's tier, and a custom agent has no deterministic form to run without one.";
  }
  if (!model.provider.permits("assist")) {
    return "this workspace's AI privacy settings keep this agent's requests from reaching its provider.";
  }
  return null;
}

/**
 * Whether the agent's own bindings reach the task's target — the same
 * not-found-shaped refusal `getAccessScoped` uses, so a run's log never
 * tells an unauthorised task more than a denied read would. A task with no
 * `subjectType`/`subjectId` (a workspace-scoped action) has nothing to bind
 * against here; the dispatched action's own access check is what covers it.
 */
async function isDeniedByBindings(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  task: AgentRun["tasks"][number],
): Promise<boolean> {
  if (!task.subjectType || !task.subjectId) {
    return false;
  }
  const context = await resolveSubjectContext(
    tx,
    task.subjectType,
    task.subjectId,
    workspaceId,
  );
  if (!context) {
    return true;
  }
  const level = await resolveMemberAccessLevel(tx, {
    workspaceId,
    memberId,
    contextId: context.contextId,
  });
  return level < ACCESS_LEVELS.view;
}

/**
 * The trigger label a finished run is counted under.
 *
 * A run started through `agents.startRun` names its own trigger, and that is
 * free text from whoever called it, so it cannot be a metric label: a label
 * must come from a fixed list, or every distinct string becomes a series
 * kept for the life of the process. Every such run is counted under one
 * value instead.
 */
const RUN_METRIC_TRIGGER = "agents.startRun";

/**
 * Records that one run ended (P7-T06b).
 *
 * The duration is measured from the run's own `startedAt` rather than from
 * this call, because a run spans several tasks and several transactions.
 * Skipped when the row has no start, which is a run that failed before it
 * ever began.
 */
function recordRunFinished(
  run: { readonly startedAt: Date | null },
  outcome: "completed" | "failed" | "cancelled",
  finishedAt: Date,
): void {
  const metrics = defaultMetrics();
  metrics.count(METRIC.agentRunsTotal, {
    trigger: RUN_METRIC_TRIGGER,
    outcome,
  });
  if (run.startedAt) {
    metrics.observe(
      METRIC.agentRunDuration,
      (finishedAt.getTime() - run.startedAt.getTime()) / 1000,
      { trigger: RUN_METRIC_TRIGGER },
    );
  }
}

/** Why a run stopped before its next task, as the audit row names it. */
type HaltReason = "agent_disabled" | "ai_unavailable" | "cost_cap" | "budget";

interface Halt {
  /**
   * `cancelled` for a limit the workspace chose, `failed` for a budget
   * crossed. The first is the same state the Champion's cost cap leaves, and
   * colouring it as a failure would teach people to ignore both.
   */
  readonly status: "cancelled" | "failed";
  readonly kind: AgentRunLogEntry["kind"];
  readonly reason: HaltReason;
  readonly message: string;
  readonly error?: string;
}

/**
 * Processes exactly one task from a `running` run: the stop checks, the
 * binding check, the autonomy-scoped dispatch (simulate, propose, or call
 * the real action), the append-only log entry, and advancing (or finishing)
 * the run.
 *
 * Not a registered action: nothing in the action registry's own surfaces
 * (REST, MCP, chat, the internal client) should be able to drive a run
 * task-by-task on someone else's behalf. It runs through the same Operation
 * pipeline as every other write, as a `system`-actor bootstrap operation,
 * because the only thing authorising it is that it exists at all — the same
 * shape `recordUsageEvent` already uses for the same reason.
 */
export async function processNextTask(
  pool: Pool,
  input: ProcessNextTaskInput,
  options: ProcessNextTaskOptions,
): Promise<ProcessNextTaskResult> {
  // No explicit type arguments: the boundary gate's own pipeline-span scan
  // (packages/config/src/boundaries.ts) matches `runOperation(`, not
  // `runOperation<...>(`, and TypeScript infers both from the spec below
  // regardless.
  return runOperation(
    { pool },
    {
      action: "agents.processNextTask",
      workspaceId: input.workspaceId,
      actor: { kind: "system" },
      bootstrap: true,
      async load({ tx, workspaceId }) {
        // Locked, so a cancel and a step cannot interleave: the cancel waits
        // for the step to finish, then finds the run where the step left it.
        const [run] = await tx
          .select()
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.id, input.runId),
              eq(agentRuns.workspaceId, workspaceId),
            ),
          )
          .limit(1)
          .for("update");
        if (!run) {
          throw new OperationError("not_found", "No such run.");
        }
        if (run.status !== "running") {
          throw new OperationError(
            "not_found",
            "This run is not currently running.",
          );
        }
        if (
          input.taskIndex !== undefined &&
          run.currentTaskIndex !== input.taskIndex
        ) {
          throw new OperationError(
            "not_found",
            "This step has already been taken.",
          );
        }
        const [agent] = await tx
          .select()
          .from(agents)
          .where(
            activeOnly(
              agents,
              eq(agents.id, run.agentId),
              eq(agents.workspaceId, workspaceId),
            ),
          )
          .limit(1);
        if (!agent) {
          throw new OperationError("not_found", "No such agent.");
        }
        return { run, agent };
      },
      async execute({ tx, workspaceId, loaded }) {
        const { run, agent } = loaded;
        const now = new Date();

        /**
         * Ends the run before its next task, with the reason in its own log.
         *
         * Every stop below comes through here, so each one is a line an
         * administrator can read on the run, an audit row naming why, and a
         * run that is finished rather than one that says it is running.
         */
        const halt = async (stop: Halt) => {
          const logEntry: AgentRunLogEntry = {
            at: now.toISOString(),
            taskIndex: run.currentTaskIndex,
            kind: stop.kind,
            message: stop.message,
          };
          await tx
            .update(agentRuns)
            .set({
              status: stop.status,
              log: [...run.log, logEntry],
              error: stop.error ?? null,
              finishedAt: now,
              updatedAt: now,
            })
            .where(eq(agentRuns.id, run.id));
          recordRunFinished(run, stop.status, now);
          const result: ProcessNextTaskResult = {
            finished: true,
            status: stop.status,
            logEntry,
          };
          return {
            result,
            activity:
              stop.status === "failed"
                ? {
                    kind: "agent.run_failed",
                    subjectType: "workspace_member",
                    subjectId: agent.memberId,
                    payload: { runId: run.id, error: stop.error ?? null },
                  }
                : {
                    kind: "agent.run_cancelled",
                    subjectType: "workspace_member",
                    subjectId: agent.memberId,
                    payload: { runId: run.id, reason: stop.reason },
                  },
            audit: {
              action: "agents.processNextTask",
              targetType: "workspace_member",
              targetId: agent.memberId,
              payload: {
                runId: run.id,
                taskIndex: run.currentTaskIndex,
                halted: stop.reason,
                ...(stop.reason === "budget" ? { haltedOnBudget: true } : {}),
              },
            },
          };
        };

        // Turning an agent off stops what it is doing, not only what it
        // would start next. An administrator silencing a noisy agent should
        // not watch it finish a list first.
        if (!agent.enabled) {
          return halt({
            status: "cancelled",
            kind: "denied",
            reason: "agent_disabled",
            message: "Stopped: this agent was turned off.",
          });
        }

        // Checked every step rather than once, because a provider can be
        // switched off, and an egress level narrowed, while a run is going.
        const refusal = modelRefusal(options.model);
        if (refusal !== null) {
          return halt({
            status: "cancelled",
            kind: "denied",
            reason: "ai_unavailable",
            message: `Stopped: ${refusal}`,
          });
        }

        // §4.14's per-run cap. Zero means the agent may not spend, which
        // halts the run as cancelled, the same answer the Champion gives.
        const capUsd = await resolveAgentRunCostCap(pool, workspaceId);
        const spentUsd = Number(run.cost);
        if (capUsd <= 0 || spentUsd >= capUsd) {
          return halt({
            status: "cancelled",
            kind: "denied",
            reason: "cost_cap",
            message: `Stopped: the cost cap for one run is ${capUsd} US dollars and this run has spent ${spentUsd}.`,
          });
        }

        // The hard caps (AI-NATIVE-PLAN §6.5): the workspace's, and then
        // this agent's own. Either halts the run mid-flight as failed.
        const workspaceCap = await isOverHardCap(pool, { workspaceId });
        if (workspaceCap.over) {
          return halt({
            status: "failed",
            kind: "error",
            reason: "budget",
            message: `Halted: ${workspaceCap.reason}`,
            ...(workspaceCap.reason ? { error: workspaceCap.reason } : {}),
          });
        }
        const agentCap = await isOverAgentBudget(pool, {
          workspaceId,
          agentId: agent.id,
        });
        if (agentCap.over) {
          return halt({
            status: "failed",
            kind: "error",
            reason: "budget",
            message: `Halted: ${agentCap.reason}`,
            ...(agentCap.reason ? { error: agentCap.reason } : {}),
          });
        }

        const task = run.tasks[run.currentTaskIndex];
        const taskIndex = run.currentTaskIndex;
        const definition = task ? getAction(task.action) : undefined;
        let kind: AgentRunLogEntry["kind"];
        let message: string;

        /**
         * Calls the task's action as the agent, through the same `can()` a
         * click goes through.
         *
         * Deliberately outside this operation's own transaction, same
         * reasoning as proposedChanges.bulkApply: a dispatched write is a
         * real, independent write with its own Operation pipeline
         * transaction, audit row and outbox rows. A failure here must not
         * roll back this run's own progress through its task list.
         */
        const asAgent = async (
          action: string,
          taskInput: Record<string, unknown>,
          done: string,
        ): Promise<[AgentRunLogEntry["kind"], string]> => {
          try {
            await callAction(
              {
                pool,
                workspaceId,
                actor: { kind: "agent", memberId: agent.memberId },
              },
              action as never,
              taskInput as never,
            );
            return ["applied", done];
          } catch (error) {
            return ["error", `"${action}" failed: ${(error as Error).message}`];
          }
        };

        if (!task) {
          kind = "error";
          message = "No task at the current index.";
        } else if (!definition) {
          // `agents.startRun` refuses an action the registry does not have,
          // so this is a run written before that check, or an action removed
          // since. Logged rather than proposed: a proposal nobody could ever
          // apply is noise in the one queue a person has to read.
          kind = "error";
          message = `No action is called "${task.action}".`;
        } else if (
          await isDeniedByBindings(tx, workspaceId, agent.memberId, task)
        ) {
          kind = "denied";
          message = `Denied "${task.action}": ${DENIED_MESSAGE}`;
        } else if (definition.safety === "read") {
          // **A read is not a write, so no write policy applies to it**
          // (M-11). "Propose turns every write into a proposal" (AI-NATIVE-PLAN
          // §6.5), and a proposal to read something would sit in the review
          // queue meaning nothing. It runs as the agent in every mode,
          // sandbox included, because reading commits nothing; the agent's
          // own bindings are what limit what it can see. Most reads still
          // resolve their caller by user id and refuse an agent outright,
          // which fails closed: such a task is logged as an error.
          [kind, message] = await asAgent(
            task.action,
            task.input,
            `Read "${task.action}".`,
          );
        } else if (agent.autonomy === "sandbox") {
          kind = "simulated";
          message = `Simulated "${task.action}" — sandbox mode commits nothing.`;
        } else if (agent.autonomy === "propose") {
          // openokr:allow-mutation: this is the operation's own execute, on
          // the transaction runOperation opened. The proposal is the actual
          // domain write "propose" mode makes; nothing about the task's own
          // action runs until a human applies it (proposedChanges.bulkApply).
          await tx.insert(proposedChanges).values({
            workspaceId,
            runId: run.id,
            action: task.action,
            payload: task.input,
            subjectType: task.subjectType ?? null,
            subjectId: task.subjectId ?? null,
          });
          kind = "proposed";
          message = `Proposed "${task.action}" for review.`;
        } else {
          // `scoped_direct`, the per-agent opt-in an administrator sets with
          // `agents.setAutonomy`. Still inside the agent's bindings, and
          // still fully audited as the agent.
          [kind, message] = await asAgent(
            task.action,
            task.input,
            `Applied "${task.action}".`,
          );
        }

        const logEntry: AgentRunLogEntry = {
          at: now.toISOString(),
          taskIndex,
          kind,
          message,
        };
        const log = [...run.log, logEntry];
        const nextIndex = taskIndex + 1;
        const finished = nextIndex >= run.tasks.length;
        const status = finished ? "completed" : "running";

        await tx
          .update(agentRuns)
          .set({
            currentTaskIndex: nextIndex,
            log,
            status,
            finishedAt: finished ? now : null,
            updatedAt: now,
          })
          .where(eq(agentRuns.id, run.id));

        if (finished) {
          recordRunFinished(run, "completed", now);
        }

        return {
          result: { finished, status, logEntry },
          activity: finished
            ? {
                kind: "agent.run_completed",
                subjectType: "workspace_member",
                subjectId: agent.memberId,
                payload: { runId: run.id },
              }
            : {
                kind: "agent.run_task_processed",
                subjectType: "workspace_member",
                subjectId: agent.memberId,
                payload: { taskIndex, outcome: kind },
              },
          audit: {
            action: "agents.processNextTask",
            targetType: "workspace_member",
            targetId: agent.memberId,
            payload: { runId: run.id, taskIndex, outcome: kind },
          },
          // Self-reschedule only when there is a next task and the run has
          // not been halted: an outbox row, never a direct JobQueue call
          // (the boundary gate's own rule). Keyed on the run and the task
          // index it is about to attempt, so a redelivered row cannot double
          // up a step that already advanced past it.
          outbox: finished
            ? []
            : [
                agentRunStep({
                  workspaceId,
                  runId: run.id,
                  taskIndex: nextIndex,
                }),
              ],
        };
      },
    },
  );
}

/** What the host gives a run: its model, through the host's own choke point. */
export interface AgentRunHost {
  /**
   * The provider and model a tier routes to for this workspace, or null when
   * nothing is configured for it. `providerForTier` in the web app.
   */
  modelFor(workspaceId: string, tier: ModelTier): Promise<AgentRunModel | null>;
}

/**
 * Takes the step one outbox row asks for (completeness review M-11).
 *
 * The relay's side of a run. It resolves the agent's model through the host,
 * then hands one step to `processNextTask`. A row that no longer describes
 * the run, because the run was cancelled, finished or already moved past
 * this task, is skipped rather than failed: retrying it would change
 * nothing, and a dead letter for every cancelled run would bury the real
 * failures an operator goes to that log for.
 */
export async function continueAgentRun(
  pool: Pool,
  job: AgentRunStepJob,
  host: AgentRunHost,
): Promise<AgentRunStepOutcome> {
  const db = drizzle(pool);
  const current = await withWorkspace(db, job.workspaceId, async (tx) => {
    const [row] = await tx
      .select({
        status: agentRuns.status,
        currentTaskIndex: agentRuns.currentTaskIndex,
        tier: agents.tier,
      })
      .from(agentRuns)
      .innerJoin(agents, eq(agents.id, agentRuns.agentId))
      .where(
        activeOnly(
          agents,
          eq(agentRuns.id, job.runId),
          eq(agentRuns.workspaceId, job.workspaceId),
        ),
      )
      .limit(1);
    return row;
  });

  if (!current) {
    return {
      kind: "skipped",
      reason: "the run, or the agent it belongs to, no longer exists",
    };
  }
  if (current.status !== "running") {
    return { kind: "skipped", reason: `the run is ${current.status}` };
  }
  if (current.currentTaskIndex !== job.taskIndex) {
    return { kind: "skipped", reason: "this step has already been taken" };
  }

  // Resolved before the step's transaction opens rather than inside it, so a
  // step holds one connection while the host reads keys and routing on its
  // own.
  const model = await host.modelFor(
    job.workspaceId,
    current.tier ?? DEFAULT_AGENT_RUN_TIER,
  );

  try {
    await processNextTask(
      pool,
      {
        workspaceId: job.workspaceId,
        runId: job.runId,
        taskIndex: job.taskIndex,
      },
      { model },
    );
  } catch (error) {
    // The run moved between the read above and the step's own locked read:
    // cancelled by hand, or taken by another relay. Both are answers, not
    // failures.
    if (error instanceof OperationError && error.code === "not_found") {
      return { kind: "skipped", reason: error.message };
    }
    throw error;
  }
  return { kind: "stepped" };
}

/**
 * Loads a run's current state without changing anything — for a caller
 * (a test proving resume-after-restart, a future worker) that needs to
 * decide whether to call `processNextTask` again without going through
 * `agents.readRun`'s own registered-action shape.
 */
export async function readRunState(
  pool: Pool,
  input: ProcessNextTaskInput,
): Promise<AgentRun | undefined> {
  const db = drizzle(pool);
  return withWorkspace(db, input.workspaceId, async (tx) => {
    const [run] = await tx
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.id, input.runId),
          eq(agentRuns.workspaceId, input.workspaceId),
        ),
      )
      .limit(1);
    return run;
  });
}
