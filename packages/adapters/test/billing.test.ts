import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { createBilling } from "../src/create-billing.ts";
import { BillingSignatureError } from "../src/ports/billing.ts";

/**
 * The Billing port, with Stripe's own HTTP client and signature code running
 * against a stubbed `fetch`. CI never reaches Stripe.
 */

const SECRET = "whsec_test";

type Handler = (url: URL, body: URLSearchParams) => unknown;

function stubbed(handler: Handler, automaticTax = false) {
  const calls: { path: string; method: string; body: URLSearchParams }[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ path: url.pathname, method: init?.method ?? "GET", body });
    return new Response(JSON.stringify(handler(url, body)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return {
    calls,
    billing: createBilling({
      provider: "stripe",
      secretKey: "sk_test_x",
      webhookSecret: SECRET,
      automaticTax,
      fetch: fakeFetch,
    }),
  };
}

const signed = (payload: string) =>
  new Stripe("sk_test_x").webhooks.generateTestHeaderString({
    payload,
    secret: SECRET,
  });

const event = (type: string, object: Record<string, unknown>) =>
  JSON.stringify({
    id: "evt_1",
    object: "event",
    type,
    data: { object },
  });

describe("no provider", () => {
  it("reaches nowhere, and says so if asked to", async () => {
    const billing = await createBilling({ provider: "none" });
    expect(billing.provider).toBe("none");
    await expect(billing.listPrices(["x"])).rejects.toThrow(
      /No billing provider/,
    );
  });
});

describe("prices", () => {
  it("come from the provider, in the provider's currency, and are cached", async () => {
    const { calls, billing } = stubbed(() => ({
      id: "price_1",
      object: "price",
      unit_amount: 4900,
      currency: "eur",
      recurring: { interval: "year" },
    }));
    const driver = await billing;
    await expect(driver.listPrices(["price_1"])).resolves.toEqual([
      { id: "price_1", amountMinor: 4900, currency: "eur", interval: "year" },
    ]);
    await driver.listPrices(["price_1"]);
    expect(calls).toHaveLength(1);
  });
});

describe("checkout", () => {
  it("writes the workspace on the session and on the subscription", async () => {
    const { calls, billing } = stubbed(() => ({
      id: "cs_1",
      object: "checkout.session",
      url: "https://checkout.stripe.test/cs_1",
    }));
    const driver = await billing;
    await expect(
      driver.startCheckout({
        mode: "subscription",
        priceId: "price_1",
        workspaceId: "w1",
        successUrl: "https://okr.example.com/ok",
        cancelUrl: "https://okr.example.com/no",
        customerEmail: "a@example.com",
      }),
    ).resolves.toEqual({ url: "https://checkout.stripe.test/cs_1" });
    const body = calls[0]?.body;
    expect(body?.get("mode")).toBe("subscription");
    expect(body?.get("metadata[workspace_id]")).toBe("w1");
    expect(body?.get("subscription_data[metadata][workspace_id]")).toBe("w1");
    expect(body?.get("customer_email")).toBe("a@example.com");
    expect(body?.get("automatic_tax[enabled]")).toBe("false");
  });

  it("turns on tax when asked, and names the pack's size on a one-off", async () => {
    const { calls, billing } = stubbed(
      () => ({
        id: "cs_2",
        object: "checkout.session",
        url: "https://checkout.stripe.test/cs_2",
      }),
      true,
    );
    const driver = await billing;
    await driver.startCheckout({
      mode: "payment",
      priceId: "price_pack",
      workspaceId: "w1",
      successUrl: "https://okr.example.com/ok",
      cancelUrl: "https://okr.example.com/no",
      customerRef: "cus_1",
      credits: 1000,
    });
    const body = calls[0]?.body;
    expect(body?.get("automatic_tax[enabled]")).toBe("true");
    expect(body?.get("customer")).toBe("cus_1");
    expect(body?.get("customer_update[address]")).toBe("auto");
    expect(body?.get("metadata[credits]")).toBe("1000");
    expect(body?.has("subscription_data[metadata][workspace_id]")).toBe(false);
  });
});

describe("the portal", () => {
  it("has plan switching off, because it cannot run the headcount check", async () => {
    const { calls, billing } = stubbed((url) => {
      if (url.pathname.endsWith("/configurations")) {
        return url.search
          ? { object: "list", data: [], has_more: false, url: url.pathname }
          : { id: "bpc_1", object: "billing_portal.configuration" };
      }
      return {
        id: "bps_1",
        object: "billing_portal.session",
        url: "https://portal.stripe.test/1",
      };
    });
    const driver = await billing;
    await driver.openPortal({
      customerRef: "cus_1",
      returnUrl: "https://x.example.com",
    });
    const created = calls.find(
      (call) =>
        call.method === "POST" &&
        call.path.endsWith("/billing_portal/configurations"),
    );
    expect(created?.body.get("features[subscription_update][enabled]")).toBe(
      "false",
    );
    expect(created?.body.get("features[subscription_cancel][mode]")).toBe(
      "at_period_end",
    );

    // Made once, and then reused.
    const before = calls.length;
    await driver.openPortal({
      customerRef: "cus_1",
      returnUrl: "https://x.example.com",
    });
    expect(calls.length).toBe(before + 1);
  });
});

describe("changing plan", () => {
  const SUBSCRIPTION = {
    id: "sub_1",
    object: "subscription",
    schedule: null,
    items: {
      object: "list",
      data: [
        {
          id: "si_1",
          price: { id: "price_old" },
          current_period_start: 100,
          current_period_end: 200,
        },
      ],
    },
  };

  it("charges the difference now, for an upgrade", async () => {
    const { calls, billing } = stubbed(() => SUBSCRIPTION);
    const driver = await billing;
    await driver.changeSubscription({
      subscriptionRef: "sub_1",
      priceId: "price_new",
      when: "now",
    });
    const update = calls.find((call) => call.method === "POST");
    expect(update?.body.get("items[0][price]")).toBe("price_new");
    expect(update?.body.get("proration_behavior")).toBe("always_invoice");
  });

  it("waits for the period's end, and charges nothing today, for a downgrade", async () => {
    const { calls, billing } = stubbed((url) => {
      if (url.pathname.includes("/prices/")) {
        return { id: "price_new", recurring: { interval: "year" } };
      }
      if (url.pathname.includes("/subscription_schedules")) {
        return { id: "sub_sched_1", current_phase: { start_date: 100 } };
      }
      return SUBSCRIPTION;
    });
    const driver = await billing;
    await driver.changeSubscription({
      subscriptionRef: "sub_1",
      priceId: "price_new",
      when: "period_end",
    });
    const update = calls.filter(
      (call) =>
        call.method === "POST" &&
        call.path.includes("/subscription_schedules/sub_sched_1"),
    )[0];
    expect(update?.body.get("end_behavior")).toBe("release");
    expect(update?.body.get("phases[0][items][0][price]")).toBe("price_old");
    expect(update?.body.get("phases[0][end_date]")).toBe("200");
    expect(update?.body.get("phases[1][items][0][price]")).toBe("price_new");
    expect(update?.body.get("phases[1][proration_behavior]")).toBe("none");
  });
});

describe("reading a subscription", () => {
  it("takes the period from the item, and names a scheduled move", async () => {
    const { billing } = stubbed(() => ({
      id: "sub_1",
      object: "subscription",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      schedule: {
        id: "sub_sched_1",
        phases: [
          { items: [{ price: "price_old" }] },
          { items: [{ price: "price_new" }] },
        ],
      },
      items: {
        object: "list",
        data: [
          { id: "si_1", price: { id: "price_old" }, current_period_end: 200 },
        ],
      },
    }));
    const driver = await billing;
    await expect(driver.readSubscription("sub_1")).resolves.toEqual({
      ref: "sub_1",
      customerRef: "cus_1",
      status: "active",
      priceId: "price_old",
      currentPeriodEnd: new Date(200_000),
      cancelAtPeriodEnd: false,
      scheduledPriceId: "price_new",
    });
  });
});

describe("the webhook", () => {
  const parse = async (payload: string, header = signed(payload)) => {
    const { billing } = stubbed(() => ({}));
    return (await billing).parseWebhook(payload, header);
  };

  it("refuses a bad signature before reading anything", async () => {
    await expect(parse(event("x", {}), "t=1,v1=nope")).rejects.toThrow(
      BillingSignatureError,
    );
  });

  it("finds the workspace on a completed subscription checkout", async () => {
    await expect(
      parse(
        event("checkout.session.completed", {
          id: "cs_1",
          object: "checkout.session",
          mode: "subscription",
          subscription: "sub_1",
          metadata: { workspace_id: "w1" },
        }),
      ),
    ).resolves.toEqual({
      kind: "subscription",
      eventRef: "evt_1",
      workspaceId: "w1",
      subscriptionRef: "sub_1",
    });
  });

  it("reads every later change to the subscription the same way", async () => {
    await expect(
      parse(
        event("customer.subscription.deleted", {
          id: "sub_1",
          object: "subscription",
          metadata: { workspace_id: "w1" },
        }),
      ),
    ).resolves.toMatchObject({ kind: "subscription", workspaceId: "w1" });
  });

  it("counts a credit pack only once it is paid", async () => {
    const session = {
      id: "cs_2",
      object: "checkout.session",
      mode: "payment",
      customer: "cus_1",
      metadata: { workspace_id: "w1", credits: "1000" },
    };
    await expect(
      parse(
        event("checkout.session.completed", {
          ...session,
          payment_status: "unpaid",
        }),
      ),
    ).resolves.toMatchObject({ kind: "ignored" });
    await expect(
      parse(
        event("checkout.session.async_payment_succeeded", {
          ...session,
          payment_status: "paid",
        }),
      ),
    ).resolves.toEqual({
      kind: "credit_pack",
      eventRef: "evt_1",
      workspaceId: "w1",
      customerRef: "cus_1",
      sessionRef: "cs_2",
      credits: 1000,
    });
  });

  it("ignores what it has no use for", async () => {
    await expect(
      parse(event("invoice.created", { id: "in_1", object: "invoice" })),
    ).resolves.toMatchObject({ kind: "ignored" });
  });
});
