/**
 * The Stripe driver (docs/design/billing.md).
 *
 * Reached only through `createBilling`, which imports this file when a provider
 * has configured Stripe and not otherwise, so an air-gapped instance never loads
 * the SDK. Requests go through the platform `fetch`.
 *
 * **Metadata is how an event finds its workspace.** Every checkout writes the
 * workspace id on the session and on the subscription it creates, because Stripe
 * carries both back on every later event. No lookup, and so no read across tenants.
 */
import Stripe from "stripe";
import {
  type Billing,
  type BillingEvent,
  type BillingPrice,
  BillingSignatureError,
  type ChangeSubscriptionInput,
  type StartCheckoutInput,
  type SubscriptionState,
} from "../../ports/billing.ts";

export interface StripeBillingOptions {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly automaticTax: boolean;
  /** Injected for contract tests, which never reach Stripe. */
  readonly fetch?: typeof fetch;
}

/** A price barely moves, and the plan screen asks on every load. */
const PRICE_CACHE_MS = 60_000;

const WORKSPACE_KEY = "workspace_id";
const CREDITS_KEY = "credits";
const MONTHS_KEY = "credit_months";
const PORTAL_MARKER = "openokr";

/** Stripe answers an id, or the object when it was asked to expand one. */
const idOf = (value: string | { readonly id: string } | null): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

export class StripeBilling implements Billing {
  readonly provider = "stripe" as const;
  readonly #client: Stripe;
  readonly #options: StripeBillingOptions;
  readonly #prices = new Map<string, { price: BillingPrice; at: number }>();
  #portalConfiguration: string | undefined;

