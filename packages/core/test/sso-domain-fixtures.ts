import { workerDb } from "@openokr/test-support/db";
import { encryptSecret, parseKeyRing } from "../src/secrets/key-ring.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Shared set-up for the single sign-on domain proof tests
 * (docs/design/sso-domain-verification.md).
 */

export const ring = parseKeyRing({
  current: "5UB2Ez1oQ0Rr8sT1n5x7yWl4qKcM9vHfJbGdApXeZi0=",
});

export const BASE = "https://okr.example";

/** A user and the workspace they own. Safe to call after a table truncate. */
export async function workspaceFor(
  userId: string,
  name: string,
): Promise<string> {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email, email_verified, created_at, updated_at) values ($1, $1, $2, true, now(), now()) on conflict (id) do nothing",
    [userId, `${userId}@owner.example`],
  );
  return (await provisionWorkspaceForUser(wb.appPool, { id: userId, name }))
    .workspaceId;
}

/** A context an owner's call carries, with a resolver when the test has one. */
export async function asOwner(
  userId: string,
  workspaceId: string,
  dns?: { resolveTxt(name: string): Promise<string[][]> },
) {
  return {
    pool: (await workerDb()).appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
    ring,
    baseUrl: BASE,
    ...(dns ? { dns } : {}),
  };
}

/** A domain already proved, written past the floor, as an earlier verify left it. */
export async function seedVerifiedDomain(
  workspaceId: string,
  domain: string,
  over: { verifiedBy?: string; failedChecks?: number; tokenHash?: string } = {},
): Promise<void> {
  const wb = await workerDb();
  await wb.admin.query(
    `insert into sso_domains
       (workspace_id, domain, token_hash, verified_at, verified_by,
        failed_checks)
     values ($1, $2, $3, now(), $4, $5)`,
    [
      workspaceId,
      domain,
      over.tokenHash ?? "00".repeat(32),
      over.verifiedBy ?? "dns",
      over.failedChecks ?? 0,
    ],
  );
}

/** An OIDC connection written past the floor, the way the enforcement tests do. */
export async function seedConnection(
  workspaceId: string,
  over: {
    providerId?: string;
    displayName?: string;
    emailDomains: string;
    enforce: boolean;
  },
): Promise<void> {
  const wb = await workerDb();
  const sealed = encryptSecret(ring, "a-client-secret");
  await wb.admin.query(
    `insert into sso_connections
       (workspace_id, provider_id, display_name, discovery_url, client_id,
        secret_ciphertext, secret_data_key, secret_key_id, enforce,
        email_domains)
     values ($1, $2, $3,
             'https://idp.example.com/.well-known/openid-configuration',
             'client-id', $4, $5, $6, $7, $8)`,
    [
      workspaceId,
      over.providerId ?? "okta",
      over.displayName ?? "Okta",
      sealed.ciphertext,
      sealed.dataKey,
      sealed.keyId,
      over.enforce,
      over.emailDomains,
    ],
  );
}

export async function domainRow(workspaceId: string, domain: string) {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select * from sso_domains where workspace_id = $1 and domain = $2 and deleted_at is null",
    [workspaceId, domain],
  );
  return rows[0] as
    | {
        id: string;
        token_hash: string;
        verified_at: Date | null;
        verified_by: string | null;
        failed_checks: number;
        last_checked_at: Date | null;
      }
    | undefined;
}

export async function auditActions(): Promise<string[]> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query(
    "select action from audit_events where action like 'sso.%' order by at, id",
  );
  return rows.map((row) => String(row.action));
}

/**
 * A resolver answering from a table. `packages/core` does not depend on
 * `packages/adapters`, so this is the same shape written here rather than
 * `FakeDnsResolver` imported.
 */
export class FakeDns {
  private readonly records = new Map<string, string[][]>();
  private failing = false;

  publish(name: string, ...chunks: string[]): this {
    const key = name.toLowerCase();
    this.records.set(key, [...(this.records.get(key) ?? []), chunks]);
    return this;
  }

  remove(name: string): this {
    this.records.delete(name.toLowerCase());
    return this;
  }

  fail(failing = true): this {
    this.failing = failing;
    return this;
  }

  async resolveTxt(name: string): Promise<string[][]> {
    if (this.failing) {
      throw new Error("The resolver did not answer.");
    }
    return this.records.get(name.toLowerCase()) ?? [];
  }
}
