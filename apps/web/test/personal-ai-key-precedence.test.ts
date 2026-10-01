import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MockAIProvider } from "@openokr/adapters";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A member's own key answers that member's assists, and nobody else's
 * requests (completeness review M-36, P2-T14's acceptance).
 *
 * `resolveAICredential` has picked the user key over the workspace key since
 * P2-T14, and `packages/core/test/ai-personal-key.test.ts` proves that against
 * a database. The host never told it who was asking: `providerForTier` took a
 * workspace and a tier, so every request resolved as the workspace's and a
 * member's stored key was never used for anything. What is proved here is the
 * host's half, on the deterministic mock driver:
 *
 * - an assist a member runs builds its provider on that member's key, and the
 *   model call goes to that provider;
 * - the same assist for a colleague, and any drafter built for nobody (the
 *   scheduler, an agent run), builds on the workspace's key;
 * - the personal key is wrapped in the workspace's egress controls exactly as
 *   the workspace's is (M-10);
 * - no agent path passes a reader, read from the source, because a future
 *   caller that did would put the Coach on somebody's personal account.
 */

const SIGNED_IN = { current: "member-user" };

const POLICY = {
  contextEgress: "assists",
  redactPersonalData: true,
  noTraining: false,
  allowedHosts: [],
};

/** What the database holds: a workspace key, and one member's own. */
const PERSONAL_KEY = "sk-ant-member-own-7Q4z";
const WORKSPACE_KEY = "sk-ant-workspace-9Xy2";

const resolveAICredential = vi.fn(
  async (
    _pool: unknown,
    _ring: unknown,
    _env: unknown,
    input: { readonly userId?: string },
  ) => ({
    source: input.userId === "member-user" ? "user" : "workspace",
    provider: "anthropic",
    apiKey: input.userId === "member-user" ? PERSONAL_KEY : WORKSPACE_KEY,
    baseUrl: null,
  }),
);

/** Every provider the host built, by the key it was built with. */
const built: { apiKey: string; mock: MockAIProvider; egress: unknown }[] = [];
const createAIProvider = vi.fn(
  (config: { readonly apiKey: string }, egress: unknown) => {
    const mock = new MockAIProvider({
      chatResponse: {
        content: JSON.stringify({ rewritten: "Lift active teams to 60" }),
        usage: { inputTokens: 10, outputTokens: 10 },
      },
    });
    built.push({ apiKey: config.apiKey, mock, egress });
    // Guarded as far as the host can see: every purpose allowed.
    return Object.assign(mock, {
      target: { host: "api.anthropic.com", local: false },
      permits: () => true,
    });
  },
);

vi.mock("@openokr/adapters", async (original) => ({
  ...(await original<typeof import("@openokr/adapters")>()),
  createAIProvider: (...args: Parameters<typeof createAIProvider>) =>
    createAIProvider(...args),
}));
vi.mock("@openokr/config", async (original) => ({
  ...(await original<typeof import("@openokr/config")>()),
  loadEnv: () => ({ BETTER_AUTH_URL: "https://okr.example.com" }),
}));
vi.mock("@openokr/core", async (original) => ({
  ...(await original<typeof import("@openokr/core")>()),
  findSeededModel: () => ({ costInPerMillion: 3, costOutPerMillion: 15 }),
  isCloudEnabled: async () => false,
  resolveAICredential: (...args: Parameters<typeof resolveAICredential>) =>
    resolveAICredential(...args),
  resolveTierRoute: async () => ({
    provider: "anthropic",
    modelId: "claude-sonnet-5",
  }),
  resolveAIPrivacySettings: async () => POLICY,
  recordAIEgressWithheld: async () => undefined,
  resolveAgentRunCostCap: async () => 2,
  checkFeatureAvailability: async () => ({ available: true }),
}));
vi.mock("../lib/pool", () => ({ getPool: () => "the pool" }));
vi.mock("../lib/auth", () => ({ getPool: () => "the pool" }));
vi.mock("../lib/secrets", () => ({ getKeyRing: () => ({}) }));
vi.mock("../lib/instance-name", () => ({
  getInstanceName: async () => "OKR Goal",
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: SIGNED_IN.current } },
    workspace: { workspaceId: "workspace-1", memberId: "member-1" },
  }),
}));

