import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import type { SubscriptionSnapshot } from "../src/billing/gateway.ts";
import { applyBillingEvent } from "../src/billing/webhook.ts";
import { setLifecycleAsOperator } from "../src/operator/lifecycle.ts";
import { setPlanAsOperator } from "../src/operator/plans.ts";
import { setTrialAsOperator } from "../src/operator/trials.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { CLOUD_ENABLED_KEY, readTenant } from "../src/tenancy/index.ts";
import { requireFreeWorkspaceRoom } from "../src/tenancy/plans.ts";
import { sweepTrials } from "../src/tenancy/trials.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * The trial sweep (docs/design/tenant-lifecycle.md §11, plan 0.7.0 P4,
 * approved by Akmal on 9 November 2026).
 *
 * A trial is a catalogue plan with an end date and no subscription. When the
 * date passes, the sweep applies the rule billing.md §6 uses for a
 * subscription that ends: people who fit the default plan are moved to it, and
 * a workspace whose people do not fit is read-only until somebody chooses.
 */

const ring = parseKeyRing({ current: newRootKey() });
const OWNER = "trial-owner";
const OPERATOR = "trial-operator";
const PLANS = [
  { key: "free", name: "Free", seats: 10 },
  {
    key: "team",
    name: "Team",
    seats: 50,
    prices: { month: "price_team_m" },
  },
];
const DAY = 24 * 60 * 60 * 1000;

let workspaceId: string;

const tenant = async () => readTenant((await workerDb()).appPool, workspaceId);

/** Humans beside the owner, so the workspace has `count + 1` people. */
const addPeople = async (count: number) => {
  const wb = await workerDb();
  for (let index = 0; index < count; index += 1) {
    await wb.admin.query(
      "insert into workspace_members (id, workspace_id, name, kind, status) values ($1, $2, $3, 'human', 'active')",
      [newId(), workspaceId, `Person ${index}`],
    );
  }
};

/** A trial of Team that ended yesterday, set as the operator sets one. */
const trialEndedYesterday = async () => {
  const wb = await workerDb();
  await setTrialAsOperator(wb.appPool, {
    workspaceId,
    operatorUserId: OPERATOR,
    planKey: "team",
    endsAt: new Date(Date.now() + DAY),
    reason: "A two-week trial of Team, as agreed on the sales call.",
  });
  // Then time passes.
  await wb.admin.query(
    "update tenants set trial_ends_at = now() - interval '1 day' where workspace_id = $1",
    [workspaceId],
  );
};

const sweep = async () => sweepTrials((await workerDb()).appPool);

const auditActions = async (action: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select payload from audit_events where workspace_id = $1 and action = $2",
    [workspaceId, action],
  );
  return rows;
};

const subscribe = async (eventRef: string) => {
  const wb = await workerDb();
  const subscription: SubscriptionSnapshot = {
    ref: "sub_1",
    customerRef: "cus_1",
    status: "active",
    priceId: "price_team_m",
    currentPeriodEnd: new Date(Date.now() + 30 * DAY),
    cancelAtPeriodEnd: false,
    scheduledPriceId: null,
  };
  await applyBillingEvent(
    wb.appPool,
    { provider: "stripe", readSubscription: async () => subscription },
    { kind: "subscription", eventRef, workspaceId, subscriptionRef: "sub_1" },
  );
};

