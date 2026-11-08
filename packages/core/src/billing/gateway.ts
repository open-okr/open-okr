/**
 * What core needs from a payment provider (docs/design/billing.md §2).
 *
 * Declared here and satisfied structurally, like `storage` and `metrics` on the
 * action context, because `packages/core` does not depend on `packages/adapters`.
 * The app passes the driver it built.
 */
export interface SubscriptionSnapshot {
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

export interface BillingGateway {
  readonly provider: string;
  listPrices(priceIds: readonly string[]): Promise<
    readonly {
      readonly id: string;
      readonly amountMinor: number | null;
      readonly currency: string;
      readonly interval: "month" | "year" | null;
    }[]
  >;
  startCheckout(input: {
    readonly mode: "subscription" | "payment";
    readonly priceId: string;
    readonly workspaceId: string;
    readonly successUrl: string;
    readonly cancelUrl: string;
    readonly customerRef?: string;
    readonly customerEmail?: string;
    readonly credits?: number;
    readonly months?: number;
  }): Promise<{ readonly url: string }>;
  openPortal(input: {
    readonly customerRef: string;
    readonly returnUrl: string;
  }): Promise<{ readonly url: string }>;
  changeSubscription(input: {
    readonly subscriptionRef: string;
    readonly priceId: string;
    readonly when: "now" | "period_end";
  }): Promise<void>;
  readSubscription(ref: string): Promise<SubscriptionSnapshot>;
}

/** A verified webhook, in the port's words. */
export type VerifiedBillingEvent =
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
      /** Null when the checkout named no length: the instance's own applies. */
      readonly months: number | null;
    }
  | { readonly kind: "ignored"; readonly eventRef: string };
