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
import { X509Certificate } from "node:crypto";
import { withSSOLookup, withWorkspace } from "@openokr/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
  decryptSecret,
  encryptSecret,
  type KeyRing,
  type SealedSecret,
} from "../secrets/key-ring.ts";
import { syncSamlProvider } from "./saml-sync.ts";

/** The shape the sign-in page needs to show SSO buttons. No secrets. */
export interface SSOProviderInfo {
  /**
   * Which protocol, because the button does a different thing (P8-T07c-b).
   *
   * OIDC starts at `signIn.social` and SAML at `signIn.sso`. The sign-in
   * page sent every provider to the first of those, so a SAML button reached
   * a provider `genericOAuth` had never heard of.
   */
  readonly kind: "oidc" | "saml";
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
  // **Both protocols, since P8-T07c-a.** OIDC completes at `/callback/:id`
  // and SAML at `/sso/saml2/sp/acs/:id`. Reading only the first meant the
  // after-create hook resolved no workspace for a SAML arrival, so nothing
  // joined them there and `provisionWorkspaceForUser` gave them a private
  // workspace instead. They ended up in two: the right one, joined later by
  // the plugin, and one of their own that nobody ever opens. That is the
  // defect P8-T07b was cut to fix, reappearing through a different door.
  const prefixes = ["/callback/", "/sso/saml2/sp/acs/"];
  const prefix = prefixes.find((one) => path?.startsWith(one));
  if (path === undefined || prefix === undefined) {
    return "";
  }
  // Better Auth hands a hook the route template with the value in `params`,
  // so the parameters are read first and the literal path is the fallback.
  const bag = params as { id?: unknown; providerId?: unknown } | undefined;
  for (const candidate of [bag?.id, bag?.providerId]) {
    if (typeof candidate === "string" && candidate !== "") {
      return candidate;
    }
  }
  return path.slice(prefix.length).split("/")[0] ?? "";
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
      providerId: derivedProviderId(row.provider_id, row.workspace_id),
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
        kind: string;
        provider_id: string;
        display_name: string;
        workspace_id: string;
        email_domains: string;
        enforce: boolean;
      }>(sql`
        select kind, provider_id, display_name, workspace_id, email_domains,
               enforce
          from sso_connections
         where enabled = true
           and deleted_at is null
         order by display_name`),
    );
    return rows.map((row) => ({
      kind: row.kind === "saml" ? ("saml" as const) : ("oidc" as const),
      id: derivedProviderId(row.provider_id, row.workspace_id),
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

/** What an administrator supplies when configuring a provider. */
export interface CreateSSOConnectionInput {
  /**
   * Which protocol. `oidc` when it is not said, which is what every caller
   * written before 18 September 2026 means.
   */
  readonly kind?: "oidc" | "saml";
  readonly providerId: string;
  readonly displayName: string;
  /** OIDC only. A SAML row carries a placeholder, because 0091 says not null. */
  readonly clientId?: string;
  /** Sealed here rather than by the caller, so one place owns the key ring. */
  readonly clientSecret?: string;
  readonly discoveryUrl?: string | null;
  readonly authorizationUrl?: string | null;
  readonly tokenUrl?: string | null;
  readonly userInfoUrl?: string | null;
  readonly scopes?: string;
  readonly emailDomains?: string;
  readonly enforce?: boolean;
  /** Where the browser is sent to authenticate. SAML only. */
  readonly samlEntryPoint?: string | null;
  /** What the identity provider calls itself in what it signs. */
  readonly samlIssuer?: string | null;
  /** Its signing certificate, with or without its PEM header. */
  readonly samlCertificate?: string | null;
  /** What this instance calls itself. Null means the instance URL. */
  readonly samlAudience?: string | null;
}

/**
 * The provider id Better Auth knows a connection by.
 *
 * One expression rather than four copies of it. The two readers above each
 * built this string themselves and P8-T07c-b needed a fourth: the id the SAML
 * plugin registers its routes under has to be the id the admin screen prints
 * in a metadata URL, or an administrator hands their identity provider an
 * address that answers 404.
 */
export function derivedProviderId(
  providerId: string,
  workspaceId: string,
): string {
  return `sso-${providerId}-${workspaceId.slice(0, 8)}`;
}

/** The three addresses an administrator needs to configure their side. */
export interface SamlServiceProviderUrls {
  /** What this instance calls itself in an assertion's audience. */
  readonly entityId: string;
  /** Where the identity provider posts its assertion. */
  readonly acsUrl: string;
  /** The document that states both, for a provider that reads one. */
  readonly metadataUrl: string;
}

/**
 * Where this instance is, as a SAML service provider (P8-T07c-b).
 *
 * **Derived, never stored.** The plugin builds its assertion consumer address
 * from its own base URL and the provider id, and `saml-sync.ts` writes the
 * entity id as this instance's base URL. A second copy of either, typed into
 * a settings screen or added as a column, would be the one that drifts, and
 * the symptom would be an identity provider posting a valid assertion to an
 * address that answers 404.
 *
 * **The metadata document itself is the plugin's**, served at the address
 * below and reachable without a session, because an identity provider that
 * fetches it has none. A second document written here would mean two
 * descriptions of one service provider and no way to tell which one somebody
 * handed over.
 */
export function samlServiceProviderUrls(
  baseUrl: string,
  providerId: string,
): SamlServiceProviderUrls {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    entityId: base,
    acsUrl: `${base}/api/auth/sso/saml2/sp/acs/${providerId}`,
    metadataUrl: `${base}/api/auth/sso/saml2/sp/metadata?providerId=${encodeURIComponent(providerId)}`,
  };
}

/** A field an administrator has to correct, and what to tell them. */
export interface SSOConnectionProblem {
  readonly field: string;
  readonly message: string;
}

/** A configuration this instance will not store, and the field to blame. */
export class SSOConnectionRejected extends Error {
  readonly field: string;
  constructor(problem: SSOConnectionProblem) {
    super(problem.message);
    this.name = "SSOConnectionRejected";
    this.field = problem.field;
  }
}

/**
 * Normalises a certificate to PEM, or answers null when it is not one.
 *
 * **Identity providers publish a certificate both ways.** Okta and Entra hand
 * over a PEM block; the same bytes sit inside a metadata document's
 * `<ds:X509Certificate>` element as bare base64, and somebody copying from
 * there pastes it without the header. They are the same key, so both are
 * accepted and stored as PEM, which is the shape `samlify` reads.
 */
export function normaliseCertificate(value: string): string | null {
  const body = value
    .trim()
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  if (body.length < 64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    return null;
  }
  const pem = `-----BEGIN CERTIFICATE-----\n${body
    .replace(/(.{64})/g, "$1\n")
    .trim()}\n-----END CERTIFICATE-----`;
  try {
    // Parsed rather than pattern-matched. Base64 that is not a certificate
    // passes every shape test and fails at somebody's sign-in instead, which
    // is the class of defect this row exists to close.
    new X509Certificate(pem);
    return pem;
  } catch {
    return null;
  }
}

function isAbsoluteUrl(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * What an administrator may store, and which field to name when they may not.
 *
 * **Pure, and the one place that decides**, so the refusal a browser shows and
 * the refusal the endpoint applies cannot disagree. Without it the next stop
 * is migration 0096's constraint, which refuses correctly and says
 * `sso_connections_saml_complete`, which is not a sentence for a person.
 *
 * The rules differ by protocol and their union is not the answer: a SAML row
 * has no client secret and an OIDC row has no certificate, so asking for both
 * would make either impossible to configure.
 */
export function validateSSOConnectionInput(
  input: CreateSSOConnectionInput,
): SSOConnectionProblem | null {
  if (!input.providerId || !/^[a-z0-9-]+$/.test(input.providerId)) {
    return {
      field: "providerId",
      message:
        "The provider ID is lowercase letters, numbers and hyphens only.",
    };
  }
  if (!input.displayName || input.displayName.trim() === "") {
    return {
      field: "displayName",
      message:
        "The display name is what the button on the sign-in page says. " +
        "Give it one.",
    };
  }
  if (input.enforce && !input.emailDomains?.trim()) {
    // The rule `listEnforcingConnections` already applies, said at the moment
    // somebody can still fix it rather than discovered later as nothing
    // happening.
    return {
      field: "emailDomains",
      message:
        "Enforcing with no domain listed does nothing, because an empty " +
        "list would otherwise claim every address on this instance. List at " +
        "least one domain, or do not enforce.",
    };
  }

  if (input.kind === "saml") {
    if (!isAbsoluteUrl(input.samlEntryPoint)) {
      return {
        field: "samlEntryPoint",
        message:
          "The sign-on URL is where the browser is sent to authenticate. " +
          "Your identity provider calls it the SSO URL or the login URL.",
      };
    }
    if (!input.samlIssuer || input.samlIssuer.trim() === "") {
      return {
        field: "samlIssuer",
        message:
          "The issuer is what the identity provider calls itself in the " +
          "assertions it signs. One issued by anybody else is refused.",
      };
    }
    if (
      !input.samlCertificate ||
      !normaliseCertificate(input.samlCertificate)
    ) {
      return {
        field: "samlCertificate",
        message:
          "That is not a certificate this instance can read. Paste the " +
          "signing certificate your identity provider publishes, with or " +
          "without its BEGIN CERTIFICATE header.",
      };
    }
    return null;
  }

  if (!input.clientId || input.clientId.trim() === "") {
    return {
      field: "clientId",
      message:
        "The client ID is what identifies this instance to the provider.",
    };
  }
  if (!input.clientSecret || input.clientSecret.trim() === "") {
    return {
      field: "clientSecret",
      message:
        "The client secret is stored encrypted and never shown again, and it " +
        "cannot be left empty.",
    };
  }
  if (!input.discoveryUrl && (!input.authorizationUrl || !input.tokenUrl)) {
    return {
      field: "discoveryUrl",
      message:
        "Give a discovery URL, or both an authorization URL and a token URL.",
    };
  }
  return null;
}

/**
 * Creates a connection for a workspace, whichever protocol it speaks.
 *
 * **This exists because the route that used to do it could never work**
 * (audit, 18 September 2026). It inserted with
 * `current_setting('app.workspace_id')::uuid` on a bare pool, and
 * `current_setting` without the missing-ok flag raises rather than returning
 * null, so every attempt ended in `unrecognized configuration parameter`. The
 * admin screen posts there and nowhere else, so no provider could be
 * configured on any instance, which made P8-T07a, P8-T07b and P8-T07c-a all
 * unreachable: each of them is downstream of a provider existing.
 *
 * The workspace is passed in rather than asked of the connection, which is the
 * same shape `createSCIMToken` has used since P8-T08a. That row fixed one of
 * the pair and left this one.
 *
 * **A SAML row's derived provider row is written here** (P8-T07c-b).
 * `syncAllSamlProviders` was built at P8-T07c-a and no running process ever
 * called it, so `sso_providers` stayed empty on every instance and the plugin
 * had nothing to answer a sign-in with. Writing it beside the authority is
 * what makes a provider configured today work at the next restart rather than
 * after somebody notices.
 */
export async function createSSOConnection(
  pool: Pool,
  workspaceId: string,
  ring: KeyRing,
  input: CreateSSOConnectionInput,
  baseUrl: string,
): Promise<{ id: string; providerId: string }> {
  const problem = validateSSOConnectionInput(input);
  if (problem) {
    throw new SSOConnectionRejected(problem);
  }

  const kind = input.kind === "saml" ? "saml" : "oidc";
  // A SAML provider has no client secret. The three secret columns are not
  // null from 0091, so an empty one is sealed and stored: nothing reads it,
  // and making them nullable would mean every OIDC read had to handle a null
  // only SAML can produce.
  const sealed = encryptSecret(ring, input.clientSecret ?? "");
  const certificate =
    kind === "saml" ? normaliseCertificate(input.samlCertificate ?? "") : null;

  const row = await withWorkspace(drizzle(pool), workspaceId, async (tx) => {
    // openokr:allow-mutation: an instance configuration write with no acting
    // member, the same arrangement `createSCIMToken` uses. The admin endpoint
    // that calls this is access-checked before it is reached.
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into sso_connections (
        workspace_id, kind, provider_id, display_name,
        discovery_url, authorization_url, token_url, user_info_url,
        client_id, secret_ciphertext, secret_data_key, secret_key_id,
        scopes, email_domains, enforce,
        saml_entry_point, saml_issuer, saml_certificate, saml_audience
      ) values (
        ${workspaceId}, ${kind}, ${input.providerId}, ${input.displayName},
        ${input.discoveryUrl ?? null}, ${input.authorizationUrl ?? null},
        ${input.tokenUrl ?? null}, ${input.userInfoUrl ?? null},
        ${input.clientId ?? ""}, ${sealed.ciphertext}, ${sealed.dataKey},
        ${sealed.keyId},
        ${input.scopes ?? "openid email profile"},
        ${input.emailDomains ?? ""}, ${input.enforce ?? false},
        ${input.samlEntryPoint ?? null}, ${input.samlIssuer ?? null},
        ${certificate}, ${input.samlAudience ?? null}
      )
      returning id`);
    return inserted.rows[0];
  });

  if (!row) {
    throw new Error("The SSO connection insert returned no row");
  }

  const providerId = derivedProviderId(input.providerId, workspaceId);

  if (kind === "saml") {
    await syncSamlProvider(
      pool,
      {
        kind: "saml",
        id: row.id,
        providerId,
        displayName: input.displayName,
        workspaceId,
        clientId: "",
        clientSecret: "",
        scopes: [],
        emailDomains: (input.emailDomains ?? "")
          .split(",")
          .map((one) => one.trim().toLowerCase())
          .filter(Boolean),
        enforce: input.enforce ?? false,
        samlEntryPoint: input.samlEntryPoint ?? undefined,
        samlIssuer: input.samlIssuer ?? undefined,
        samlCertificate: certificate ?? undefined,
        ...(input.samlAudience ? { samlAudience: input.samlAudience } : {}),
        samlWantAssertionsSigned: true,
      },
      baseUrl,
    );
  }

  return { id: row.id, providerId };
}
