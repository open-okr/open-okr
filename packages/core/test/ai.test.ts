import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { maskKeyHint } from "../src/ai/credentials.ts";
import { resolveAICredential } from "../src/ai/resolve.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import {
  type KeyRing,
  newRootKey,
  parseKeyRing,
} from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * AI provider configuration and credentials (P2-T14 test plan,
 * AI-NATIVE-PLAN.md §3.3).
 *
 * The precedence resolver picks a member's own key over the workspace's,
 * and the workspace's own over the deployment default; an admin reading the
 * provider configuration never sees a decrypted key, personal or
 * workspace-level; and rotation re-wraps every credential onto a new root
 * key while leaving each one still usable.
 */

const OWNER = "ai-owner";

let workspaceId: string;
let ring: KeyRing;

async function addMember(name: string): Promise<string> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'human', 'active')
     returning id`,
    [workspaceId, name],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("insert into workspace_members returned no row");
  }
  return row.id;
}

const context = (actorUserId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId: actorUserId },
  ring,
});

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "AI Owner", "ai-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "AI Owner",
  });
  workspaceId = provisioned.workspaceId;
  ring = parseKeyRing({ current: newRootKey() });
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("maskKeyHint", () => {
  it("keeps only the last four characters", () => {
    expect(maskKeyHint("sk-ant-abcdEFGH1234")).toBe("••••1234");
  });

  it("masks a short key entirely rather than revealing all of it", () => {
    expect(maskKeyHint("abc")).toBe("•••");
  });
});

describe("the precedence resolver: user, then workspace, then deployment, then off", () => {
  it("resolves off when nothing anywhere is configured", async () => {
    const wb = await workerDb();
    const resolved = await resolveAICredential(
      wb.appPool,
      ring,
      {},
      {
        workspaceId,
        provider: "anthropic",
      },
    );
    expect(resolved.source).toBe("off");
  });

  it("resolves an enabled local Ollama that has no key, which it never needs (H-27)", async () => {
    // Every lookup used to require a stored key, so the one provider the
    // product promises works air-gapped resolved to off and never ran.
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateProviderConfig",
      {
        provider: "ollama",
        enabled: true,
        baseUrl: "http://ollama.internal:11434/v1",
      },
    );

    const resolved = await resolveAICredential(
      wb.appPool,
      ring,
      {},
      { workspaceId, provider: "ollama" },
    );
    expect(resolved).toMatchObject({
      source: "workspace",
      provider: "ollama",
      apiKey: "",
      baseUrl: "http://ollama.internal:11434/v1",
    });
  });

  it("still resolves a keyed provider with no key to off", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateProviderConfig",
      { provider: "anthropic", enabled: true },
    );
    const resolved = await resolveAICredential(
      wb.appPool,
      ring,
      {},
      { workspaceId, provider: "anthropic" },
    );
    expect(resolved.source).toBe("off");
  });

  it("resolves the workspace's own key once enabled and set", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateProviderConfig",
      { provider: "anthropic", enabled: true },
    );
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.setWorkspaceCredential",
      { provider: "anthropic", apiKey: "sk-ant-workspace-key" },
    );

    const resolved = await resolveAICredential(
      wb.appPool,
      ring,
      {},
      {
        workspaceId,
        provider: "anthropic",
      },
    );
    expect(resolved).toMatchObject({
      source: "workspace",
      apiKey: "sk-ant-workspace-key",
    });
  });

  it("records a connection test on the workspace key (UAT BUG-026)", async () => {
    const wb = await workerDb();
    const call = (action: string, input: unknown) =>
      callAction(
        { pool: wb.appPool, ...context(OWNER) },
        action as never,
        input as never,
      );
    await call("ai.updateProviderConfig", {
      provider: "anthropic",
      enabled: true,
    });
    await call("ai.setWorkspaceCredential", {
      provider: "anthropic",
      apiKey: "sk-ant-workspace-key",
    });
    const status = async () =>
      (
        await wb.admin.query<{ status: string; verified: boolean }>(
          `select status, last_verified_at is not null as verified
             from ai_credentials where workspace_id = $1`,
          [workspaceId],
        )
      ).rows[0];
    expect(await status()).toEqual({ status: "unverified", verified: false });

    await call("ai.recordCredentialCheck", {
      provider: "anthropic",
      status: "verified",
    });
    expect(await status()).toEqual({ status: "verified", verified: true });

    await call("ai.recordCredentialCheck", {
      provider: "anthropic",
      status: "invalid",
    });
    expect(await status()).toEqual({ status: "invalid", verified: false });

    // Storing a new key starts it over.
    await call("ai.setWorkspaceCredential", {
      provider: "anthropic",
      apiKey: "sk-ant-another-key",
    });
    expect((await status())?.status).toBe("unverified");
  });

  it("prefers a member's own key over the workspace's, for that member only — the acceptance criterion itself", async () => {
    const wb = await workerDb();
    const member = await addMember("Member With Own Key");
    const otherMember = await addMember("Member Without Own Key");

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateProviderConfig",
      { provider: "anthropic", enabled: true, allowUserKeys: true },
    );
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.setWorkspaceCredential",
      { provider: "anthropic", apiKey: "sk-ant-workspace-key" },
    );
    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", memberId: member },
        ring,
      },
      "ai.setPersonalCredential",
      { provider: "anthropic", apiKey: "sk-ant-personal-key" },
    );

    const forOwnKeyHolder = await resolveAICredential(
      wb.appPool,
      ring,
      {},
      {
        workspaceId,
        provider: "anthropic",
        memberId: member,
      },
    );
    expect(forOwnKeyHolder).toMatchObject({
      source: "user",
      apiKey: "sk-ant-personal-key",
    });

    const forEveryoneElse = await resolveAICredential(
      wb.appPool,
      ring,
      {},
      {
        workspaceId,
        provider: "anthropic",
        memberId: otherMember,
      },
    );
    expect(forEveryoneElse).toMatchObject({
      source: "workspace",
      apiKey: "sk-ant-workspace-key",
    });
  });

  it("ignores a personal key when the provider does not allow one", async () => {
    const wb = await workerDb();
    const member = await addMember("Member");

    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateProviderConfig",
      { provider: "anthropic", enabled: true, allowUserKeys: false },
    );
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.setWorkspaceCredential",
      { provider: "anthropic", apiKey: "sk-ant-workspace-key" },
    );

    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human", memberId: member },
          ring,
        },
        "ai.setPersonalCredential",
        { provider: "anthropic", apiKey: "sk-ant-should-not-be-storable" },
      ),
    ).rejects.toThrow();
  });

  it("falls back to the deployment default only when it names the same provider", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "ai.deployment.provider", value: "openai" },
      { key: "ai.deployment.apiKey", secret: "sk-deployment-key" },
    ]);

    const wrongProvider = await resolveAICredential(
      wb.appPool,
      ring,
      {},
      {
        workspaceId,
        provider: "anthropic",
      },
    );
    expect(wrongProvider.source).toBe("off");

    const matchingProvider = await resolveAICredential(
      wb.appPool,
      ring,
      {},
      {
        workspaceId,
        provider: "openai",
      },
    );
    expect(matchingProvider).toMatchObject({
      source: "deployment",
      apiKey: "sk-deployment-key",
    });
  });
});

describe("an admin can never read a stored key, personal or workspace-level", () => {
  it("readProviderConfig returns only a masked hint for the workspace credential", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateProviderConfig",
      { provider: "anthropic", enabled: true },
    );
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.setWorkspaceCredential",
      { provider: "anthropic", apiKey: "sk-ant-workspace-key" },
    );

    const rows = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.readProviderConfig",
      {},
    );
    const anthropicRow = rows.find((row) => row.provider === "anthropic");
    expect(anthropicRow?.hasWorkspaceCredential).toBe(true);
    expect(anthropicRow?.workspaceKeyHint).toBe(
      maskKeyHint("sk-ant-workspace-key"),
    );
    expect(JSON.stringify(rows)).not.toContain("sk-ant-workspace-key");
  });

  it("readProviderConfig never surfaces a member's own personal key at all", async () => {
    const wb = await workerDb();
    const member = await addMember("Member");
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateProviderConfig",
      { provider: "anthropic", enabled: true, allowUserKeys: true },
    );
    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", memberId: member },
        ring,
      },
      "ai.setPersonalCredential",
      { provider: "anthropic", apiKey: "sk-ant-personal-only" },
    );

    const rows = await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.readProviderConfig",
      {},
    );
    expect(JSON.stringify(rows)).not.toContain("sk-ant-personal-only");
    expect(
      rows.find((row) => row.provider === "anthropic")?.hasWorkspaceCredential,
    ).toBe(false);
  });
});

/**
 * The availability boolean an ordinary member's screen asks for (P8-G05).
 *
 * The goal detail asked `ai.readProviderConfig` whether the draft assist could
 * offer anything. That action is declared `full`, correctly, because it carries
 * every provider's configuration and a masked key hint. An ordinary member
 * holds `edit` on the workspace, so the whole goal screen failed for anybody
 * who had not created the workspace, over a question whose answer is one bit.
 *
 * Every test here acts as a plain member rather than as the owner, which is the
 * thing no suite in this repository was doing when the defect shipped.
 */
describe("ai.readAvailability", () => {
  it("answers an ordinary member, where the admin read refuses them", async () => {
    const wb = await workerDb();
    const member = await addMember("Ordinary");
    const actor = {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, memberId: member },
      ring,
    };

    await expect(
      callAction(actor, "ai.readProviderConfig", {}),
    ).rejects.toMatchObject({ code: "not_found" });

    await expect(callAction(actor, "ai.readAvailability", {})).resolves.toEqual(
      { available: false },
    );
  });

  it("is true once a provider is enabled and the workspace holds a key", async () => {
    const wb = await workerDb();
    const member = await addMember("Ordinary2");
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateProviderConfig",
      { provider: "anthropic", enabled: true },
    );
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.setWorkspaceCredential",
      { provider: "anthropic", apiKey: "sk-ant-availability" },
    );

    const read = await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", memberId: member },
        ring,
      },
      "ai.readAvailability",
      {},
    );
    expect(read).toEqual({ available: true });
  });

  it("carries no provider, key, hint or status in its answer", async () => {
    // The whole reason this action may be `view`: there is nothing in the
    // response to leak. A future field would have to pass this assertion.
    const wb = await workerDb();
    const member = await addMember("Ordinary3");
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateProviderConfig",
      { provider: "anthropic", enabled: true },
    );
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.setWorkspaceCredential",
      { provider: "anthropic", apiKey: "sk-ant-nothing-leaks" },
    );

    const read = await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", memberId: member },
        ring,
      },
      "ai.readAvailability",
      {},
    );
    expect(Object.keys(read)).toEqual(["available"]);
    const serialised = JSON.stringify(read);
    expect(serialised).not.toContain("sk-ant-nothing-leaks");
    expect(serialised).not.toContain("anthropic");
  });

  it("counts a member's personal key for that member and nobody else", async () => {
    // A personal key is not the workspace having one, so it answers no for
    // everybody else. It is the key this member's own requests use, though
    // (completeness review M-36), so for them the assist does work, and this
    // said no to them until M-36.
    const wb = await workerDb();
    const member = await addMember("Ordinary4");
    const other = await addMember("Ordinary5");
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateProviderConfig",
      { provider: "anthropic", enabled: true, allowUserKeys: true },
    );
    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", memberId: member },
        ring,
      },
      "ai.setPersonalCredential",
      { provider: "anthropic", apiKey: "sk-ant-personal-availability" },
    );

    const readAs = (memberId: string) =>
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human", memberId },
          ring,
        },
        "ai.readAvailability",
        {},
      );
    expect(await readAs(member)).toEqual({ available: true });
    expect(await readAs(other)).toEqual({ available: false });
  });
});

describe("rotation", () => {
  it("re-wraps every credential onto a new current key, and each stays usable throughout", async () => {
    const wb = await workerDb();
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.updateProviderConfig",
      { provider: "anthropic", enabled: true },
    );
    await callAction(
      { pool: wb.appPool, ...context(OWNER) },
      "ai.setWorkspaceCredential",
      { provider: "anthropic", apiKey: "sk-ant-workspace-key" },
    );

    const rotated = parseKeyRing({
      current: newRootKey(),
      previous: [ring.current.key.toString("base64")],
    });

    const beforeRotation = await resolveAICredential(
      wb.appPool,
      rotated,
      {},
      {
        workspaceId,
        provider: "anthropic",
      },
    );
    expect(beforeRotation).toMatchObject({
      source: "workspace",
      apiKey: "sk-ant-workspace-key",
    });

    const outcome = await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        ring: rotated,
      },
      "ai.rotateCredentials",
      {},
    );
    expect(outcome).toEqual({ examined: 1, rewrapped: 1 });

    const afterRotation = await resolveAICredential(
      wb.appPool,
      rotated,
      {},
      {
        workspaceId,
        provider: "anthropic",
      },
    );
    expect(afterRotation).toMatchObject({
      source: "workspace",
      apiKey: "sk-ant-workspace-key",
    });

    // Running it again re-wraps nothing: every credential is already on the
    // current key.
    const secondPass = await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        ring: rotated,
      },
      "ai.rotateCredentials",
      {},
    );
    expect(secondPass).toEqual({ examined: 1, rewrapped: 0 });
  });
});
