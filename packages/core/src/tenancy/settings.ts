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
