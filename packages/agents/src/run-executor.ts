/**
 * The run executor: the state machine that actually processes an agent
 * run's task list (AI-NATIVE-PLAN.md §6.5, §7, TECHNICAL-PLAN §1's own
 * package table — "run state machines" live in `packages/agents`, not in
 * `packages/core/src/actions/agents.ts`, which only starts and reads a run).
 *
 * `processNextTask` handles exactly one task per call and returns. It is not
 * a loop: the caller (the outbox relay's dispatch, or a test calling it
 * directly) decides whether and when the next task runs. This is what makes
 * "a run resumes correctly after a restart" true by construction — every
 * call re-reads the run's persisted state from the database rather than
 * closing over anything in memory, so a crash between calls loses nothing
 * but a scheduling opportunity, never task state.
 *
 * Dispatch never calls the job queue port's own enqueue method directly
 * (the boundary gate's own rule, `packages/adapters/src/ports/jobs.ts`):
 * when tasks remain, this
 * writes an outbox row in the same transaction as the task's own log entry,
 * and whatever relay is wired up in `apps/web` is what turns that row into
 * the next `processNextTask` call. No relay wiring exists yet — same
 * "mechanism proven, no live caller" scope every AI task since P2-T13 has
 * carried — so a run only actually advances past its first task when
 * something calls `processNextTask` again itself, which is exactly what the
 * tests below do.
 */
import {
  ACCESS_LEVELS,
  callAction,
  isOverHardCap,
  OperationError,
  type OperationTx,
  resolveMemberAccessLevel,
  resolveSubjectContext,
  runOperation,
} from "@openokr/core";
import {
  type Agent,
  type AgentRun,
  type AgentRunLogEntry,
  activeOnly,
  agentRuns,
  agents,
  proposedChanges,
  withWorkspace,
} from "@openokr/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

export interface ProcessNextTaskInput {
  readonly workspaceId: string;
  readonly runId: string;
}

export interface ProcessNextTaskResult {
  /** True once this call left the run in `completed` or `failed`. */
  readonly finished: boolean;
  readonly status: AgentRun["status"];
  readonly logEntry: AgentRunLogEntry;
}

interface LoadedRun {
  readonly run: AgentRun;
  readonly agent: Agent;
}

const DENIED_MESSAGE = "No such resource, or this agent has no access to it.";

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
 * Processes exactly one task from a `running` run: the binding check, the
 * autonomy-scoped dispatch (simulate, propose, or call the real action),
 * the append-only log entry, and advancing (or finishing) the run.
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
        const [run] = await tx
          .select()
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.id, input.runId),
              eq(agentRuns.workspaceId, workspaceId),
            ),
          )
          .limit(1);
        if (!run) {
          throw new OperationError("not_found", "No such run.");
        }
        if (run.status !== "running") {
          throw new OperationError(
            "not_found",
            "This run is not currently running.",
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

        const cap = await isOverHardCap(pool, { workspaceId });
        if (cap.over) {
          const now = new Date();
          await tx
            .update(agentRuns)
            .set({
              status: "failed",
              error: cap.reason,
              finishedAt: now,
              updatedAt: now,
            })
            .where(eq(agentRuns.id, run.id));
          const logEntry: AgentRunLogEntry = {
            at: now.toISOString(),
            taskIndex: run.currentTaskIndex,
            kind: "error",
            message: `Halted: ${cap.reason}`,
          };
          const result: ProcessNextTaskResult = {
            finished: true,
            status: "failed",
            logEntry,
          };
          return {
            result,
            activity: {
              kind: "agent.run_failed",
              subjectType: "workspace_member",
              subjectId: agent.memberId,
              payload: { runId: run.id, error: cap.reason },
            },
            audit: {
              action: "agents.processNextTask",
              targetType: "workspace_member",
              targetId: agent.memberId,
              payload: { runId: run.id, haltedOnBudget: true },
            },
          };
        }

        const task = run.tasks[run.currentTaskIndex];
        const taskIndex = run.currentTaskIndex;
        const now = new Date();
        let kind: AgentRunLogEntry["kind"];
        let message: string;

        if (!task) {
          kind = "error";
          message = "No task at the current index.";
        } else if (
          await isDeniedByBindings(tx, workspaceId, agent.memberId, task)
        ) {
          kind = "denied";
          message = `Denied "${task.action}": ${DENIED_MESSAGE}`;
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
          try {
            // Deliberately outside this operation's own transaction, same
            // reasoning as proposedChanges.bulkApply: the dispatched action
            // is a real, independent write with its own Operation pipeline
            // transaction, audit row and outbox rows. A failure here must
            // not roll back this run's own progress through its task list.
            await callAction(
              {
                pool,
                workspaceId,
                actor: { kind: "agent", memberId: agent.memberId },
              },
              task.action as never,
              task.input as never,
            );
            kind = "applied";
            message = `Applied "${task.action}".`;
          } catch (error) {
            kind = "error";
            message = `"${task.action}" failed: ${(error as Error).message}`;
          }
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
                {
                  topic: "agents.run.continue",
                  payload: { workspaceId, runId: run.id, taskIndex: nextIndex },
                  idempotencyKey: `agents.run.continue:${run.id}:${nextIndex}`,
                },
              ],
        };
      },
    },
  );
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
