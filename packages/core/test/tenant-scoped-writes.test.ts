import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveAgentRunCostCap } from "../src/ai/resolve.ts";
import { createSSOConnection } from "../src/auth/sso.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Two reads and a write that ran on a connection with no tenant setting
 * (implementation audit, 18 September 2026).
 *
 * **The class, stated once because it has now happened seven times.** A table
 * behind the tenant floor is read or written on a bare pool. The application
 * role is `nosuperuser nobypassrls`, so Postgres answers a read with no rows
 * and refuses a write. Nothing throws on the read path, a sensible-looking
 * fallback takes over, and the feature is inert while every gate stays green.
 * No rows is also exactly what a correct tenant floor looks like from above,
 * which is why nobody can tell the two apart by looking.
 *
 * Both tests below fail against the code as it was:
 *
 * - `createSSOConnection` used `current_setting('app.workspace_id')` on a bare
 *   pool, which raises rather than returning null, so **no OIDC provider could
 *   be configured on any instance**. Everything P8-T07a, P8-T07b and P8-T07c-a
 *   built is downstream of a provider existing.
 * - `resolveAgentRunCostCap` was a query in `apps/web/lib/drafter.ts` on a bare
 *   pool, so the per-workspace spend cap was never read and every workspace ran
 *   on the hardcoded default whatever an administrator set.
 */

const OWNER = "tenant-scope-owner";
const SECOND = "tenant-scope-other";

let workspaceId: string;
let otherWorkspaceId: string;

const ring = () => parseKeyRing({ current: newRootKey() });

beforeAll(async () => {
  const wb = await workerDb();
  for (const [id, email] of [
    [OWNER, "tenant-scope-owner@example.com"],
    [SECOND, "tenant-scope-other@example.com"],
  ]) {
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $2, $3) on conflict (id) do nothing",
      [id, "Scope", email],
    );
  }
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Scope one",
    })
  ).workspaceId;
  otherWorkspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: SECOND,
      name: "Scope two",
    })
  ).workspaceId;
}, 60_000);

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("configuring an OIDC provider", () => {
  it("writes the connection, which no route could do before", async () => {
    const wb = await workerDb();

    const created = await createSSOConnection(wb.appPool, workspaceId, ring(), {
      providerId: "okta",
      displayName: "Okta",
      clientId: "client-id",
      clientSecret: "the-secret",
      discoveryUrl: "https://idp.example/.well-known/openid-configuration",
      emailDomains: "acme.example",
    });

    expect(created.id).toBeTruthy();

    const { rows } = await wb.admin.query(
      "select workspace_id, provider_id, secret_ciphertext from sso_connections where id = $1",
      [created.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workspace_id).toBe(workspaceId);
    // Sealed, not stored. The route used to seal it and then fail to write it.
    expect(rows[0]?.secret_ciphertext).not.toContain("the-secret");
  });

  it("lands in the workspace it was told, not the one the connection guessed", async () => {
    const wb = await workerDb();

    await createSSOConnection(wb.appPool, otherWorkspaceId, ring(), {
      providerId: "entra",
      displayName: "Entra",
      clientId: "client-id",
      clientSecret: "another-secret",
    });

    const { rows } = await wb.admin.query(
      "select workspace_id from sso_connections where provider_id = 'entra'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workspace_id).toBe(otherWorkspaceId);
  });
});

describe("the per-workspace spend cap", () => {
  it("reads what an administrator stored, rather than the default", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspaces set settings = jsonb_set(settings, '{agentRunCostCapUsd}', '25') where id = $1",
      [workspaceId],
    );

    // The whole finding in one line: this returned 2 before, on every
    // instance, for every workspace.
    expect(await resolveAgentRunCostCap(wb.appPool, workspaceId)).toBe(25);
  });

  it("treats zero as a real answer rather than as absent", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspaces set settings = jsonb_set(settings, '{agentRunCostCapUsd}', '0') where id = $1",
      [otherWorkspaceId],
    );

    // Zero means the agent may not spend. A falsy check would read it as unset
    // and hand back the default, which is the opposite instruction.
    expect(await resolveAgentRunCostCap(wb.appPool, otherWorkspaceId)).toBe(0);
  });

  it("falls back only when nothing is stored", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspaces set settings = settings - 'agentRunCostCapUsd' where id = $1",
      [workspaceId],
    );

    expect(await resolveAgentRunCostCap(wb.appPool, workspaceId)).toBe(2);
  });

  it("reads the workspace it was asked about and no other", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspaces set settings = jsonb_set(settings, '{agentRunCostCapUsd}', '9') where id = $1",
      [otherWorkspaceId],
    );
    await wb.admin.query(
      "update workspaces set settings = jsonb_set(settings, '{agentRunCostCapUsd}', '3') where id = $1",
      [workspaceId],
    );

    expect(await resolveAgentRunCostCap(wb.appPool, workspaceId)).toBe(3);
    expect(await resolveAgentRunCostCap(wb.appPool, otherWorkspaceId)).toBe(9);
  });
});
