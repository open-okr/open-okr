/**
 * The scheduler's judgement, read where it is needed (plan 0.8.0 H12 and
 * H10d, docs/design/worker-deployment.md §1.3).
 *
 * `/api/status` and Admin General ask the same question, so they read the
 * same answer: the shared stamp every scheduler writes, this pod's own
 * reading, and where this pod's `OPENOKR_SCHEDULER` says the scheduler runs.
 * `scheduler-health.ts` holds the rule; this gathers what it reads.
 */
import { readSchedulerHeartbeat } from "@openokr/core";
import { schedulerMode } from "./background-work";
import { getPool } from "./pool";
import {
  schedulerBootedAt,
  schedulerLastRunAt,
  schedulerState,
} from "./scheduler";
import { type ComponentStatus, judgeScheduler } from "./scheduler-health";
import { statusThresholds } from "./status-thresholds";

export async function schedulerStatus(): Promise<ComponentStatus> {
  // The shared stamp, so every pod answers the same. A read that fails falls
  // back to this pod's own reading when it runs the scheduler, and is
  // `unavailable` when the scheduler runs elsewhere and nothing else is known.
  let sharedLastRun: number | null = null;
  let sharedUnreadable = false;
  try {
    sharedLastRun = await readSchedulerHeartbeat(getPool());
  } catch {
    sharedUnreadable = true;
  }
  const now = Date.now();
  const thresholds = statusThresholds().scheduler;
  return judgeScheduler({
    mode: schedulerMode(),
    failedHere: schedulerState() === "failed",
    localLastRun: schedulerLastRunAt(),
    sharedLastRun,
    sharedUnreadable,
    bootedAt: schedulerBootedAt(),
    processStartedAt: now - process.uptime() * 1000,
    now,
    degradedSeconds: thresholds.degraded,
    unavailableSeconds: thresholds.unavailable,
  });
}

/**
 * Which scheduler notice Admin General shows, if any.
 *
 * | Here | Shown when | Notice |
 * |---|---|---|
 * | `on` | This pod's scheduler could not start | `failed` |
 * | `elsewhere` | The shared judgement is `unavailable` | `elsewhere`, naming the worker |
 * | `off` | Never | None |
 *
 * `unavailable` rather than `degraded` for `elsewhere`, so the notice means
 * what the `failed` one means: nothing on a clock is happening.
 */
export async function schedulerNotice(): Promise<
  "failed" | "elsewhere" | null
> {
  const state = schedulerState();
  if (state === "failed") {
    return "failed";
  }
  if (state === "elsewhere") {
    return (await schedulerStatus()) === "unavailable" ? "elsewhere" : null;
  }
  return null;
}
