import { workerDb } from "@openokr/test-support/db";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { callRecorder } from "../src/ai/usage.ts";
import type { BillingGateway } from "../src/billing/gateway.ts";
import { applyBillingEvent } from "../src/billing/webhook.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { addMonths } from "../src/tenancy/credits.ts";
import {
  CLOUD_ENABLED_KEY,
  creditsPausedReason,
  readCreditSummary,
  readHostedAccess,
} from "../src/tenancy/index.ts";
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

const pack = (
  eventRef: string,
  credits = 1000,
  options: { readonly sessionRef?: string; readonly months?: number } = {},
) =>
  workerDb().then((wb) =>
    applyBillingEvent(wb.appPool, gateway, {
      kind: "credit_pack",
      eventRef,
      workspaceId,
      customerRef: "cus_1",
      sessionRef: options.sessionRef ?? `cs_${eventRef}`,
      credits,
      months: options.months ?? null,
    }),
  );

/** One call of exactly `usd` of model cost, on the provider's key. */
const spend = async (usd: number) => {
  const wb = await workerDb();
  await callRecorder(wb.appPool, {
    workspaceId,
    provider: "anthropic",
    rates: { costInPerMillion: 1_000, costOutPerMillion: 0 },
    keySource: "deployment",
    forUser: OWNER,
  })({
    model: "m",
    usage: { inputTokens: Math.round(usd * 1000), outputTokens: 0 },
  });
};

const packsLeft = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select remaining_usd::float8 as left from ai_credit_packs where workspace_id = $1 order by expires_at",
    [workspaceId],
  );
  return rows.map((row) => row.left);
};

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

  it("is added once per checkout, even under a second event", async () => {
    await pack("evt_1", 1000, { sessionRef: "cs_same" });
    await pack("evt_2", 1000, { sessionRef: "cs_same" });
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
        // Twelve unless the provider says otherwise, as Terms §5.2 promises.
        months: 12,
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

describe("expiry (ai-credits.md §6)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (iso: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  };

  it("lasts twelve months from the day it lands", async () => {
    at("2026-11-08T10:00:00Z");
    await pack("evt_1");
    const wb = await workerDb();
    await expect(
      readCreditSummary(wb.appPool, workspaceId),
    ).resolves.toMatchObject({
      purchased: 1000,
      expiring: { credits: 1000, at: "2027-11-08T10:00:00.000Z" },
    });
  });

  it("ends on the month's last day when its own day does not exist there", () => {
    expect(addMonths(new Date("2027-01-31T10:00:00Z"), 1).toISOString()).toBe(
      "2027-02-28T10:00:00.000Z",
    );
    expect(addMonths(new Date("2028-02-29T00:00:00Z"), 12).toISOString()).toBe(
      "2029-02-28T00:00:00.000Z",
    );
    expect(addMonths(new Date("2026-11-30T23:59:59Z"), 3).toISOString()).toBe(
      "2027-02-28T23:59:59.000Z",
    );
  });

  it("is spent soonest to expire first, once the allowance is gone", async () => {
    await pack("evt_june", 1000, { months: 7 });
    await pack("evt_march", 1000, { months: 4 });
    await spend(1 + 5);
    await expect(packsLeft()).resolves.toEqual([5, 10]);
    await expect(hosted()).resolves.toMatchObject({ availableUsd: 15 });
    await spend(6);
    await expect(packsLeft()).resolves.toEqual([0, 9]);
  });

  it("stops counting the moment it lapses, with no job having run", async () => {
    at("2026-11-08T10:00:00Z");
    await pack("evt_1");
    at("2027-11-08T10:00:01Z");
    await expect(hosted()).resolves.toMatchObject({
      purchasedUsd: 0,
      availableUsd: 1,
    });
    await spend(1);
    const wb = await workerDb();
    await expect(creditsPausedReason(wb.appPool, workspaceId)).resolves.toMatch(
      /AI is paused/,
    );
    // The row stays as the record of what lapsed, untouched.
    await expect(packsLeft()).resolves.toEqual([10]);
  });

  it("keeps the length it was sold with when the provider changes it", async () => {
    const wb = await workerDb();
    await onPlan("team");
    await writeSettings(wb.appPool, ring, [
      {
        key: "billing.creditPack",
        value: { priceId: "price_pack", credits: 1000, months: 6 },
      },
    ]);
    await callAction(await context(), "billing.buyCredits", {});
    expect(gateway.startCheckout).toHaveBeenLastCalledWith(
      expect.objectContaining({ credits: 1000, months: 6 }),
    );
    at("2026-11-08T10:00:00Z");
    await pack("evt_1", 1000, { months: 6 });
    await writeSettings(wb.appPool, ring, [
      {
        key: "billing.creditPack",
        value: { priceId: "price_pack", credits: 1000, months: 3 },
      },
    ]);
    await callAction(await context(), "billing.buyCredits", {});
    expect(gateway.startCheckout).toHaveBeenLastCalledWith(
      expect.objectContaining({ months: 3 }),
    );
    const { rows } = await wb.admin.query(
      "select expires_at from ai_credit_packs where workspace_id = $1",
      [workspaceId],
    );
    expect(rows.map((row) => row.expires_at.toISOString())).toEqual([
      "2027-05-08T10:00:00.000Z",
    ]);
  });

  it("takes the provider's length when a checkout did not say", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      {
        key: "billing.creditPack",
        value: { priceId: "price_pack", credits: 1000, months: 3 },
      },
    ]);
    at("2026-11-08T10:00:00Z");
    await pack("evt_1");
    await expect(
      readCreditSummary(wb.appPool, workspaceId),
    ).resolves.toMatchObject({
      expiring: { at: "2027-02-08T10:00:00.000Z" },
    });
  });
});
