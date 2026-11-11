/**
 * The link that confirms an email address, queued rather than sent
 * (docs/design/email-verification.md, plan 0.8.0 S3 carrying H1, approved by
 * Akmal on 11 November 2026).
 *
 * **Queued, never sent inside the request** (D1). The mail went out through
 * SMTP while the person waited on the sign-up form, and a refused mail left an
 * account nobody could confirm: Better Auth swallowed the error, nothing
 * retried it and nothing offered the link again. Now the callback writes one
 * outbox row and returns, and the relay sends it, retries it and
 * dead-letters it like every other mail.
 *
 * **Its own one-statement transaction, on the pool** (D2). Better Auth has
 * committed the user row before it calls back, and hands the callback no
 * transaction to join. An insert that fails leaves an account with no link
 * queued, which is the state "send the link again" recovers.
 *
 * **Never throws** (D3). Better Auth's resend rethrows a callback error, and
 * only for an unconfirmed account, so an error here would tell a stranger the
 * address has one.
 *
 * The numbers are constants, not settings (D11).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac } from "node:crypto";
import { enqueueOutbox } from "@openokr/db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { defaultMetrics, METRIC } from "../telemetry/recorder.ts";
import type { AuthLimiterStorage } from "./limiter-storage.ts";

/** The outbox topic the relay sends the confirmation mail from. */
export const VERIFY_EMAIL_TOPIC = "account.verifyEmail";

/**
 * How long a link that confirms an email address works, in seconds: a day
 * (D13, Akmal's Q1). Mail can sit in a company's filters for longer than an
 * hour, and people sign up at the end of a day. The link only confirms an
 * address and signs nobody in, and a signed token cannot be cancelled one at
 * a time, so a week would leave a forwarded mail useful for too long.
 *
 * The check-your-email card, the expired page, the resend's answer and the
 * mail all read this, so none of them can say a different number.
 */
export const EMAIL_VERIFICATION_LINK_SECONDS = 24 * 60 * 60;

/** Why a link was queued, which the row and the counter both carry (D4). */
export type VerificationReason = "sign_up" | "resend" | "repeat_sign_up";

/**
 * Links one address may be sent, whatever network asks (D9). Counted on every
 * request, whether or not the address has an account, so a refusal says
 * nothing about who has one.
 */
const PER_MINUTE = 1;
const PER_DAY = 5;
const MINUTE_SECONDS = 60;
const DAY_SECONDS = 24 * 60 * 60;

/**
 * The reason, for the one way in Better Auth cannot tell apart: a repeat
 * sign-up calls the resend from server code, so the request it hands the
 * callback is the same absence a server call always has. On `globalThis` for
 * the reason `provisioning-authority.ts` gives: Next.js can load this module
 * twice.
 */
const globals = globalThis as typeof globalThis & {
  openokrVerificationReason?: AsyncLocalStorage<VerificationReason>;
};
if (!globals.openokrVerificationReason) {
  globals.openokrVerificationReason =
    new AsyncLocalStorage<VerificationReason>();
}
const reasonStorage = globals.openokrVerificationReason;

/** Runs `fn` with this reason in scope. */
export function withVerificationReason<T>(
  reason: VerificationReason,
  fn: () => Promise<T>,
): Promise<T> {
  return reasonStorage.run(reason, fn);
}

/**
 * Why Better Auth is asking for a link right now: the reason in scope, then
 * the path the request was made on, then the caller's own guess. A sign-up
 * and the resend each arrive with their own request.
 */
export function verificationReason(
  fallback: VerificationReason,
  request?: Request,
): VerificationReason {
  const scoped = reasonStorage.getStore();
  if (scoped) {
    return scoped;
  }
  if (request) {
    try {
      if (new URL(request.url).pathname.endsWith("/send-verification-email")) {
        return "resend";
      }
    } catch {
      // A request with no parsable url says nothing; the fallback stands.
    }
  }
  return fallback;
}

