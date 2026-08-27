import { loadEnv } from "@openokr/config";
import { createAuth } from "@openokr/core";
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
};

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
      // Lets a server action set and clear the session cookie. Framework glue,
      // so it lives here rather than in packages/core, and Better Auth
      // requires it last in the plugin list.
      plugins: [nextCookies()],
    });
  }
  return globals.openokrAuth;
}
