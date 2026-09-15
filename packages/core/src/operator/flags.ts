/**
 * The instance's boolean flags, as an operator reads them (P8-T03c).
 *
 * **Derived from the settings registry rather than typed out**, so a flag
 * added next month appears on S-47 without anybody remembering and one
 * removed stops appearing. A screen that lists settings by hand is a screen
 * that is wrong within a release.
 *
 * Only the boolean ones. A mail host and a root key are settings too, and
 * neither is a flag: the screen this feeds answers "what is this instance",
 * not "what is it configured with", and a secret has no business on a console
 * that lists every customer.
 */
import type { Pool } from "pg";
import {
  environmentValue,
  INSTANCE_SETTINGS,
} from "../secrets/instance-registry.ts";
import { readSetting, resolveSetting } from "../secrets/instance-settings.ts";

export interface InstanceFlag {
  readonly key: string;
  readonly value: boolean;
  /** Where the answer came from, which is what an operator asks next. */
  readonly source: "database" | "environment" | "default";
}

export async function readInstanceFlags(
  pool: Pool,
): Promise<readonly InstanceFlag[]> {
  const flags: InstanceFlag[] = [];

  for (const definition of INSTANCE_SETTINGS) {
    if (definition.kind !== "boolean" || definition.secret) {
      continue;
    }
    const stored = await readSetting(pool, definition.key);
    const environment = environmentValue(definition, process.env);
    const resolved = resolveSetting(stored, environment, definition.fallback);
    flags.push({
      key: definition.key,
      value: Boolean(resolved.value),
      source: resolved.source,
    });
  }

  return flags;
}