const { assistContext, assistOffered } = await import("../lib/assists");
const { drafterFor } = await import("../lib/drafter");

/** A rewrite, the assist P2-T14's acceptance has in mind, run as the reader. */
async function runAssistAs(userId: string) {
  SIGNED_IN.current = userId;
  const context = await assistContext();
  if (!("drafter" in context) || !context.drafter?.rewriteForRule) {
    throw new Error("no drafter was built for the reader");
  }
  return context.drafter.rewriteForRule({
    text: "Improve engagement",
    ruleId: "KR-1",
    rulePrompt: "Is this a number somebody can read?",
    goalTitle: "Grow retention",
  });
}

beforeEach(() => {
  built.length = 0;
  resolveAICredential.mockClear();
  createAIProvider.mockClear();
});

describe("a member's assist", () => {
  it("runs on their own key when they stored one", async () => {
    const answer = await runAssistAs("member-user");

    expect(answer).toBe("Lift active teams to 60");
    expect(resolveAICredential).toHaveBeenCalledWith(
      "the pool",
      {},
      expect.anything(),
      {
        workspaceId: "workspace-1",
        provider: "anthropic",
        userId: "member-user",
      },
    );
    expect(built.map((one) => one.apiKey)).toEqual([PERSONAL_KEY]);
    // And the model call went to the provider holding that key.
    expect(built[0]?.mock.calls.map((call) => call.method)).toEqual([
      "extract",
    ]);
  });

  it("runs on the workspace's key for a colleague who stored none", async () => {
    await runAssistAs("colleague-user");
    expect(built.map((one) => one.apiKey)).toEqual([WORKSPACE_KEY]);
    expect(built[0]?.mock.calls).toHaveLength(1);
  });

  it("wraps the personal key in the workspace's egress controls", async () => {
    await runAssistAs("member-user");
    expect(built[0]?.egress).toMatchObject({ policy: POLICY });
  });

  it("is offered by asking about the reader, not the workspace", async () => {
    await assistOffered(
      "workspace-1",
      "assists.narrateTrend",
      "balanced",
      "member-user",
    );
    expect(resolveAICredential).toHaveBeenCalledWith(
      "the pool",
      {},
      expect.anything(),
      expect.objectContaining({ userId: "member-user" }),
    );
  });
});

describe("a request nobody signed in made", () => {
  it("never reaches a personal key", async () => {
    // The scheduler, an agent step and the administrator's "run it now" all
    // build their drafter this way.
    const drafter = await drafterFor("workspace-1");
    expect(drafter).not.toBeNull();
    const [, , , input] = resolveAICredential.mock.calls[0] ?? [];
    expect(input).toEqual({
      workspaceId: "workspace-1",
      provider: "anthropic",
    });
    expect(built.map((one) => one.apiKey)).toEqual([WORKSPACE_KEY]);
  });
});

describe("the agent paths", () => {
  const source = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  it.each([
    ["the scheduler", "../lib/scheduler.ts"],
    ["the administrator's run controls", "../app/admin/agents/actions.ts"],
  ])(
    "pass no reader from %s, so the Coach and the Champion stay on the workspace's key",
    (_name, path) => {
      const calls = source(path).match(/drafterFor\([^)]*\)/g) ?? [];
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call, `${path}: ${call}`).not.toMatch(/,/);
      }
    },
  );

  it("builds an agent step's model with no reader", () => {
    expect(source("../lib/relay.ts")).toContain(
      "modelFor: (id, tier) => providerForTier(id, tier)",
    );
  });
});
