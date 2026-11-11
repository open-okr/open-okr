/**
 * The Better Auth instance (TECHNICAL-PLAN §8.2, screen S-35).
 *
 * Authentication goes through Better Auth only: no hand-rolled sessions,
 * tokens or password handling. This module configures it and mounts the
 * factors the product ships with from day one — a password, a passkey and a
 * one-time code with backup codes.
 *
 * It lives in `packages/core` rather than `apps/web` because it needs the
 * database, and TECHNICAL-PLAN §1 allows `core` to depend on `db` while
 * `apps/web` may not. The web app mounts `auth.handler` on a route and
 * otherwise treats this as a service.
 */

import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { authSchema } from "@openokr/db";
import type { BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { callAction } from "../actions/registry.ts";
import { recordInstanceAuditEvent } from "../audit/instance-chain.ts";
import { isDemoAccount } from "../demo/personas.ts";
import {
  cookieHeaderFrom,
  inviteTokenFromCookies,
} from "../invitations/pending.ts";
import { previewInvite } from "../invitations/preview.ts";
import { domainIsTrusted } from "../invitations/trusted-domain.ts";
import { instanceNameOr } from "../secrets/instance-registry.ts";
import type { KeyRing } from "../secrets/key-ring.ts";
import { readSetupState } from "../setup/state.ts";
import { defaultMetrics, METRIC } from "../telemetry/recorder.ts";
import { browserTimezoneFromCookies } from "../workspaces/browser-timezone.ts";
import { tryJoinWorkspaceForIdentity } from "../workspaces/directory-join.ts";
import { provisionWorkspaceForUser } from "../workspaces/provisioning.ts";
import { registrationRefusal } from "../workspaces/registration.ts";
import {
  processOnlyKeyRing,
  withSealedAccountTokens,
} from "./account-token-sealing.ts";
import { callerAddress, callerAddressOptions } from "./caller-address.ts";
import { DISABLED_AUTH_PATHS } from "./endpoints.ts";
import {
  type AuthLimiterStorage,
  inProcessLimiter,
  routedByPath,
} from "./limiter-storage.ts";
import { clearSignInAttempts, recordPasswordAttempt } from "./lockout.ts";
import {
  accountHasPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  recordPasswordChange,
} from "./password-change.ts";
import { currentProvisioningAuthority } from "./provisioning-authority.ts";
import { withSecondFactorLockAudit } from "./second-factor-lock.ts";
import { withHashedSessionTokens } from "./session-hashing.ts";
import { providerIdFromCallback } from "./sso.ts";
import {
  type EnforcingProvider,
  enforcedProviderForEmail,
  enforcedProviderForUser,
  enforcementMessage,
  isProviderSignInPath,
  isSSOCallbackPath,
} from "./sso-enforcement.ts";
import { ssoLinkAllowed } from "./sso-linking.ts";
import {
  countVerificationLink,
  EMAIL_VERIFICATION_LINK_SECONDS,
  queueVerificationLink,
  resendAllowance,
  resendHeldMessage,
  verificationReason,
  withVerificationReason,
} from "./verification-links.ts";

/**
 * The paths that establish or recover a local credential (P8-T07a).
 *
 * Each of them carries the address in its body, so an enforced account is
 * refused before a password is checked, which also keeps the refusal from
 * saying whether the password was right.
 *
 * Sign-up is on the list because an account created locally on an enforced
 * domain would be exactly the credential enforcement exists to prevent, and
 * the reset path is because a reset link is a way to set a password on an
 * account that had none. Better Auth 1.7 has no `/forget-password` any more,
 * so the list no longer names it (account-lockout.md D11).
 */
const CREDENTIAL_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/request-password-reset",
]);

/**
 * **Every password check behind a session** (docs/design/
 * account-self-service.md D3, plan 0.8.0 Y3). Each counts toward the same
 * hold a sign-in does, and a success clears it. Counting only the password
 * change would leave four uncounted ways to test a password with a stolen
 * session cookie. `/verify-password` is off over HTTP, so what reaches it is
 * a server call (`auth.api.verifyPassword`), which runs these hooks too.
 *
 * This changes account-lockout.md §7, which said such checks were not
 * counted.
 */
const SESSION_PASSWORD_PATHS = new Set([
  "/change-password",
  "/verify-password",
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
]);

/**
 * **What a demonstration account may not change** (account-self-service.md
 * D1, D8 and AS-Q8). Its password is published, so one visitor changing it,
 * or turning a one-time code on, would lock every other visitor out until
 * the nightly rebuild.
 */
const DEMO_REFUSALS: Readonly<Record<string, string>> = {
  "/change-password":
    "Demonstration accounts keep their password. Anyone can sign in to them, so anyone could change it.",
  "/two-factor/enable":
    "Demonstration accounts keep their sign-in as it is. Anyone can sign in to them.",
  "/two-factor/disable":
    "Demonstration accounts keep their sign-in as it is. Anyone can sign in to them.",
};

/**
 * The password a session path checks, or null when Better Auth would refuse
 * the request before checking anything (D3). A malformed request is never
 * counted: a new password outside 12 to 128 characters, or a checked one
 * that is missing or past the maximum.
 */
function checkedPassword(path: string, body: unknown): string | null {
  const fields = (body ?? {}) as Record<string, unknown>;
  const checked =
    path === "/change-password" ? fields.currentPassword : fields.password;
  if (
    typeof checked !== "string" ||
    checked === "" ||
    checked.length > MAX_PASSWORD_LENGTH
  ) {
    return null;
  }
  if (path === "/change-password") {
    const next = fields.newPassword;
    if (
      typeof next !== "string" ||
      next.length < MIN_PASSWORD_LENGTH ||
      next.length > MAX_PASSWORD_LENGTH
    ) {
      return null;
    }
  }
  return checked;
}

/** The refusal for an account single sign-on claims (D8). */
function enforcedRefusal(provider: EnforcingProvider): APIError {
  return new APIError("FORBIDDEN", {
    message: enforcementMessage(provider),
    code: "SSO_ENFORCED",
  });
}

/**
 * The answer to a held attempt (account-lockout.md D12). The same words for
 * every address, so a hold says nothing about who has an account. The
 * seconds travel in the body as well as the header, because the browser
 * client hands a page the body and not the headers.
 */
function heldRefusal(retryAfterSeconds: number): APIError {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return new APIError(
    "TOO_MANY_REQUESTS",
    {
      message: `Too many attempts for this address. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}, or reset your password.`,
      code: "SIGN_IN_HELD",
      retryAfterSeconds,
    },
    { "Retry-After": String(retryAfterSeconds) },
  );
}

