import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolveBillingSettings } from "../src/billing/settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";

/** Off until a provider turns it on, whatever else is set (docs/design/billing.md §3). */

const ring = parseKeyRing({ current: newRootKey() });

beforeEach(async () => {
  const wb = await workerDb();
  await wb.admin.query("delete from system_settings");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("which provider applies", () => {
  it("is none by default", async () => {
    const wb = await workerDb();
    await expect(resolveBillingSettings(wb.appPool, ring, {})).resolves.toEqual(
      {
        provider: "none",
      },
    );
  });

  it("is none for Stripe with a key missing, rather than a broken checkout", async () => {
    const wb = await workerDb();
    await expect(
      resolveBillingSettings(wb.appPool, ring, {
        OPENOKR_BILLING_PROVIDER: "stripe",
        OPENOKR_STRIPE_SECRET_KEY: "sk_test_x",
      }),
    ).resolves.toEqual({ provider: "none" });
  });

  it("is Stripe with both keys, and tax off until asked for", async () => {
    const wb = await workerDb();
    await expect(
      resolveBillingSettings(wb.appPool, ring, {
        OPENOKR_BILLING_PROVIDER: "stripe",
        OPENOKR_STRIPE_SECRET_KEY: "sk_test_x",
        OPENOKR_STRIPE_WEBHOOK_SECRET: "whsec_x",
      }),
    ).resolves.toEqual({
      provider: "stripe",
      secretKey: "sk_test_x",
      webhookSecret: "whsec_x",
      automaticTax: false,
    });
  });

  it("turns tax on when asked", async () => {
    const wb = await workerDb();
    await expect(
      resolveBillingSettings(wb.appPool, ring, {
        OPENOKR_BILLING_PROVIDER: "stripe",
        OPENOKR_STRIPE_SECRET_KEY: "sk_test_x",
        OPENOKR_STRIPE_WEBHOOK_SECRET: "whsec_x",
        OPENOKR_STRIPE_AUTOMATIC_TAX: "true",
      }),
    ).resolves.toMatchObject({ automaticTax: true });
  });
});
