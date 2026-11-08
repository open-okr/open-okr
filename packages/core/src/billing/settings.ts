/**
 * Which payment provider this instance uses, if any (docs/design/billing.md §3).
 *
 * Off is the default, and with nothing set nothing changes. Stripe with a missing key
 * reads as off rather than as a broken checkout: the plan screen then says who to
 * contact, which is a true sentence.
 */
import type { Pool } from "pg";
import { z } from "zod";
import {
  environmentValue,
  getInstanceSetting,
} from "../secrets/instance-registry.ts";
import { readSecret, readSetting } from "../secrets/instance-settings.ts";
import type { KeyRing } from "../secrets/key-ring.ts";

export type BillingSettings =
  | { readonly provider: "none" }
  | {
      readonly provider: "stripe";
      readonly secretKey: string;
      readonly webhookSecret: string;
      readonly automaticTax: boolean;
    };

type Environment = Record<string, string | undefined>;

async function plain(
  pool: Pool,
  key: string,
  environment: Environment,
): Promise<unknown> {
  const stored = await readSetting(pool, key);
  if (stored !== undefined && stored !== null) {
    return stored;
  }
  const definition = getInstanceSetting(key);
  return definition
    ? (environmentValue(definition, environment) ?? definition.fallback)
    : undefined;
}

async function secret(
  pool: Pool,
  ring: KeyRing,
  key: string,
  environment: Environment,
): Promise<string> {
  const stored = await readSecret(pool, ring, key);
  if (stored) {
    return stored;
  }
  const definition = getInstanceSetting(key);
  const fromVariable = definition
    ? environmentValue(definition, environment)
    : undefined;
  return typeof fromVariable === "string" ? fromVariable : "";
}

export async function resolveBillingSettings(
  pool: Pool,
  ring: KeyRing,
  environment: Environment = process.env,
): Promise<BillingSettings> {
  if ((await plain(pool, "billing.provider", environment)) !== "stripe") {
    return { provider: "none" };
  }
  const secretKey = await secret(
    pool,
    ring,
    "billing.stripe.secretKey",
    environment,
  );
  const webhookSecret = await secret(
    pool,
    ring,
    "billing.stripe.webhookSecret",
    environment,
  );
  if (secretKey === "" || webhookSecret === "") {
    return { provider: "none" };
  }
  return {
    provider: "stripe",
    secretKey,
    webhookSecret,
    automaticTax:
      (await plain(pool, "billing.stripe.automaticTax", environment)) === true,
  };
}

/** Twelve months, which is what OKRGoal's Terms §5.2 promise. */
export const DEFAULT_CREDIT_PACK_MONTHS = 12;

/**
 * The pack a provider has on sale, or none (docs/design/ai-credits.md §6).
 *
 * `months` is how long a pack lasts once bought, so the release does not decide that
 * for another provider. Ten years is the ceiling: a longer one is a typo, and a pack
 * that never lapses is not something to fall into by one.
 */
const creditPackSchema = z.object({
  priceId: z.string().trim().min(1),
  credits: z.number().int().positive(),
  months: z.number().int().min(1).max(120).default(DEFAULT_CREDIT_PACK_MONTHS),
});

export type CreditPack = z.infer<typeof creditPackSchema>;

export async function readCreditPack(
  pool: Pool,
  environment: Environment = process.env,
): Promise<CreditPack | null> {
  let raw = await plain(pool, "billing.creditPack", environment);
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = creditPackSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