/**
 * The answer to a request for a link that this address's allowance refuses
 * (email-verification.md D9). The same words and the same shape for every
 * address, with the wait in the body as well as the header, as a sign-in
 * hold gives it.
 */
function resendHeldRefusal(retryAfterSeconds: number): APIError {
  return new APIError(
    "TOO_MANY_REQUESTS",
    {
      message: resendHeldMessage(retryAfterSeconds),
      code: "VERIFICATION_RESEND_HELD",
      retryAfterSeconds,
    },
    { "Retry-After": String(retryAfterSeconds) },
  );
}

/**
 * The audit row and the account holder's email when a run's first account
 * hold begins (account-lockout.md D13 and Q2).
 *
 * Only for an address that has an account, and never awaited by the attempt
 * that set it off: the reply to that attempt must take the same time whether
 * or not the account exists. The row names the user by id, never by address.
 */
async function announceAccountHold(
  pool: Pool,
  input: {
    readonly email: string;
    readonly failures: number;
    readonly holdSeconds: number;
    readonly baseUrl: string;
    readonly send: AuthOptions["sendSignInHeldNotice"];
  },
): Promise<void> {
  const { rows } = await pool.query<{ id: string; email: string }>(
    "select id, email from users where lower(email) = $1 limit 1",
    [input.email.trim().toLowerCase()],
  );
  const user = rows[0];
  if (!user) {
    return;
  }
  await recordInstanceAuditEvent(pool, {
    action: "auth.sign_in_held",
    payload: {
      userId: user.id,
      failures: input.failures,
      holdSeconds: input.holdSeconds,
    },
  });
  // openokr:allow-side-effect: the same arrangement as the reset mail.
  // Better Auth owns this request and there is no domain write, so there is
  // no outbox row to attach the mail to.
  await input.send?.({
    to: user.email,
    resetUrl: new URL("/forgot-password", input.baseUrl).toString(),
  });
}

/**
 * Accepts the invitation a freshly created account arrived with (P6-G06b).
 *
 * Two steps because they answer two questions. `previewInvite` runs in the
 * pre-tenant transaction and says which workspace the token names;
 * `invitations.acceptLink` then does the real work under that workspace, with
 * its own checks, its use count, its activity row and an audit row naming who
 * invited them. Going through the action rather than reimplementing it is what
 * keeps one writer for this row.
 */
async function acceptPendingInvitation(
  pool: Pool,
  token: string,
  userId: string,
  timezone: string | undefined,
): Promise<void> {
  const invitation = await previewInvite(pool, { token, now: new Date() });
  if (invitation.kind !== "usable") {
    return;
  }
  await callAction(
    {
      pool,
      workspaceId: invitation.workspaceId,
      actor: { kind: "human", userId },
    },
    "invitations.acceptLink",
    { token, ...(timezone ? { timezone } : {}) },
  );
}

export interface AuthOptions {
  /** The application-role pool. Authentication tables are global, so this is
   * used without a workspace setting. */
  readonly pool: Pool;
  /** Signs cookies and encrypts the two-factor secrets at rest. */
  readonly secret: string;
  /**
   * The instance's key ring, which seals identity-provider tokens at rest
   * (completeness review L-11).
   *
   * A function, read the first time a token is sealed or opened, so building
   * the instance needs no key and a password sign-in never reads one. The web
   * process passes its own ring, which `pnpm keys:rotate` covers. Absent, a
   * ring made for this process alone is used: a token is still never stored
   * as issued, and one sealed under it reads as absent after a restart,
   * which the next sign-in through that provider replaces.
   */
  readonly keyRing?: () => KeyRing;
  /** The instance's public origin. Passkeys are bound to it. */
  readonly baseUrl: string;
  /**
   * What the instance calls itself, as an authenticator app lists it and a
   * passkey prompt names it (completeness review M-33).
   *
   * Read when the instance is built, because Better Auth reads both off this
   * options object once per process: a rename reaches them at the next
   * restart. Changing either is safe. A passkey is bound to the origin, not to
   * its display name, and an authenticator entry keeps the name it was
   * created with. Absent says "OpenOKR".
   */
  readonly instanceName?: string;
  /**
   * Sends a password reset link. Defaults to writing it to the console,
   * which is what a fresh install does before mail is configured: the link
   * still works, so nothing is blocked on configuration.
   */
  readonly sendResetPassword?: (message: {
    to: string;
    url: string;
  }) => Promise<void>;
  /**
   * Brute-force protection. On everywhere by default, including tests, so
   * the behaviour is exercised rather than assumed. Tests that are about
   * something else turn it off to stay independent of each other.
   */
  readonly rateLimit?: { readonly enabled: boolean };
  /**
   * Where the address limiter keeps its count (account-lockout.md D10).
   * The web app passes the Postgres cache, so every replica shares one count.
   * Absent keeps Better Auth's in-process count, which is what a test or a
   * one-process command wants.
   */
  readonly rateLimitStorage?: AuthLimiterStorage;
  /**
   * Holding password sign-in after too many failures (docs/design/
   * account-lockout.md, plan 0.7.0 P10). On by default, tests included, like
   * the limiter above. A test about something else that makes many wrong
   * attempts turns it off.
   */
  readonly lockout?: { readonly enabled: boolean };
  /**
   * Tells the account holder that somebody is trying their password, when a
   * run's first account hold begins (account-lockout.md, Q2, approved by
   * Akmal on 9 November 2026). Absent means no mail, which is the right
   * pairing for a console transport: the audit row still records it.
   */
  readonly sendSignInHeldNotice?: (message: {
    to: string;
    resetUrl: string;
  }) => Promise<void>;
  /**
   * Whether a sign-in must wait for a verified address (P8-T02b), and with it
   * whether a confirmation link is queued at all (email-verification.md D6).
   *
   * Resolved by the caller from `mail.transport`, because Better Auth reads
   * this off an options object built once per process and the resolution is
   * a database read. `resolveRequireEmailVerification` is the one place that
   * decides; this is only where the answer arrives.
   *
   * Defaults to false, which is what every instance did before this option
   * existed. A caller that forgets it gets the old behaviour rather than a
   * locked-out instance.
   *
   * The link is queued on the outbox, which the relay sends through whatever
   * mail is configured. There is no send function to pass any more: the mail
   * used to go out inside the sign-up request, and a refused one left an
   * account nobody could confirm (plan 0.8.0 H1).
   */
  readonly requireEmailVerification?: boolean;
  /**
   * SSO provider configurations loaded from `sso_connections` (P8-T07). Each
   * OIDC entry becomes a genericOAuth provider that appears on the sign-in
   * page and flows through Better Auth's social-provider path.
   *
   * **Fixed for the life of this instance, and the instance is not for the
   * life of the process** (completeness review L-15). Better Auth reads its
   * plugins once, when it is built, so the web process builds a new instance
   * when these change, through `followSSOProviders` in `sso-refresh.ts`.
   *
   * An empty array means no SSO providers are configured. The plugin is
   * only included when at least one provider is present, so an instance
   * with no SSO pays nothing.
   */
  readonly ssoProviders?: ReadonlyArray<{
    /**
     * Which protocol this provider speaks (P8-T07c-a).
     *
     * Absent means `oidc`, which is what every caller written before SAML
     * existed supplies and what every row written before migration 0096
     * means.
     */
    readonly kind?: "oidc" | "saml";
    /** The `sso_connections` row id, which the derived plugin row carries. */
    readonly id?: string;
    readonly providerId: string;
    /**
     * The workspace that configured this provider (P8-T07b).
     *
     * What makes just-in-time provisioning land where it was meant to. The
     * field was loaded from `sso_connections` at boot and dropped here, so
     * the first person to sign in through their company's provider got a
     * fresh empty workspace of their own instead of the one that had
     * configured it.
     *
     * Optional, because an instance whose caller does not supply it keeps the
     * old behaviour rather than refusing to sign anybody in.
     */
    readonly workspaceId?: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly discoveryUrl?: string;
    readonly authorizationUrl?: string;
    readonly tokenUrl?: string;
    readonly userInfoUrl?: string;
    readonly scopes?: readonly string[];
  }>;
  /**
   * Framework glue, supplied by the caller.
   *
   * `packages/core` knows nothing about Next.js, so the plugin that lets a
   * server action set cookies belongs to the app rather than here. Better Auth
   * requires it last, so these are appended after the built-in plugins.
   */
  readonly plugins?: readonly BetterAuthPlugin[];
}

