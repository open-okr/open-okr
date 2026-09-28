/**
 * How long a settled outbox row is kept (completeness review M-19).
 *
 * Read the way every instance setting is: stored value, then the environment
 * variable, then the registry's fallback of thirty days. Delivered rows are
 * delivery bookkeeping rather than anybody's data, and the scheduler purges
 * them once a day through `purgeSettledOutbox`.
 */
import type { Pool } from "pg";
import {
  environmentValue,
  getInstanceSetting,
} from "../secrets/instance-registry.ts";
import { readSetting, resolveSetting } from "../secrets/instance-settings.ts";

const OUTBOX_RETENTION_KEY = "outbox.retentionDays";

export async function outboxRetentionDays(pool: Pool): Promise<number> {
  const definition = getInstanceSetting(OUTBOX_RETENTION_KEY);
  if (!definition) {
    throw new Error(
      `${OUTBOX_RETENTION_KEY} is not declared in the instance registry`,
    );
  }
  const stored = await readSetting(pool, OUTBOX_RETENTION_KEY);
  const environment = environmentValue(definition, process.env);
  const value = Number(
    resolveSetting(stored, environment, definition.fallback).value,
  );
  return Number.isFinite(value) ? value : Number(definition.fallback);
}
