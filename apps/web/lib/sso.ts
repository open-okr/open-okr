/**
 * SSO connection loading for the web process (P8-T07).
 *
 * Loads SSO connections from the database at boot, decrypts client secrets,
 * and caches them on `globalThis`. The result is passed to `createAuth` so
 * Better Auth's genericOAuth plugin knows about every configured provider.
 *
 * A new SSO connection takes effect on the next restart. This is a
 * documented limitation: the genericOAuth plugin is configured once at
 * construction time.
 */

import type { KeyRing } from "@openokr/core";
import {
  loadSSOConnections,
  type SSOProviderConfig,
  syncAllSamlProviders,
} from "@openokr/core";
import type { Pool } from "pg";

const globals = globalThis as typeof globalThis & {
  openokrSSOProviders?: readonly SSOProviderConfig[];
};

/**
 * Loads and caches SSO connections. Called once at boot, before `getAuth()`
 * is first called.
 *
 * Failures are logged, not fatal: an instance that cannot read its SSO
 * connections still serves password and passkey sign-in. The SSO buttons
 * simply do not appear.
 */
export async function resolveSSOProviders(
  pool: Pool,
  ring: KeyRing,
  baseUrl: string,
): Promise<void> {
  try {
    const providers = await loadSSOConnections(pool, ring);
    globals.openokrSSOProviders = providers;

    // **The derived table, brought in line before the plugin reads it**
    // (P8-T07c-b). `syncAllSamlProviders` was built at P8-T07c-a and nothing
    // in the application ever called it, so `sso_providers` stayed empty on
    // every running instance and the SAML plugin had no provider to answer a
    // sign-in with. A row written straight into `sso_connections`, or one
    // whose authority was removed while this process was not running, is
    // reconciled here rather than discovered by somebody failing to sign in.
    const saml = await syncAllSamlProviders(pool, providers, baseUrl);
    if (saml > 0) {
      process.stdout.write(`sso: ${saml} SAML provider(s) in step\n`);
    }
    if (providers.length > 0) {
      process.stdout.write(
        `sso: loaded ${providers.length} provider(s): ${providers.map((p) => p.providerId).join(", ")}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(
      `sso: could not load SSO connections, SSO sign-in will not be available: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/** The cached SSO providers, or an empty array if none were loaded. */
export function getSSOProviders(): readonly SSOProviderConfig[] {
  return globals.openokrSSOProviders ?? [];
}