/** Failed sign-in attempts allowed per window before the caller is refused. */
const SIGN_IN_ATTEMPTS = 10;
const SIGN_IN_WINDOW_SECONDS = 60;

/**
 * The paths with a limit of their own. Every other auth path gets 100 a
 * minute. These are also the paths whose count every replica shares when a
 * storage is passed (account-lockout.md D10).
 */
const LIMIT_RULES = {
  "/sign-in/email": { window: SIGN_IN_WINDOW_SECONDS, max: SIGN_IN_ATTEMPTS },
  "/sign-up/email": { window: SIGN_IN_WINDOW_SECONDS, max: SIGN_IN_ATTEMPTS },
  "/two-factor/verify-totp": {
    window: SIGN_IN_WINDOW_SECONDS,
    max: SIGN_IN_ATTEMPTS,
  },
  "/two-factor/verify-backup-code": {
    window: SIGN_IN_WINDOW_SECONDS,
    max: SIGN_IN_ATTEMPTS,
  },
  // The path Better Auth 1.7 really serves. The rule used to name
  // `/forget-password`, which no longer exists, so Better Auth's own default
  // of 3 applied rather than this 5 (account-lockout.md D11).
  "/request-password-reset": { window: SIGN_IN_WINDOW_SECONDS, max: 5 },
  // Asking for a new confirmation link, per network (email-verification.md
  // D10). Five, as for a reset request, and in the shared count, where
  // Better Auth's own default was three in each process. The per-address
  // allowance is counted separately, in the hook below (D9).
  "/send-verification-email": { window: SIGN_IN_WINDOW_SECONDS, max: 5 },
  // Changing a password while signed in (account-self-service.md D11). Ten a
  // minute per network, in the shared count, where it fell under the
  // hundred-a-minute catch-all counted in each process. The hold counts each
  // wrong current password on top (D3).
  "/change-password": {
    window: SIGN_IN_WINDOW_SECONDS,
    max: SIGN_IN_ATTEMPTS,
  },
} as const;

