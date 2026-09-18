/**
 * SSO connection loading and genericOAuth configuration (P8-T07).
 *
 * Reads `sso_connections` from the database, decrypts client secrets, and
 * returns a configuration array for Better Auth's `genericOAuth` plugin.
 *
 * Connections are loaded at boot and cached. A change takes effect on the
 * next restart. This is a documented limitation: rebuilding the auth
 * instance on every sign-in would put a database read and a decryption on
 * the hot path of every request.
 */
import { withSSOLookup } from "@openokr/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  decryptSecret,
  type KeyRing,
  type SealedSecret,
} from "../secrets/key-ring.ts";

/** The shape the sign-in page needs to show SSO buttons. No secrets. */
export interface SSOProviderInfo {
  readonly id: string;
  readonly displayName: string;
  readonly workspaceId: string;
  readonly emailDomains: string;
  readonly enforce: boolean;
}

/** The full configuration for a provider, whichever protocol it speaks. */
export interface SSOProviderConfig {
  /**
   * Which protocol (P8-T07c-a).
   *
   * `oidc` goes to `genericOAuth`, `saml` to `@better-auth/sso`. Defaults to
   * `oidc` on any row written before the column existed, which is every row
   * written before 18 September 2026.
   */
  readonly kind: "oidc" | "saml";
  /** The row's own id, which is what the SAML plugin is registered under. */
  readonly id: string;
  readonly providerId: string;
  readonly displayName: string;
  readonly workspaceId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly discoveryUrl?: string;
  readonly authorizationUrl?: string;
  readonly tokenUrl?: string;
  readonly userInfoUrl?: string;
  readonly scopes: string[];
  readonly emailDomains: string[];
  readonly enforce: boolean;
  /** Where the browser is sent to authenticate. SAML only. */
  readonly samlEntryPoint?: string;
  /** The provider's entity id, which it signs its assertions as. */
  readonly samlIssuer?: string;
  /** The provider's signing certificate. A public key, so never sealed. */
  readonly samlCertificate?: string;
  /** What this instance calls itself to the provider. */
  readonly samlAudience?: string;
  readonly samlWantAssertionsSigned?: boolean;
}

/**
 * The provider id out of an OAuth callback, or "" (P8-T07b).
 *
 * Better Auth completes every social and genericOAuth sign-in at
 * `/callback/:id`, so the id is either in the route parameters or is the last
 * segment of the path. Both are read, because a hook receiving a context it
 * did not construct should not depend on which one is populated.
 *
 * Anything that is not a callback answers "", which matches no provider. A
 * pure function, so the parsing is tested without an identity provider.
 */
export function providerIdFromCallback(
  path: string | undefined,
  params: unknown,
): string {
  if (path === undefined || !path.startsWith("/callback/")) {
    return "";
  }
  const fromParams = (params as { id?: unknown } | undefined)?.id;
  if (typeof fromParams === "string" && fromParams !== "") {
    return fromParams;
  }
  return path.slice("/callback/".length).split("/")[0] ?? "";
}

type SSORow = {
  id: string;
  kind: string;
  workspace_id: string;
  provider_id: string;
  display_name: string;
  discovery_url: string | null;
  authorization_url: string | null;
  token_url: string | null;
  user_info_url: string | null;
  client_id: string;
  secret_ciphertext: string;
  secret_data_key: string;
  secret_key_id: string;
  scopes: string;
  enforce: boolean;
  email_domains: string;
  saml_entry_point: string | null;
  saml_issuer: string | null;
  saml_certificate: string | null;
  saml_audience: string | null;
  saml_want_assertions_signed: boolean;
};

/**
 * Loads all enabled SSO connections from the database and decrypts their
 * client secrets.
 *
 * Called once at boot. The result configures Better Auth's genericOAuth
 * plugin for the lifetime of the process.
 */
