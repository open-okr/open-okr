import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  resolveDeploymentRates,
  resolveTierRoute,
} from "../src/ai/tier-routing.ts";
import { callRecorder } from "../src/ai/usage.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import {
  CLOUD_ENABLED_KEY,
  creditsPausedReason,
  type HostedAccess,
  readCreditSummary,
  readHostedAccess,
} from "../src/tenancy/index.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * AI credits (docs/design/ai-credits.md §10), on a real database. A plan's allowance
 * here is the page's own shape: 100 credits, at one US cent each, is $1 of model cost.
 */

const ring = parseKeyRing({ current: newRootKey() });

const OWNER = "credits-owner";
const RATES = { costInPerMillion: 1_000, costOutPerMillion: 0 };
const PLANS = [
  { key: "free", name: "Free", seats: 10, aiCredits: 100 },
  { key: "team", name: "Team", seats: 50, aiCredits: 2000, aiTopUps: true },
  { key: "byo", name: "Bring your own", seats: 10 },
];

let workspaceId: string;

const applySetup = async (settings: Record<string, unknown>) => {
  const wb = await workerDb();
  await writeSettings(
    wb.appPool,
    ring,
    Object.entries(settings).map(([key, value]) => ({ key, value })),
  );
};

const access = async (): Promise<HostedAccess> => {
  const wb = await workerDb();
  return readHostedAccess(wb.appPool, workspaceId);
};

const credits = async () => {
  const state = await access();
  if (state.kind !== "credits") {
    throw new Error(`expected credits, got ${state.kind}`);
  }
  return state;
};

/** One call of exactly `usd` of model cost, on whichever key is named. */
const spend = async (
  usd: number,
  keySource: "deployment" | "workspace" | "user" = "deployment",
  source?: "agent" | "copilot",
) => {
  const wb = await workerDb();
  await callRecorder(wb.appPool, {
    workspaceId,
    provider: "anthropic",
    rates: RATES,
    keySource,
    ...(source ? { source } : { forUser: OWNER }),
  })({
    model: "m",
    usage: { inputTokens: Math.round(usd * 1000), outputTokens: 0 },
  });
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("delete from system_settings");
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2)",
    [OWNER, `${OWNER}@example.com`],
  );
  await applySetup({
    [CLOUD_ENABLED_KEY]: true,
    "cloud.plans": PLANS,
    "cloud.defaultPlan": "free",
  });
  workspaceId = (
    await createWorkspace(wb.appPool, { user: { id: OWNER, name: "Owner" } })
  ).workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("who may use the provider's key", () => {
  it("a plan with credits, spending them", async () => {
    await expect(credits()).resolves.toMatchObject({
      allowanceUsd: 1,
      usedUsd: 0,
      availableUsd: 1,
      creditValueUsd: 0.01,
      topUps: false,
    });
  });

  it("nobody on a plan with none: they bring their own key", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update tenants set plan_key = 'byo' where workspace_id = $1",
      [workspaceId],
    );
    await expect(access()).resolves.toEqual({ kind: "none" });
  });

  it("nobody with no plan when there is a catalogue, so nothing spends it unlimited", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update tenants set plan_key = null where workspace_id = $1",
      [workspaceId],
    );
    await expect(access()).resolves.toEqual({ kind: "none" });
  });

  it("anybody with no catalogue: self-hosting and groups are never limited", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "delete from system_settings where key = 'cloud.plans'",
    );
    await expect(access()).resolves.toEqual({ kind: "unmetered" });
  });

  it("takes a provider's own credit value", async () => {
    await applySetup({ "cloud.creditValueUsd": 0.02 });
    await expect(credits()).resolves.toMatchObject({ allowanceUsd: 2 });
  });
});

describe("spending", () => {
  it("is charged at the model's price, on the provider's key", async () => {
    await spend(0.25);
    await expect(credits()).resolves.toMatchObject({
      usedUsd: 0.25,
      availableUsd: 0.75,
    });
  });

  it("spends nothing on a workspace's own key, or a person's", async () => {
    await spend(0.25, "workspace");
    await spend(0.25, "user");
    await expect(credits()).resolves.toMatchObject({ usedUsd: 0 });
  });

  it("records whose key paid on the usage row", async () => {
    await spend(0.25);
    await spend(0.25, "workspace");
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select key_source from ai_usage_events where workspace_id = $1 order by created_at",
      [workspaceId],
    );
    expect(rows.map((row) => row.key_source).sort()).toEqual([
      "deployment",
      "workspace",
    ]);
  });

  it("is not raised by an administrator's budget", async () => {
    const wb = await workerDb();
    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
      },
      "ai.setBudget",
      {
        scope: "workspace",
        scopeRef: null,
        metric: "cost",
        period: "month",
        limitValue: 10_000,
      },
    );
    await spend(1);
    await expect(credits()).resolves.toMatchObject({ availableUsd: 0 });
  });

  it("is exact under concurrency, at most the calls in flight past the limit", async () => {
    await Promise.all(Array.from({ length: 10 }, () => spend(0.1)));
    const state = await credits();
    expect(state.usedUsd).toBeCloseTo(1);
    expect(state.availableUsd).toBeCloseTo(0);
  });

  it("starts again in a new month", async () => {
    await spend(0.5);
    const wb = await workerDb();
    await wb.admin.query(
      "update ai_credit_balances set period_start = '2020-01-01' where workspace_id = $1",
      [workspaceId],
    );
    await expect(credits()).resolves.toMatchObject({
      usedUsd: 0,
      availableUsd: 1,
    });
  });
});

