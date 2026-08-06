import { getCurrentSession } from "@openokr/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";

/**
 * Session helpers for server components and route handlers.
 *
 * `requireSession` is the one a protected page uses: it redirects rather than
 * rendering an empty shell, so an unauthenticated request can never reach
 * page code that assumes a user.
 */

/** The session, or null. For callers that refuse rather than redirect. */
export const currentSession = async () => {
  // `headers()` first, deliberately. It is a dynamic API, so during a
  // prerender it bails the route out to request time before we touch the
  // database. Reading the auth instance first would instead try to open a
  // connection while the build is running.
  const requestHeaders = await headers();
  return getCurrentSession(getAuth(), requestHeaders);
};

export async function requireSession() {
  const session = await currentSession();
  if (!session) {
    redirect("/sign-in");
  }
  return session;
}
