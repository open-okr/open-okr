import { loadEnv } from "@openokr/config";
import {
  authLimiterStorage,
  createAuth,
  type EmailConfirmation,
  followSSOProviders,
  resolveCanSendMail,
  resolveEmailConfirmation,
  type SSOFollowingAuth,
  type SSOProviderConfig,
} from "@openokr/core";
import { nextCookies } from "better-auth/next-js";
import { getCache } from "./cache";
import { getInstanceName } from "./instance-name";
import { getPool } from "./pool";
import { getKeyRing } from "./secrets";
import { ssoProviderTracker } from "./sso";

export { getPool };

/**
 * The process-wide authentication instance.
 *
 * The configuration lives in `packages/core` because it needs the database,
 * which TECHNICAL-PLAN §1 does not allow this app to reach directly. Here we
 * only supply the environment.
 *
 * `getPool` is re-exported because most of the app imports it from here, and
 * it now lives in `lib/pool.ts` so a process with no sessions can have a pool
 * without loading Better Auth.
 *
 * Built on first use rather than on import, so that loading a page module
 * does not open a database connection as a side effect. The environment is
 * still validated at boot, by `instrumentation.node.ts`, so a bad
 * configuration fails immediately rather than at the first sign-in.
 *
 * Next.js reloads modules in development, so both the pool and the instance
 * are cached on `globalThis`. Without that, every reload would open another
 * pool and eventually exhaust the database's connection limit.
 *
 * **One instance at a time, not one for the life of the process**
 * (completeness review L-15). Better Auth reads its SSO plugins when an
 * instance is built, so the instance is rebuilt when an administrator adds,
 * changes or removes a connection, on this process and on every other. What
 * else it reads at construction is resolved at boot and carried over
 * unchanged, so a rebuild does not bring a rename or a new mail transport
 * forward: those still wait for a restart, as the admin screen says.
 */
const globals = globalThis as typeof globalThis & {
  openokrAuthFollower?: SSOFollowingAuth<ReturnType<typeof createAuth>>;
  openokrRequireEmailVerification?: boolean;
  openokrOptionalVerificationLinks?: boolean;
  openokrConfirmationCheckedAt?: number;
  openokrCanSendMail?: boolean;
  openokrAuthInstanceName?: string;
};

/**
 * Holds the answer the auth instance is built with. Returns whether it
 * moved, so the caller knows to rebuild.
 */
function holdConfirmation(answer: EmailConfirmation): boolean {
  const optional = answer.linksCanArrive && !answer.required;
  const moved =
    globals.openokrRequireEmailVerification !== answer.required ||
    globals.openokrOptionalVerificationLinks !== optional;
  globals.openokrRequireEmailVerification = answer.required;
  globals.openokrOptionalVerificationLinks = optional;
  return moved;
}

/** How often the auth route reads the confirmation rule again (S4). */
const CONFIRMATION_RECHECK_MS = 15_000;

/**
 * Follows a change to `auth.emailVerification` without a restart (plan 0.8.0
 * S4, email-verification.md §11.1). Read at most every fifteen seconds, on
 * the route every sign-up and sign-in arrives at, and the instance rebuilt
 * when the answer moved. Every replica reads it for itself, so a change on
 * one reaches all of them. A failed read keeps the answer it had.
 */
async function followConfirmationRule(): Promise<void> {
  const now = Date.now();
  if (
    now - (globals.openokrConfirmationCheckedAt ?? 0) <
    CONFIRMATION_RECHECK_MS
  ) {
    return;
  }
  globals.openokrConfirmationCheckedAt = now;
  try {
    if (holdConfirmation(await resolveEmailConfirmation(getPool()))) {
      globals.openokrAuthFollower = undefined;
    }
  } catch {
    // Keeps the answer it had; boot already logged why a read can fail.
  }
}

/** Makes the next auth request read the rule again, after a change here. */
export function readConfirmationRuleAgain(): void {
  globals.openokrConfirmationCheckedAt = 0;
}

/**
 * Resolves whether a sign-in must wait for a verified address, once, at boot
 * (P8-T02b).
 *
 * Better Auth reads `requireEmailVerification` off an options object built
 * once per process and `getAuth()` is synchronous, so the answer cannot be
 * fetched when it is needed. `register()` calls this before anything is
 * served, which is the one moment an async read fits.
 *
 * A failure here is not fatal and leaves the answer false. The question is
 * whether to add a requirement, and an instance that cannot read its own
 * settings should not lock everybody out while it works that out.
 *
 * **The instance's name is read here too, for the same reason** (completeness
 * review M-33). The two-factor issuer and the passkey name are options on the
 * same object, so a rename reaches an authenticator app and a passkey prompt
 * at the next restart, and the admin screen says so. The reader never throws.
 */
