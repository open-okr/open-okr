/**
 * What a managed cloud is still missing before it takes customers, as the
 * operator reads it on S-47.
 *
 * **Warnings, never a block.** Nothing here stops an instance from starting or
 * a person from signing up. Each one names a setting that works with its
 * default and that a public cloud almost never wants left there: mail that is
 * only written to the log, no terms or privacy address on the sign-up page,
 * and no retention window, so a closed workspace is kept for good.
 *
 * **Only while the cloud flag is on.** A self-hosted instance with console
 * mail is an ordinary evaluation, and telling its owner so is the
 * console-mail notice on Admin, General.
 *
 * **The erasure schedule is not here.** It is a Helm CronJob the application
 * cannot see, so the retention window is the one half of the pair this can
 * read.
 */
import type { Pool } from "pg";
import {
  environmentValue,
  getInstanceSetting,
} from "../secrets/instance-registry.ts";
import { readSetting, resolveSetting } from "../secrets/instance-settings.ts";

export type CloudPreflightWarning =
  | "mail_console"
  | "terms_missing"
  | "privacy_missing"
  | "retention_zero";

const read = async (pool: Pool, key: string): Promise<unknown> => {
  const definition = getInstanceSetting(key);
  if (!definition) {
    throw new Error(`${key} is not declared in the instance registry`);
  }
  const stored = await readSetting(pool, key);
  const environment = environmentValue(definition, process.env);
  return resolveSetting(stored, environment, definition.fallback).value;
};

/** The warnings that apply, in the order the screen shows them. */
export async function readCloudPreflight(
  pool: Pool,
): Promise<readonly CloudPreflightWarning[]> {
  if (!(await read(pool, "cloud.enabled"))) {
    return [];
  }
  const warnings: CloudPreflightWarning[] = [];
  const transport = String(await read(pool, "mail.transport"))
    .trim()
    .toLowerCase();
  if (transport === "console") {
    warnings.push("mail_console");
  }
  if (String(await read(pool, "instance.termsUrl")).trim() === "") {
    warnings.push("terms_missing");
  }
  if (String(await read(pool, "instance.privacyUrl")).trim() === "") {
    warnings.push("privacy_missing");
  }
  if (Number(await read(pool, "cloud.closureRetentionDays")) === 0) {
    warnings.push("retention_zero");
  }
  return warnings;
}
