/**
 * The three settings that make an instance a cloud one (P8-T02a).
 *
 * Design: `docs/design/p8-t01a-tenant-lifecycle.md` §4 and §6.
 *
 * They live at instance scope because they describe the deployment rather
 * than any customer, and every one of them defaults to the self-hosted
 * answer. An instance that never reads this file is a self-hosted instance,
 * which is the only default that can be right for a product whose
 * self-hosted half must never be seat-limited or feature-gated
 * (REQUIREMENTS §5).
 *
 * **Resolved before the provisioning transaction, never inside it.**
 * `system_settings` sits above the tenant floor and Postgres refuses a read
 * of it unless `app.instance_admin` is set, which a tenant-scoped
 * transaction deliberately never sets. So this mirrors
 * `resolveInstanceDefaultLanguage`: the caller resolves, then passes the
 * answer in. A reader that tried to ask from inside would not fail in
 * review, it would fail at the database, on every registration.
 */
import type { Pool } from "pg";
import {
  environmentValue,
  getInstanceSetting,
} from "../secrets/instance-registry.ts";
import { readSetting, resolveSetting } from "../secrets/instance-settings.ts";
import { type AdmissionLimits, validateAdmissionLimits } from "./admission.ts";

export const CLOUD_ENABLED_KEY = "cloud.enabled";
export const CLOUD_REGION_KEY = "cloud.region";
export const CLOUD_CLOSURE_RETENTION_KEY = "cloud.closureRetentionDays";

/** What provisioning needs to know about the deployment it runs in. */
export interface CloudTenancy {
  /** False on every self-hosted instance, which is the default. */
  readonly enabled: boolean;
  /** Recorded on the tenant row. Never routed on. */
  readonly region: string;
  /** Days to keep a closed workspace. Zero means never erase. */
  readonly closureRetentionDays: number;
}

const resolve = async <T>(pool: Pool, key: string): Promise<T> => {
  const definition = getInstanceSetting(key);
  if (!definition) {
    throw new Error(`${key} is not declared in the instance registry`);
  }
  const stored = await readSetting(pool, key);
  const environment = environmentValue(definition, process.env);
  return resolveSetting(stored, environment, definition.fallback).value as T;
};

/**
 * Just the flag, for callers that need nothing else.
 *
 * Separate from `resolveCloudTenancy` because `isRegistrationOpen` runs on
 * every sign-up page load and resolving the region and the retention window
 * there would be two setting reads nobody asked for.
 */
export async function isCloudEnabled(pool: Pool): Promise<boolean> {
  return resolve<boolean>(pool, CLOUD_ENABLED_KEY);
}

export async function resolveCloudTenancy(pool: Pool): Promise<CloudTenancy> {
  const enabled = await isCloudEnabled(pool);
  // The other two are only meaningful when the cloud is on, and asking for
  // them anyway costs two reads on a path that already runs once per
  // workspace ever created. Resolving them unconditionally keeps one shape
  // for the caller instead of a partial object it has to narrow.
  return {
    enabled,
    region: await resolve<string>(pool, CLOUD_REGION_KEY),
    closureRetentionDays: await resolve<number>(
      pool,
      CLOUD_CLOSURE_RETENTION_KEY,
    ),
  };
}

// Not exported, unlike the three above. Nothing outside this file names
// either key: the operator console lists settings from the registry and the
// only reader is the resolver below. `pnpm dead-code` refuses an export
// nothing imports, and it is right to.
const CLOUD_ACTIONS_PER_MINUTE_KEY = "cloud.limits.actionsPerMinute";
const CLOUD_CONCURRENT_ACTIONS_KEY = "cloud.limits.concurrentActions";

/**
 * The two admission limits, resolved and validated (P8-T06a).
 *
 * **Resolved once by the host, never per call.** Reading a setting is a
 * database read, and admission runs on every action from every surface, so
 * resolving here per call would cost the connection the whole design exists
 * to protect. The host resolves and passes the answer into
 * `ActionCallContext.admission`, the same arrangement `resolveCloudTenancy`
 * uses and for the same reason.
 *
 * **Validated here rather than at the call.** A number below its floor fails
 * this read, which happens at boot or on a settings change, instead of
 * failing every action afterwards with a message about configuration.
 */
export async function resolveAdmissionLimits(
  pool: Pool,
): Promise<AdmissionLimits> {
  const limits: AdmissionLimits = {
    actionsPerMinute: await resolve<number>(pool, CLOUD_ACTIONS_PER_MINUTE_KEY),
    concurrentActions: await resolve<number>(
      pool,
      CLOUD_CONCURRENT_ACTIONS_KEY,
    ),
  };
  validateAdmissionLimits(limits);
  return limits;
}
