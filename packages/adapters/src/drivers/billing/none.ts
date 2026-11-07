import { type Billing, BillingUnavailableError } from "../../ports/billing.ts";

/**
 * The default: no payment provider, which is every self-hosted instance and any
 * provider invoicing by hand. Nothing here reaches anywhere.
 */
export class NoBilling implements Billing {
  readonly provider = "none" as const;

  async listPrices(): Promise<never> {
    throw new BillingUnavailableError();
  }
  async startCheckout(): Promise<never> {
    throw new BillingUnavailableError();
  }
  async openPortal(): Promise<never> {
    throw new BillingUnavailableError();
  }
  async changeSubscription(): Promise<never> {
    throw new BillingUnavailableError();
  }
  async readSubscription(): Promise<never> {
    throw new BillingUnavailableError();
  }
  async parseWebhook(): Promise<never> {
    throw new BillingUnavailableError();
  }
}
