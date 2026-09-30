import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The host builds every provider with the workspace's egress controls
 * (completeness review M-10).
 *
 * `createAIProvider` will not build a provider without them, which the
 * adapters suite proves. What is left to prove here is that the host hands
 * over the workspace's own controls rather than something permissive, that
 * what a control withheld is recorded against the right workspace, and that
 * a workspace whose controls let nothing through gets no drafter, exactly as
 * one with no provider gets none.
 */

const createAIProvider = vi.fn();
const resolveAIPrivacySettings = vi.fn();
const recordAIEgressWithheld = vi.fn();

vi.mock("@openokr/adapters", () => ({
  createAIProvider: (...args: unknown[]) => createAIProvider(...args),
}));
vi.mock("@openokr/config", () => ({
  loadEnv: () => ({ BETTER_AUTH_URL: "https://okr.example.com" }),
}));
vi.mock("@openokr/core", () => ({
  findSeededModel: () => ({ costInPerMillion: 3, costOutPerMillion: 15 }),
  isCloudEnabled: async () => false,
  resolveAICredential: async () => ({
    source: "workspace",
    provider: "anthropic",
    apiKey: "key",
    baseUrl: null,
  }),
  resolveTierRoute: async () => ({
    provider: "anthropic",
    modelId: "claude-sonnet-5",
  }),
  resolveAIPrivacySettings: (...args: unknown[]) =>
    resolveAIPrivacySettings(...args),
  recordAIEgressWithheld: (...args: unknown[]) =>
    recordAIEgressWithheld(...args),
  resolveAgentRunCostCap: async () => 2,
}));
vi.mock("@openokr/agents", () => ({
  createProviderDrafter: () => ({ drafted: true }),
}));
vi.mock("../lib/pool", () => ({ getPool: () => "the pool" }));
vi.mock("../lib/auth", () => ({ getPool: () => "the pool" }));
vi.mock("../lib/secrets", () => ({ getKeyRing: () => ({}) }));
vi.mock("../lib/instance-name", () => ({
  getInstanceName: async () => "OKR Goal",
}));

const { providerForTier } = await import("../lib/ai-provider");
const { drafterFor } = await import("../lib/drafter");

const POLICY = {
  contextEgress: "assists",
  redactPersonalData: true,
  noTraining: true,
  allowedHosts: ["api.anthropic.com"],
};

/** A guarded provider, as far as the host can see one. */
const guarded = (permitted: readonly string[]) => ({
  target: { host: "api.anthropic.com", local: false },
  permits: (purpose: string) => permitted.includes(purpose),
});

beforeEach(() => {
  createAIProvider.mockReset();
  resolveAIPrivacySettings.mockReset();
  recordAIEgressWithheld.mockReset();
  resolveAIPrivacySettings.mockResolvedValue(POLICY);
});

describe("providerForTier", () => {
  it("builds the provider with this workspace's own controls", async () => {
    createAIProvider.mockReturnValue(guarded(["assist", "retrieval"]));
    await providerForTier("workspace-1", "balanced");

    expect(resolveAIPrivacySettings).toHaveBeenCalledWith(
      "the pool",
      "workspace-1",
    );
    expect(createAIProvider).toHaveBeenCalledWith(
      { provider: "anthropic", apiKey: "key" },
      expect.objectContaining({ policy: POLICY }),
    );
  });

  it("records what a control withheld against the workspace that asked", async () => {
    createAIProvider.mockReturnValue(guarded(["assist"]));
    await providerForTier("workspace-1", "balanced");

    const [, egress] = createAIProvider.mock.calls[0] as [
      unknown,
      { onWithheld: (event: Record<string, unknown>) => Promise<void> },
    ];
    const event = {
      provider: "anthropic",
      host: "api.anthropic.com",
      purpose: "retrieval",
      outcome: "refused",
      reason: "context_withheld",
      emails: 0,
      phones: 0,
    };
    await egress.onWithheld(event);
    expect(recordAIEgressWithheld).toHaveBeenCalledWith("the pool", {
      workspaceId: "workspace-1",
      ...event,
    });
  });
});

describe("drafterFor", () => {
  it("is built when assists may reach the provider", async () => {
    createAIProvider.mockReturnValue(guarded(["assist"]));
    expect(await drafterFor("workspace-1")).toEqual({ drafted: true });
  });

  it("is absent when nothing may, as it is with AI off", async () => {
    createAIProvider.mockReturnValue(guarded([]));
    expect(await drafterFor("workspace-1")).toBeNull();
  });
});
