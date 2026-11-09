/**
 * Live agent run streams (PLAN.md §7, release 0.7.0 row A11).
 *
 * The same shape `activities/live.ts`, `notifications/live.ts` and
 * `tasks/live.ts` set: `packages/core` does not hold the Realtime port, so a
 * write puts the channel name and a compact payload on an outbox row in its
 * own transaction, and the relay's `publishEvent` handler publishes it after
 * the commit. Nothing fires for a write that rolls back.
 *
 * | Question | Answer |
 * |---|---|
 * | Who writes it | Every write that changes a run: `agents.startRun`, `agents.cancelRun`, `agents.runChampion`, `agents.runCoach`, and each step or halt in `packages/agents/src/run-executor.ts` |
 * | Channel | One per workspace, `workspace:{id}:agent-runs`. The screen lists the newest runs, so it must hear about a run it has not seen yet, which a channel per run could not tell it |
 * | Payload | The run's id and its version. No status, no log line, no agent name |
 * | Who may listen | Whoever `agents.listRuns` lets read the runs, which is `full`. The stream route asks that read before it opens |
 * | What the browser does | Re-reads the page through the normal read path, coalescing a burst into one refresh, and skips a version it already shows |
 *
 * **Why the version is derived and not a column.** `agent_runs` has no version
 * column, and adding one is a schema change. A run's state only ever moves in
 * two ways: a line is appended to its log (every step and every halt writes
 * exactly one), or it ends. So the number of log lines plus one once it has
 * ended counts every visible change, rises by at least one on each, and is
 * computed from what every read already returns. `updated_at` was the other
 * candidate and was not used: two steps can land in the same millisecond, and
 * the Coach's and the Champion's runs never set it after the insert.
 *
 * **The key is a fresh id, not the version**, for the reason `tasks.ts` gives
 * for the board: the idempotency key is unique across the outbox, and a key
 * that collided would refuse the write that enqueued it. A duplicate event
 * costs one skipped refresh, because the client already holds that version.
 */
import { newId } from "@openokr/db";

/** The channel the agents screen listens on. */
export function agentRunsChannel(workspaceId: string): string {
  return `workspace:${workspaceId}:agent-runs`;
}

/** The topic the relay dispatches, and the event name on the channel. */
export const AGENT_RUN_CHANGED_TOPIC = "agentRun.changed";

/** A run's statuses that end it. A run in any of them never changes again. */
const FINISHED = new Set(["completed", "failed", "cancelled"]);

/**
 * How many times a run has visibly changed: one per log line, and one more
 * once it has ended. See the header for why this is the version.
 */
export function agentRunVersion(run: {
  readonly status: string;
  readonly logLength: number;
}): number {
  return run.logLength + (FINISHED.has(run.status) ? 1 : 0);
}

export interface AgentRunChangedEvent {
  readonly name: typeof AGENT_RUN_CHANGED_TOPIC;
  readonly data: {
    readonly runId: string;
    readonly version: number;
  };
}

export interface AgentRunChangedMessage {
  readonly topic: typeof AGENT_RUN_CHANGED_TOPIC;
  readonly payload: {
    readonly channel: string;
    readonly workspaceId: string;
    readonly runId: string;
    readonly version: number;
  };
  readonly idempotencyKey: string;
}

/** The outbox row that tells every open agents screen one run moved. */
export function agentRunChangedEvent(input: {
  readonly workspaceId: string;
  readonly runId: string;
  readonly status: string;
  readonly logLength: number;
}): AgentRunChangedMessage {
  return {
    topic: AGENT_RUN_CHANGED_TOPIC,
    payload: {
      channel: agentRunsChannel(input.workspaceId),
      workspaceId: input.workspaceId,
      runId: input.runId,
      version: agentRunVersion(input),
    },
    idempotencyKey: `${AGENT_RUN_CHANGED_TOPIC}:${input.runId}:${newId()}`,
  };
}
