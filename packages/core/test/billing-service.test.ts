import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import type {
  BillingGateway,
  SubscriptionSnapshot,
} from "../src/billing/gateway.ts";
import { applyBillingEvent } from "../src/billing/webhook.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { CLOUD_ENABLED_KEY, readTenant } from "../src/tenancy/index.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/** What an administrator does with billing (docs/design/billing.md §7 and §11). */

const ring = parseKeyRing({ current: newRootKey() });

const OWNER = "billing-admin";
const MEMBER = "billing-member";
const PLANS = [
  { key: "free", name: "Free", seats: 2 },
  {
    key: "team",
    name: "Team",
    seats: 5,
    prices: { month: "price_team_m", year: "price_team_y" },
  },
  { key: "biz", name: "Business", seats: 20, prices: { month: "price_biz_m" } },
  { key: "contract", name: "Contract", seats: null },
];

let workspaceId: string;
let subscription: SubscriptionSnapshot;
let gateway: BillingGateway & {
  startCheckout: ReturnType<typeof vi.fn>;
  changeSubscription: ReturnType<typeof vi.fn>;
  openPortal: ReturnType<typeof vi.fn>;
};

const context = async (userId = OWNER) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
    billing: gateway,
    baseUrl: "https://okr.example.com",
  };
};

const subscribe = async (priceId = "price_team_m") => {
  subscription = { ...subscription, priceId };
  const wb = await workerDb();
  await applyBillingEvent(wb.appPool, gateway, {
    kind: "subscription",
    eventRef: `evt_${newId()}`,
    workspaceId,
    subscriptionRef: "sub_1",
  });
};

const addPeople = async (count: number) => {
  const wb = await workerDb();
  for (let index = 0; index < count; index += 1) {
    await wb.admin.query(
      "insert into workspace_members (id, workspace_id, name, kind, status) values ($1, $2, $3, 'human', 'active')",
      [newId(), workspaceId, `Person ${index}`],
    );
  }
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("delete from system_settings");
  for (const id of [OWNER, MEMBER]) {
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $1, $2)",
      [id, `${id}@example.com`],
    );
  }
  await writeSettings(wb.appPool, ring, [
    { key: CLOUD_ENABLED_KEY, value: true },
    { key: "cloud.plans", value: PLANS },
    { key: "cloud.defaultPlan", value: "free" },
  ]);
  workspaceId = (
    await createWorkspace(wb.appPool, { user: { id: OWNER, name: "Owner" } })
  ).workspaceId;
  subscription = {
    ref: "sub_1",
    customerRef: "cus_1",
    status: "active",
    priceId: "price_team_m",
    currentPeriodEnd: new Date("2027-01-01T00:00:00Z"),
    cancelAtPeriodEnd: false,
    scheduledPriceId: null,
  };
  gateway = {
    provider: "stripe",
    listPrices: async (ids) =>
      ids.map((id) => ({
        id,
        amountMinor: 4900,
        currency: "eur",
        interval: id.endsWith("_y") ? ("year" as const) : ("month" as const),
      })),
    readSubscription: async () => subscription,
    startCheckout: vi.fn(async () => ({ url: "https://pay.test/checkout" })),
    openPortal: vi.fn(async () => ({ url: "https://pay.test/portal" })),
    changeSubscription: vi.fn(async () => undefined),
  };
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the summary", () => {
  it("states each price as the provider does, in the provider's currency", async () => {
    const summary = await callAction(await context(), "billing.summary", {});
    expect(summary.plans.find((plan) => plan.key === "team")).toEqual({
      key: "team",
      name: "Team",
      seats: 5,
      month: { amountMinor: 4900, currency: "eur" },
      year: { amountMinor: 4900, currency: "eur" },
    });
    // A plan with no prices cannot be bought.
    expect(
      summary.plans.find((plan) => plan.key === "contract")?.month,
    ).toBeNull();
    expect(summary.currentPlanKey).toBe("free");
    expect(summary.hasLiveSubscription).toBe(false);
  });

  it("still draws when the provider does not answer", async () => {
    gateway.listPrices = async () => {
      throw new Error("Stripe is down");
    };
    gateway.readSubscription = async () => {
      throw new Error("Stripe is down");
    };
    await expect(
      callAction(await context(), "billing.summary", {}),
    ).resolves.toMatchObject({
      pricesAvailable: false,
      currentPlanKey: "free",
    });
  });

  it("names a scheduled move", async () => {
    await subscribe();
    subscription = { ...subscription, scheduledPriceId: "price_biz_m" };
    await expect(
      callAction(await context(), "billing.summary", {}),
    ).resolves.toMatchObject({ scheduledPlanKey: "biz" });
  });
});