export async function resolveSignupPolicy(): Promise<void> {
  globals.openokrAuthInstanceName = await getInstanceName();
  try {
    holdConfirmation(await resolveEmailConfirmation(getPool()));
    globals.openokrConfirmationCheckedAt = Date.now();
  } catch (error) {
    process.stderr.write(
      `auth: could not resolve the mail transport, so email verification ` +
        `stays off: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  // Whether mail can be sent at all, which turns on changing the sign-in
  // email (account-self-service.md D14, plan 0.8.0 Y4). Its own answer, so a
  // later rule about confirming addresses at sign-up does not move it.
  try {
    globals.openokrCanSendMail = await resolveCanSendMail(getPool());
  } catch (error) {
    process.stderr.write(
      `auth: could not resolve the mail transport, so changing a sign-in ` +
        `email stays off: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/**
 * Whether this instance can send mail, as boot resolved it (account-self-
 * service.md D14, plan 0.8.0 Y4). Your account offers the change of sign-in
 * email only where this is true, and `createAuth` turns Better Auth's change
 * on from the same answer, so the card and the endpoint never disagree.
 * False until boot has run, and after a failed read.
 */
export function canSendMail(): boolean {
  return globals.openokrCanSendMail ?? false;
}

/**
 * Builds an instance around the SSO providers as last read.
 *
 * Everything but the providers comes from the environment and from what boot
 * resolved, so two instances built minutes apart differ only in their
 * providers.
 */
function buildAuth(
  providers: readonly SSOProviderConfig[],
): ReturnType<typeof createAuth> {
  const env = loadEnv();
  return createAuth({
    pool: getPool(),
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.BETTER_AUTH_URL,
    // Seals the identity-provider tokens stored on accounts, under the key
    // `keys:rotate` re-wraps (L-11). Passed as the function, so it is read
    // at the first provider sign-in rather than when this is built.
    keyRing: getKeyRing,
    // Read at boot, so a rename reaches these two after a restart (M-33).
    ...(globals.openokrAuthInstanceName
      ? { instanceName: globals.openokrAuthInstanceName }
      : {}),
    // Through whatever mail is configured right now: SMTP when the instance
    // has it, the console driver otherwise. Imported lazily because this
    // module and lib/mail.ts import each other's pool accessor. The name in
    // the mail is read when it is sent, so a rename reaches the next one.
    sendResetPassword: async ({ to, url }) => {
      const [{ sendMail }, { resetPasswordMail }] = await Promise.all([
        import("./mail"),
        import("./account-mail"),
      ]);
      await sendMail({ to, ...(await resetPasswordMail(to, url)) });
    },
    // The address limiter's count in Postgres, so every replica shares one
    // (account-lockout.md D10).
    rateLimitStorage: authLimiterStorage(getCache()),
    // Somebody is trying this account's password (account-lockout.md Q2).
    // Through the same mail as the reset, so a console transport writes it
    // to the log and nothing waits on a mail server.
    sendSignInHeldNotice: async ({ to, resetUrl }) => {
      const [{ sendMail }, { signInHeldMail }] = await Promise.all([
        import("./mail"),
        import("./account-mail"),
      ]);
      await sendMail({ to, ...(await signInHeldMail(to, resetUrl)) });
    },
    // Resolved at boot from `mail.transport`: the question is whether a
    // link can arrive, not whether this is a managed cloud (P8-T02b). The
    // link itself is queued on the outbox and sent by the relay, so nothing
    // here waits on a mail server (email-verification.md D1, D6).
    requireEmailVerification: globals.openokrRequireEmailVerification ?? false,
    // Confirmation off where mail can arrive: a link worded as optional,
    // nothing waiting on it (plan 0.8.0 S4).
    optionalVerificationLinks:
      globals.openokrOptionalVerificationLinks ?? false,
    // Resolved at boot from `mail.transport` too, and read by Your account
    // through `canSendMail()` (account-self-service.md D14).
    canSendMail: canSendMail(),
    // From sso_connections, as last read (P8-T07, L-15).
    ssoProviders: providers,
    // Lets a server action set and clear the session cookie. Framework glue,
    // so it lives here rather than in packages/core, and Better Auth
    // requires it last in the plugin list.
    plugins: [nextCookies()],
  });
}

function authFollower(): SSOFollowingAuth<ReturnType<typeof createAuth>> {
  if (!globals.openokrAuthFollower) {
    globals.openokrAuthFollower = followSSOProviders(
      ssoProviderTracker(),
      buildAuth,
    );
  }
  return globals.openokrAuthFollower;
}

/**
 * The instance, for a caller that signs nobody in: reading a session,
 * signing out, listing or revoking sessions, provisioning over SCIM.
 *
 * Never reads the database. None of those depends on a provider, and a
 * session made by an earlier instance reads the same in this one.
 */
export function getAuth(): ReturnType<typeof createAuth> {
  return authFollower().latest();
}

/**
 * The instance, rebuilt first if single sign-on changed (L-15). For the
 * authentication route, which is where every sign-in arrives.
 *
 * Reads a stamp of `sso_connections` at most once every few seconds, shared
 * by every request that arrives meanwhile.
 */
export async function getCurrentAuth(): Promise<ReturnType<typeof createAuth>> {
  await followConfirmationRule();
  return authFollower().current();
}
