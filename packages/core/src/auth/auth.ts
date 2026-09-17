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
import { authSchema } from "@openokr/db";
import type { BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { callAction } from "../actions/registry.ts";
import {
  cookieHeaderFrom,
  inviteTokenFromCookies,
} from "../invitations/pending.ts";
import { previewInvite } from "../invitations/preview.ts";
import { provisionWorkspaceForUser } from "../workspaces/provisioning.ts";
import {
  REGISTRATION_CLOSED_MESSAGE,
  registrationOpenOrInvited,
} from "../workspaces/registration.ts";
import { withHashedSessionTokens } from "./session-hashing.ts";
import {
  enforcedProviderForEmail,
  enforcedProviderForUser,
  enforcementMessage,
  isProviderSignInPath,
} from "./sso-enforcement.ts";

/**
 * The paths that establish or recover a local credential (P8-T07a).
 *
 * Each of them carries the address in its body, so an enforced account is
 * refused before a password is checked, which also keeps the refusal from
 * saying whether the password was right.
 *
 * Sign-up is on the list because an account created locally on an enforced
 * domain would be exactly the credential enforcement exists to prevent, and
 * the two reset paths are because a reset link is a way to set a password on
 * an account that had none.
 */
const CREDENTIAL_PATHS = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/forget-password",
  "/request-password-reset",
]);

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
    { token },
  );
}

export interface AuthOptions {
  /** The application-role pool. Authentication tables are global, so this is
   * used without a workspace setting. */
  readonly pool: Pool;
  /** Signs cookies and encrypts the two-factor secrets at rest. */
  readonly secret: string;
  /** The instance's public origin. Passkeys are bound to it. */
  readonly baseUrl: string;
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
   * Whether a sign-in must wait for a verified address (P8-T02b).
   *
   * Resolved by the caller from `mail.transport`, because Better Auth reads
   * this off an options object built once per process and the resolution is
   * a database read. `resolveRequireEmailVerification` is the one place that
   * decides; this is only where the answer arrives.
   *
   * Defaults to false, which is what every instance did before this option
   * existed. A caller that forgets it gets the old behaviour rather than a
   * locked-out instance.
   */
  readonly requireEmailVerification?: boolean;
  /**
   * Sends the verification link. Absent means no verification mail is ever
   * sent, which is the right pairing for a console transport.
   */
  readonly sendVerificationEmail?: (message: {
    to: string;
    url: string;
  }) => Promise<void>;
  /**
   * SSO provider configurations loaded from `sso_connections` at boot
   * (P8-T07). Each entry becomes a genericOAuth provider that appears on
   * the sign-in page and flows through Better Auth's social-provider path.
   *
   * An empty array means no SSO providers are configured. The plugin is
   * only included when at least one provider is present, so an instance
   * with no SSO pays nothing.
   */
  readonly ssoProviders?: ReadonlyArray<{
    readonly providerId: string;
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

export function createAuth(options: AuthOptions) {
  const database = drizzle(options.pool, { schema: authSchema });
  const origin = new URL(options.baseUrl);

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
  // resolved options, so the hashing wrapper goes around the adapter the
  // factory builds, not around the factory itself.
  const adapterFactory = drizzleAdapter(database, {
    provider: "pg",
    schema: authSchema,
  });

  return betterAuth({
    database: (betterAuthOptions: Parameters<typeof adapterFactory>[0]) =>
      withHashedSessionTokens(adapterFactory(betterAuthOptions)),

    secret: options.secret,
    baseURL: options.baseUrl,
    basePath: "/api/auth",

    emailAndPassword: {
      enabled: true,
      // Verification is not required to sign in unless the instance can
      // actually send mail. A self-hosted first run has no mail server, and
      // blocking the first login on an email nobody can receive would make
      // the product unusable out of the box. `mail.transport` is what
      // decides, resolved by the caller at boot (P8-T02b): the question is
      // whether a link can arrive, not whether this is a managed cloud.
      requireEmailVerification: options.requireEmailVerification ?? false,
      minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) => {
        // openokr:allow-side-effect: Better Auth owns this request's
        // transaction and calls back outside the Operation pipeline, so
        // there is no outbox row to attach the mail to. The reset link is
        // sent in response to a request, not as a consequence of a domain
        // write.
        await sendResetPassword({ to: user.email, url });
      },
    },

    emailVerification: {
      // Sent on sign-up only where a link can arrive. With a console
      // transport there is no callback, so nothing is sent and nothing is
      // written to the log either.
      sendOnSignUp: Boolean(options.sendVerificationEmail),
      sendVerificationEmail: async ({ user, url }) => {
        // openokr:allow-side-effect: the same arrangement `sendResetPassword`
        // has above. Better Auth owns this request's transaction and calls
        // back outside the Operation pipeline, so there is no outbox row to
        // attach the mail to. The link is sent in response to a request, not
        // as a consequence of a domain write.
        await options.sendVerificationEmail?.({ to: user.email, url });
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
      ipAddress: {
        // Every deployment target puts a reverse proxy in front of the app
        // (deploy/docker ships one), so the socket address is the proxy and
        // the caller's address is in this header. Rate limits are keyed on
        // it, which is why it has to be read rather than ignored.
        ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
      },
    },

    rateLimit: {
      // Brute-force protection (TECHNICAL-PLAN §8.2). Enabled in every
      // environment, not just production, so the behaviour is tested.
      enabled: options.rateLimit?.enabled ?? true,
      window: SIGN_IN_WINDOW_SECONDS,
      max: 100,
      customRules: {
        "/sign-in/email": {
          window: SIGN_IN_WINDOW_SECONDS,
          max: SIGN_IN_ATTEMPTS,
        },
        "/sign-up/email": {
          window: SIGN_IN_WINDOW_SECONDS,
          max: SIGN_IN_ATTEMPTS,
        },
        "/two-factor/verify-totp": {
          window: SIGN_IN_WINDOW_SECONDS,
          max: SIGN_IN_ATTEMPTS,
        },
        "/two-factor/verify-backup-code": {
          window: SIGN_IN_WINDOW_SECONDS,
          max: SIGN_IN_ATTEMPTS,
        },
        "/forget-password": { window: SIGN_IN_WINDOW_SECONDS, max: 5 },
      },
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
          before: async (_user, hookContext) => {
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
            // consumed by an attempt that may still fail on a taken address.
            const allowed = await registrationOpenOrInvited(
              options.pool,
              cookieHeaderFrom(hookContext),
            );
            if (allowed) {
              return;
            }
            throw new APIError("FORBIDDEN", {
              message: REGISTRATION_CLOSED_MESSAGE,
            });
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
            const token = inviteTokenFromCookies(cookieHeaderFrom(hookContext));
            if (token) {
              await acceptPendingInvitation(options.pool, token, user.id).catch(
                () => undefined,
              );
            }
            await provisionWorkspaceForUser(options.pool, {
              id: user.id,
              name: user.name,
            });
          },
        },
      },
    },

    plugins: [
      // One-time codes with backup codes. The shared secret and the codes are
      // encrypted with the instance secret before they reach the database.
      twoFactor({
        issuer: "OpenOKR",
      }),
      // Passkeys, bound to this origin.
      passkey({
        rpID: origin.hostname,
        rpName: "OpenOKR",
        origin: options.baseUrl,
      }),
      // SSO providers (P8-T07). Each entry loaded from `sso_connections` at
      // boot and passed through `genericOAuth`, which registers them as
      // social providers on the standard `signIn.social` flow. Only included
      // when at least one provider is configured: an instance with no SSO
      // carries no plugin, no route and no schema contribution.
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
      ...(options.plugins ?? []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
