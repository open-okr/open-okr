/**
 * Keeping the SSO plugin's table in step with ours (P8-T07c-a).
 *
 * **`sso_connections` is the authority and `sso_providers` is derived from
 * it.** Agung settled that on 18 September 2026 against two alternatives that
 * both put per-workspace provider configuration on a table with no
 * `workspace_id` and no policy. `docs/design/p8-t07c-saml.md` records why.
 *
 * So this is the one place that writes the derived table, and it writes it
 * from the authority rather than from its caller's arguments. A caller that
 * passed the wrong thing could otherwise leave the two disagreeing, which is
 * the failure mode derived state exists to have.
 *
 * **Nothing in the product reads `sso_providers` to answer a question.** Every
 * read goes to `sso_connections`. A drifted row here makes a sign-in fail,
 * which somebody notices, rather than making an answer wrong, which nobody
 * does.
 */
import { ssoProviders } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { SSOProviderConfig } from "./sso.ts";

/**
 * What the plugin stores in its `samlConfig` column.
 *
 * Written as the plugin's own shape rather than as ours, because the plugin
 * reads it back and its shape is its business across upgrades. The product
 * never parses this.
 */
interface StoredSamlConfig {
  readonly entryPoint: string;
  readonly issuer: string;
  readonly cert: string;
  readonly audience?: string;
  readonly wantAssertionsSigned: boolean;
  readonly callbackUrl: string;
}

/**
 * The domain the plugin matches an email against.
 *
 * It requires one and refuses a row without it. A provider configured with no
 * trusted domain still has to have something here, so the issuer's host stands
 * in: it matches nobody's email, which is the correct behaviour for a provider
 * that named no domain, rather than matching everybody.
 */
export function domainFor(connection: SSOProviderConfig): string {
  const first = connection.emailDomains[0];
  if (first && first !== "") {
    return first;
  }
  try {
    return new URL(connection.samlEntryPoint ?? "https://invalid.example")
      .hostname;
  } catch {
    return "invalid.example";
  }
}

/**
 * Writes, updates or removes the derived row for one connection.
 *
 * Idempotent, because the boot path calls it for every provider on every
 * start and a write path calls it again for the one that changed.
 *
 * A connection that is not SAML removes any derived row it had, which is what
 * makes switching a provider from SAML to OIDC leave nothing behind.
 */
export async function syncSamlProvider(
  pool: Pool,
  connection: SSOProviderConfig,
  baseUrl: string,
): Promise<void> {
  const db = drizzle(pool);

  if (
    connection.kind !== "saml" ||
    !connection.samlEntryPoint ||
    !connection.samlIssuer ||
    !connection.samlCertificate
  ) {
    // openokr:allow-mutation: `sso_providers` is a Better Auth table, outside
    // the Operation pipeline the way `users` and `sessions` are. The audited
    // change is the one on `sso_connections`; this is its consequence.
    await db
      .delete(ssoProviders)
      .where(eq(ssoProviders.providerId, connection.providerId));
    return;
  }

  const samlConfig: StoredSamlConfig = {
    entryPoint: connection.samlEntryPoint,
    issuer: connection.samlIssuer,
    cert: connection.samlCertificate,
    ...(connection.samlAudience ? { audience: connection.samlAudience } : {}),
    // Defaults true in the schema, and the admin screen does not offer false.
    // An identity provider that cannot sign its assertions is one this
    // instance should refuse rather than quietly accommodate.
    wantAssertionsSigned: connection.samlWantAssertionsSigned !== false,
    callbackUrl: `${baseUrl}/api/auth/sso/saml2/callback/${connection.providerId}`,
  };

  const row = {
    id: connection.id,
    providerId: connection.providerId,
    issuer: connection.samlIssuer,
    domain: domainFor(connection),
    samlConfig: JSON.stringify(samlConfig),
    oidcConfig: null,
    userId: null,
    organizationId: null,
  };

  // openokr:allow-mutation: as above. One statement rather than a read and a
  // branch, so two boots racing cannot both decide to insert.
  await db
    .insert(ssoProviders)
    .values(row)
    .onConflictDoUpdate({
      target: ssoProviders.providerId,
      set: {
        issuer: row.issuer,
        domain: row.domain,
        samlConfig: row.samlConfig,
        oidcConfig: null,
      },
    });
}

/**
 * Brings the derived table in line with every connection, at boot.
 *
 * **Removals are part of it.** A row whose authority disappeared while this
 * process was not running would otherwise keep answering sign-ins, which is
 * the one drift that matters: the product would consider a provider gone and
 * the plugin would not.
 */
export async function syncAllSamlProviders(
  pool: Pool,
  connections: readonly SSOProviderConfig[],
  baseUrl: string,
): Promise<number> {
  const db = drizzle(pool);
  const live = new Set(
    connections
      .filter((one) => one.kind === "saml")
      .map((one) => one.providerId),
  );

  const existing = await db
    .select({ providerId: ssoProviders.providerId })
    .from(ssoProviders);

  for (const row of existing) {
    if (!live.has(row.providerId)) {
      // openokr:allow-mutation: see `syncSamlProvider`.
      await db
        .delete(ssoProviders)
        .where(eq(ssoProviders.providerId, row.providerId));
    }
  }

  for (const connection of connections) {
    await syncSamlProvider(pool, connection, baseUrl);
  }

  return live.size;
}