describe("starting a subscription", () => {
  it("opens a checkout at the price chosen, for the person's own address", async () => {
    await expect(
      callAction(await context(), "billing.startCheckout", {
        planKey: "team",
        interval: "year",
      }),
    ).resolves.toEqual({ url: "https://pay.test/checkout" });
    expect(gateway.startCheckout).toHaveBeenCalledWith({
      mode: "subscription",
      priceId: "price_team_y",
      workspaceId,
      successUrl: "https://okr.example.com/admin/plan?checkout=done",
      cancelUrl: "https://okr.example.com/admin/plan",
      customerEmail: `${OWNER}@example.com`,
    });
  });

  it("refuses a plan that cannot be bought", async () => {
    await expect(
      callAction(await context(), "billing.startCheckout", {
        planKey: "contract",
        interval: "month",
      }),
    ).rejects.toThrow(/cannot be bought/);
  });

  it("refuses a second subscription", async () => {
    await subscribe();
    await expect(
      callAction(await context(), "billing.startCheckout", {
        planKey: "biz",
        interval: "month",
      }),
    ).rejects.toThrow(/already has a subscription/);
  });

  it("refuses before the money a plan too small for the people", async () => {
    await addPeople(6);
    await expect(
      callAction(await context(), "billing.startCheckout", {
        planKey: "team",
        interval: "month",
      }),
    ).rejects.toThrow(/5 seat\(s\) and 7 are in use/);
    expect(gateway.startCheckout).not.toHaveBeenCalled();
  });

  it("is refused for somebody without full access", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into workspace_members (id, workspace_id, user_id, name, kind, status) values ($1, $2, $3, 'Member', 'human', 'active')",
      [newId(), workspaceId, MEMBER],
    );
    await expect(
      callAction(await context(MEMBER), "billing.startCheckout", {
        planKey: "team",
        interval: "month",
      }),
    ).rejects.toThrow();
    expect(gateway.startCheckout).not.toHaveBeenCalled();
  });
});

describe("changing plan", () => {
  it("moves up now", async () => {
    await subscribe();
    await expect(
      callAction(await context(), "billing.changePlan", {
        planKey: "biz",
        interval: "month",
      }),
    ).resolves.toEqual({ when: "now" });
    expect(gateway.changeSubscription).toHaveBeenCalledWith({
      subscriptionRef: "sub_1",
      priceId: "price_biz_m",
      when: "now",
    });
  });

  it("moves down at the period's end", async () => {
    await subscribe("price_biz_m");
    await expect(
      callAction(await context(), "billing.changePlan", {
        planKey: "team",
        interval: "month",
      }),
    ).resolves.toEqual({ when: "period_end" });
  });

  it("moves yearly to monthly at the period's end, having been paid for", async () => {
    await subscribe("price_team_y");
    await expect(
      callAction(await context(), "billing.changePlan", {
        planKey: "team",
        interval: "month",
      }),
    ).resolves.toEqual({ when: "period_end" });
  });

  it("refuses below the headcount, naming both numbers, without calling Stripe", async () => {
    await subscribe("price_biz_m");
    await addPeople(7);
    await expect(
      callAction(await context(), "billing.changePlan", {
        planKey: "team",
        interval: "month",
      }),
    ).rejects.toThrow(/5 seat\(s\) and 8 are in use/);
    expect(gateway.changeSubscription).not.toHaveBeenCalled();
  });

  it("does not move the plan itself: that waits for the webhook", async () => {
    await subscribe();
    await callAction(await context(), "billing.changePlan", {
      planKey: "biz",
      interval: "month",
    });
    const wb = await workerDb();
    await expect(readTenant(wb.appPool, workspaceId)).resolves.toMatchObject({
      planKey: "team",
    });
  });

  it("refuses a workspace with no subscription", async () => {
    await expect(
      callAction(await context(), "billing.changePlan", {
        planKey: "team",
        interval: "month",
      }),
    ).rejects.toThrow(/no subscription to change/);
  });
});

