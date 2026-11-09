/**
 * The four thresholds `/api/status` judges the relay and the scheduler by
 * (docs/design/status-and-capacity.md §4, plan 0.7.0 P8).
 *
 * **Resolved once by the host, at boot, like the admission limits.** The
 * status endpoint answers every uptime probe, so it must not read
 * `system_settings` per request. Until 0.7.0 it read only the environment and
 * the four instance settings were declared and never read; now each resolves
 * the way every instance setting does: a stored value, then the variable, then
 * the registry's fallback.
 *
 * **Validated here, and a bad pair stops the boot.** §4 asks for each
 * "unavailable" to be strictly greater than its "degraded", checked at
 * resolve time like the admission floors. A pair the other way round would
 * jump from operational to unavailable and never say degraded, which is a
 * probe that hides the warning it exists to give.
 */
import type { Pool } from "pg";
import {
  environmentValue,
  getInstanceSetting,
} from "../secrets/instance-registry.ts";
import { readSetting, resolveSetting } from "../secrets/instance-settings.ts";

export interface StatusThresholdPair {
  /** Seconds of lag at or above which the component reports degraded. */
  readonly degraded: number;
  /** Seconds of lag at or above which it reports unavailable. */
  readonly unavailable: number;
}

export interface StatusThresholds {
  readonly relay: StatusThresholdPair;
  readonly scheduler: StatusThresholdPair;
}

/** A threshold the product refuses to run with, named for the operator. */
export class StatusSettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatusSettingError";
  }
}

const PAIRS = {
  relay: {
    degraded: "status.relayDegradedSeconds",
    unavailable: "status.relayUnavailableSeconds",
  },
  scheduler: {
    degraded: "status.schedulerDegradedSeconds",
    unavailable: "status.schedulerUnavailableSeconds",
  },
} as const;

const KEYS = Object.values(PAIRS).flatMap((pair) => [
  pair.degraded,
  pair.unavailable,
]);

function seconds(
  key: string,
  stored: Readonly<Record<string, unknown>>,
  environment: Readonly<Record<string, string | undefined>>,
): number {
  const definition = getInstanceSetting(key);
  if (!definition) {
    throw new Error(`${key} is not declared in the instance registry`);
  }
  const { value } = resolveSetting<unknown>(
    stored[key],
    environmentValue(definition, environment),
    definition.fallback,
  );
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new StatusSettingError(
      `${key} must be a number of seconds above zero, and is ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function pairOf(
  keys: { readonly degraded: string; readonly unavailable: string },
  stored: Readonly<Record<string, unknown>>,
  environment: Readonly<Record<string, string | undefined>>,
): StatusThresholdPair {
  const degraded = seconds(keys.degraded, stored, environment);
  const unavailable = seconds(keys.unavailable, stored, environment);
  if (unavailable <= degraded) {
    throw new StatusSettingError(
      `${keys.unavailable} is ${unavailable}, which must be greater than ` +
        `${keys.degraded}, ${degraded}. Otherwise the component goes from ` +
        `operational to unavailable without ever reporting degraded.`,
    );
  }
  return { degraded, unavailable };
}

/** The thresholds from stored values and the environment, validated. */
export function statusThresholdsFrom(
  stored: Readonly<Record<string, unknown>>,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): StatusThresholds {
  return {
    relay: pairOf(PAIRS.relay, stored, environment),
    scheduler: pairOf(PAIRS.scheduler, stored, environment),
  };
}

/** Reads the four stored settings once and resolves them. For the host's boot. */
export async function resolveStatusThresholds(
  pool: Pool,
): Promise<StatusThresholds> {
  const stored: Record<string, unknown> = {};
  for (const key of KEYS) {
    const value = await readSetting(pool, key);
    if (value !== undefined) {
      stored[key] = value;
    }
  }
  return statusThresholdsFrom(stored);
}
