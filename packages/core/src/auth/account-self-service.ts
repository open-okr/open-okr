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
 *
 * **Changing the sign-in email is here** (plan 0.8.0 Y4, D14 to D17).
 * `/change-email` is off over HTTP, so the server action is the only way in,
 * and it runs every refusal, the password and the limits before it calls
 * `auth.api.changeEmail`. The link and its completion are in `createAuth`'s
 * hooks and `email-change.ts`.
 */
import { APIError } from "better-auth/api";
import type { Pool } from "pg";
import { isDemoAccount } from "../demo/persona-list.ts";
import type { Auth } from "./auth.ts";
import { callerAddress } from "./caller-address.ts";
import {
  addressHasAccount,
  auditedAddress,
  EMAIL_CHANGE_ANSWER_FLOOR_MS,
  EMAIL_CHANGE_CALLBACK,
  emailChangeAllowance,
  emailChangeBlock,
  newAddressRefusal,
  recordEmailChangeRequest,
} from "./email-change.ts";
import type { AuthLimiterStorage } from "./limiter-storage.ts";
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
import { EMAIL_VERIFICATION_LINK_SECONDS } from "./verification-links.ts";

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
 * offers, by name, for "Sign in again with ..." (D2). Deleting your own
 * account offers the same (account-deletion.md §3.1).
 */
