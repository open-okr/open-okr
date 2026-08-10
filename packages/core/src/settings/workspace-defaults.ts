/**
 * Where a workspace-scoped default reaches past its own registry entry into
 * the instance's own settings (TECHNICAL-PLAN §4.14, P2-T08).
 *
 * `SETTINGS_REGISTRY`'s `language` entry falls back to the hardcoded
 * `INSTANCE_DEFAULT_LANGUAGE` constant when nothing else is supplied, because
 * the registry is a plain, synchronous, DB-free module and cannot reach
 * `system_settings` itself. This function is the bridge a provisioning
 * caller uses instead: it resolves the instance's own `instance.language`
 * setting, letting the environment override the constant the way every
 * other instance setting already does (database wins, the environment
 * bootstraps, the constant is the last resort), and a freshly registering
 * workspace inherits that resolution rather than a value that can never see
 * `OPENOKR_DEFAULT_LANGUAGE`.
 */
import type { Pool } from "pg";
import {
  environmentValue,
  getInstanceSetting,
} from "../secrets/instance-registry.ts";
import { readSetting, resolveSetting } from "../secrets/instance-settings.ts";
import { INSTANCE_DEFAULT_LANGUAGE } from "./registry.ts";

const INSTANCE_LANGUAGE_KEY = "instance.language";

export async function resolveInstanceDefaultLanguage(
  pool: Pool,
): Promise<string> {
  const definition = getInstanceSetting(INSTANCE_LANGUAGE_KEY);
  const fallback =
    (definition?.fallback as string | undefined) ?? INSTANCE_DEFAULT_LANGUAGE;
  if (!definition) {
    return fallback;
  }
  const stored = await readSetting(pool, definition.key);
  const environment = environmentValue(definition, process.env);
  return resolveSetting(stored, environment, fallback).value as string;
}
