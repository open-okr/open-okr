import { loadEnv } from "@openokr/config";
import { createAuth, resolveRequireEmailVerification } from "@openokr/core";
import { nextCookies } from "better-auth/next-js";
import { getPool } from "./pool";

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
 */
const globals = globalThis as typeof globalThis & {
  openokrAuth?: ReturnType<typeof createAuth>;
  openokrRequireEmailVerification?: boolean;
};

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
 */
export async function resolveSignupPolicy(): Promise<void> {
  try {
    globals.openokrRequireEmailVerification =
      await resolveRequireEmailVerification(getPool());
  } catch (error) {
    process.stderr.write(
      `auth: could not resolve the mail transport, so email verification ` +
        `stays off: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

export function getAuth(): ReturnType<typeof createAuth> {
  if (!globals.openokrAuth) {
    const env = loadEnv();
    globals.openokrAuth = createAuth({
      pool: getPool(),
      secret: env.BETTER_AUTH_SECRET,
      baseUrl: env.BETTER_AUTH_URL,
      // Through whatever mail is configured right now: SMTP when the instance
      // has it, the console driver otherwise. Imported lazily because this
      // module and lib/mail.ts import each other's pool accessor.
      sendResetPassword: async ({ to, url }) => {
        const { sendMail } = await import("./mail");
        await sendMail({
          to,
          subject: "Reset your OpenOKR password",
          text: [
            "Someone asked to reset the password for this address.",
            "",
            `Reset it here: ${url}`,
            "",
            "If this was not you, ignore this message. The link expires.",
          ].join("\n"),
        });
      },
      // Resolved at boot from `mail.transport`: the question is whether a
      // link can arrive, not whether this is a managed cloud (P8-T02b).
      requireEmailVerification:
        globals.openokrRequireEmailVerification ?? false,
      sendVerificationEmail: globals.openokrRequireEmailVerification
        ? async ({ to, url }) => {
            const { sendMail } = await import("./mail");
            await sendMail({
              to,
              subject: "Confirm your email address",
              text: [
                "Confirm this address to finish setting up your OpenOKR account.",
                "",
                `Confirm it here: ${url}`,
                "",
                "If you did not sign up, ignore this message. The link expires.",
              ].join("\n"),
            });
          }
        : undefined,
      // Lets a server action set and clear the session cookie. Framework glue,
      // so it lives here rather than in packages/core, and Better Auth
      // requires it last in the plugin list.
      plugins: [nextCookies()],
    });
  }
  return globals.openokrAuth;
}
