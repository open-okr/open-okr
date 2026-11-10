import { loadEnv } from "@openokr/config";
import { DEMO_PERSONA_PASSWORD, demoPersonasOn } from "@openokr/core";
import { NextResponse } from "next/server";

/**
 * Who a visitor may sign in as, on a demo instance (P8-T13c).
 *
 * **Empty unless `OPENOKR_DEMO` is `on`**, and that variable is a claim about
 * the deployment rather than a feature flag: publishing a list of addresses
 * and a shared password is correct for an instance that resets itself every
 * night and wrong for every other kind. The default is off, so an instance
 * nobody configured says nothing. The answer's `demo` drives the Demo pill
 * beside the sign-in heading, the one other thing the variable shows (plan
 * 0.8.0 D1; the top bar reads it on the server).
 *
 * **It publishes no secret and grants nothing.** These accounts exist only if
 * `pnpm demo:prepare` created them, the password is the one printed by that
 * command and written in the documentation, and every account it names is
 * inside a workspace that is wiped on a schedule. An instance with the flag on
 * and no demo data answers with names that cannot be signed in as, which is a
 * misconfiguration rather than an exposure.
 *
 * Unauthenticated, like `/api/sso-providers`: the sign-in page needs this
 * before anybody has a session, which is the whole point.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const env = loadEnv();
    if (env.OPENOKR_DEMO !== "on") {
      return NextResponse.json({ demo: false, personas: [], password: null });
    }
    // `demo` says the instance is one even when no persona is listed, so the
    // sign-in page can show its Demo pill either way (plan 0.8.0 D1).
    // Only who has joined the year by today, in UTC as the seed reads it:
    // somebody the story brings in later has no account yet.
    return NextResponse.json({
      demo: true,
      personas: demoPersonasOn(new Date().toISOString().slice(0, 10)),
      password: DEMO_PERSONA_PASSWORD,
    });
  } catch {
    // A boot-time environment error is the deployment's problem, not the sign
    // in page's. Answering with nothing leaves the password form working.
    return NextResponse.json({ demo: false, personas: [], password: null });
  }
}