export async function linkedProviders(
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

/** What Your account's email card shows for this account (D14, D16 (1)). */
export type EmailCard =
  /** The instance cannot send mail, so the change is not offered (D14). */
  | { readonly kind: "no_mail" }
  /** A demonstration account keeps its email (D1). */
  | { readonly kind: "demo" }
  /** A directory manages the account (AS-Q3). */
  | { readonly kind: "directory" }
  /** Single sign-on claims the address's domain (D16). */
  | {
      readonly kind: "enforced";
      readonly provider: string;
      readonly domain: string;
    }
  /**
   * The form: the new address, and the current password where the account
   * has one. An account with none needs a recent sign-in instead (D2), and
   * is offered its providers to sign in again with until it has one.
   */
  | {
      readonly kind: "change";
      readonly hasPassword: boolean;
      readonly recent: boolean;
      readonly providers: readonly SignInAgainProvider[];
    };

/**
 * What the email card draws for the signed-in account. Every refusal here
 * depends only on the asker's own account, so the card says why before any
 * address is typed.
 */
export async function emailCardFor(
  pool: Pool,
  input: {
    readonly userId: string;
    readonly email: string;
    /** `canSendMail()`, the same answer Better Auth was built with (D14). */
    readonly canSendMail: boolean;
    readonly sessionCreatedAt: Date | string;
    readonly now?: Date;
  },
): Promise<EmailCard> {
  if (!input.canSendMail) {
    return { kind: "no_mail" };
  }
  const block = await emailChangeBlock(pool, input);
  if (block?.kind === "enforced") {
    return {
      kind: "enforced",
      provider: block.provider.displayName,
      domain: block.provider.domain,
    };
  }
  if (block) {
    return { kind: block.kind };
  }
  const hasPassword = await accountHasPassword(pool, input.userId);
  return {
    kind: "change",
    hasPassword,
    recent: signedInRecently({ createdAt: input.sessionCreatedAt }, input.now),
    providers: hasPassword ? [] : await linkedProviders(pool, input.userId),
  };
}

/** Why a change of sign-in email was refused, or that it was accepted. */
export type EmailChangeOutcome =
  | {
      readonly ok: true;
      /** The address the link went to, or would have. */
      readonly to: string;
      /** The address that still signs in until the link is opened. */
      readonly current: string;
      /** How long the link works, in hours. */
      readonly hours: number;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "signed_out"
        | "no_mail"
        | "demo"
        | "directory"
        | "invalid"
        | "same"
        | "company"
        | "wrong_password"
        | "account_limit"
        | "address_limit";
    }
  | {
      readonly ok: false;
      readonly reason: "enforced";
      readonly provider: string;
      readonly domain: string;
    }
  | {
      readonly ok: false;
      readonly reason: "held";
      readonly retryAfterSeconds: number;
    }
  | {
      readonly ok: false;
      readonly reason: "not_recent";
      readonly providers: readonly SignInAgainProvider[];
    };

/** Waits until `ms` milliseconds have passed since `started` (D17). */
async function answerNoSoonerThan(started: number, ms: number): Promise<void> {
  const remaining = ms - (Date.now() - started);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

/**
 * Asks to change the signed-in account's sign-in email (D16, D17).
 *
 * **In this order.** (1) The account itself: mail can be sent, then demo,
 * directory-managed, single sign-on. (2) The new address: well formed, not
 * the current one, and allowed by the address rule. (3) Proof: the current
 * password through `auth.api.verifyPassword`, which counts toward the sign-in
 * hold (D3), or a sign-in in the last ten minutes for an account with no
 * password. (4) Three requests a day per account, and three per new address.
 * (5) One branch: an address another account holds is told nothing changed
 * (AS-Q5); a free one gets Better Auth's link. Either way the current
 * address is told and the request recorded, before any link exists.
 * (6) The same answer, no sooner than 500 ms after the request began.
 *
 * Every refusal before the address depends only on the asker's account, the
 * address rule only on the domain, and the per-address limit counts every
 * address alike, so no answer here says whether another account exists.
 */
export async function changeOwnEmail(
  auth: Pick<Auth, "api" | "options" | "$context">,
  pool: Pool,
  input: {
    readonly headers: Headers;
    readonly newEmail: string;
    /** The current password. Ignored for an account that has none. */
    readonly password: string;
    /** Where the daily limits are counted: the shared cache in the web app. */
    readonly limits: AuthLimiterStorage;
    readonly now?: Date;
  },
): Promise<EmailChangeOutcome> {
  const started = Date.now();
  const session = await auth.api.getSession({ headers: input.headers });
  if (!session) {
    return { ok: false, reason: "signed_out" };
  }
  const user = session.user as { id: string; email: string };

  // (1) The account itself.
  if (auth.options.user?.changeEmail?.enabled !== true) {
    return { ok: false, reason: "no_mail" };
  }
  const block = await emailChangeBlock(pool, {
    userId: user.id,
    email: user.email,
  });
  if (block?.kind === "enforced") {
    return {
      ok: false,
      reason: "enforced",
      provider: block.provider.displayName,
      domain: block.provider.domain,
    };
  }
  if (block) {
    return { ok: false, reason: block.kind };
  }

  // (2) The address.
  const next = input.newEmail.trim().toLowerCase();
  const refusal = await newAddressRefusal(pool, {
    current: user.email,
    next,
  });
  if (refusal) {
    return { ok: false, reason: refusal };
  }

  // (3) Proof.
  if (await accountHasPassword(pool, user.id)) {
    if (input.password === "") {
      return { ok: false, reason: "wrong_password" };
    }
    try {
      await auth.api.verifyPassword({
        headers: input.headers,
        body: { password: input.password },
      });
    } catch (error) {
      const body = (error instanceof APIError ? error.body : undefined) as
        | { code?: unknown; retryAfterSeconds?: unknown }
        | undefined;
      if (body?.code === "SIGN_IN_HELD") {
        const seconds = Number(body.retryAfterSeconds);
        return {
          ok: false,
          reason: "held",
          retryAfterSeconds: Number.isFinite(seconds) ? seconds : 60,
        };
      }
      if (body?.code === "INVALID_PASSWORD") {
        return { ok: false, reason: "wrong_password" };
      }
      throw error;
    }
  } else if (!signedInRecently(session.session, input.now)) {
    return {
      ok: false,
      reason: "not_recent",
      providers: await linkedProviders(pool, user.id),
    };
  }

  // (4) The limits.
  const { secret } = await auth.$context;
  const allowance = await emailChangeAllowance(input.limits, {
    userId: user.id,
    toKey: auditedAddress(secret, next).key,
  });
  if (allowance !== "allowed") {
    return { ok: false, reason: allowance };
  }

  // (5) One branch. Recorded first, so the owner is told of every link.
  const taken = await addressHasAccount(pool, next, user.id);
  await recordEmailChangeRequest(pool, secret, {
    userId: user.id,
    from: user.email,
    to: next,
    outcome: taken ? "address_taken" : "link_sent",
  });
  if (!taken) {
    await auth.api.changeEmail({
      headers: input.headers,
      body: { newEmail: next, callbackURL: EMAIL_CHANGE_CALLBACK },
    });
  }

  // (6) The same answer.
  await answerNoSoonerThan(started, EMAIL_CHANGE_ANSWER_FLOOR_MS);
  return {
    ok: true,
    to: next,
    current: user.email,
    hours: EMAIL_VERIFICATION_LINK_SECONDS / 3600,
  };
}