  constructor(options: StripeBillingOptions) {
    this.#options = options;
    this.#client = new Stripe(options.secretKey, {
      httpClient: Stripe.createFetchHttpClient(options.fetch),
      maxNetworkRetries: 2,
      // The plan screen waits on this, and must still draw when Stripe does not answer.
      timeout: 10_000,
    });
  }

  async listPrices(
    priceIds: readonly string[],
  ): Promise<readonly BillingPrice[]> {
    return Promise.all(priceIds.map((id) => this.#price(id)));
  }

  async #price(id: string): Promise<BillingPrice> {
    const cached = this.#prices.get(id);
    if (cached && Date.now() - cached.at < PRICE_CACHE_MS) {
      return cached.price;
    }
    const price = await this.#client.prices.retrieve(id);
    const interval = price.recurring?.interval;
    const found: BillingPrice = {
      id: price.id,
      amountMinor: price.unit_amount,
      currency: price.currency,
      interval:
        interval === "month" ? "month" : interval === "year" ? "year" : null,
    };
    this.#prices.set(id, { price: found, at: Date.now() });
    return found;
  }

  async startCheckout(input: StartCheckoutInput): Promise<{ url: string }> {
    const metadata = {
      [WORKSPACE_KEY]: input.workspaceId,
      ...(input.credits === undefined
        ? {}
        : { [CREDITS_KEY]: String(input.credits) }),
      ...(input.months === undefined
        ? {}
        : { [MONTHS_KEY]: String(input.months) }),
    };
    const session = await this.#client.checkout.sessions.create({
      mode: input.mode,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata,
      allow_promotion_codes: true,
      automatic_tax: { enabled: this.#options.automaticTax },
      ...(input.mode === "subscription"
        ? { subscription_data: { metadata } }
        : {}),
      ...(input.customerRef
        ? {
            customer: input.customerRef,
            // Automatic tax needs an address on the customer to work from.
            ...(this.#options.automaticTax
              ? { customer_update: { address: "auto" as const } }
              : {}),
          }
        : input.customerEmail
          ? { customer_email: input.customerEmail }
          : {}),
    });
    if (!session.url) {
      throw new Error("Stripe answered a checkout session with no address.");
    }
    return { url: session.url };
  }

  async openPortal(input: {
    readonly customerRef: string;
    readonly returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await this.#client.billingPortal.sessions.create({
      customer: input.customerRef,
      return_url: input.returnUrl,
      configuration: await this.#portal(),
    });
    return { url: session.url };
  }

  /**
   * The portal's settings, made once and then found again.
   *
   * **Plan switching is off**, because the portal cannot run the headcount check
   * and would let somebody move to a plan too small for their people. A cancel
   * takes effect at the period's end. Made here rather than left to the Stripe
   * dashboard, because the dashboard's default has plan switching on, and a
   * provider who did not know would have the check bypassed.
   */
  async #portal(): Promise<string> {
    if (this.#portalConfiguration) {
      return this.#portalConfiguration;
    }
    const existing = await this.#client.billingPortal.configurations.list({
      active: true,
      limit: 100,
    });
    const ours = existing.data.find(
      (configuration) => configuration.metadata?.managed_by === PORTAL_MARKER,
    );
    const configuration =
      ours ??
      (await this.#client.billingPortal.configurations.create({
        metadata: { managed_by: PORTAL_MARKER },
        features: {
          customer_update: {
            enabled: true,
            allowed_updates: ["email", "address", "tax_id"],
          },
          invoice_history: { enabled: true },
          payment_method_update: { enabled: true },
          subscription_cancel: { enabled: true, mode: "at_period_end" },
          subscription_update: { enabled: false },
        },
      }));
    this.#portalConfiguration = configuration.id;
    return configuration.id;
  }

  async changeSubscription(input: ChangeSubscriptionInput): Promise<void> {
    const subscription = await this.#client.subscriptions.retrieve(
      input.subscriptionRef,
    );
    const item = subscription.items.data[0];
    if (!item) {
      throw new Error("That subscription has nothing on it to change.");
    }
    const scheduleId = idOf(subscription.schedule);

    if (input.when === "now") {
      // A move now replaces a move that was waiting.
      if (scheduleId) {
        await this.#client.subscriptionSchedules.release(scheduleId);
      }
      await this.#client.subscriptions.update(input.subscriptionRef, {
        items: [{ id: item.id, price: input.priceId }],
        // The difference for the rest of the period, charged today.
        proration_behavior: "always_invoice",
      });
      return;
    }

    const schedule = scheduleId
      ? await this.#client.subscriptionSchedules.retrieve(scheduleId)
      : await this.#client.subscriptionSchedules.create({
          from_subscription: input.subscriptionRef,
        });
    const next = await this.#client.prices.retrieve(input.priceId);
    await this.#client.subscriptionSchedules.update(schedule.id, {
      // Back to an ordinary subscription once the move has happened.
      end_behavior: "release",
      phases: [
        {
          items: [{ price: item.price.id, quantity: 1 }],
          start_date:
            schedule.current_phase?.start_date ?? item.current_period_start,
          end_date: item.current_period_end,
        },
        {
          items: [{ price: input.priceId, quantity: 1 }],
          proration_behavior: "none",
          duration: {
            interval: next.recurring?.interval === "year" ? "year" : "month",
            interval_count: 1,
          },
        },
      ],
    });
  }

  async endSubscription(ref: string): Promise<void> {
    const subscription = await this.#client.subscriptions.retrieve(ref);
    if (
      subscription.status === "canceled" ||
      subscription.status === "incomplete_expired"
    ) {
      return;
    }
    // A downgrade waiting for the period's end would otherwise start a new
    // phase, and so a new charge, on the day the subscription was meant to end.
    const scheduleId = idOf(subscription.schedule);
    if (scheduleId) {
      await this.#client.subscriptionSchedules.release(scheduleId);
    }
    if (!subscription.cancel_at_period_end) {
      await this.#client.subscriptions.update(ref, {
        cancel_at_period_end: true,
      });
    }
  }

  async readSubscription(ref: string): Promise<SubscriptionState> {
    const subscription = await this.#client.subscriptions.retrieve(ref, {
      expand: ["schedule"],
    });
    const item = subscription.items.data[0];
    const schedule = subscription.schedule;
    const scheduled =
      schedule && typeof schedule !== "string"
        ? schedule.phases.at(-1)?.items[0]?.price
        : null;
    const scheduledPriceId = scheduled ? idOf(scheduled) : null;
    return {
      ref: subscription.id,
      customerRef: idOf(subscription.customer) ?? "",
      status: subscription.status,
      priceId: item?.price.id ?? null,
      currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      scheduledPriceId:
        scheduledPriceId === item?.price.id ? null : scheduledPriceId,
    };
  }

  async parseWebhook(body: string, signature: string): Promise<BillingEvent> {
    let event: Stripe.Event;
    try {
      event = await this.#client.webhooks.constructEventAsync(
        body,
        signature,
        this.#options.webhookSecret,
      );
    } catch {
      throw new BillingSignatureError();
    }

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        return this.#fromSession(event.id, event.data.object);
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        return {
          kind: "subscription",
          eventRef: event.id,
          workspaceId: subscription.metadata?.[WORKSPACE_KEY] ?? null,
          subscriptionRef: subscription.id,
        };
      }
      default:
        return { kind: "ignored", eventRef: event.id };
    }
  }

  #fromSession(
    eventRef: string,
    session: Stripe.Checkout.Session,
  ): BillingEvent {
    const workspaceId = session.metadata?.[WORKSPACE_KEY] ?? null;
    const subscriptionRef = idOf(session.subscription);
    if (session.mode === "subscription" && subscriptionRef) {
      return { kind: "subscription", eventRef, workspaceId, subscriptionRef };
    }
    // A pack paid by a method that clears later arrives a second time, as
    // `async_payment_succeeded`, and only then is it paid.
    const credits = Number(session.metadata?.[CREDITS_KEY] ?? 0);
    const months = Number(session.metadata?.[MONTHS_KEY] ?? 0);
    if (
      session.mode === "payment" &&
      session.payment_status === "paid" &&
      credits > 0
    ) {
      return {
        kind: "credit_pack",
        eventRef,
        workspaceId,
        customerRef: idOf(session.customer),
        sessionRef: session.id,
        credits,
        months: Number.isInteger(months) && months > 0 ? months : null,
      };
    }
    return { kind: "ignored", eventRef };
  }
}
