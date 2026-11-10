/**
 * The scheduler's heartbeat, shared by every pod (plan 0.8.0 H12).
 *
 * `/api/status` judged the scheduler by a timestamp in the answering
 * process's memory. Behind a load balancer only the pod that ran a job had
 * one, so the answer depended on which pod replied, and a pod with the
 * scheduler off reported it as operational whatever the others were doing.
 * The pod that completes a run now also writes the time here.
 */
import type { Pool } from "pg";
import { SCHEDULER_LAST_RUN_AT } from "../secrets/instance-registry.ts";
import { readSetting, writeSettings } from "../secrets/instance-settings.ts";
import type { KeyRing } from "../secrets/key-ring.ts";

/** Records that a scheduler on some pod completed a run at `at`. */
export async function recordSchedulerHeartbeat(
  pool: Pool,
  ring: KeyRing,
  at: Date = new Date(),
): Promise<void> {
  await writeSettings(pool, ring, [
    {
      key: SCHEDULER_LAST_RUN_AT,
      value: at.toISOString(),
      source: "scheduler",
    },
  ]);
}

/** When any scheduler last completed a run, in epoch milliseconds, or null. */
export async function readSchedulerHeartbeat(
  pool: Pool,
): Promise<number | null> {
  const value = await readSetting(pool, SCHEDULER_LAST_RUN_AT);
  if (typeof value !== "string" || value === "") {
    return null;
  }
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}
