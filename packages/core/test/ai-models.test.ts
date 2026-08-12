import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { guardContextWindow } from "../src/ai/context-guard.ts";
import { seededModelsForProvider } from "../src/ai/model-catalog.ts";
import { defaultPromptFor } from "../src/ai/prompts.ts";
import {
  resolveFeatureTier,
  resolveTierRoute,
} from "../src/ai/tier-routing.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Model catalogue, tier routing, feature settings and the prompt registry
 * (P2-T15 test plan, AI-NATIVE-PLAN.md §3.4, §4).
 */

const OWNER = "ai-models-owner";

let workspaceId: string;

const context = (actorUserId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId: actorUserId },
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "AI Models Owner", "ai-models-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "AI Models Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("guardContextWindow", () => {
  it("blocks an oversized request before any call is made", () => {
    const result = guardContextWindow({
      estimatedTokens: 190_000,
      contextWindow: 200_000,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/context window/);
  });

  it("allows a request that leaves room for the reply", () => {
    const result = guardContextWindow({
      estimatedTokens: 1_000,
      contextWindow: 200_000,
    });
    expect(result.allowed).toBe(true);
  });
});

describe("the seeded model catalogue", () => {
  it("has at least one model per tier for anthropic, save embed which anthropic ships none of", () => {
    const models = seededModelsForProvider("anthropic");
    expect(models.some((m) => m.tiers.includes("fast"))).toBe(true);
    expect(models.some((m) => m.tiers.includes("balanced"))).toBe(true);
    expect(models.some((m) => m.tiers.includes("deep"))).toBe(true);
    expect(models.some((m) => m.tiers.includes("embed"))).toBe(false);
  });
});

describe("readModelCatalog combines the seeded list with custom entries", () => {
  it("returns every seeded model, plus a custom one once added", async () => {
    const wb = await workerDb();
    const before = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.readModelCatalog",
      {},
    );
    const seededCount = before.filter((m) => m.source === "seeded").length;
    expect(seededCount).toBeGreaterThan(0);
    expect(before.some((m) => m.source === "custom")).toBe(false);

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.addCustomModel",
      {
        provider: "ollama",
        modelId: "my-fine-tune:latest",
        displayName: "My Fine-Tune",
        contextWindow: 32_000,
        costInPerMillion: 0,
        costOutPerMillion: 0,
        supportsTools: false,
        supportsVision: false,
        supportsJsonMode: false,
        supportsStreaming: true,
        embeddingDimensions: null,
        tiers: ["balanced"],
      },
    );

    const after = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.readModelCatalog",
      {},
    );
    expect(after.filter((m) => m.source === "seeded")).toHaveLength(
      seededCount,
    );
    const custom = after.find((m) => m.source === "custom");
    expect(custom).toMatchObject({
      provider: "ollama",
      modelId: "my-fine-tune:latest",
    });
  });

  it("a custom model still meters cost from its own figures", async () => {
    const wb = await workerDb();
    const added = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.addCustomModel",
      {
        provider: "openai-compatible",
        modelId: "self-hosted-mixtral",
        displayName: "Self-hosted Mixtral",
        contextWindow: 32_000,
        costInPerMillion: 0.5,
        costOutPerMillion: 1.5,
        supportsTools: false,
        supportsVision: false,
        supportsJsonMode: false,
        supportsStreaming: true,
        embeddingDimensions: null,
        tiers: ["balanced"],
      },
    );
    expect(added.costInPerMillion).toBe(0.5);
    expect(added.costOutPerMillion).toBe(1.5);
  });
});

describe("tier routing", () => {
  it("resolves through the driver's seeded map once a workspace has supplied only a key", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateProviderConfig",
      { provider: "anthropic", enabled: true },
    );

    const route = await resolveTierRoute(wb.appPool, {
      workspaceId,
      tier: "fast",
    });
    expect(route?.source).toBe("seeded-default");
    expect(route?.provider).toBe("anthropic");
  });

  it("an explicit policy overrides the seeded default", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateProviderConfig",
      { provider: "anthropic", enabled: true },
    );
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.setTierPolicy",
      { tier: "fast", provider: "openai", modelId: "gpt-5-mini" },
    );

    const route = await resolveTierRoute(wb.appPool, {
      workspaceId,
      tier: "fast",
    });
    expect(route).toMatchObject({
      source: "policy",
      provider: "openai",
      modelId: "gpt-5-mini",
    });

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.removeTierPolicy",
      { tier: "fast" },
    );
    const reverted = await resolveTierRoute(wb.appPool, {
      workspaceId,
      tier: "fast",
    });
    expect(reverted?.source).toBe("seeded-default");
  });

  it("leaves an unconfigured tier unresolved when nothing is enabled", async () => {
    const wb = await workerDb();
    const route = await resolveTierRoute(wb.appPool, {
      workspaceId,
      tier: "fast",
    });
    expect(route).toBeUndefined();
  });
});

describe("per-feature tier override", () => {
  it("routes only the overridden feature to its new tier, every other feature unaffected", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateFeatureSetting",
      { featureKey: "draft.objective", tierOverride: "deep" },
    );

    const overridden = await resolveFeatureTier(wb.appPool, {
      workspaceId,
      featureKey: "draft.objective",
      defaultTier: "balanced",
    });
    expect(overridden).toEqual({ enabled: true, tier: "deep" });

    const unaffected = await resolveFeatureTier(wb.appPool, {
      workspaceId,
      featureKey: "rewrite.failing_rule",
      defaultTier: "balanced",
    });
    expect(unaffected).toEqual({ enabled: true, tier: "balanced" });
  });

  it("a disabled feature reports disabled regardless of tier", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateFeatureSetting",
      { featureKey: "draft.objective", enabled: false },
    );

    const resolved = await resolveFeatureTier(wb.appPool, {
      workspaceId,
      featureKey: "draft.objective",
      defaultTier: "balanced",
    });
    expect(resolved.enabled).toBe(false);
  });
});

describe("the prompt registry", () => {
  it("serves the built-in default until a workspace saves its own version", async () => {
    const wb = await workerDb();
    const before = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.readPrompt",
      { promptKey: "draft.objective" },
    );
    expect(before.isDefault).toBe(true);
    expect(before.systemPrompt).toBe(defaultPromptFor("draft.objective"));
    expect(before.version).toBe(0);
  });

  it("records a change as a new version and can revert it", async () => {
    const wb = await workerDb();
    const v1 = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updatePrompt",
      { promptKey: "draft.objective", systemPrompt: "Version one text." },
    );
    expect(v1.version).toBe(1);
    expect(v1.isDefault).toBe(false);

    const v2 = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updatePrompt",
      { promptKey: "draft.objective", systemPrompt: "Version two text." },
    );
    expect(v2.version).toBe(2);
    expect(v2.history.map((h) => h.version)).toEqual([2, 1]);

    // Reversible: the old text is still there, not overwritten in place.
    expect(v2.history.find((h) => h.version === 1)?.systemPrompt).toBe(
      "Version one text.",
    );

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.restorePrompt",
      { promptKey: "draft.objective" },
    );
    const restored = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.readPrompt",
      { promptKey: "draft.objective" },
    );
    expect(restored.isDefault).toBe(true);
    expect(restored.systemPrompt).toBe(defaultPromptFor("draft.objective"));
  });
});
