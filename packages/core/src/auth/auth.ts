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
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { withHashedSessionTokens } from "./session-hashing.ts";

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
      process.stdout.write(
        `\n--- password reset (no mailer configured) ---\nto:  ${to}\nlink: ${url}\n---------------------------------------------\n`,
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
      // Verification is not required to sign in: a self-hosted first run has
      // no mail server, and blocking the first login on an email nobody can
      // receive would make the product unusable out of the box.
      requireEmailVerification: false,
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
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
