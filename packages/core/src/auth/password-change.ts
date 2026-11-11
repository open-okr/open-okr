/**
 * Recording a password change (docs/design/account-self-service.md D9, plan
 * 0.8.0 Y3).
 *
 * **One function, three callers, one per way a password changes**: the
 * `/change-password` endpoint's after hook (`change`), a completed reset
 * (`reset`), and Set a password's server action (`set`). The screen and a
 * direct call both pass the hook, the reset has its own callback, and
 * `setPassword` is server only, so only OpenOKR's code calls it. A sign-up's
 * first password is not a change, and neither is the one `pnpm demo:prepare`
 * writes.
 *
 * **The audit row and the mail commit together**, in one transaction on the
 * pool with the instance-admin flag, as erasure's claim does. The row goes on
 * the instance chain, because a password belongs to the account and not to
 * any workspace. The mail is queued on the outbox, so the relay sends it,
 * retries it and dead-letters it like every other (D5).
 *
 * **It never undoes the change.** The password is already changed when this
 * runs. A failure is written to the process log and counted, and the caller
 * answers as it would have.
 */
import { randomUUID } from "node:crypto";
import { enqueueOutbox, withInstanceAdmin } from "@openokr/db";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { appendInstanceAuditInTx } from "../audit/instance-chain.ts";
import { defaultMetrics, METRIC } from "../telemetry/recorder.ts";

/**
 * How long a password may be. The minimum is ours (TECHNICAL-PLAN §8.2); the
 * maximum is Better Auth's own default, written down so an upgrade that moves
 * it shows in a diff, and so the session hook refuses to count exactly what
 * Better Auth refuses to check (account-self-service.md D3).
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** The outbox topic the relay sends the "your password changed" mail from. */
export const PASSWORD_CHANGED_TOPIC = "account.passwordChanged";

/**
 * The instance chain's action for every password change. Named without the
 * word, as `email-change.ts` names its own: CodeQL reads any name holding
 * "password" as a secret, and this one is only a label.
 */
const CHANGED_ACTION = "auth.password_changed";

/** How the password changed: changed, set where there was none, or reset. */
export type PasswordChangeVia = "change" | "set" | "reset";

export const PASSWORD_CHANGE_VIAS: readonly PasswordChangeVia[] = [
  "change",
  "set",
  "reset",
];

/**
 * Whether an account has a password Better Auth would check: a credential
 * account with a password on it. An account that signs in only by single
 * sign-on or a passkey has none.
 */
export async function accountHasPassword(
  pool: Pool,
  userId: string,
): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from accounts
      where user_id = $1 and provider_id = 'credential' and password is not null
      limit 1`,
    [userId],
  );
  return rows.length > 0;
}

export interface PasswordChange {
  readonly userId: string;
  readonly via: PasswordChangeVia;
  /** Whether every other session of the account ended with the change. */
  readonly otherSessionsEnded: boolean;
  /** The caller's network address, as `callerAddress()` reads it. */
  readonly address: string;
  readonly now?: Date;
}

/**
 * Appends `auth.password_changed` and queues `account.passwordChanged` to the
 * account's address, in one transaction. Never throws.
 */
export async function recordPasswordChange(
  pool: Pool,
  change: PasswordChange,
): Promise<void> {
  const at = change.now ?? new Date();
  try {
    await withInstanceAdmin(drizzle(pool), async (tx) => {
      // The address the account had when the password changed. Read here
      // rather than passed in, so every caller mails the same address.
      const { rows } = await tx.execute<{ email: string }>(
        sql`select email from users where id = ${change.userId}`,
      );
      const to = rows[0]?.email;
      await appendInstanceAuditInTx(tx, {
        action: CHANGED_ACTION,
        payload: {
          userId: change.userId,
          via: change.via,
          otherSessionsEnded: change.otherSessionsEnded,
          address: change.address,
        },
      });
      if (to === undefined) {
        return;
      }
      await enqueueOutbox(tx, {
        topic: PASSWORD_CHANGED_TOPIC,
        payload: {
          userId: change.userId,
          to,
          via: change.via,
          otherSessionsEnded: change.otherSessionsEnded,
          at: at.toISOString(),
        },
        // A fresh id: two changes in the same second are two mails.
        idempotencyKey: `${PASSWORD_CHANGED_TOPIC}:${randomUUID()}`,
      });
    });
  } catch (error) {
    defaultMetrics().count(METRIC.accountChangeRecordFailures, {
      via: change.via,
    });
    process.stderr.write(
      `auth: could not record a password change for ${change.userId} (${change.via}): ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
