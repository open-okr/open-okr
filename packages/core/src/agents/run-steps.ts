/**
 * One step of an agent run, as the outbox carries it (completeness review
 * M-11, AI-NATIVE-PLAN.md §6.5).
 *
 * **The run's own state machine lives in `packages/agents`**, which depends
 * on this package and not the other way round. So the topic and the shape of
 * its payload are declared here, where both the producer (`agents.startRun`)
 * and the consumer (the outbox handler) can see them, and the host supplies
 * the function that actually takes the step. That is the same arrangement the
 * drafter and the embedder already have.
 *
 * A step names the task index it is for. A row delivered twice, or delivered
 * after the run has already moved on, finds the run at a different index and
 * does nothing, which is what keeps at-least-once delivery from running one
 * task twice.
 */

/** The topic every step of an agent run is enqueued under. */
export const AGENT_RUN_STEP_TOPIC = "agents.run.continue";

/** What one step's outbox row carries. Identifiers only. */
export interface AgentRunStepJob {
  readonly workspaceId: string;
  readonly runId: string;
  /** The task this step is for. Stale when the run is already past it. */
  readonly taskIndex: number;
}

/**
 * What taking one step came to, for the relay's log.
 *
 * `skipped` is an ordinary answer rather than a failure: a run somebody
 * cancelled, or a row delivered a second time, has nothing left to do and
 * retrying it would change nothing.
 */
export type AgentRunStepOutcome =
  | { readonly kind: "stepped" }
  | { readonly kind: "skipped"; readonly reason: string };

/** The outbox row for one step, keyed so the same step is enqueued once. */
export function agentRunStep(job: AgentRunStepJob): {
  readonly topic: string;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
} {
  return {
    topic: AGENT_RUN_STEP_TOPIC,
    payload: {
      workspaceId: job.workspaceId,
      runId: job.runId,
      taskIndex: job.taskIndex,
    },
    idempotencyKey: `${AGENT_RUN_STEP_TOPIC}:${job.runId}:${job.taskIndex}`,
  };
}

/** Turns an outbox payload into a step, or answers null. */
export function parseAgentRunStepJob(
  payload: Record<string, unknown>,
): AgentRunStepJob | null {
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value : null;
  const workspaceId = text(payload.workspaceId);
  const runId = text(payload.runId);
  const taskIndex = payload.taskIndex;
  if (
    !workspaceId ||
    !runId ||
    typeof taskIndex !== "number" ||
    !Number.isInteger(taskIndex) ||
    taskIndex < 0
  ) {
    return null;
  }
  return { workspaceId, runId, taskIndex };
}
