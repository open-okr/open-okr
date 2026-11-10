/**
 * How `/api/status` judges the scheduler (plan 0.8.0 H12).
 *
 * The heartbeat lived only in the answering process's memory, and pg-boss
 * hands each scheduled job to one pod, so behind a load balancer a healthy
 * scheduler read as degraded whenever the pod that replied had not run the
 * last job. The pod that completes a run now writes a shared stamp too, and
 * the newer of the shared and the local reading is the one judged.
 *
 * A pod with the scheduler off still answers "operational", as before: an
 * instance may switch the scheduler off everywhere and run its sweeps by hand,
 * and its status should not turn red for that choice. When the worker split
 * (plan row H10) runs the scheduler on some pods only, that is the place to
 * judge the shared stamp from pods that have it off.
 */

export type ComponentStatus = "operational" | "degraded" | "unavailable";

export interface SchedulerReading {
  /** Whether this pod runs the scheduler (`OPENOKR_SCHEDULER`). */
  readonly enabledHere: boolean;
  /** Whether this pod's scheduler failed to start. */
  readonly failedHere: boolean;
  /** When this pod last completed a run, in epoch ms. */
  readonly localLastRun: number | null;
  /** When any pod last completed a run, from the database, in epoch ms. */
  readonly sharedLastRun: number | null;
  /** When this pod booted its scheduler, for the grace before a first run. */
  readonly bootedAt: number | null;
  readonly now: number;
  readonly degradedSeconds: number;
  readonly unavailableSeconds: number;
}

export function judgeScheduler(reading: SchedulerReading): ComponentStatus {
  if (!reading.enabledHere) {
    return "operational";
  }
  const byAge = (since: number): ComponentStatus => {
    const seconds = (reading.now - since) / 1000;
    if (seconds >= reading.unavailableSeconds) {
      return "unavailable";
    }
    if (seconds >= reading.degradedSeconds) {
      return "degraded";
    }
    return "operational";
  };

  const lastRun = Math.max(
    reading.sharedLastRun ?? Number.NEGATIVE_INFINITY,
    reading.localLastRun ?? Number.NEGATIVE_INFINITY,
  );
  if (Number.isFinite(lastRun)) {
    const status = byAge(lastRun);
    // This pod's scheduler did not start, and nothing fresh ran anywhere.
    return reading.failedHere && status !== "operational"
      ? "unavailable"
      : status;
  }
  // A scheduler that could not start is unavailable now, not in two hours
  // when the heartbeat would have gone stale (completeness review H-02).
  if (reading.failedHere) {
    return "unavailable";
  }
  // No run yet anywhere: grace from this pod's boot.
  if (reading.bootedAt !== null) {
    return byAge(reading.bootedAt);
  }
  return "unavailable";
}
