/**
 * The Billing composition seam (docs/design/billing.md §2).
 *
 * A per-port factory beside `createMailer`, for the same reason: which provider
 * applies is stored configuration the host resolves and hands over.
 *
 * **The SDK is imported here, and only when asked for**, so an instance with billing
 * off never loads it. That is the promise an air-gapped install rests on, and
 * `pnpm check:air-gap` holds this file to it.
 */
import { NoBilling } from "./drivers/billing/none.ts";
import type { Billing } from "./ports/billing.ts";

export type BillingConfig =
  | { readonly provider: "none" }
  | {
      readonly provider: "stripe";
      readonly secretKey: string;
      readonly webhookSecret: string;
      readonly automaticTax: boolean;
      /** Injected for contract tests. */
      readonly fetch?: typeof fetch;
    };

export async function createBilling(config: BillingConfig): Promise<Billing> {
  if (config.provider === "none") {
    return new NoBilling();
  }
  const { StripeBilling } = await import("./drivers/billing/stripe.ts");
  return new StripeBilling(config);
}
