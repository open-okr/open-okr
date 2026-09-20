/**
 * Single sign-on enforcement (P8-T07a).
 *
 * A connection that is enforcing claims a set of email domains. Anybody whose
 * address is in one of them signs in through that identity provider and
 * through nothing else: a password, a password reset and a passkey are all
 * refused. That is the point of the setting. The organisation controls the
 * account, so removing somebody at the identity provider removes them here,
 * and a local credential that outlives that removal would be the one thing
 * enforcement exists to prevent.
 *
 * **An enforcing connection with no domains enforces nothing.** Migration
 * 0091's own comment reads the empty list as "every member of this
 * workspace", and applying that to sign-in would claim every address on the
 * instance, including members of workspaces that have never heard of this
 * provider. An empty list is therefore a configuration that does nothing, and
 * the admin screen says so, rather than a switch that locks out an instance.
 *
 * **There is no cache.** The read is one indexed query against a table with a
 * handful of rows, on a path Better Auth already rate-limits to ten attempts
 * a minute. A cache would buy nothing measurable and would mean an
 * administrator turning enforcement off still watched people be refused.
 */
import { withSSOLookup } from "@openokr/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { emailDomain } from "../invitations/tokens.ts";
import { derivedProviderId } from "./sso.ts";

/** A provider that claims the address somebody is trying to sign in with. */
export interface EnforcingProvider {
  /** The provider id, which is what the sign-in call is given. */
  readonly providerId: string;
  /**
   * Which protocol, because the two are started differently (P8-T07c-b).
   *
   * `oidc` goes to `signIn.social` and `saml` to `signIn.sso`. Carried
   * here so that whatever refuses somebody can also say which button to press.
   */
  readonly kind: "oidc" | "saml";
  readonly displayName: string;
  /** The claimed domain that matched. */
  readonly domain: string;
}

/** One enforcing connection, as the database holds it. */
export interface EnforcingConnection {
  readonly providerId: string;
  readonly kind: "oidc" | "saml";
  readonly displayName: string;
  readonly domains: readonly string[];
}

/**
 * Which provider claims this address, if any.
 *
 * Pure, so the matching is tested without a database: the rules about what
 * counts as a claim are the part worth being sure of.
 *
 * A domain claim is exact. `acme.com` does not claim `mail.acme.com`, because
 * a suffix match would let `notacme.com` be claimed by `acme.com` unless the
 * dot were handled exactly right, and a subdomain that should be claimed can
 * be listed.
 *
 * The domain is read with the same `emailDomain` the invitation path uses, so
 * "which domain is this address on" has one answer in the product rather than
 * two that can drift.
 */
export function enforcingProviderFor(
  email: string,
  connections: readonly EnforcingConnection[],
): EnforcingProvider | null {
  const domain = emailDomain(email.trim());
  if (domain === "") {
    return null;
  }
  for (const connection of connections) {
    if (connection.domains.includes(domain)) {
      return {
        providerId: connection.providerId,
        kind: connection.kind,
        displayName: connection.displayName,
        domain,
      };
    }
  }
  return null;
}

/**
 * Every enforcing connection on the instance, with its claimed domains.
 *
 * Through `app.sso_lookup`, for the reason the provider list is: this runs on
 * a sign-in attempt, which has no workspace.
 */
export async function listEnforcingConnections(
  pool: Pool,
): Promise<readonly EnforcingConnection[]> {
  try {
    const { rows } = await withSSOLookup(drizzle(pool), (tx) =>
      tx.execute<{
        kind: string;
        provider_id: string;
        workspace_id: string;
        display_name: string;
        email_domains: string;
      }>(sql`
        select kind, provider_id, workspace_id, display_name, email_domains
          from sso_connections
         where enabled = true
           and enforce = true
           and email_domains <> ''
           and deleted_at is null`),
    );
    return rows.map((row) => ({
      providerId: derivedProviderId(row.provider_id, row.workspace_id),
      kind: row.kind === "saml" ? ("saml" as const) : ("oidc" as const),
      displayName: row.display_name,
      domains: row.email_domains
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    }));
  } catch (error) {
    // The same degradation the provider list has: on a database without
    // migration 0091, nothing is enforced rather than everything refused.
    // Enforcement that fails closed here would lock out an instance that has
    // never configured single sign-on at all.
    if (error instanceof Error && error.message.includes("sso_connections")) {
      return [];
    }
    throw error;
  }
}

/** The provider that claims this address, read from the database. */
export async function enforcedProviderForEmail(
  pool: Pool,
  email: string,
): Promise<EnforcingProvider | null> {
  const connections = await listEnforcingConnections(pool);
  if (connections.length === 0) {
    return null;
  }
  return enforcingProviderFor(email, connections);
}

