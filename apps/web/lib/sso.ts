/**
 * The SSO providers this process signs people in with (P8-T07).
 *
 * Read from the database at boot, decrypted, and held on `globalThis` for
 * `getAuth()`. **A connection saved while the process runs is used by the
 * next sign-in** (completeness review L-15): every authentication request
 * asks the tracker, which reads a stamp of `sso_connections` at most every
 * few seconds and reloads the providers when it moved. The stamp is in the
 * database, so a connection saved on one process reaches all the others.
 */

import { loadEnv } from "@openokr/config";
import {
  type KeyRing,
  loadSSOConnections,
  type SSOProviderConfig,
  type SSOProviderTracker,
  syncAllSamlProviders,
  trackSSOProviders,
} from "@openokr/core";
import type { Pool } from "pg";
import { getPool } from "./pool";
import { getKeyRing } from "./secrets";

const globals = globalThis as typeof globalThis & {
  openokrSSOTracker?: SSOProviderTracker;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Reads the providers and brings the SAML plugin's rows into line. Throws.
 *
 * At boot, and again whenever the stamp moves.
 */
async function loadSSOProviders(
  pool: Pool,
  ring: KeyRing,
  baseUrl: string,
): Promise<readonly SSOProviderConfig[]> {
  const providers = await loadSSOConnections(pool, ring);

  // **The derived table, brought in line before the plugin reads it**
  // (P8-T07c-b). `syncAllSamlProviders` was built at P8-T07c-a and nothing
  // in the application ever called it, so `sso_providers` stayed empty on
  // every running instance and the SAML plugin had no provider to answer a
  // sign-in with. A row written straight into `sso_connections`, or one
  // whose authority was removed while this process was not running, is
  // reconciled here rather than discovered by somebody failing to sign in.
  //
  // On a reload too, and on every process that sees the change (L-15). They
  // write the same rows from the same table. One that read the table just
  // before a second change can land its rows after another process's, and
  // puts them right at its next check, because the stamp it holds is the
  // older one.
  const saml = await syncAllSamlProviders(pool, providers, baseUrl);
  if (saml > 0) {
    process.stdout.write(`sso: ${saml} SAML provider(s) in step\n`);
  }
  if (providers.length > 0) {
    process.stdout.write(
      `sso: loaded ${providers.length} provider(s): ${providers.map((p) => p.providerId).join(", ")}\n`,
    );
  }
  return providers;
}

/**
 * The process's tracker, made on first use.
 *
 * The key ring and the base URL are read when a reload runs rather than here,
 * so making it needs no key, and a pool opens no connection until it is used.
 */
export function ssoProviderTracker(): SSOProviderTracker {
  if (!globals.openokrSSOTracker) {
    globals.openokrSSOTracker = trackSSOProviders({
      pool: getPool(),
      load: () =>
        loadSSOProviders(getPool(), getKeyRing(), loadEnv().BETTER_AUTH_URL),
      onError: (error) => {
        process.stderr.write(
          `sso: could not reload SSO connections, sign-in keeps the ones it had: ${messageOf(error)}\n`,
        );
      },
    });
  }
  return globals.openokrSSOTracker;
}

/**
 * Loads the providers before the first request. Called once at boot, before
 * `getAuth()` is first called.
 *
 * Failures are logged, not fatal: an instance that cannot read its SSO
 * connections still serves password and passkey sign-in. The SSO buttons
 * simply do not work until a later check reads them.
 */
export async function resolveSSOProviders(): Promise<void> {
  try {
    await ssoProviderTracker().refresh();
  } catch (error) {
    process.stderr.write(
      `sso: could not load SSO connections, SSO sign-in will not be available: ${messageOf(error)}\n`,
    );
  }
}

/**
 * Says this process just saved a connection, so its next sign-in reads it
 * rather than waiting out the stamp's few seconds.
 */
export function expireSSOProviders(): void {
  ssoProviderTracker().expire();
}
