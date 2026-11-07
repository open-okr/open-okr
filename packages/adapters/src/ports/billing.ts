/**
 * The Billing port (docs/design/billing.md §2).
 *
 * Another payment provider is a new driver behind this, and needs no change
 * anywhere else. Nothing here names a currency or an amount as a fact about the
 * product: both come from the provider, because each provider sets its own.
 */

/** What a provider says a price is. Amounts are in the currency's minor unit. */
export interface BillingPrice {
  readonly id: string;
  readonly amountMinor: number | null;
  /** The provider's lower-case ISO code. */
  readonly currency: string;
  readonly interval: "month" | "year" | null;
}

export interface SubscriptionState {
  readonly ref: string;
  readonly customerRef: string;
  /** The provider's own word for it. */
  readonly status: string;
  readonly priceId: string | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  /** The price a scheduled downgrade moves to, at the period's end. */
  readonly scheduledPriceId: string | null;
}

export interface StartCheckoutInput {
  readonly mode: "subscription" | "payment";
  readonly priceId: string;
  readonly workspaceId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** An existing customer, so a returning one keeps their cards and invoices. */
  readonly customerRef?: string;
  readonly customerEmail?: string;
  /** A credit pack's size, so the webhook knows what was bought. */
  readonly credits?: number;
}

export interface ChangeSubscriptionInput {
  readonly subscriptionRef: string;
  readonly priceId: string;
  /** Now charges the difference. At the period's end charges nothing today. */
  readonly when: "now" | "period_end";
}

/** What a verified webhook means, in the port's words rather than the provider's. */
export type BillingEvent =
  | {
      readonly kind: "subscription";
      readonly eventRef: string;
      readonly workspaceId: string | null;
      readonly subscriptionRef: string;
    }
  | {
      readonly kind: "credit_pack";
      readonly eventRef: string;
      readonly workspaceId: string | null;
      readonly customerRef: string | null;
      readonly sessionRef: string;
      readonly credits: number;
    }
  | { readonly kind: "ignored"; readonly eventRef: string };

export interface Billing {
  readonly provider: "none" | "stripe";
  listPrices(priceIds: readonly string[]): Promise<readonly BillingPrice[]>;
  startCheckout(input: StartCheckoutInput): Promise<{ readonly url: string }>;
  openPortal(input: {
    readonly customerRef: string;
    readonly returnUrl: string;
  }): Promise<{ readonly url: string }>;
  changeSubscription(input: ChangeSubscriptionInput): Promise<void>;
  readSubscription(ref: string): Promise<SubscriptionState>;
  /** Verifies the signature first. A bad one throws, and nothing else runs. */
  parseWebhook(body: string, signature: string): Promise<BillingEvent>;
}

/** Thrown by the `none` driver. A host checks `provider` and should never see it. */
export class BillingUnavailableError extends Error {
  override readonly name = "BillingUnavailableError";
  constructor() {
    super("No billing provider is configured.");
  }
}

/** A webhook whose signature does not verify. Answered with a 400. */
export class BillingSignatureError extends Error {
  override readonly name = "BillingSignatureError";
  constructor() {
    super("The webhook's signature did not verify.");
  }
}
