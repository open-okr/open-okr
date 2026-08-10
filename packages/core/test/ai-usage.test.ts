import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  checkBudget,
  checkFeatureAvailability,
  isOverHardCap,
} from "../src/ai/budgets.ts";
import { recordUsageEvent, summariseUsage } from "../src/ai/usage.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Usage metering, budgets and the hard cap (P2-T16 test plan,
 * AI-NATIVE-PLAN.md §4).
 *
 * A call records tokens and cost accurately against the catalogue;
 * crossing a quota disables the feature with a clear message; crossing
 * the workspace's own hard cap is what an agent run halts against.
 */

const OWNER = "ai-usage-owner";

let workspaceId: string;

const context = (actorUserId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId: actorUserId },
});

async function recordCall(
  cost: number,
  overrides: Partial<Parameters<typeof recordUsageEvent>[1]> = {},
) {
  const wb = await workerDb();
  return recordUsageEvent(wb.appPool, {
    workspaceId,
    source: "assist",
    provider: "anthropic",
    modelId: "claude-sonnet-5",
    inputTokens: 100,
    outputTokens: 50,
    cost,
    ...overrides,
  });
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "AI Usage Owner", "ai-usage-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "AI Usage Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("recordUsageEvent", () => {
  it("records tokens and cost accurately, summing across calls", async () => {
    await recordCall(1.5);
    await recordCall(2.5, { inputTokens: 200, outputTokens: 100 });

    const wb = await workerDb();
    const summary = await summariseUsage(wb.appPool, {
      workspaceId,
      since: new Date(Date.now() - 60_000),
    });
    expect(summary.totalCalls).toBe(2);
    expect(summary.totalInputTokens).toBe(300);
    expect(summary.totalOutputTokens).toBe(150);
    expect(summary.totalCost).toBeCloseTo(4, 5);
  });

  it("flags a call whose cost is far outside this feature's own recent pattern", async () => {
    for (let i = 0; i < 5; i++) {
      await recordCall(1, { featureKey: "draft.objective" });
    }
    const spike = await recordCall(50, { featureKey: "draft.objective" });
    expect(spike.flagged).toBe(true);
  });

  it("does not flag a workspace's first few calls with no baseline yet", async () => {
    const first = await recordCall(500, { featureKey: "draft.objective" });
    expect(first.flagged).toBe(false);
  });
});

describe("checkBudget", () => {
  it("reports unconfigured, and within limit, when nothing is set", async () => {
    const wb = await workerDb();
    const result = await checkBudget(wb.appPool, {
      workspaceId,
      scope: "workspace",
      scopeRef: null,
      metric: "cost",
    });
    expect(result).toMatchObject({ configured: false, withinLimit: true });
  });

  it("crosses the limit once usage in the current period exceeds it", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "ai.setBudget", {
      scope: "workspace",
      scopeRef: null,
      metric: "cost",
      period: "day",
      limitValue: 10,
    });

    const before = await checkBudget(wb.appPool, {
      workspaceId,
      scope: "workspace",
      scopeRef: null,
      metric: "cost",
    });
    expect(before.withinLimit).toBe(true);

    await recordCall(12);

    const after = await checkBudget(wb.appPool, {
      workspaceId,
      scope: "workspace",
      scopeRef: null,
      metric: "cost",
    });
    expect(after.withinLimit).toBe(false);
    expect(after.current).toBe(12);
    expect(after.limit).toBe(10);
  });
});

describe("checkFeatureAvailability", () => {
  it("disables a feature with a clear message once its workspace crosses its budget", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "ai.setBudget", {
      scope: "workspace",
      scopeRef: null,
      metric: "cost",
      period: "day",
      limitValue: 5,
    });
    await recordCall(10);

    const availability = await checkFeatureAvailability(wb.appPool, {
      workspaceId,
      featureKey: "draft.objective",
      defaultTier: "balanced",
    });
    expect(availability.available).toBe(false);
    expect(availability.reason).toMatch(/budget/i);
  });

  it("stays available for a feature with no budget configured at all — every manual path keeps working", async () => {
    const wb = await workerDb();
    const availability = await checkFeatureAvailability(wb.appPool, {
      workspaceId,
      featureKey: "rewrite.failing_rule",
      defaultTier: "balanced",
    });
    expect(availability.available).toBe(true);
  });

  it("refuses when the feature's own switch is off, before any budget is even checked", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateFeatureSetting",
      { featureKey: "draft.objective", enabled: false },
    );

    const availability = await checkFeatureAvailability(wb.appPool, {
      workspaceId,
      featureKey: "draft.objective",
      defaultTier: "balanced",
    });
    expect(availability.available).toBe(false);
    expect(availability.reason).toMatch(/turned off/);
  });
});

describe("isOverHardCap", () => {
  it("reports over once the workspace's own budget is crossed, for an agent run to halt against", async () => {
    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context(OWNER) }, "ai.setBudget", {
      scope: "workspace",
      scopeRef: null,
      metric: "calls",
      period: "day",
      limitValue: 2,
    });
    await recordCall(1);
    const stillUnder = await isOverHardCap(wb.appPool, { workspaceId });
    expect(stillUnder.over).toBe(false);

    await recordCall(1);
    await recordCall(1);
    const over = await isOverHardCap(wb.appPool, { workspaceId });
    expect(over.over).toBe(true);
    expect(over.reason).toMatch(/calls/);
  });

  it("reports not over when nothing is configured", async () => {
    const wb = await workerDb();
    const result = await isOverHardCap(wb.appPool, { workspaceId });
    expect(result.over).toBe(false);
  });
});

describe("budget admin actions", () => {
  it("readBudgets lists every configured budget, and removeBudget clears one", async () => {
    const wb = await workerDb();
    const saved = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.setBudget",
      {
        scope: "user",
        scopeRef: null,
        metric: "tokens",
        period: "month",
        limitValue: 100_000,
      },
    );

    const listed = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.readBudgets",
      {},
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      scope: "user",
      metric: "tokens",
      limitValue: 100_000,
    });

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.removeBudget",
      { id: saved.id },
    );
    const afterRemoval = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.readBudgets",
      {},
    );
    expect(afterRemoval).toHaveLength(0);
  });
});
