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

/** The full configuration for the genericOAuth plugin. */
export interface SSOProviderConfig {
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
}

interface SSORow {
  id: string;
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
}

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
  // A raw read, because SSO connections are above the tenant floor: the
  // boot process has no workspace context and needs every provider from
  // every workspace. The query runs once, at startup, and row-level
  // security would hide everything behind an unset tenant setting.
  const { rows } = await pool.query<SSORow>(
    `select id, workspace_id, provider_id, display_name,
            discovery_url, authorization_url, token_url, user_info_url,
            client_id, secret_ciphertext, secret_data_key, secret_key_id,
            scopes, enforce, email_domains
       from sso_connections
      where enabled = true
        and deleted_at is null
      order by created_at`,
  );

  return rows.map((row) => {
    const sealed: SealedSecret = {
      ciphertext: row.secret_ciphertext,
      dataKey: row.secret_data_key,
      keyId: row.secret_key_id,
    };
    return {
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
    };
  });
}

/**
 * Returns the public SSO provider info (no secrets) for the sign-in page.
 *
 * This is a database read rather than a cached value because the sign-in
 * page needs to reflect newly added providers without a restart. The query
 * runs outside the tenant floor (no workspace context on the sign-in page).
 */
export async function listSSOProviders(
  pool: Pool,
): Promise<readonly SSOProviderInfo[]> {
  const { rows } = await pool.query<{
    provider_id: string;
    display_name: string;
    workspace_id: string;
    email_domains: string;
    enforce: boolean;
  }>(
    `select provider_id, display_name, workspace_id, email_domains, enforce
       from sso_connections
      where enabled = true
        and deleted_at is null
      order by display_name`,
  );
  return rows.map((row) => ({
    id: `sso-${row.provider_id}-${row.workspace_id.slice(0, 8)}`,
    displayName: row.display_name,
    workspaceId: row.workspace_id,
    emailDomains: row.email_domains,
    enforce: row.enforce,
  }));
}
