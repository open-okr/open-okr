import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { guardContextWindow } from "../src/ai/context-guard.ts";
import { seededModelsForProvider } from "../src/ai/model-catalog.ts";
import {
  defaultPromptEvaluator,
  type PromptEvaluation,
  type PromptEvaluator,
} from "../src/ai/prompt-evaluation.ts";
import { currentPromptVersions } from "../src/ai/prompt-versions.ts";
import { defaultPromptFor, knownPromptKeys } from "../src/ai/prompts.ts";
import {
  resolveFeatureTier,
  resolveModelRates,
  resolveTierRoute,
} from "../src/ai/tier-routing.ts";
import { OperationError } from "../src/operations/errors.ts";
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

/**
 * An evaluator that answers whatever the test says (plan 0.7.0 A9).
 *
 * The real one runs the drafter, which core may not import; it is proved in
 * `packages/agents/test/evaluation.test.ts`, and against this action in
 * `packages/agents/test/prompt-gate.test.ts`. What this file proves is the
 * action's half: what it does with the answer.
 */
const answering =
  (answer: Omit<PromptEvaluation, "promptKey">): PromptEvaluator =>
  async (promptKey) => ({ promptKey, ...answer });

const PASSING = answering({
  known: true,
  fixtures: 2,
  passed: 2,
  failures: [],
});

/** The owner, with the set answered by `evaluatePrompt`. */
const gated = (pool: Pool, evaluatePrompt: PromptEvaluator = PASSING) => ({
  pool,
  ...context(OWNER),
  evaluatePrompt,
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

  it("refuses a model id with a space in it, or longer than any provider's", async () => {
    // guided-inputs §4.11: a pasted display name was stored as the id.
    const wb = await workerDb();
    const add = (modelId: string) =>
      callAction({ pool: wb.appPool, ...context(OWNER) }, "ai.addCustomModel", {
        provider: "ollama",
        modelId,
        displayName: "Typed by hand",
        contextWindow: 8192,
        costInPerMillion: 0,
        costOutPerMillion: 0,
        supportsTools: false,
        supportsVision: false,
        supportsJsonMode: false,
        supportsStreaming: false,
        embeddingDimensions: null,
        tiers: [],
      });
    await expect(add("My Fine Tune")).rejects.toThrow(/one word/);
    await expect(add("m".repeat(201))).rejects.toThrow();
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

    // Read back the way the host reads it. Only the seed was read before, so a
    // model an administrator added was unpriced, and an unpriced model is
    // refused: no OpenAI-compatible endpoint could ever answer.
    await expect(
      resolveModelRates(wb.appPool, {
        workspaceId,
        provider: "openai-compatible",
        modelId: "self-hosted-mixtral",
      }),
    ).resolves.toEqual({ costInPerMillion: 0.5, costOutPerMillion: 1.5 });
  });

  it("falls back to the seeded price, and to nothing for an unknown model", async () => {
    const wb = await workerDb();
    await expect(
      resolveModelRates(wb.appPool, {
        workspaceId,
        provider: "anthropic",
        modelId: "claude-sonnet-5-5",
      }),
    ).resolves.toMatchObject({ costInPerMillion: 2, costOutPerMillion: 10 });
    await expect(
      resolveModelRates(wb.appPool, {
        workspaceId,
        provider: "anthropic",
        modelId: "no-such-model",
      }),
    ).resolves.toBeUndefined();
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
    const v1 = await callAction(gated(wb.appPool), "ai.updatePrompt", {
      promptKey: "draft.objective",
      systemPrompt: "Version one text.",
    });
    expect(v1.version).toBe(1);
    expect(v1.isDefault).toBe(false);

    const v2 = await callAction(gated(wb.appPool), "ai.updatePrompt", {
      promptKey: "draft.objective",
      systemPrompt: "Version two text.",
    });
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

  it("knows only the prompts it ships a text for", () => {
    expect(knownPromptKeys()).toEqual([
      "draft.objective",
      "rewrite.failing_rule",
    ]);
    // An own key, not one every object inherits.
    expect(defaultPromptFor("constructor")).toBeUndefined();
  });
});

describe("the evaluation gate on a new version (plan 0.7.0 A9)", () => {
  it("refuses a version that fails its set, naming the check, and stores nothing", async () => {
    const wb = await workerDb();
    const failure = {
      fixture: "an ambition with a team",
      check: "personal-data",
      detail: "an email address is sent",
    };
    const refused = await callAction(
      gated(
        wb.appPool,
        answering({ known: true, fixtures: 3, passed: 2, failures: [failure] }),
      ),
      "ai.updatePrompt",
      {
        promptKey: "draft.objective",
        systemPrompt: "Write to priya@northwind.example for anything.",
      },
    ).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(OperationError);
    const error = refused as OperationError;
    expect(error.field).toBe("systemPrompt");
    expect(error.message).toBe(
      'Not saved. This version fails 1 of the 3 examples in its evaluation set: personal-data on "an ambition with a team" (an email address is sent).',
    );
    expect(error.details).toEqual({ failures: [failure] });

    const after = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.readPrompt",
      { promptKey: "draft.objective" },
    );
    expect(after.isDefault).toBe(true);
    expect(after.history).toEqual([]);
  });

  it("names three failures and counts the rest", async () => {
    const wb = await workerDb();
    const refused = await callAction(
      gated(
        wb.appPool,
        answering({
          known: true,
          fixtures: 5,
          passed: 0,
          failures: ["a", "b", "c", "d", "e"].map((fixture) => ({
            fixture,
            check: "budget",
            detail: "about 3,000 tokens, over 2,000",
          })),
        }),
      ),
      "ai.updatePrompt",
      { promptKey: "draft.objective", systemPrompt: "Long." },
    ).catch((error: unknown) => error);
    expect((refused as Error).message).toMatch(
      /^Not saved\. This version fails 5 of the 5 examples .*"c" \(about 3,000 tokens, over 2,000\); and 2 more\.$/,
    );
  });

  it("refuses a prompt key with no set, on the key", async () => {
    const wb = await workerDb();
    const refused = await callAction(
      gated(
        wb.appPool,
        answering({ known: false, fixtures: 0, passed: 0, failures: [] }),
      ),
      "ai.updatePrompt",
      { promptKey: "coach.rewrite", systemPrompt: "Anything." },
    ).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(OperationError);
    expect((refused as OperationError).field).toBe("promptKey");
    expect((refused as Error).message).toMatch(/no evaluation set/);
  });

  it("refuses every version when the host installed no evaluator", async () => {
    const wb = await workerDb();
    // Nothing in this suite installs one, so this is the host that forgot.
    expect(defaultPromptEvaluator()).toBeUndefined();
    const refused = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updatePrompt",
      { promptKey: "draft.objective", systemPrompt: "Unchecked." },
    ).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(OperationError);
    expect((refused as OperationError).field).toBe("systemPrompt");
    expect((refused as Error).message).toMatch(/cannot check a prompt/);

    const after = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.readPrompt",
      { promptKey: "draft.objective" },
    );
    expect(after.history).toEqual([]);
  });

  it("asks the evaluator about the key and the text that would be saved", async () => {
    const wb = await workerDb();
    const asked: [string, string][] = [];
    await callAction(
      gated(wb.appPool, async (promptKey, systemPrompt) => {
        asked.push([promptKey, systemPrompt]);
        return { promptKey, known: true, fixtures: 1, passed: 1, failures: [] };
      }),
      "ai.updatePrompt",
      { promptKey: "rewrite.failing_rule", systemPrompt: "  Trimmed.  " },
    );
    expect(asked).toEqual([["rewrite.failing_rule", "Trimmed."]]);
  });
});

