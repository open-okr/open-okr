import { recordInstanceAuditEvent } from "@openokr/core";
import { getAuth, getPool } from "../../../../lib/auth";

/**
 * Every authentication endpoint: sign up, sign in, sign out, password reset,
 * the second-factor challenge and the passkey ceremonies. Better Auth owns
 * the routing beneath this catch-all.
 *
 * The instance is resolved per request rather than at module load, so
 * importing this route does not open a database connection.
 *
 * Better Auth's own rate limiter (P1-T05) enforces the lockout in
 * `createAuth`'s `customRules`, but it rejects a request from inside its own
 * router — before any plugin hook, `onAPIError`, or `onResponse` callback
 * runs — so there is no extension point inside Better Auth that ever sees a
 * 429 it produced. This wrapper is the only place that can, which is why the
 * audit write happens here rather than in `lib/auth.ts` (TECHNICAL-PLAN
 * §8.2: "Brute force: lockout with backoff and an audit entry" — the entry
 * half was open since P1-T05, because the audit spine it needed did not
 * exist yet, and then because that spine's `audit_events.workspace_id` is
 * not null and a failed sign-in has no workspace yet; `recordInstanceAuditEvent`
 * is the instance-level chain built for exactly that gap).
 *
 * Deliberately not recorded: the email address that was attempted. §8.2's
 * own privacy line asks for "minimal personal data in logs," and the path
 * plus the caller's address is already enough to show a lockout happened,
 * where, and from where, without putting a permanent, hash-chained,
 * undeletable copy of someone's email address into place over an address
 * that might not even be theirs.
 */
async function withLockoutAudit(request: Request): Promise<Response> {
  const response = await getAuth().handler(request);

  if (response.status === 429) {
    const address =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    await recordInstanceAuditEvent(getPool(), {
      action: "auth.rate_limited",
      payload: { path: new URL(request.url).pathname, address },
    }).catch(() => {
      // A failed audit write must never turn an already-issued 429 into a
      // 500: the caller has already been refused, and this record is
      // best-effort on top of that, not a condition of it.
    });
  }

  return response;
}

export const GET = withLockoutAudit;
export const POST = withLockoutAudit;