const asOwner = async (name: string, input: unknown) =>
  callAction(
    {
      pool: (await workerDb()).appPool,
      workspaceId,
      actor: { kind: "human" as const, userId: OWNER },
    },
    name as never,
    input as never,
  );

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("delete from system_settings");
  await wb.admin.query("delete from instance_operators");
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2), ($3, $3, $4)",
    [OWNER, `${OWNER}@example.com`, OPERATOR, `${OPERATOR}@example.com`],
  );
  await writeSettings(wb.appPool, ring, [
    { key: CLOUD_ENABLED_KEY, value: true },
    { key: "cloud.plans", value: PLANS },
    { key: "cloud.defaultPlan", value: "free" },
  ]);
  await wb.admin.query(
    "insert into instance_operators (user_id, granted_by_user_id, note) values ($1, $2, 'test')",
    [OPERATOR, OWNER],
  );
  workspaceId = (
    await createWorkspace(wb.appPool, { user: { id: OWNER, name: "Owner" } })
  ).workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("an operator's trial", () => {
  it("puts the workspace on the trial plan until the date, in the customer's own audit log", async () => {
    const wb = await workerDb();
    const endsAt = new Date(Date.now() + 14 * DAY);
    await setTrialAsOperator(wb.appPool, {
      workspaceId,
      operatorUserId: OPERATOR,
      planKey: "team",
      endsAt,
      reason: "A two-week trial of Team.",
    });

    expect(await tenant()).toMatchObject({
      planKey: "team",
      seats: 50,
      trialEndsAt: endsAt,
    });
    // Named as the operator's, with the reason, as a plan change is.
    const [audit] = await auditActions("workspace.setTrial");
    expect(audit?.payload).toMatchObject({
      planKey: "team",
      reason: "A two-week trial of Team.",
      by: "operator",
    });
  });

  it("is refused to somebody who is not an operator", async () => {
    const wb = await workerDb();
    await expect(
      setTrialAsOperator(wb.appPool, {
        workspaceId,
        operatorUserId: OWNER,
        planKey: "team",
        endsAt: new Date(Date.now() + DAY),
        reason: "Trying my luck.",
      }),
    ).rejects.toThrow(/No such workspace/);
  });
});

describe("when a trial ends", () => {
  it("moves people who fit the default plan onto it, still active", async () => {
    await trialEndedYesterday();
    await addPeople(4);

    expect(await sweep()).toMatchObject({ ended: 1 });

    expect(await tenant()).toMatchObject({
      state: "active",
      planKey: "free",
      seats: 10,
      trialEndsAt: null,
      suspendedByTrial: false,
    });
    const [audit] = await auditActions("workspace.endTrial");
    expect(audit?.payload).toMatchObject({ outcome: "moved", planKey: "free" });
  });

  it("makes the workspace read-only when its people do not fit, and suspends nobody", async () => {
    await trialEndedYesterday();
    await addPeople(11);

    await sweep();

    expect(await tenant()).toMatchObject({
      state: "suspended",
      planKey: "team",
      trialEndsAt: null,
      suspendedByTrial: true,
    });
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select count(*)::int as n from workspace_members where workspace_id = $1 and kind = 'human' and status <> 'active'",
      [workspaceId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("only clears the date when a subscription is already live", async () => {
    await trialEndedYesterday();
    await subscribe("evt_live");
    // The subscription cleared the trial; put a past date back as a stale
    // replica might have, to prove the sweep reads the subscription.
    const wb = await workerDb();
    await wb.admin.query(
      "update tenants set trial_ends_at = now() - interval '1 hour' where workspace_id = $1",
      [workspaceId],
    );

    await sweep();

    expect(await tenant()).toMatchObject({
      state: "active",
      planKey: "team",
      trialEndsAt: null,
    });
    const [audit] = await auditActions("workspace.endTrial");
    expect(audit?.payload).toMatchObject({ outcome: "subscribed" });
  });

  it("writes nothing the second time", async () => {
    await trialEndedYesterday();
    await sweep();
    expect(await sweep()).toMatchObject({ ended: 0 });
    expect(await auditActions("workspace.endTrial")).toHaveLength(1);
  });

  it("settles two parallel sweeps once", async () => {
    await trialEndedYesterday();
    const [first, second] = await Promise.all([sweep(), sweep()]);
    expect(first.ended + second.ended).toBe(1);
    expect(await auditActions("workspace.endTrial")).toHaveLength(1);
  });

  it("reads no tenant with the cloud flag off", async () => {
    await trialEndedYesterday();
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: CLOUD_ENABLED_KEY, value: false },
    ]);
    expect(await sweep()).toEqual({ due: [], ended: 0 });
    expect((await tenant())?.trialEndsAt).not.toBeNull();
  });
});

