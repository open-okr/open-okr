import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { SubscriptionSnapshot } from "../src/billing/gateway.ts";
import { applyBillingEvent } from "../src/billing/webhook.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { CLOUD_ENABLED_KEY, readTenant } from "../src/tenancy/index.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * What a verified webhook does to a workspace (docs/design/billing.md §6 and §11).
 *
 * Against a real database, with a fake provider standing in for Stripe. The signature
 * is proved in `packages/adapters/test/billing.test.ts`.
 */

const ring = parseKeyRing({ current: newRootKey() });

const OWNER = "billing-owner";
const PLANS = [
  { key: "free", name: "Free", seats: 2 },
  {
    key: "team",
    name: "Team",
    seats: 5,
    prices: { month: "price_team_m", year: "price_team_y" },
  },
  { key: "biz", name: "Business", seats: 20, prices: { month: "price_biz_m" } },
];

let workspaceId: string;
let eventNumber = 0;

const subscriptionOf = (
  overrides: Partial<SubscriptionSnapshot> = {},
): SubscriptionSnapshot => ({
  ref: "sub_1",
  customerRef: "cus_1",
  status: "active",
  priceId: "price_team_m",
  currentPeriodEnd: new Date("2027-01-01T00:00:00Z"),
  cancelAtPeriodEnd: false,
  scheduledPriceId: null,
  ...overrides,
});

const nextEventRef = () => {
  eventNumber += 1;
  return `evt_${eventNumber}`;
};

const deliver = async (
  overrides: Partial<SubscriptionSnapshot> = {},
  eventRef = nextEventRef(),
) => {
  const wb = await workerDb();
  return applyBillingEvent(
    wb.appPool,
    {
      provider: "stripe",
      readSubscription: async () => subscriptionOf(overrides),
    },
    {
      kind: "subscription",
      eventRef,
      workspaceId,
      subscriptionRef: "sub_1",
    },
  );
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

const tenant = async () => {
  const wb = await workerDb();
  return readTenant(wb.appPool, workspaceId);
};

const account = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select * from billing_accounts where workspace_id = $1",
    [workspaceId],
  );
  return rows[0];
};

const memberStatuses = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select distinct status from workspace_members where workspace_id = $1 and kind = 'human'",
    [workspaceId],
  );
  return rows.map((row) => row.status);
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
  ]);
  workspaceId = (
    await createWorkspace(wb.appPool, { user: { id: OWNER, name: "Owner" } })
  ).workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a live subscription", () => {
  it("puts the workspace on the plan its price maps to, monthly or yearly", async () => {
    await expect(deliver()).resolves.toBe("applied");
    expect(await tenant()).toMatchObject({ planKey: "team", seats: 5 });
    expect(await account()).toMatchObject({
      provider: "stripe",
      customer_ref: "cus_1",
      subscription_ref: "sub_1",
      status: "active",
    });

    await deliver({ priceId: "price_biz_m" });
    expect(await tenant()).toMatchObject({ planKey: "biz", seats: 20 });
    await deliver({ priceId: "price_team_y" });
    expect(await tenant()).toMatchObject({ planKey: "team" });
  });

  it("changes nothing the second time the same event arrives", async () => {
    await expect(deliver({}, "evt_same")).resolves.toBe("applied");
    await deliver({ priceId: "price_biz_m" }, "evt_newer");
    // The same reference again, however it now reads, is already done.
    await expect(deliver({}, "evt_same")).resolves.toBe("duplicate");
    expect(await tenant()).toMatchObject({ planKey: "biz" });
  });

  it("reflects the subscription as it is now, whichever event arrives last", async () => {
    // The provider is read on every event, so an older event delivered late reads
    // the current state and cannot undo the newer one.
    await deliver({ priceId: "price_biz_m" }, "evt_newer");
    await deliver({ priceId: "price_biz_m" }, "evt_older");
    expect(await tenant()).toMatchObject({ planKey: "biz" });
  });

  it("moves nothing for a price no catalogue row holds", async () => {
    await deliver();
    await deliver({ priceId: "price_from_another_product" });
    expect(await tenant()).toMatchObject({ planKey: "team" });
  });

  it("keeps the plan while a payment is failing and Stripe retries", async () => {
    await deliver();
    await deliver({ status: "past_due" });
    expect(await tenant()).toMatchObject({ planKey: "team", state: "active" });
    expect(await account()).toMatchObject({ status: "past_due" });
  });
});

describe("a subscription that ends", () => {
  it("moves to the default plan when its people fit, and suspends nobody", async () => {
    await deliver();
    await expect(deliver({ status: "canceled" })).resolves.toBe("applied");
    expect(await tenant()).toMatchObject({
      planKey: "free",
      seats: 2,
      state: "active",
    });
  });

  it("goes read-only when they do not, and removes nobody", async () => {
    await deliver();
    await addPeople(3);
    await deliver({ status: "canceled" });

    expect(await tenant()).toMatchObject({
      planKey: "team",
      state: "suspended",
    });
    expect(await account()).toMatchObject({ suspended_by_billing: true });
    expect(await memberStatuses()).toEqual(["active"]);
  });

  it("is lifted when they subscribe again", async () => {
    await deliver();
    await addPeople(3);
    await deliver({ status: "canceled" });
    await deliver({ status: "active", priceId: "price_biz_m" });

    expect(await tenant()).toMatchObject({ planKey: "biz", state: "active" });
    expect(await account()).toMatchObject({ suspended_by_billing: false });
  });

  it("does not lift a suspension an operator imposed", async () => {
    await deliver();
    const wb = await workerDb();
    await wb.admin.query(
      "update tenants set state = 'suspended' where workspace_id = $1",
      [workspaceId],
    );
    await deliver({ status: "active", priceId: "price_biz_m" });
    expect(await tenant()).toMatchObject({
      planKey: "biz",
      state: "suspended",
    });
  });
});

describe("a scheduled downgrade that no longer fits at renewal", () => {
  it("goes read-only rather than leaving the workspace over its limit", async () => {
    await deliver({ priceId: "price_biz_m" });
    await addPeople(8);
    await deliver({ priceId: "price_team_m" });
    expect(await tenant()).toMatchObject({
      planKey: "biz",
      state: "suspended",
    });
  });
});

describe("events that are not ours to apply", () => {
  it("ignores a signed event with no workspace on it", async () => {
    const wb = await workerDb();
    await expect(
      applyBillingEvent(
        wb.appPool,
        { provider: "stripe", readSubscription: async () => subscriptionOf() },
        {
          kind: "subscription",
          eventRef: "evt_x",
          workspaceId: null,
          subscriptionRef: "sub_1",
        },
      ),
    ).resolves.toBe("ignored");
  });

  it("leaves a workspace with no billing account alone", async () => {
    const wb = await workerDb();
    const other = await createWorkspace(wb.appPool, {
      user: { id: OWNER, name: "Owner" },
      name: "Contract customer",
    });
    await wb.admin.query(
      "update tenants set plan_key = 'biz', seats = 500 where workspace_id = $1",
      [other.workspaceId],
    );
    await deliver({ status: "canceled" });
    await expect(
      readTenant(wb.appPool, other.workspaceId),
    ).resolves.toMatchObject({ planKey: "biz", seats: 500 });
  });
});

describe("the audit log", () => {
  it("says what the provider said, and what moved", async () => {
    await deliver();
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select payload from audit_events where workspace_id = $1 and action = 'billing.subscription_changed'",
      [workspaceId],
    );
    expect(rows[0]?.payload).toMatchObject({
      provider: "stripe",
      status: "active",
      plan: "Team",
    });
  });
});