describe("the audit trail", () => {
  it("records who asked, with what they chose, on each provider call", async () => {
    const wb = await workerDb();
    await callAction(await context(), "billing.startCheckout", {
      planKey: "team",
      interval: "year",
    });
    await subscribe();
    await callAction(await context(), "billing.changePlan", {
      planKey: "biz",
      interval: "month",
    });
    await callAction(await context(), "billing.openPortal", {});
    const { rows } = await wb.admin.query(
      `select action, payload, actor_kind from audit_events
        where workspace_id = $1 and action in ('billing.startCheckout', 'billing.changePlan', 'billing.openPortal')`,
      [workspaceId],
    );
    expect(rows.map((row) => row.action).sort()).toEqual([
      "billing.changePlan",
      "billing.openPortal",
      "billing.startCheckout",
    ]);
    expect(
      rows.find((row) => row.action === "billing.changePlan")?.payload,
    ).toEqual({
      planKey: "biz",
      interval: "month",
      when: "now",
    });
    expect(rows.every((row) => row.actor_kind === "human")).toBe(true);
  });

  it("works on a workspace billing made read-only, which has to be able to pay", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspaces set state = 'read_only' where id = $1",
      [workspaceId],
    );
    await expect(
      callAction(await context(), "billing.startCheckout", {
        planKey: "team",
        interval: "month",
      }),
    ).resolves.toEqual({ url: "https://pay.test/checkout" });
  });
});

describe("the portal", () => {
  it("opens for a workspace with an account, and returns to the plan screen", async () => {
    await subscribe();
    await callAction(await context(), "billing.openPortal", {});
    expect(gateway.openPortal).toHaveBeenCalledWith({
      customerRef: "cus_1",
      returnUrl: "https://okr.example.com/admin/plan",
    });
  });

  it("refuses a workspace with none", async () => {
    await expect(
      callAction(await context(), "billing.openPortal", {}),
    ).rejects.toThrow(/no billing account/);
  });
});

describe("settling a workspace billing made read-only", () => {
  const endTooBig = async () => {
    await subscribe();
    await addPeople(3);
    subscription = { ...subscription, status: "canceled" };
    await subscribe(subscription.priceId as string);
  };

  it("refuses until the people fit, naming both numbers", async () => {
    await endTooBig();
    await expect(
      callAction(await context(), "billing.settleEnded", {}),
    ).rejects.toThrow(/2 seat\(s\) and 4 are in use/);
  });

  it("moves to the default plan once they do, and lifts it", async () => {
    await endTooBig();
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where workspace_id = $1 and name like 'Person %'",
      [workspaceId],
    );
    await expect(
      callAction(await context(), "billing.settleEnded", {}),
    ).resolves.toEqual({ planKey: "free" });
    await expect(readTenant(wb.appPool, workspaceId)).resolves.toMatchObject({
      planKey: "free",
      state: "active",
    });
  });

  it("refuses a workspace billing did not suspend", async () => {
    await expect(
      callAction(await context(), "billing.settleEnded", {}),
    ).rejects.toThrow(/did not make this workspace read-only/);
  });
});
