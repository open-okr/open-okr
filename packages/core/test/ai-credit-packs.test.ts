import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import type { BillingGateway } from "../src/billing/gateway.ts";
import { applyBillingEvent } from "../src/billing/webhook.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { CLOUD_ENABLED_KEY, readHostedAccess } from "../src/tenancy/index.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/** Buying more credits (docs/design/ai-credits.md §6). */

const ring = parseKeyRing({ current: newRootKey() });

const OWNER = "packs-owner";
const PLANS = [
  { key: "free", name: "Free", seats: 10, aiCredits: 100 },
  { key: "team", name: "Team", seats: 50, aiCredits: 2000, aiTopUps: true },
];

let workspaceId: string;
let gateway: BillingGateway & { startCheckout: ReturnType<typeof vi.fn> };

const pack = (eventRef: string, credits = 1000) =>
  workerDb().then((wb) =>
    applyBillingEvent(wb.appPool, gateway, {
      kind: "credit_pack",
      eventRef,
      workspaceId,
      customerRef: "cus_1",
      sessionRef: "cs_1",
      credits,
    }),
  );

const hosted = async () => {
  const wb = await workerDb();
  const access = await readHostedAccess(wb.appPool, workspaceId);
  if (access.kind !== "credits") {
    throw new Error(`expected credits, got ${access.kind}`);
  }
  return access;
};

const context = async () => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: OWNER },
    billing: gateway,
    baseUrl: "https://okr.example.com",
  };
};

const onPlan = async (planKey: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "update tenants set plan_key = $1 where workspace_id = $2",
    [planKey, workspaceId],
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("delete from system_settings");
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2)",
    [OWNER, `${OWNER}@example.com`],
  );
  await writeSettings(wb.appPool, ring, [
    { key: CLOUD_ENABLED_KEY, value: true },
    { key: "cloud.plans", value: PLANS },
    { key: "cloud.defaultPlan", value: "free" },
    {
      key: "billing.creditPack",
      value: { priceId: "price_pack", credits: 1000 },
    },
  ]);
  workspaceId = (
    await createWorkspace(wb.appPool, { user: { id: OWNER, name: "Owner" } })
  ).workspaceId;
  gateway = {
    provider: "stripe",
    listPrices: async (ids) =>
      ids.map((id) => ({
        id,
        amountMinor: 2000,
        currency: "usd",
        interval: null,
      })),
    readSubscription: async () => {
      throw new Error("not used");
    },
    startCheckout: vi.fn(async () => ({ url: "https://pay.test/pack" })),
    openPortal: async () => ({ url: "" }),
    changeSubscription: async () => undefined,
  };
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a pack, once paid", () => {
  it("adds its credits, in model cost at this instance's credit value", async () => {
    await expect(pack("evt_1")).resolves.toBe("applied");
    await expect(hosted()).resolves.toMatchObject({
      purchasedUsd: 10,
      availableUsd: 11,
    });
  });

  it("is added once, however many times the event is delivered", async () => {
    await pack("evt_1");
    await expect(pack("evt_1")).resolves.toBe("duplicate");
    await expect(hosted()).resolves.toMatchObject({ purchasedUsd: 10 });
  });

  it("survives a new month, while the allowance resets", async () => {
    await pack("evt_1");
    const wb = await workerDb();
    await wb.admin.query(
      "update ai_credit_balances set period_start = '2020-01-01', used_usd = 1 where workspace_id = $1",
      [workspaceId],
    );
    await expect(hosted()).resolves.toMatchObject({
      usedUsd: 0,
      purchasedUsd: 10,
      availableUsd: 11,
    });
  });

  it("is added even to a workspace billing made read-only: they paid", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspaces set state = 'read_only' where id = $1",
      [workspaceId],
    );
    await expect(pack("evt_1")).resolves.toBe("applied");
    await expect(hosted()).resolves.toMatchObject({ purchasedUsd: 10 });
  });
});

describe("buying one", () => {
  it("opens a one-off checkout at the provider's own price, naming the size", async () => {
    await onPlan("team");
    await expect(
      callAction(await context(), "billing.buyCredits", {}),
    ).resolves.toEqual({ url: "https://pay.test/pack" });
    expect(gateway.startCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        priceId: "price_pack",
        credits: 1000,
        workspaceId,
      }),
    );
  });

  it("is refused on a plan with no top-ups", async () => {
    await expect(
      callAction(await context(), "billing.buyCredits", {}),
    ).rejects.toThrow(/cannot buy more credits/);
    expect(gateway.startCheckout).not.toHaveBeenCalled();
  });

  it("is refused where the provider has set no pack", async () => {
    const wb = await workerDb();
    await onPlan("team");
    await wb.admin.query(
      "delete from system_settings where key = 'billing.creditPack'",
    );
    await expect(
      callAction(await context(), "billing.buyCredits", {}),
    ).rejects.toThrow(/cannot buy more credits/);
  });

  it("is on the summary, at the price the provider states", async () => {
    await onPlan("team");
    await expect(
      callAction(await context(), "billing.summary", {}),
    ).resolves.toMatchObject({
      creditPack: { credits: 1000, amountMinor: 2000, currency: "usd" },
    });
  });

  it("is not offered on a plan with no top-ups", async () => {
    await expect(
      callAction(await context(), "billing.summary", {}),
    ).resolves.toMatchObject({ creditPack: null });
  });
});