/**
 * The provider that claims this user's address, by user id.
 *
 * The backstop path uses this: a passkey assertion carries no address, so the
 * only way to know whose sign-in it is, is to look the account up. The
 * enforcing list is read first and answers nothing on an instance with no
 * enforcement, which is what keeps that instance to one small query.
 */
export async function enforcedProviderForUser(
  pool: Pool,
  userId: string,
): Promise<EnforcingProvider | null> {
  const connections = await listEnforcingConnections(pool);
  if (connections.length === 0) {
    return null;
  }
  // `users` is Better Auth's own table and carries no workspace column, so
  // this needs no tenant context.
  const { rows } = await pool.query<{ email: string }>(
    "select email from users where id = $1",
    [userId],
  );
  const email = rows[0]?.email;
  if (!email) {
    return null;
  }
  return enforcingProviderFor(email, connections);
}

/**
 * Is this the identity provider's own sign-in, rather than a local factor?
 *
 * `/callback/:id` is where Better Auth completes every social and
 * genericOAuth sign-in, and `/sign-in/social` is where one starts. Everything
 * else that reaches session creation is a local factor: a password, a
 * passkey, a one-time code. The backstop refuses those for a claimed address.
 *
 * **SAML has its own two, and they were missing** (P8-T07c-b). A SAML sign-in
 * starts at `/sign-in/sso` and completes at `/sso/saml2/sp/acs/:id`, so the
 * backstop read both as local factors and refused the very sign-in enforcement
 * exists to insist on. An enforced domain with a SAML provider could not sign
 * in by any route at all, which is what this function is one line away from in
 * either direction.
 *
 * Written here rather than beside the hook that calls it, so the rule that
 * decides which sign-ins escape enforcement is tested on its own. An
 * undefined path is not a provider sign-in: a caller that cannot say where it
 * came from gets the stricter answer.
 */
export function isProviderSignInPath(path: string | undefined): boolean {
  if (path === undefined) {
    return false;
  }
  return (
    path.startsWith("/callback/") ||
    path.startsWith("/sso/saml2/sp/acs/") ||
    path === "/sign-in/social" ||
    path === "/sign-in/sso"
  );
}

/** What somebody refused by enforcement is told. */
export function enforcementMessage(provider: EnforcingProvider): string {
  return (
    `Accounts on ${provider.domain} sign in with ${provider.displayName}. ` +
    "Use that button on the sign-in page. A password, a reset link and a " +
    "passkey will not work for this address."
  );
}

/**
 * Whether a path is the callback of a provider this instance has configured
 * (P8-T07c-a).
 *
 * **What this answers is "did a provider we trust just vouch for somebody",
 * and it is why just-in-time provisioning can work on a closed instance.**
 * Configuring a provider is a workspace saying it will admit the people that
 * provider vouches for. Without this, the registration rule refuses every
 * arrival on an invitation-only instance, which is every instance after its
 * first account.
 *
 * **It is not a way in.** Reaching either path means the provider's signature
 * or its token exchange has already been verified, and Better Auth builds the
 * path from the route it dispatched rather than from anything a caller sends.
 * An unknown provider id matches nothing.
 *
 * Two shapes, because the two protocols land in different places: OIDC
 * completes at `/callback/:id` through `genericOAuth`, and SAML at
 * `/sso/saml2/sp/acs/:id` through the SSO plugin.
 *
 * **The id comes from the parameters, and the path may be the route template
 * rather than the request.** Better Auth hands the hook `/sso/saml2/sp/acs/
 * :providerId` verbatim with the value in `params`, which is why reading the
 * path alone matched nothing and every arrival was still refused.
 * `providerIdFromCallback` reads both for the same reason, discovered the same
 * way.
 */
export function isSSOCallbackPath(
  path: string | undefined,
  params: unknown,
  providerIds: ReadonlySet<string>,
): boolean {
  if (!path || providerIds.size === 0) {
    return false;
  }
  const isCallback =
    path.startsWith("/callback/") || path.startsWith("/sso/saml2/sp/acs/");
  if (!isCallback) {
    return false;
  }

  const fromParams = params as
    | { id?: unknown; providerId?: unknown }
    | undefined;
  for (const candidate of [fromParams?.providerId, fromParams?.id]) {
    if (typeof candidate === "string" && providerIds.has(candidate)) {
      return true;
    }
  }

  // A literal path, which is what a request rather than a route template
  // looks like.
  const prefix = path.startsWith("/callback/")
    ? "/callback/"
    : "/sso/saml2/sp/acs/";
  const id = path.slice(prefix.length).split("/")[0] ?? "";
  return providerIds.has(id);
}
