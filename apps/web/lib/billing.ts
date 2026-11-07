import { type Billing, createBilling } from "@openokr/adapters";
import { resolveBillingSettings } from "@openokr/core";
import { getPool } from "./pool";
import { getKeyRing } from "./secrets";

/**
 * The payment provider, or null when this instance has none (docs/design/billing.md).
 *
 * Null is the ordinary answer: every self-hosted instance, and any provider who
 * invoices by hand. Read per use, because a provider can turn it on while this
 * process runs, and building the driver holds nothing open.
 */
export async function getBilling(): Promise<Billing | null> {
  const settings = await resolveBillingSettings(getPool(), getKeyRing());
  return settings.provider === "none" ? null : createBilling(settings);
}
