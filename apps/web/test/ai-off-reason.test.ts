import { beforeEach, describe, expect, it, vi } from "vitest";

// Plan 0.8.0 O1: the provider chain names the step that stopped it, so the
// copilot can say "your plan includes no AI credits" rather than "no provider
// is configured" to a cloud workspace whose provider's key works for others.

const core = vi.hoisted(() => ({
  resolveTierRoute: vi.fn(),
  resolveAICredential: vi.fn(),
  readHostedAccess: vi.fn(),
  resolveDeploymentRates: vi.fn(),
  resolveModelRates: vi.fn(),
  guardsAIEndpoints: vi.fn(async () => false),
  resolveAIPrivacySettings: vi.fn(async () => ({})),
  recordAIEgressWithheld: vi.fn(),
  callRecorder: vi.fn(() => vi.fn()),
}));

vi.mock("@openokr/core", () => core);
vi.mock("@openokr/adapters", () => ({
  createAIProvider: vi.fn(() => ({ permits: () => true })),
}));
vi.mock("@openokr/config", () => ({
  loadEnv: () => ({ BETTER_AUTH_URL: "https://okr.example" }),
}));
vi.mock("../lib/pool", () => ({ getPool: vi.fn(() => ({})) }));
vi.mock("../lib/secrets", () => ({ getKeyRing: vi.fn() }));
vi.mock("../lib/instance-name", () => ({
  getInstanceName: vi.fn(async () => "OKRGoal"),
}));

const { resolveProviderForTier } = await import("../lib/ai-provider");

const ROUTE = {
  provider: "openrouter",
  modelId: "anthropic/claude-sonnet-4.5",
};
const RATES = { costInPerMillion: 3, costOutPerMillion: 15 };

describe("resolveProviderForTier names the step that stopped it", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    core.resolveTierRoute.mockResolvedValue(ROUTE);
    core.resolveAICredential.mockResolvedValue({
      source: "deployment",
      provider: "openrouter",
      apiKey: "sk-or-test",
      baseUrl: null,
    });
    core.readHostedAccess.mockResolvedValue({ kind: "unmetered" });
    core.resolveDeploymentRates.mockResolvedValue(RATES);
    core.resolveModelRates.mockResolvedValue(RATES);
  });

  it("is no provider when nothing routes the tier", async () => {
    core.resolveTierRoute.mockResolvedValue(undefined);
    expect(await resolveProviderForTier("w", "balanced")).toEqual({
      off: "no_provider",
    });
  });

  it("is no provider when no key answers the routed provider", async () => {
    core.resolveAICredential.mockResolvedValue({ source: "off" });
    expect(await resolveProviderForTier("w", "balanced")).toEqual({
      off: "no_provider",
    });
  });

  it("is the plan when the provider's key works but the plan has no credits", async () => {
    core.readHostedAccess.mockResolvedValue({ kind: "none" });
    expect(await resolveProviderForTier("w", "balanced", "user")).toEqual({
      off: "plan_without_credits",
    });
  });

  it("is spent credits when nothing is left this month", async () => {
    core.readHostedAccess.mockResolvedValue({
      kind: "credits",
      availableUsd: 0,
      agentAvailableUsd: 0,
    });
    expect(await resolveProviderForTier("w", "balanced", "user")).toEqual({
      off: "credits_used",
    });
  });

  it("is the price when the routed model has none", async () => {
    core.resolveDeploymentRates.mockResolvedValue(undefined);
    expect(await resolveProviderForTier("w", "balanced")).toEqual({
      off: "model_unpriced",
    });
  });

  it("never asks the plan about a workspace's own key", async () => {
    core.resolveAICredential.mockResolvedValue({
      source: "workspace",
      provider: "openrouter",
      apiKey: "sk-or-own",
      baseUrl: null,
    });
    core.readHostedAccess.mockResolvedValue({ kind: "none" });
    const outcome = await resolveProviderForTier("w", "balanced", "user");
    expect("routed" in outcome).toBe(true);
    expect(core.readHostedAccess).not.toHaveBeenCalled();
  });

  it("builds the provider when every step passes", async () => {
    const outcome = await resolveProviderForTier("w", "balanced", "user");
    expect("routed" in outcome && outcome.routed.modelId).toBe(ROUTE.modelId);
  });
});
