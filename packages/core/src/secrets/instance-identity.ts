/**
 * What this deployment says about itself beyond its name: where its source is,
 * its legal pages and who to contact.
 *
 * **A provider's obligations, not decoration.** AGPL-3.0 §13 asks that every
 * person using the instance over a network is offered its source, and a provider
 * who changed the code has to offer their own, so the link cannot be a literal
 * pointing upstream. A cloud that takes sign-ups needs terms a person can read
 * before agreeing to them.
 *
 * Each is read stored value, then environment, then default, like every instance
 * setting. Each is only ever used as a link, so what cannot be one safely reads
 * as unset: an `href` is not the place for `javascript:`.
 *
 * **Never throws.** The sign-up page and the shell read these, and a settings row
 * that cannot be read must not take either of them down.
 */
import { isEmailAddress } from "@openokr/formats";
import type { Pool } from "pg";
import {
  DEFAULT_SOURCE_URL,
  environmentValue,
  getInstanceSetting,
} from "./instance-registry.ts";
import { readSetting } from "./instance-settings.ts";

type Environment = Record<string, string | undefined>;

async function read(
  pool: Pool,
  key: string,
  environment: Environment,
): Promise<string | null> {
  const stored = await readSetting(pool, key).catch(() => undefined);
  if (typeof stored === "string" && stored.trim() !== "") {
    return stored.trim();
  }
  const definition = getInstanceSetting(key);
  const fromVariable = definition
    ? environmentValue(definition, environment)
    : undefined;
  return typeof fromVariable === "string" && fromVariable.trim() !== ""
    ? fromVariable.trim()
    : null;
}

const asWebAddress = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:" ? value : null;
  } catch {
    return null;
  }
};

/** Where this instance's source is offered, which every member can open. */
export async function resolveSourceUrl(
  pool: Pool,
  environment: Environment = process.env,
): Promise<string> {
  return (
    asWebAddress(await read(pool, "instance.sourceUrl", environment)) ??
    DEFAULT_SOURCE_URL
  );
}

export interface LegalLinks {
  readonly termsUrl: string | null;
  readonly privacyUrl: string | null;
}

/** The legal pages a sign-up offers, when this instance has any. */
export async function resolveLegalLinks(
  pool: Pool,
  environment: Environment = process.env,
): Promise<LegalLinks> {
  return {
    termsUrl: asWebAddress(await read(pool, "instance.termsUrl", environment)),
    privacyUrl: asWebAddress(
      await read(pool, "instance.privacyUrl", environment),
    ),
  };
}

/** Who a customer writes to about their plan, when this instance names anybody. */
export async function resolveSupportEmail(
  pool: Pool,
  environment: Environment = process.env,
): Promise<string | null> {
  const value = await read(pool, "instance.supportEmail", environment);
  return value !== null && isEmailAddress(value) ? value : null;
}
