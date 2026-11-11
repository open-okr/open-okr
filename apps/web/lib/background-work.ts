/**
 * Where this instance's background work runs, as this process sees it (plan
 * 0.8.0 H10d, docs/design/worker-deployment.md D2 and §1.3).
 *
 * | Value | Here | Somewhere else |
 * |---|---|---|
 * | `on`, the default | Runs | Perhaps too: several are safe |
 * | `off` | Not run | Perhaps nowhere |
 * | `elsewhere` | Not run | Another process of this instance runs it |
 *
 * The third value is what lets a web pod tell "the worker runs it" from
 * "turned off on purpose". With the relay `elsewhere`, the copilot still runs
 * its answer in the background, because the worker drains the queue. With the
 * scheduler `elsewhere`, `/api/status` judges the stamp the worker writes
 * rather than answering `operational` as it does for `off`.
 *
 * Light on purpose: the copilot route reads it, and the relay host it used
 * to import from loads every channel driver.
 */
import { type Env, loadEnv } from "@openokr/config";

export type BackgroundMode = Env["OPENOKR_RELAY"];

/** Where the outbox relay runs (`OPENOKR_RELAY`). */
export function relayMode(
  env: Pick<Env, "OPENOKR_RELAY"> = loadEnv(),
): BackgroundMode {
  return env.OPENOKR_RELAY;
}

/** Where the scheduler runs (`OPENOKR_SCHEDULER`). */
export function schedulerMode(
  env: Pick<Env, "OPENOKR_SCHEDULER"> = loadEnv(),
): BackgroundMode {
  return env.OPENOKR_SCHEDULER;
}

/**
 * Whether something drains the outbox: this process, or another one of this
 * instance. Only `off` says nothing may be, and only then does enqueuing a
 * copilot run risk enqueuing into nothing.
 */
export function outboxDrained(
  env: Pick<Env, "OPENOKR_RELAY"> = loadEnv(),
): boolean {
  return relayMode(env) !== "off";
}
