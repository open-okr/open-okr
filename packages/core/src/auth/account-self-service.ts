/**
 * Your account: the parts that change how you sign in (docs/design/
 * account-self-service.md, plan 0.8.0 Y3, approved by Akmal on 11 November
 * 2026).
 *
 * **Account actions, not registry actions** (D4). Changing how a person signs
 * in is something a token should never do on their behalf, so REST, the
 * command line, the agent catalogue and chat get no projection. The web app
 * calls these from server actions under `apps/web/app/account/`.
 *
 * **Changing a password is not here.** Security's Password card calls Better
 * Auth's own `/change-password` from the browser, so the screen and a direct
 * call meet one guard, in `createAuth`'s hooks (D7, D8). What is here is what
 * the card needs to know before it draws, and Set a password, which goes
 * through Better Auth's server-only `setPassword` (D12).
 */
import { APIError } from "better-auth/api";
import type { Pool } from "pg";
import { isDemoAccount } from "../demo/personas.ts";
import type { Auth } from "./auth.ts";
import { callerAddress } from "./caller-address.ts";
import {
  accountHasPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  recordPasswordChange,
} from "./password-change.ts";
import { signedInRecently } from "./recent-sign-in.ts";
import { listSSOProviders } from "./sso.ts";
import {
  enforcedProviderForUser,
  enforcementMessage,
} from "./sso-enforcement.ts";

/** An identity provider the account can sign in again with (D2). */
export interface SignInAgainProvider {
  readonly id: string;
  readonly displayName: string;
  /** OIDC starts at `signIn.social`, SAML at `signIn.sso`. */
  readonly kind: "oidc" | "saml";
}

/** What Security's password card shows for this account. */
export type PasswordCard =
  /** A demonstration account keeps its password (D1). */
  | { readonly kind: "demo" }
  /** Single sign-on claims the address, so a password would never work (D8). */
  | { readonly kind: "enforced"; readonly message: string }
  /** The account has a password: current, new, new again (D7). */
  | { readonly kind: "change" }
  /**
   * No password yet: Set a password, once the session is recent (D12), and
   * the providers to sign in again with until it is.
   */
  | {
      readonly kind: "set";
      readonly recent: boolean;
      readonly providers: readonly SignInAgainProvider[];
    };

/**
 * The identity providers this account is linked to and this instance still
 * offers, by name, for "Sign in again with ..." (D2).
 */
async function linkedProviders(
  pool: Pool,
  userId: string,
): Promise<readonly SignInAgainProvider[]> {
  const { rows } = await pool.query<{ provider_id: string }>(
    `select distinct provider_id from accounts
      where user_id = $1 and provider_id <> 'credential'`,
    [userId],
  );
  if (rows.length === 0) {
    return [];
  }
  const linked = new Set(rows.map((row) => row.provider_id));
  return (await listSSOProviders(pool))
    .filter((provider) => linked.has(provider.id))
    .map(({ id, displayName, kind }) => ({ id, displayName, kind }));
}

/** What Security's password card draws for the signed-in account. */
export async function passwordCardFor(
  pool: Pool,
  input: {
    readonly userId: string;
    readonly email: string;
    /** When this session began, which "recent" is judged by (D2). */
    readonly sessionCreatedAt: Date | string;
    readonly now?: Date;
  },
): Promise<PasswordCard> {
  if (isDemoAccount(input.email)) {
    return { kind: "demo" };
  }
  const provider = await enforcedProviderForUser(pool, input.userId);
  if (provider) {
    return { kind: "enforced", message: enforcementMessage(provider) };
  }
  if (await accountHasPassword(pool, input.userId)) {
    return { kind: "change" };
  }
  return {
    kind: "set",
    recent: signedInRecently({ createdAt: input.sessionCreatedAt }, input.now),
    providers: await linkedProviders(pool, input.userId),
  };
}

/** Why Set a password refused, or what it did. */
export type SetPasswordOutcome =
  | {
      readonly ok: true;
      /** The providers it also signs in with, for the sentence that says so. */
      readonly providers: readonly SignInAgainProvider[];
    }
  | {
      readonly ok: false;
      readonly reason:
        | "signed_out"
        | "demo"
        | "enforced"
        | "not_recent"
        | "too_short"
        | "too_long"
        | "already_set";
      /** The enforcement sentence, for `enforced`. */
      readonly message?: string;
    };

/**
 * Gives a password to an account that has none (D12), after a recent sign-in
 * (D2), then records it (D9).
 *
 * Refused in the card's own order: a demonstration account, an account single
 * sign-on claims, a session older than ten minutes, a password outside 12 to
 * 128 characters. Better Auth's `setPassword` refuses an account that already
 * has one. It checks no freshness itself, which is why this does.
 */
export async function setOwnPassword(
  auth: Pick<Auth, "api">,
  pool: Pool,
  input: {
    readonly headers: Headers;
    readonly newPassword: string;
    readonly now?: Date;
  },
): Promise<SetPasswordOutcome> {
  const session = await auth.api.getSession({ headers: input.headers });
  if (!session) {
    return { ok: false, reason: "signed_out" };
  }
  const { user } = session;
  if (isDemoAccount(user.email)) {
    return { ok: false, reason: "demo" };
  }
  const provider = await enforcedProviderForUser(pool, user.id);
  if (provider) {
    return {
      ok: false,
      reason: "enforced",
      message: enforcementMessage(provider),
    };
  }
  if (!signedInRecently(session.session, input.now)) {
    return { ok: false, reason: "not_recent" };
  }
  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: "too_short" };
  }
  if (input.newPassword.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  try {
    await auth.api.setPassword({
      headers: input.headers,
      body: { newPassword: input.newPassword },
    });
  } catch (error) {
    if (
      error instanceof APIError &&
      (error.body as { code?: unknown } | undefined)?.code ===
        "PASSWORD_ALREADY_SET"
    ) {
      return { ok: false, reason: "already_set" };
    }
    throw error;
  }
  await recordPasswordChange(pool, {
    userId: user.id,
    via: "set",
    otherSessionsEnded: false,
    address: callerAddress(input.headers),
  });
  return { ok: true, providers: await linkedProviders(pool, user.id) };
}