export function createAuth(options: AuthOptions) {
  const database = drizzle(options.pool, { schema: authSchema });
  const origin = new URL(options.baseUrl);

  /**
   * Which workspace each SSO provider belongs to (P8-T07b).
   *
   * Built once, because the after-create hook has to answer it while a
   * browser waits mid-redirect and the providers are fixed for the life of
   * this instance anyway. A change builds another instance (L-15).
   */
  const workspaceByProvider = new Map<string, string>(
    (options.ssoProviders ?? []).flatMap((provider) =>
      provider.workspaceId ? [[provider.providerId, provider.workspaceId]] : [],
    ),
  );

  /**
   * The SAML providers, and which workspace each belongs to (P8-T07c-a).
   *
   * Built once beside `workspaceByProvider` above and for the same reason: the
   * plugin's `provisionUser` has to answer "which workspace" while a browser
   * waits mid-redirect, and the answer is fixed for the life of this instance.
   */
  /**
   * Every configured provider id, whichever protocol it speaks.
   *
   * Read by the registration rule to tell an arrival vouched for by a
   * provider this instance configured from a stranger signing up.
   */
  const ssoCallbackProviders = new Set(
    (options.ssoProviders ?? []).map((provider) => provider.providerId),
  );

  const samlProviders = (options.ssoProviders ?? []).filter(
    (provider) => provider.kind === "saml",
  );
  const samlWorkspaceByProvider = new Map<string, string>(
    samlProviders.flatMap((provider) =>
      // A provider with no workspace cannot provision anybody, so it is left
      // out of the map rather than mapped to nothing. `provisionUser` reads a
      // miss as "the authority is gone" and joins nothing, which is the same
      // answer and one fewer state.
      provider.workspaceId
        ? [[provider.providerId, provider.workspaceId] as [string, string]]
        : [],
    ),
  );

  const sendResetPassword =
    options.sendResetPassword ??
    (async ({ to, url }: { to: string; url: string }) => {
      // The console fallback. Mail is an instance connection that is optional
      // by design (TECHNICAL-PLAN §4.14), so this path has to work.
      //
      // **The link is not printed in production** (P7-T08d). A reset link is
      // not only personal data, it is a credential: anyone who can read the
      // process log can take the account, and container logs are usually
      // shipped somewhere. The address stays, so an operator can still see
      // that a reset was asked for and by whom, which is the part that helps
      // them and cannot be used to sign in.
      //
      // In development the link is printed, because a developer with no mail
      // server needs to click it and that is the whole reason this path
      // exists. Found by the P7-T08a privacy review on 11 September 2026.
      const printLink = process.env.NODE_ENV !== "production";
      const line = printLink
        ? `link: ${url}\n`
        : "link: withheld. Configure mail, or read it from the reset token in the database.\n";
      process.stdout.write(
        `\n--- password reset (no mailer configured) ---\nto:  ${to}\n${line}---------------------------------------------\n`,
      );
    });

  // `drizzleAdapter` returns a factory that Better Auth calls with its
  // resolved options, so the wrappers go around the adapter the factory
  // builds, not around the factory itself. Each touches one model: session
  // tokens are hashed, and identity-provider tokens on accounts are sealed.
  const adapterFactory = drizzleAdapter(database, {
    provider: "pg",
    schema: authSchema,
  });
  const keyRing = options.keyRing ?? processOnlyKeyRing();
  const lockoutEnabled = options.lockout?.enabled ?? true;
  const requireEmailVerification = options.requireEmailVerification ?? false;
  const rateLimitEnabled = options.rateLimit?.enabled ?? true;
  // Where each address's allowance of confirmation links is counted (D9):
  // the shared storage when there is one, so every replica sees one count.
  const resendStorage = options.rateLimitStorage ?? inProcessLimiter();

  /**
   * Two callbacks below need the instance they belong to: a completed reset
   * confirms the address through Better Auth's own adapter (D14), and a
   * repeat sign-up asks for a link the way the resend does (D12). Both run
   * long after the instance is built, so these are filled in once it is.
   */
  let contextOf:
    | (() => Promise<{
        internalAdapter: {
          updateUser(
            userId: string,
            data: Record<string, unknown>,
          ): Promise<unknown>;
        };
      }>)
    | undefined;
  let resendFromServer: ((email: string) => Promise<unknown>) | undefined;

  const auth = betterAuth({
    database: (betterAuthOptions: Parameters<typeof adapterFactory>[0]) =>
      withSecondFactorLockAudit(
        withSealedAccountTokens(
          withHashedSessionTokens(adapterFactory(betterAuthOptions)),
          keyRing,
        ),
        // The moment a second factor locks (account-lockout.md D13). Its
        // own row, because the lock is Better Auth's and nothing else sees it.
        (userId) =>
          recordInstanceAuditEvent(options.pool, {
            action: "auth.second_factor_locked",
            payload: { userId },
          }),
      ),

    secret: options.secret,
    baseURL: options.baseUrl,
    basePath: "/api/auth",

    // The endpoints no screen uses answer 404 over HTTP
    // (account-self-service.md D26, plan 0.8.0 Y6). Built from the inventory
    // in `endpoints.ts`, whose test fails when Better Auth serves a path the
    // inventory does not classify. A server call through `auth.api` never
    // meets this list.
    disabledPaths: [...DISABLED_AUTH_PATHS],

    emailAndPassword: {
      enabled: true,
      // Verification is not required to sign in unless the instance can
      // actually send mail. A self-hosted first run has no mail server, and
      // blocking the first login on an email nobody can receive would make
      // the product unusable out of the box. `mail.transport` is what
      // decides, resolved by the caller at boot (P8-T02b): the question is
      // whether a link can arrive, not whether this is a managed cloud.
      requireEmailVerification,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      // A completed reset signs every device out (email-verification.md
      // D15). With D14 below it is what lets the owner of an address take it
      // back from somebody who signed up with it first: their reset confirms
      // the address and ends the other person's sessions.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // openokr:allow-side-effect: Better Auth owns this request's
        // transaction and calls back outside the Operation pipeline, so
        // there is no outbox row to attach the mail to. The reset link is
        // sent in response to a request, not as a consequence of a domain
        // write.
        await sendResetPassword({ to: user.email, url });
      },
      // A completed reset ends any hold on the account at once
      // (account-lockout.md D7). No caller is marked as known: whoever opens
      // a reset link has proved the mailbox, not the network.
      onPasswordReset: async ({ user }, request) => {
        if (lockoutEnabled) {
          await clearSignInAttempts(options.pool, {
            secret: options.secret,
            email: user.email,
          });
        }
        // **A completed reset is a password change** (account-self-service.md
        // D9, D13): one audit row, and a mail to the account's address.
        // Somebody with brief access to the mailbox should not be able to
        // take the account in silence. Every session ended with it (D15 of
        // email-verification.md). Never throws.
        await recordPasswordChange(options.pool, {
          userId: user.id,
          via: "reset",
          otherSessionsEnded: true,
          address: callerAddress(request?.headers ?? new Headers()),
        });
        // **A completed reset confirms the address** (email-verification.md
        // D14). The reset link reached the mailbox, which is the same proof a
        // confirmation link gives, and it is the second way out for an
        // account whose first mail never arrived. Through Better Auth's own
        // adapter, so its user-update hooks run, and never by direct SQL.
        if (!user.emailVerified) {
          try {
            const context = await contextOf?.();
            await context?.internalAdapter.updateUser(user.id, {
              emailVerified: true,
            });
            await recordInstanceAuditEvent(options.pool, {
              action: "auth.email_verified",
              payload: { userId: user.id, via: "reset" },
            });
          } catch (error) {
            // The password is already changed; this never undoes it. The
            // next reset, or a confirmation link, confirms the address.
            process.stderr.write(
              `auth: could not confirm an address after a reset: ${error instanceof Error ? error.message : String(error)}\n`,
            );
          }
        }
      },
      /**
       * **Signing up again with an unconfirmed address queues a fresh link**
       * (email-verification.md D12). It is what a person whose first mail
       * never came does first, and the check-your-email card they see says a
       * link was sent. Not awaited, so a repeat takes no longer for having an
       * account, and drawn on the same per-address allowance as the button:
       * a spent allowance queues nothing, silently. A confirmed address gets
       * nothing (Q3), and the answer to the sign-up is Better Auth's generic
       * success either way.
       */
      onExistingUserSignUp: async ({ user }) => {
        const resend = resendFromServer;
        if (!requireEmailVerification || user.emailVerified || !resend) {
          return;
        }
        void withVerificationReason("repeat_sign_up", () =>
          resend(user.email),
        ).catch(() => undefined);
      },
    },

    emailVerification: {
      // A day (email-verification.md D13). Every page that tells a person to
      // open the link reads the same constant.
      expiresIn: EMAIL_VERIFICATION_LINK_SECONDS,
      // Queued on sign-up only where a link can arrive. With a console
      // transport nothing is queued and nothing is written to the log.
      sendOnSignUp: requireEmailVerification,
      /**
       * **Queued on the outbox, never sent here** (email-verification.md D1
       * to D4, plan 0.8.0 H1). The row is written on the pool in its own
       * statement rather than inside a domain transaction, because Better
       * Auth committed the user row before calling back and hands this no
       * transaction to join (D2). It never throws (D3).
       *
       * Always present, so the resend endpoint answers on every instance;
       * with a console transport it queues nothing.
       */
      sendVerificationEmail: async ({ user, url, token }, request) => {
        // The account that claims the instance is created verified, and a
        // link asking it to confirm again would only confuse (BUG-028).
        if (!requireEmailVerification || user.emailVerified) {
          return;
        }
        await queueVerificationLink(options.pool, {
          userId: user.id,
          to: user.email,
          url,
          token,
          lifetimeSeconds: EMAIL_VERIFICATION_LINK_SECONDS,
          reason: verificationReason("sign_up", request),
        });
      },
      /**
       * One instance audit row when an address is confirmed by its link
       * (D17). Better Auth calls this only on the change from unconfirmed to
       * confirmed, so an old link opened again writes nothing. Y4's change of
       * address reaches this callback too, and adds its own branch when it
       * lands (account-self-service.md D20).
       */
      afterEmailVerification: async (user) => {
        try {
          await recordInstanceAuditEvent(options.pool, {
            action: "auth.email_verified",
            payload: { userId: user.id, via: "link" },
          });
        } catch (error) {
          // The address is confirmed already; a missing row never undoes it.
          process.stderr.write(
            `auth: could not record a confirmed address: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },

    advanced: {
      // Http-only, same-site cookies. Secure is added automatically when the
      // base URL is https, which keeps a local http instance working.
      useSecureCookies: origin.protocol === "https:",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
      },
      // Every deployment target puts a reverse proxy in front of the app
      // (deploy/docker ships one), so the socket address is the proxy and the
      // caller's address is in a header. Rate limits and the session row are
      // keyed on it, which is why it has to be read rather than ignored.
      // Which header, and which proxies are walked past, is the deployment's
      // choice (docs/design/trusted-proxies.md). Every other per-address
      // limit reads the same block through `callerAddress()`.
      ipAddress: callerAddressOptions(),
    },

    rateLimit: {
      // Brute-force protection (TECHNICAL-PLAN §8.2). Enabled in every
      // environment, not just production, so the behaviour is tested.
      enabled: options.rateLimit?.enabled ?? true,
      window: SIGN_IN_WINDOW_SECONDS,
      max: 100,
      // One count for every replica on the paths with a rule of their own,
      // when the caller has somewhere to keep it (account-lockout.md D10).
      // Everything else, a session check above all, stays in the process, so
      // reading a session never costs a query.
      ...(options.rateLimitStorage
        ? {
            customStorage: routedByPath(
              new Set(Object.keys(LIMIT_RULES)),
              options.rateLimitStorage,
              inProcessLimiter(),
            ),
          }
        : {}),
      customRules: LIMIT_RULES,
    },

    hooks: {
      /**
       * Single-sign-on enforcement, at the paths that carry an address
       * (P8-T07a).
       *
       * Before the endpoint rather than inside it, so one rule covers a
       * sign-in, a sign-up and both reset paths, and so a future local factor
       * that posts an address has to be added here deliberately rather than
       * quietly becoming a way around the policy.
       *
       * The session hook below is the other half, for the factors that carry
       * no address.
       */
      before: createAuthMiddleware(async (hookContext) => {
        /**
         * **Each address's allowance of confirmation links** (email-
         * verification.md D9): one a minute and five a day, whatever network
         * asks. Counted for every address before Better Auth looks it up, so
         * the refusal is the same whether or not it has an account.
         */
        if (hookContext.path === "/send-verification-email") {
          const email = (hookContext.body as { email?: unknown } | undefined)
            ?.email;
          if (!rateLimitEnabled || typeof email !== "string" || email === "") {
            return;
          }
          const verdict = await resendAllowance(
            resendStorage,
            options.secret,
            email,
          );
          if (!verdict.allowed) {
            countVerificationLink(verificationReason("resend"), "refused");
            throw resendHeldRefusal(verdict.retryAfterSeconds);
          }
          return;
        }

        /**
         * **A password checked behind a session** (account-self-service.md
         * D3, D8). In this order: a demonstration account and an account
         * single sign-on claims are refused before anything is checked, so
         * Better Auth never ends sessions for a change that cannot stand;
         * a request Better Auth would refuse unchecked is let through
         * uncounted; then the attempt is counted against the account's hold,
         * exactly as a sign-in is, and a held one is refused unchecked.
         */
        if (SESSION_PASSWORD_PATHS.has(hookContext.path)) {
          const session = await getSessionFromCtx(hookContext);
          if (!session) {
            // No session: the endpoint answers 401 itself.
            return;
          }
          const user = session.user as { id: string; email: string };
          const demoRefusal = DEMO_REFUSALS[hookContext.path];
          if (demoRefusal && isDemoAccount(user.email)) {
            throw new APIError("FORBIDDEN", {
              message: demoRefusal,
              code: "DEMO_ACCOUNT",
            });
          }
          if (hookContext.path === "/change-password") {
            const provider = await enforcedProviderForUser(
              options.pool,
              user.id,
            );
            if (provider) {
              throw enforcedRefusal(provider);
            }
          }
          if (
            !lockoutEnabled ||
            checkedPassword(hookContext.path, hookContext.body) === null ||
            !(await accountHasPassword(options.pool, user.id))
          ) {
            return;
          }
          const verdict = await recordPasswordAttempt(options.pool, {
            secret: options.secret,
            email: user.email,
            callerAddress: callerAddress(hookContext.headers ?? new Headers()),
          });
          if (verdict.held) {
            defaultMetrics().count(METRIC.signInHeldTotal, {
              scope: verdict.scope,
            });
            throw heldRefusal(verdict.retryAfterSeconds);
          }
          if (verdict.accountHoldBegan) {
            void announceAccountHold(options.pool, {
              email: user.email,
              ...verdict.accountHoldBegan,
              baseUrl: options.baseUrl,
              send: options.sendSignInHeldNotice,
            }).catch((error: unknown) => {
              process.stderr.write(
                `auth: could not record a sign-in hold: ${error instanceof Error ? error.message : String(error)}\n`,
              );
            });
          }
          return;
        }

        if (!CREDENTIAL_PATHS.has(hookContext.path)) {
          return;
        }
        const email = (hookContext.body as { email?: unknown } | undefined)
          ?.email;
        if (typeof email !== "string" || email === "") {
          return;
        }
        const provider = await enforcedProviderForEmail(options.pool, email);
        if (provider) {
          throw new APIError("FORBIDDEN", {
            message: enforcementMessage(provider),
          });
        }

        // **The hold** (account-lockout.md D6). After enforcement, so an
        // enforced account is refused for that reason and never counted.
        // Only a password is counted: a passkey, single sign-on, a reset
        // request and a sign-up are the ways round a hold (D8).
        if (!lockoutEnabled || hookContext.path !== "/sign-in/email") {
          return;
        }
        const verdict = await recordPasswordAttempt(options.pool, {
          secret: options.secret,
          email,
          callerAddress: callerAddress(hookContext.headers ?? new Headers()),
        });
        if (verdict.held) {
          defaultMetrics().count(METRIC.signInHeldTotal, {
            scope: verdict.scope,
          });
          throw heldRefusal(verdict.retryAfterSeconds);
        }
        if (verdict.accountHoldBegan) {
          void announceAccountHold(options.pool, {
            email,
            ...verdict.accountHoldBegan,
            baseUrl: options.baseUrl,
            send: options.sendSignInHeldNotice,
          }).catch((error: unknown) => {
            process.stderr.write(
              `auth: could not record a sign-in hold: ${error instanceof Error ? error.message : String(error)}\n`,
            );
          });
        }
      }),

      /**
       * A matched password forgives the count (account-lockout.md D7), even
       * when no session follows yet: a second factor still to come, or an
       * address still to confirm, which Better Auth says only after the
       * password matched. The session hook below covers every other factor.
       */
      after: createAuthMiddleware(async (hookContext) => {
        /**
         * **A password checked behind a session, and accepted** (account-
         * self-service.md D3, D9). Only a success clears the account's
         * counts: clearing on anything but a wrong password would let a
         * guesser reset the count with a deliberately broken request. No
         * address is marked as known; that is a sign-in's to do.
         *
         * A changed password is recorded and mailed here, so the screen and a
         * direct call to the endpoint are recorded alike.
         */
        if (SESSION_PASSWORD_PATHS.has(hookContext.path)) {
          const returned = hookContext.context.returned;
          if (returned === undefined || returned instanceof Error) {
            return;
          }
          const sessionUser = (
            hookContext.context.session as {
              user?: { id?: unknown; email?: unknown };
            } | null
          )?.user;
          const changedUser = (returned as { user?: { id?: unknown } }).user;
          const email = sessionUser?.email;
          if (lockoutEnabled && typeof email === "string") {
            await clearSignInAttempts(options.pool, {
              secret: options.secret,
              email,
            });
          }
          if (hookContext.path === "/change-password") {
            const userId = changedUser?.id ?? sessionUser?.id;
            if (typeof userId === "string") {
              await recordPasswordChange(options.pool, {
                userId,
                via: "change",
                otherSessionsEnded:
                  (hookContext.body as { revokeOtherSessions?: unknown })
                    ?.revokeOtherSessions === true,
                address: callerAddress(hookContext.headers ?? new Headers()),
              });
            }
          }
          return;
        }

        if (!lockoutEnabled || hookContext.path !== "/sign-in/email") {
          return;
        }
        const email = (hookContext.body as { email?: unknown } | undefined)
          ?.email;
        if (typeof email !== "string" || email === "") {
          return;
        }
        const returned = hookContext.context.returned;
        const matched =
          returned instanceof Error
            ? (returned as { body?: { code?: unknown } }).body?.code ===
              "EMAIL_NOT_VERIFIED"
            : true;
        if (matched) {
          await clearSignInAttempts(options.pool, {
            secret: options.secret,
            email,
          });
        }
      }),
    },

    databaseHooks: {
      session: {
        create: {
          /**
           * The enforcement backstop (P8-T07a).
           *
           * A passkey assertion carries no address, so the middleware above
           * cannot see whose sign-in it is. Every sign-in ends in a session
           * row, though, whatever factor produced it, so this is the one
           * place that catches all of them: the account is looked up by id,
           * and a session for an enforced address is refused unless it is the
           * identity provider's own callback that is creating it.
           *
           * It costs one small query per sign-in on an instance with no
           * enforcement configured, and that query answers before the
           * account is ever read.
           */
          before: async (session, hookContext) => {
            if (isProviderSignInPath(hookContext?.path)) {
              return;
            }
            const userId = (session as { userId?: unknown }).userId;
            if (typeof userId !== "string") {
              return;
            }
            const provider = await enforcedProviderForUser(
              options.pool,
              userId,
            );
            if (provider) {
              throw new APIError("FORBIDDEN", {
                message: enforcementMessage(provider),
              });
            }
          },
          /**
           * **A session by any factor clears the account's counts**
           * (account-lockout.md D7), and marks the caller's address as known
           * for 30 days, so the account counter never holds that desk (D4).
           *
           * A session made with no request behind it marks nothing. A failure
           * here never undoes the sign-in: the worst it leaves is a count
           * that a later success or a quiet day clears.
           */
          after: async (session, hookContext) => {
            if (!lockoutEnabled) {
              return;
            }
            try {
              const { rows } = await options.pool.query<{ email: string }>(
                "select email from users where id = $1",
                [session.userId],
              );
              const email = rows[0]?.email;
              if (!email) {
                return;
              }
              await clearSignInAttempts(options.pool, {
                secret: options.secret,
                email,
                // A session a password change or a second factor made is not
                // a sign-in, so it marks no address as known (D3).
                ...(hookContext?.headers &&
                !SESSION_PASSWORD_PATHS.has(hookContext.path ?? "")
                  ? { callerAddress: callerAddress(hookContext.headers) }
                  : {}),
              });
            } catch (error) {
              process.stderr.write(
                `auth: could not clear sign-in counts: ${error instanceof Error ? error.message : String(error)}\n`,
              );
            }
          },
        },
      },
      account: {
        create: {
          /**
           * Which accounts a single sign-on connection may attach to
           * (docs/design/sso-account-trust.md).
           *
           * Better Auth links a provider sign-in to an existing account with
           * the same email by itself. A connection belongs to one workspace,
           * so only that workspace's members, or an account with nothing else
           * behind it, may be attached. Providers that are not workspace
           * connections (the password account, passkeys) pass through.
           */
          before: async (account) => {
            const providerId = (account as { providerId?: unknown }).providerId;
            const userId = (account as { userId?: unknown }).userId;
            if (typeof providerId !== "string" || typeof userId !== "string") {
              return;
            }
            const workspaceId = workspaceByProvider.get(providerId);
            if (!workspaceId) {
              return;
            }
            if (!(await ssoLinkAllowed(options.pool, userId, workspaceId))) {
              throw new APIError("FORBIDDEN", {
                message:
                  "This account is not a member of the workspace that owns this sign-in provider.",
              });
            }
          },
        },
      },
      user: {
        create: {
          /**
           * The registration policy (§4.14): open until somebody has claimed
           * this instance, invitation-only afterwards. Refusing here rather
           * than at the route covers every path that creates a user, so a
           * future social or single-sign-on provider cannot quietly reopen
           * registration by not knowing about the rule.
           */
          before: async (user, hookContext) => {
            // **The account that claims the instance is admitted whatever
            // the policy says** (docs/design/registration-policy.md §10 D17,
            // plan 0.8.0 H3). Unclaimed is setup unfinished and no account,
            // the same test the wizard's own guard reads. The setup wizard's
            // sign-up is the claim, so a policy that refused it, such as
            // `OPENOKR_REGISTRATION=invite_only` set before the first run,
            // left an instance nobody could ever claim. A closed policy means
            // closed behind the owner, and governs every account after this
            // one. Whoever reaches an unclaimed instance first claims it,
            // which is the rule with no policy too (D18).
            //
            // **And it arrives verified** (UAT BUG-028). The setup wizard
            // signs up and finishes setup in one go, which needs a session.
            // With mail configured before the first run, verification is
            // required, so the sign-up gave no session, setup could not
            // finish, and every later sign-in was refused as unverified.
            // Whoever runs the wizard is the operator who deployed it, so
            // there is nobody to prove the address to.
            const setup = await readSetupState(options.pool);
            if (!setup.configured && !setup.hasUser) {
              return { data: { ...user, emailVerified: true } };
            }

            // **An invitation is the exception, and the only one** (P6-G06b).
            // A closed instance was closed to everybody, including the person
            // an administrator had just invited, so every invitation issued
            // since P6-G06a was unredeemable on exactly the instances that
            // needed it.
            //
            // The same function the sign-up page asks, because the two
            // disagreeing is its own bug: the page refused a form this hook
            // would have accepted, so the invitation was redeemable and
            // unreachable at once. Previewed, not accepted, so nothing is
            // **A directory-sync token is the second exception** (P8-T08a).
            // It is an authorisation the workspace itself issued, verified
            // before this call was made, and it arrives in the async context
            // rather than in a cookie because a directory has no browser. An
            // invitation-only instance is exactly the kind that runs a
            // directory, so without this the rule refused every account SCIM
            // tried to provision.
            if (currentProvisioningAuthority()) {
              return;
            }

            // **A configured identity provider is the third** (P8-T07c-a).
            //
            // Configuring a provider is a workspace saying "admit the people
            // this provider vouches for", which is the same kind of statement
            // a directory token makes and is made by the same people. Without
            // it, just-in-time provisioning cannot work on an
            // invitation-only instance, which is every instance after its
            // first account: the assertion verifies, the audience matches,
            // and the account is refused at the last step. That is the
            // P8-T07 acceptance criterion, "when a user signs in through it,
            // then they are provisioned with default access", and it could
            // not hold.
            //
            // Found on 18 September 2026 by driving a real SAML assertion all
            // the way through rather than by reading, which is the only way
            // this was ever going to surface: every layer before it answered
            // correctly.
            //
            // The path is the evidence and it cannot be forged from outside:
            // Better Auth builds it from the route it dispatched, and these
            // two routes are reached only after the provider's own signature
            // or token exchange has been verified.
            if (
              isSSOCallbackPath(
                hookContext?.path,
                hookContext?.params,
                ssoCallbackProviders,
              )
            ) {
              return;
            }

            // consumed by an attempt that may still fail on a taken address.
            //
            // **The address is what makes this the real decision, not the
            // sign-up page's preview of it.** A token admits the one address
            // it was issued to, or the domains a shared link named; passing
            // `user.email` is what stops a personal invitation for one
            // address from opening registration for any address (manual UAT,
            // 29 September 2026, M04-03 — see `registrationOpenOrInvited`'s
            // own comment for the failure this closes).
            // The refusal says which rule refused: closed, or open to
            // company addresses only (docs/design/registration-policy.md §3).
            const refusal = await registrationRefusal(
              options.pool,
              cookieHeaderFrom(hookContext),
              user.email,
            );
            if (refusal !== null) {
              throw new APIError("FORBIDDEN", { message: refusal });
            }
            return;
          },
          /**
           * Provisioning. Better Auth queues after-create hooks and drains
           * them once its own transaction has committed, so this runs on a
           * real, committed user and opens a transaction of its own rather
           * than nesting inside one it does not control.
           *
           * A failure here therefore leaves a user with no workspace. That is
           * why provisioning is idempotent and why the web app repairs the
           * state on the next request instead of trusting this to be the only
           * path that ever runs.
           */
          after: async (user, hookContext) => {
            // **The invitation is accepted before a workspace is created, and
            // the order is the whole of it** (P6-G06b). An invitee belongs in
            // the workspace that invited them;
            // `provisionWorkspaceForUser` returns the membership it finds
            // rather than making a second one, so accepting first leaves it a
            // no-op and creating first would leave every invitee holding a
            // stray empty workspace of their own.
            //
            // A failure here is swallowed on purpose. The account exists by
            // now, and refusing to provision anything would leave somebody
            // signed up with nowhere to go; `/join` still works afterwards,
            // and the fall-through gives them their own workspace meanwhile.
            const cookies = cookieHeaderFrom(hookContext);
            // **The browser's timezone, for whatever this sign-up makes**
            // (TECHNICAL-PLAN §4.14, docs/design/browser-timezone.md): their
            // own workspace, or their membership of somebody else's. Read
            // once, here, because every path below needs it and none of them
            // sees the request. `undefined` when there is no browser behind
            // the request, which is a SCIM call, and the fallback applies.
            const timezone = browserTimezoneFromCookies(cookies);
            const token = inviteTokenFromCookies(cookies);
            if (token) {
              await acceptPendingInvitation(
                options.pool,
                token,
                user.id,
                timezone,
              ).catch(() => undefined);
            }

            // **An identity provider vouching for somebody works the same
            // way, and for the same reason** (P8-T07b). The provider was
            // configured by one workspace, so the person signing in through
            // it belongs there, and joining before the line below means
            // `provisionWorkspaceForUser` finds that membership instead of
            // making a workspace of their own.
            //
            // Until this existed, every just-in-time account landed alone in
            // a fresh empty workspace and never saw the one whose provider
            // they had used, which is the opposite of the P8-T07 deliverable.
            //
            // A directory-sync token says the same thing about the account it
            // is provisioning, so the two land in one place rather than the
            // SCIM path repeating this afterwards and leaving a stray
            // workspace in between (P8-T08a).
            const authority = currentProvisioningAuthority();

            // **A demo persona is attached, not provisioned** (P8-T13a). The
            // cast are members of the demo workspace before they have
            // accounts, so the command that gives Priya one is filling in the
            // `user_id` of a row that already exists. Joining her as well
            // would put her in the directory twice, and provisioning below
            // would hand her a private workspace of her own that nobody ever
            // opens. The caller does the attaching, inside its own operation.
            if (authority?.kind === "demo") {
              return;
            }

            const workspaceId =
              authority?.workspaceId ??
              workspaceByProvider.get(
                providerIdFromCallback(hookContext?.path, hookContext?.params),
              );
            if (workspaceId) {
              await tryJoinWorkspaceForIdentity(options.pool, {
                workspaceId,
                user: { id: user.id, name: user.name },
                via: authority ? "directory_sync" : "sso",
                ...(authority?.externalId
                  ? { externalId: authority.externalId }
                  : {}),
                ...(timezone ? { timezone } : {}),
              });
            }

            // **A workspace that trusts their domain is offered first**
            // (completeness review M-34). Their address is not confirmed yet,
            // so nothing can be offered now; what this decides is only to
            // hold off making them a workspace of their own. The first page
            // they open after confirming asks again, offers what their
            // domain admits, and makes their own workspace only if they
            // choose it or nothing is on offer. Making it here would leave
            // everybody who joins their company's workspace holding a stray
            // empty one. Somebody already joined above loses nothing: the
            // line below would only have returned that membership.
            if (
              await domainIsTrusted(options.pool, user.email).catch(() => false)
            ) {
              return;
            }

            await provisionWorkspaceForUser(
              options.pool,
              { id: user.id, name: user.name },
              timezone ? { timezone } : {},
            );
          },
        },
      },
    },

    plugins: [
      // One-time codes with backup codes. The shared secret and the codes are
      // encrypted with the instance secret before they reach the database.
      twoFactor({
        issuer: instanceNameOr(options.instanceName),
        // Better Auth's own defaults, written down (account-lockout.md D9):
        // ten wrong codes in a row, across challenges and factors, lock the
        // second factor for 15 minutes. Explicit, so an upgrade that changes
        // a default shows in a diff rather than in production.
        accountLockout: {
          enabled: true,
          maxFailedAttempts: 10,
          durationSeconds: 900,
        },
      }),
      // Passkeys, bound to this origin.
      passkey({
        rpID: origin.hostname,
        rpName: instanceNameOr(options.instanceName),
        origin: options.baseUrl,
      }),
      // SSO providers (P8-T07). Each entry read from `sso_connections` and
      // passed through `genericOAuth`, which resolves them once, in its
      // `init`, and registers them as social providers on the standard
      // `signIn.social` flow. Only included when at least one provider is
      // configured: an instance with no SSO carries no plugin, no route and
      // no schema contribution.
      ...(options.ssoProviders && options.ssoProviders.length > 0
        ? [
            genericOAuth({
              config: options.ssoProviders.map((p) => ({
                providerId: p.providerId,
                clientId: p.clientId,
                clientSecret: p.clientSecret,
                ...(p.discoveryUrl ? { discoveryUrl: p.discoveryUrl } : {}),
                ...(p.authorizationUrl
                  ? { authorizationUrl: p.authorizationUrl }
                  : {}),
                ...(p.tokenUrl ? { tokenUrl: p.tokenUrl } : {}),
                ...(p.userInfoUrl ? { userInfoUrl: p.userInfoUrl } : {}),
                ...(p.scopes ? { scopes: [...p.scopes] } : {}),
              })),
            }),
          ]
        : []),
      /**
       * SAML (P8-T07c-a).
       *
       * **Mounted only when a SAML provider is configured**, the same rule
       * `genericOAuth` follows above: an instance with none carries no
       * plugin, no route and no schema contribution.
       *
       * The plugin reads its providers from `sso_providers`, which
       * `saml-sync.ts` derives from `sso_connections`, on every request.
       * That made SAML look as if it needed no restart, but the plugin is
       * only here when a SAML provider existed when this instance was built,
       * and the workspace map above is fixed then too. So the first SAML
       * provider on an instance waited for a restart like every OIDC one,
       * until the instance began to be rebuilt on a change (L-15).
       */
      ...(samlProviders.length > 0
        ? [
            sso({
              /**
               * **Where a SAML arrival meets the member funnel** (P8-T07c-a).
               *
               * P8-T07b built one path that both single sign-on and directory
               * sync call, so that somebody arriving through a provider lands
               * in the workspace that configured it rather than alone in a new
               * one. This is that path, reached from the plugin's own seam, so
               * a SAML arrival and an OIDC arrival are the same arrival.
               *
               * The workspace comes from the provider, not from anything the
               * assertion carries. An identity provider says who somebody is;
               * it does not get to say which workspace they join.
               */
              provisionUser: async ({ user, provider }) => {
                const workspaceId = samlWorkspaceByProvider.get(
                  provider.providerId,
                );
                if (!workspaceId) {
                  // A provider with no workspace behind it is a derived row
                  // whose authority is gone. Joining nothing is right; the
                  // sign-in still fails, because the session has no member.
                  return;
                }
                await tryJoinWorkspaceForIdentity(options.pool, {
                  workspaceId,
                  user: { id: user.id, name: user.name },
                  via: "sso",
                });
              },
              /**
               * Off. Better Auth's organization plugin is not what this
               * product uses for membership; `provisionUser` above is.
               */
              organizationProvisioning: { disabled: true },
              /**
               * **No provider is ever registered through the plugin**
               * (account-self-service.md D26). Its rows are derived from
               * `sso_connections` by `saml-sync.ts`, which writes them
               * itself. The HTTP path is off as well; this refuses a server
               * call too, which `disabledPaths` never sees.
               */
              providersLimit: 0,
            }),
          ]
        : []),
      ...(options.plugins ?? []),
    ],
  });

  contextOf = () => auth.$context;
  resendFromServer = (email) =>
    auth.api.sendVerificationEmail({
      body: { email, callbackURL: "/email-confirmed" },
    });
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