describe("currentPromptVersions (plan 0.7.0 A9)", () => {
  it("is each editable prompt's newest version, and nothing after a restore", async () => {
    const wb = await workerDb();
    expect(await currentPromptVersions(wb.appPool, workspaceId)).toEqual({});

    for (const systemPrompt of ["First.", "Second."]) {
      await callAction(gated(wb.appPool), "ai.updatePrompt", {
        promptKey: "draft.objective",
        systemPrompt,
      });
    }
    await callAction(gated(wb.appPool), "ai.updatePrompt", {
      promptKey: "rewrite.failing_rule",
      systemPrompt: "Rewrite.",
    });
    // A key this release cannot send, as a version saved before the gate
    // left one: stored, and never handed to a drafter. The stand-in
    // evaluator knows every key, which is how it got past the save.
    await callAction(gated(wb.appPool), "ai.updatePrompt", {
      promptKey: "coach.rewrite",
      systemPrompt: "Old.",
    });

    expect(await currentPromptVersions(wb.appPool, workspaceId)).toEqual({
      "draft.objective": "Second.",
      "rewrite.failing_rule": "Rewrite.",
    });

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.restorePrompt",
      { promptKey: "draft.objective" },
    );
    expect(await currentPromptVersions(wb.appPool, workspaceId)).toEqual({
      "rewrite.failing_rule": "Rewrite.",
    });
  });
});
