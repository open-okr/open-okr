/**
 * The switch for the update check (docs/design/version-footer.md §4).
 *
 * Read per request, so turning it off in Admin, General stops the next
 * request rather than the next restart. The check itself lives in the web
 * application, which is where `outboundFetch` is handed to it.
 */
import type { Pool } from "pg";
import { recordInstanceAuditEvent } from "../audit/instance-chain.ts";
import {
  environmentValue,
  getInstanceSetting,
  type InstanceSettingDefinition,
} from "./instance-registry.ts";
import {
  readSetting,
  resolveSetting,
  type SettingSource,
  writeSettings,
} from "./instance-settings.ts";
import type { KeyRing } from "./key-ring.ts";

const UPDATE_CHECK_KEY = "instance.updateCheck";

type Environment = Record<string, string | undefined>;

const definition = (): InstanceSettingDefinition => {
  const found = getInstanceSetting(UPDATE_CHECK_KEY);
  if (!found) {
    throw new Error(
      `${UPDATE_CHECK_KEY} is not declared in the instance registry`,
    );
  }
  return found;
};

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

export async function readUpdateCheck(
  pool: Pool,
  environment: Environment = process.env,
): Promise<{ readonly value: boolean; readonly source: SettingSource }> {
  return resolveSetting(
    asBoolean(await readSetting(pool, UPDATE_CHECK_KEY)),
    asBoolean(environmentValue(definition(), environment)),
    true,
  );
}

export async function setUpdateCheck(
  pool: Pool,
  ring: KeyRing,
  input: {
    readonly enabled: boolean;
    readonly userId: string;
    readonly workspaceId: string;
  },
  environment: Environment = process.env,
): Promise<"changed" | "unchanged"> {
  const current = await readUpdateCheck(pool, environment);
  if (current.value === input.enabled && current.source === "database") {
    return "unchanged";
  }
  await writeSettings(pool, ring, [
    { key: UPDATE_CHECK_KEY, value: input.enabled, source: "admin" },
  ]);
  if (current.value === input.enabled) {
    // Pinned in the product where it was only a default or the environment,
    // so a later change to either no longer moves it. Not a change anybody
    // would read in the trail.
    return "unchanged";
  }
  await recordInstanceAuditEvent(pool, {
    action: "instance.update_check_set",
    payload: {
      from: current.value,
      to: input.enabled,
      userId: input.userId,
      workspaceId: input.workspaceId,
    },
  });
  return "changed";
}
