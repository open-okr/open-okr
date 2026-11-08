import type { NextRequest } from "next/server";
import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The webhook route, with the real Stripe driver and its real signature code
 * (docs/design/billing.md §5 and §11). The signature comes first, and with billing
 * off the route does not exist.
 */

const SECRET = "whsec_route";
const resolveBillingSettings = vi.fn();
const applyBillingEvent = vi.fn();

vi.mock("@openokr/core", () => ({
  resolveBillingSettings: (...args: unknown[]) =>
    resolveBillingSettings(...args),
  applyBillingEvent: (...args: unknown[]) => applyBillingEvent(...args),
}));
vi.mock("../lib/pool", () => ({ getPool: () => "the pool" }));
vi.mock("../lib/secrets", () => ({ getKeyRing: () => ({}) }));

const { POST } = await import("../app/api/billing/webhook/route");

const request = (body: string, signature: string) =>
  new Request("https://okr.example.com/api/billing/webhook", {
    method: "POST",
    body,
    headers: { "stripe-signature": signature },
  }) as unknown as NextRequest;

const EVENT = JSON.stringify({
  id: "evt_1",
  object: "event",
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_1",
      object: "subscription",
      metadata: { workspace_id: "w1" },
    },
  },
});

const signed = (payload: string) =>
  new Stripe("sk_test_x").webhooks.generateTestHeaderString({
    payload,
    secret: SECRET,
  });

beforeEach(() => {
  applyBillingEvent.mockReset();
  resolveBillingSettings.mockResolvedValue({
    provider: "stripe",
    secretKey: "sk_test_x",
    webhookSecret: SECRET,
    automaticTax: false,
  });
});

describe("the billing webhook", () => {
  it("does not exist with billing off", async () => {
    resolveBillingSettings.mockResolvedValue({ provider: "none" });
    const answer = await POST(request(EVENT, signed(EVENT)));
    expect(answer.status).toBe(404);
    expect(applyBillingEvent).not.toHaveBeenCalled();
  });

  it("answers 400 to a bad signature and applies nothing", async () => {
    const answer = await POST(request(EVENT, "t=1,v1=forged"));
    expect(answer.status).toBe(400);
    expect(applyBillingEvent).not.toHaveBeenCalled();
  });

  it("answers 400 to a body changed after it was signed", async () => {
    const answer = await POST(
      request(EVENT.replace("sub_1", "sub_2"), signed(EVENT)),
    );
    expect(answer.status).toBe(400);
    expect(applyBillingEvent).not.toHaveBeenCalled();
  });

  it("applies a signed event, naming the workspace it carried", async () => {
    const answer = await POST(request(EVENT, signed(EVENT)));
    expect(answer.status).toBe(200);
    expect(applyBillingEvent).toHaveBeenCalledWith(
      "the pool",
      expect.objectContaining({ provider: "stripe" }),
      {
        kind: "subscription",
        eventRef: "evt_1",
        workspaceId: "w1",
        subscriptionRef: "sub_1",
      },
    );
  });

  it("lets a failure after the signature surface, so Stripe retries", async () => {
    applyBillingEvent.mockRejectedValue(new Error("Stripe is down"));
    await expect(POST(request(EVENT, signed(EVENT)))).rejects.toThrow(
      /Stripe is down/,
    );
  });
});