export async function loadSSOConnections(
  pool: Pool,
  ring: KeyRing,
): Promise<readonly SSOProviderConfig[]> {
  // **Through `app.sso_lookup`, because the tenant floor applies here too**
  // (P8-T07a). The boot process has no workspace context and needs every
  // provider on the instance, and the application role is `nobypassrls` on a
  // table with `force row level security`. The first version of this read ran
  // unscoped and returned nothing on every correctly provisioned deployment,
  // so no provider was ever configured. Migration 0094 is the policy this
  // opens; it is `for select` on this one table.
  let rows: SSORow[];
  try {
    const result = await withSSOLookup(drizzle(pool), (tx) =>
      tx.execute<SSORow>(sql`
        select id, kind, workspace_id, provider_id, display_name,
               discovery_url, authorization_url, token_url, user_info_url,
               client_id, secret_ciphertext, secret_data_key, secret_key_id,
               scopes, enforce, email_domains,
               saml_entry_point, saml_issuer, saml_certificate,
               saml_audience, saml_want_assertions_signed
          from sso_connections
         where enabled = true
           and deleted_at is null
         order by created_at`),
    );
    rows = result.rows;
  } catch (error) {
    // Graceful degradation: if the table does not exist yet (migration
    // 0091 not applied), return no providers rather than crashing the
    // boot sequence. The instance works without SSO.
    if (error instanceof Error && error.message.includes("sso_connections")) {
      return [];
    }
    throw error;
  }

  return rows.map((row) => {
    const sealed: SealedSecret = {
      ciphertext: row.secret_ciphertext,
      dataKey: row.secret_data_key,
      keyId: row.secret_key_id,
    };
    return {
      // `oidc` on anything written before the column existed, which is what
      // the default in migration 0096 already guarantees. Read defensively
      // anyway: a row from a database at an older migration answers the same.
      kind: row.kind === "saml" ? ("saml" as const) : ("oidc" as const),
      id: row.id,
      providerId: `sso-${row.provider_id}-${row.workspace_id.slice(0, 8)}`,
      displayName: row.display_name,
      workspaceId: row.workspace_id,
      clientId: row.client_id,
      clientSecret: decryptSecret(ring, sealed),
      discoveryUrl: row.discovery_url ?? undefined,
      authorizationUrl: row.authorization_url ?? undefined,
      tokenUrl: row.token_url ?? undefined,
      userInfoUrl: row.user_info_url ?? undefined,
      scopes: row.scopes.split(" ").filter(Boolean),
      emailDomains: row.email_domains
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
      enforce: row.enforce,
      ...(row.saml_entry_point ? { samlEntryPoint: row.saml_entry_point } : {}),
      ...(row.saml_issuer ? { samlIssuer: row.saml_issuer } : {}),
      ...(row.saml_certificate
        ? { samlCertificate: row.saml_certificate }
        : {}),
      ...(row.saml_audience ? { samlAudience: row.saml_audience } : {}),
      samlWantAssertionsSigned: row.saml_want_assertions_signed,
    };
  });
}

/**
 * Returns the public SSO provider info (no secrets) for the sign-in page.
 *
 * This is a database read rather than a cached value because the sign-in
 * page needs to reflect newly added providers without a restart.
 *
 * Through `app.sso_lookup` for the reason the boot read is: a visitor who has
 * not signed in has no workspace, and the tenant floor answers an unscoped
 * read with nothing (P8-T07a).
 */
export async function listSSOProviders(
  pool: Pool,
): Promise<readonly SSOProviderInfo[]> {
  try {
    const { rows } = await withSSOLookup(drizzle(pool), (tx) =>
      tx.execute<{
        provider_id: string;
        display_name: string;
        workspace_id: string;
        email_domains: string;
        enforce: boolean;
      }>(sql`
        select provider_id, display_name, workspace_id, email_domains, enforce
          from sso_connections
         where enabled = true
           and deleted_at is null
         order by display_name`),
    );
    return rows.map((row) => ({
      id: `sso-${row.provider_id}-${row.workspace_id.slice(0, 8)}`,
      displayName: row.display_name,
      workspaceId: row.workspace_id,
      emailDomains: row.email_domains,
      enforce: row.enforce,
    }));
  } catch (error) {
    // Graceful degradation: if the table does not exist yet (migration
    // 0091 not applied), return no providers. The sign-in page renders
    // without SSO buttons and nothing crashes.
    if (error instanceof Error && error.message.includes("sso_connections")) {
      return [];
    }
    throw error;
  }
}