/** The key one address is counted under (D9), as `lockout.ts` keys its own. */
function addressKey(secret: string, email: string): string {
  const key = createHmac("sha256", secret)
    .update("openokr:verification-resend")
    .digest();
  return createHmac("sha256", key)
    .update(email.trim().toLowerCase())
    .digest("hex");
}

/** What one request for a link meets. */
export type ResendAllowance =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

/**
 * Counts one request for a link to this address, and says whether it may go
 * on (D9). The minute is counted first, and the day only for a request the
 * minute let through, so somebody pressing the button in a hurry does not use
 * up the address's day.
 */
export async function resendAllowance(
  storage: AuthLimiterStorage,
  secret: string,
  email: string,
): Promise<ResendAllowance> {
  const key = addressKey(secret, email);
  for (const [window, max, name] of [
    [MINUTE_SECONDS, PER_MINUTE, "minute"],
    [DAY_SECONDS, PER_DAY, "day"],
  ] as const) {
    const verdict = await storage.consume(`verify-link:${name}:${key}`, {
      window,
      max,
    });
    if (!verdict.allowed) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, verdict.retryAfter ?? window),
      };
    }
  }
  return { allowed: true };
}

/**
 * The wait in the largest whole unit that fits, rounded up: "1 minute",
 * "12 minutes", "5 hours". The pages say the same in their own language.
 */
function resendWait(retryAfterSeconds: number): {
  readonly unit: "minute" | "hour";
  readonly count: number;
} {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return minutes < 60
    ? { unit: "minute", count: minutes }
    : { unit: "hour", count: Math.ceil(minutes / 60) };
}

/** The words a held request is answered with, in English for the API. */
export function resendHeldMessage(retryAfterSeconds: number): string {
  const { unit, count } = resendWait(retryAfterSeconds);
  return `Too many links have been asked for this address. Try again in ${count} ${unit}${count === 1 ? "" : "s"}.`;
}

/** Counts one link by why it was asked for and what became of it (D17). */
export function countVerificationLink(
  reason: VerificationReason,
  outcome: "queued" | "refused" | "failed",
): void {
  defaultMetrics().count(METRIC.verificationLinksTotal, { reason, outcome });
}

/**
 * Queues one confirmation mail (D1 to D4). Never throws: a failure is written
 * to the process log and counted, and the request answers as if the row were
 * queued.
 *
 * The idempotency key is the token's digest, so the same link is never queued
 * twice. Two requests in the same second for the same account mint the same
 * token, and the second insert meeting the first is not a failure.
 */
export async function queueVerificationLink(
  pool: Pool,
  link: {
    readonly userId: string;
    readonly to: string;
    readonly url: string;
    readonly token: string;
    readonly lifetimeSeconds: number;
    readonly reason: VerificationReason;
    /** Worded as optional, nothing waiting on it (plan 0.8.0 S4). */
    readonly optional?: boolean;
  },
): Promise<void> {
  try {
    await enqueueOutbox(drizzle(pool), {
      topic: VERIFY_EMAIL_TOPIC,
      payload: {
        userId: link.userId,
        to: link.to,
        url: link.url,
        expiresAt: new Date(
          Date.now() + link.lifetimeSeconds * 1000,
        ).toISOString(),
        reason: link.reason,
        ...(link.optional ? { optional: true } : {}),
      },
      idempotencyKey: `${VERIFY_EMAIL_TOPIC}:${createHash("sha256").update(link.token).digest("hex")}`,
    });
    countVerificationLink(link.reason, "queued");
  } catch (error) {
    // Drizzle wraps the driver's error, so the code may be one level down.
    const failure = error as { code?: unknown; cause?: { code?: unknown } };
    if (failure.code === "23505" || failure.cause?.code === "23505") {
      return;
    }
    countVerificationLink(link.reason, "failed");
    process.stderr.write(
      `auth: could not queue a confirmation link (${link.reason}): ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