describe("leaving a trial suspension", () => {
  const suspendedByTrial = async () => {
    await trialEndedYesterday();
    await addPeople(11);
    await sweep();
  };

  it("lifts when the administrator makes the people fit and presses Settle", async () => {
    await suspendedByTrial();
    const wb = await workerDb();
    await wb.admin.query(
      `update workspace_members set status = 'suspended'
        where id in (select id from workspace_members
                      where workspace_id = $1 and kind = 'human' and user_id is null
                      limit 2)`,
      [workspaceId],
    );

    await asOwner("billing.settleEnded", {});

    expect(await tenant()).toMatchObject({
      state: "active",
      planKey: "free",
      suspendedByTrial: false,
    });
  });

  it("lifts when a subscription becomes active", async () => {
    await suspendedByTrial();
    await subscribe("evt_paid");
    expect(await tenant()).toMatchObject({
      state: "active",
      planKey: "team",
      suspendedByTrial: false,
    });
  });

  it("does not lift an operator's own suspension", async () => {
    const wb = await workerDb();
    await setLifecycleAsOperator(wb.appPool, {
      workspaceId,
      operatorUserId: OPERATOR,
      state: "suspended",
      reason: "Under review for misuse.",
    });
    await subscribe("evt_paid_while_held");
    expect(await tenant()).toMatchObject({ state: "suspended" });
  });

  it("lifts when an operator extends the trial into the future", async () => {
    await suspendedByTrial();
    const wb = await workerDb();
    await setTrialAsOperator(wb.appPool, {
      workspaceId,
      operatorUserId: OPERATOR,
      endsAt: new Date(Date.now() + 30 * DAY),
      reason: "Another month while procurement signs.",
    });
    expect(await tenant()).toMatchObject({
      state: "active",
      planKey: "team",
      suspendedByTrial: false,
    });
  });
});

describe("choosing a plan ends the trial", () => {
  it("when an operator sets one", async () => {
    await trialEndedYesterday();
    const wb = await workerDb();
    await setPlanAsOperator(wb.appPool, {
      workspaceId,
      operatorUserId: OPERATOR,
      planKey: "team",
      reason: "Signed the annual contract.",
    });
    expect((await tenant())?.trialEndsAt).toBeNull();
  });
});

/**
 * A trial a sign-up starts by itself (tenant-lifecycle.md §11 Q1, approved
 * yes, plan 0.7.0 P4b): only when the provider names both a length and a
 * plan the catalogue holds.
 */
describe("a sign-up's own trial", () => {
  const SIGNER = "trial-signer";

  const signUp = async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $1, $2) on conflict do nothing",
      [SIGNER, `${SIGNER}@example.com`],
    );
    const created = await createWorkspace(wb.appPool, {
      user: { id: SIGNER, name: "Signer" },
    });
    return readTenant(wb.appPool, created.workspaceId);
  };

  it("starts on the trial plan, ending the configured number of days from now", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "cloud.trialDays", value: 14 },
      { key: "cloud.trialPlan", value: "team" },
    ]);
    const signed = await signUp();
    expect(signed).toMatchObject({ planKey: "team", seats: 50 });
    const days = ((signed?.trialEndsAt?.getTime() ?? 0) - Date.now()) / DAY;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
  });

  it("starts no trial unless both settings name something", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "cloud.trialDays", value: 14 },
    ]);
    expect(await signUp()).toMatchObject({
      planKey: "free",
      trialEndsAt: null,
    });
  });

  it("reads a plan the catalogue does not hold as no trial", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "cloud.trialDays", value: 14 },
      { key: "cloud.trialPlan", value: "enterprise" },
    ]);
    expect(await signUp()).toMatchObject({
      planKey: "free",
      trialEndsAt: null,
    });
  });

  it("counts a workspace on a trial as one of its owner's free workspaces", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "cloud.trialDays", value: 14 },
      { key: "cloud.trialPlan", value: "team" },
      { key: "cloud.limits.freeWorkspacesPerPerson", value: 1 },
    ]);
    await signUp();
    await expect(requireFreeWorkspaceRoom(wb.appPool, SIGNER)).rejects.toThrow(
      /free workspace/,
    );
  });
});
