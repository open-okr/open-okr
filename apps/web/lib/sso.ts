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
import { loadSSOConnections, type SSOProviderConfig } from "@openokr/core";
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
): Promise<void> {
  try {
    const providers = await loadSSOConnections(pool, ring);
    globals.openokrSSOProviders = providers;
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