describe("out of credits", () => {
  it("says why, and that nothing else stopped", async () => {
    const wb = await workerDb();
    await expect(
      creditsPausedReason(wb.appPool, workspaceId),
    ).resolves.toBeNull();
    await spend(1);
    await expect(creditsPausedReason(wb.appPool, workspaceId)).resolves.toMatch(
      /AI is paused until the 1st.*Everything else keeps working/,
    );
  });

  it("is not paused with a key of its own", async () => {
    const wb = await workerDb();
    await spend(1);
    await wb.admin.query(
      `insert into ai_credentials (id, workspace_id, provider, ciphertext, data_key, key_id, key_hint)
       values ($1, $2, 'anthropic', 'x', 'x', 'x', 'x')`,
      [newId(), workspaceId],
    );
    await expect(
      creditsPausedReason(wb.appPool, workspaceId),
    ).resolves.toBeNull();
  });

  it("is told by the copilot, rather than that no provider is set up", async () => {
    const wb = await workerDb();
    await spend(1);
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human", userId: OWNER },
        },
        "copilot.availability",
        {},
      ),
    ).resolves.toMatchObject({
      available: false,
      providerConfigured: true,
      reason: expect.stringMatching(/AI is paused/),
    });
  });
});

describe("the plan screen's summary", () => {
  it("is in credits, rounded up, and says where they went", async () => {
    const wb = await workerDb();
    await spend(0.125);
    await spend(0.25, "deployment", "agent");
    await spend(0.5, "workspace");
    const summary = await readCreditSummary(wb.appPool, workspaceId);
    expect(summary).toMatchObject({ allowance: 100, used: 38, purchased: 0 });
    expect(
      Object.fromEntries(
        (summary?.bySource ?? []).map((row) => [row.source, row.credits]),
      ),
    ).toEqual({ agent: 25, assist: 13 });
  });

  it("is absent with no credits on the plan", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update tenants set plan_key = 'byo' where workspace_id = $1",
      [workspaceId],
    );
    await expect(
      readCreditSummary(wb.appPool, workspaceId),
    ).resolves.toBeNull();
  });
});

describe("the agents' share", () => {
  it("stops the agents at half the allowance and leaves the rest for people", async () => {
    await spend(0.5, "deployment", "agent");
    const state = await credits();
    expect(state.agentAvailableUsd).toBe(0);
    expect(state.availableUsd).toBeCloseTo(0.5);
  });

  it("counts only agents against it", async () => {
    await spend(0.5, "deployment", "copilot");
    await expect(credits()).resolves.toMatchObject({
      agentAvailableUsd: 0.5,
    });
  });

  it("follows the setting", async () => {
    await applySetup({ "cloud.agentCreditShare": 0.2 });
    await expect(credits()).resolves.toMatchObject({
      agentAvailableUsd: 0.2,
    });
  });
});

describe("routing on the provider's key", () => {
  it("gives a fresh workspace a model, once a deployment names a provider", async () => {
    const wb = await workerDb();
    await expect(
      resolveTierRoute(wb.appPool, { workspaceId, tier: "fast" }),
    ).resolves.toBeUndefined();

    await applySetup({ "ai.deployment.provider": "anthropic" });
    await expect(
      resolveTierRoute(wb.appPool, { workspaceId, tier: "fast" }),
    ).resolves.toMatchObject({
      provider: "anthropic",
      modelId: "claude-haiku-5-5",
      source: "deployment",
    });
  });

  it("lets a deployment send every tier to the model it chose", async () => {
    await applySetup({
      "ai.deployment.provider": "anthropic",
      "ai.deployment.tierModels": { balanced: "claude-haiku-5-5" },
    });
    const wb = await workerDb();
    await expect(
      resolveTierRoute(wb.appPool, { workspaceId, tier: "balanced" }),
    ).resolves.toMatchObject({ modelId: "claude-haiku-5-5" });
    await expect(
      resolveTierRoute(wb.appPool, { workspaceId, tier: "deep" }),
    ).resolves.toMatchObject({ modelId: "claude-opus-5-5" });
  });

  it("ignores a tier model the catalogue cannot price", async () => {
    await applySetup({
      "ai.deployment.provider": "anthropic",
      "ai.deployment.tierModels": { fast: "no-such-model" },
    });
    const wb = await workerDb();
    await expect(
      resolveTierRoute(wb.appPool, { workspaceId, tier: "fast" }),
    ).resolves.toMatchObject({ modelId: "claude-haiku-5-5" });
  });
});

describe("prices on the provider's key", () => {
  it("come from the catalogue, never from a workspace's own row", async () => {
    const wb = await workerDb();
    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
      },
      "ai.addCustomModel",
      {
        provider: "anthropic",
        modelId: "claude-sonnet-5-5",
        displayName: "Free, says me",
        contextWindow: 1000,
        costInPerMillion: 0,
        costOutPerMillion: 0,
        supportsTools: false,
        supportsVision: false,
        supportsJsonMode: false,
        supportsStreaming: false,
        embeddingDimensions: null,
        tiers: ["balanced"],
      },
    );
    await expect(
      resolveDeploymentRates(wb.appPool, "anthropic", "claude-sonnet-5-5"),
    ).resolves.toMatchObject({ costInPerMillion: 2, costOutPerMillion: 10 });
  });

  it("can be corrected without a release, because prices move", async () => {
    await applySetup({
      "ai.deployment.prices": {
        "claude-haiku-5-5": { costInPerMillion: 0.2, costOutPerMillion: 1 },
      },
    });
    const wb = await workerDb();
    await expect(
      resolveDeploymentRates(wb.appPool, "anthropic", "claude-haiku-5-5"),
    ).resolves.toMatchObject({ costInPerMillion: 0.2, costOutPerMillion: 1 });
  });
});
