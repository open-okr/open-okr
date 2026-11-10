/**
 * Holding password sign-in after too many failures (docs/design/
 * account-lockout.md, plan 0.7.0 P10, approved by Akmal on 9 November 2026).
 *
 * **A hold, not a lock** (D1). After too many failures the next password
 * attempt is refused without checking the password, until a time passes. It
 * ends on its own; nothing needs unlocking, so an attacker cannot hold a
 * person out for longer than the curve allows.
 *
 * **Two counters** (D2): the caller address trying this account, and the
 * account from anywhere. An address that signed in to the account in the last
 * 30 days is never held by the account counter (D4).
 *
 * **Counted first, forgiven on success** (D6, D7). Each attempt is counted
 * before the password is checked, with both rows locked for the length of a
 * short transaction, so fifty parallel guesses take turns and only the first
 * five reach the password. A session for the user, by any factor, or a
 * completed reset clears the account's counts.
 *
 * **Outside the Operation pipeline** (D15), like Better Auth's own rows: a
 * sign-in attempt has no workspace and no actor.
 *
 * The numbers are constants, not settings (D14): a security floor nobody
 * should have to choose.
 */
import { createHmac } from "node:crypto";
import type { Pool, PoolClient } from "pg";

const PAIR_THRESHOLD = 5;
const ACCOUNT_THRESHOLD = 20;
const BASE_HOLD_SECONDS = 60;
const MAX_HOLD_SECONDS = 15 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const KNOWN_DAYS = 30;
const PURGE_DAYS = 30;

/** Seconds to hold after this many failures in a row; 0 below the threshold. */
export function holdSeconds(failures: number, threshold: number): number {
  if (failures < threshold) {
    return 0;
  }
  // Sixteen minutes is already past the cap, so a longer run never needs a
  // larger power, and a run of thousands cannot overflow anything.
  const doublings = Math.min(failures - threshold, 4);
  return Math.min(MAX_HOLD_SECONDS, BASE_HOLD_SECONDS * 2 ** doublings);
}

/** The count after one more failure: one more, or one after a quiet day (D3). */
export function failuresAfter(
  previous: { readonly failures: number; readonly lastFailureAt: Date | null },
  now: Date,
): number {
  if (
    previous.lastFailureAt === null ||
    now.getTime() - previous.lastFailureAt.getTime() > DAY_MS
  ) {
    return 1;
  }
  return previous.failures + 1;
}

/** What one password attempt meets. */
export type AttemptVerdict =
  | {
      readonly held: false;
      /** Set on the attempt that begins a run's first account hold (D13). */
      readonly accountHoldBegan: {
        readonly failures: number;
        readonly holdSeconds: number;
      } | null;
    }
  | {
      readonly held: true;
      readonly scope: "pair" | "account";
      readonly retryAfterSeconds: number;
    };

/**
 * The two keys (D5): HMACs under a key derived from the auth secret, of the
 * trimmed lower-cased address and of the caller's network address. A copy of
 * the table names nobody, and rotating the secret forgets every count.
 */
function keysFor(
  secret: string,
  email: string,
  callerAddress: string,
): { readonly account: string; readonly caller: string } {
  const key = createHmac("sha256", secret)
    .update("openokr:sign-in-lockout")
    .digest();
  const mac = (value: string) =>
    createHmac("sha256", key).update(value).digest("hex");
  return {
    account: mac(`account:${email.trim().toLowerCase()}`),
    caller: mac(`caller:${callerAddress}`),
  };
}

interface CounterRow {
  readonly caller_key: string;
  readonly failures: number;
  readonly last_failure_at: Date | null;
  readonly held_until: Date | null;
  readonly last_success_at: Date | null;
}

async function inTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const secondsUntil = (until: Date, now: Date): number =>
  Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));

const isHeld = (
  row: CounterRow,
  now: Date,
): row is CounterRow & {
  held_until: Date;
} => row.held_until !== null && row.held_until.getTime() > now.getTime();

/**
 * Counts a password attempt against both counters and says whether it may go
 * on to the password check (D2 to D6).
 *
 * A held attempt is refused and not counted. Otherwise the attempt counts as a
 * failure on both rows, and a right password clears them a moment later.
 */
export async function recordPasswordAttempt(
  pool: Pool,
  input: {
    readonly secret: string;
    readonly email: string;
    readonly callerAddress: string;
    readonly now?: Date;
  },
): Promise<AttemptVerdict> {
  const now = input.now ?? new Date();
  const keys = keysFor(input.secret, input.email, input.callerAddress);

  return inTransaction(pool, async (client) => {
    // openokr:allow-mutation: counters outside the pipeline, as
    // account-lockout.md D15 decides. Rows made in one order, the account
    // row first, so two attempts never wait on each other in a circle.
    await client.query(
      `insert into sign_in_attempts (account_key, caller_key, updated_at)
       values ($1, '', $3), ($1, $2, $3)
       on conflict (account_key, caller_key) do nothing`,
      [keys.account, keys.caller, now],
    );
    const { rows } = await client.query<CounterRow>(
      `select caller_key, failures, last_failure_at, held_until, last_success_at
         from sign_in_attempts
        where account_key = $1 and caller_key in ('', $2)
        order by caller_key
          for update`,
      [keys.account, keys.caller],
    );
    const account = rows.find((row) => row.caller_key === "");
    const pair = rows.find((row) => row.caller_key === keys.caller);
    if (!account || !pair) {
      throw new Error("sign-in counters were not there after their insert");
    }

    if (isHeld(pair, now)) {
      return {
        held: true,
        scope: "pair",
        retryAfterSeconds: secondsUntil(pair.held_until, now),
      } as const;
    }
    const known =
      pair.last_success_at !== null &&
      now.getTime() - pair.last_success_at.getTime() < KNOWN_DAYS * DAY_MS;
    if (!known && isHeld(account, now)) {
      return {
        held: true,
        scope: "account",
        retryAfterSeconds: secondsUntil(account.held_until, now),
      } as const;
    }

    const count = async (
      callerKey: string,
      row: CounterRow,
      threshold: number,
    ) => {
      const failures = failuresAfter(
        { failures: row.failures, lastFailureAt: row.last_failure_at },
        now,
      );
      const hold = holdSeconds(failures, threshold);
      // openokr:allow-mutation: counters outside the pipeline (D15).
      await client.query(
        `update sign_in_attempts
            set failures = $3, last_failure_at = $4, held_until = $5, updated_at = $4
          where account_key = $1 and caller_key = $2`,
        [
          keys.account,
          callerKey,
          failures,
          now,
          hold > 0 ? new Date(now.getTime() + hold * 1000) : null,
        ],
      );
      return { failures, holdSeconds: hold };
    };

    await count(keys.caller, pair, PAIR_THRESHOLD);
    if (known) {
      return { held: false, accountHoldBegan: null } as const;
    }
    const counted = await count("", account, ACCOUNT_THRESHOLD);
    return {
      held: false,
      // Only the run's first hold: one audit row and one email per run
      // rather than one every time a hold ends and the next begins.
      accountHoldBegan: counted.failures === ACCOUNT_THRESHOLD ? counted : null,
    } as const;
  });
}

/**
 * Clears an account's counts after a success or a reset (D7). On a sign-in it
 * also marks this caller address as known for 30 days (D4); a reset has no
 * caller worth trusting, so it marks nothing.
 *
 * Addresses already known stay known: signing in from a phone must not make
 * the desk a stranger.
 */
export async function clearSignInAttempts(
  pool: Pool,
  input: {
    readonly secret: string;
    readonly email: string;
    readonly callerAddress?: string;
    readonly now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const keys = keysFor(input.secret, input.email, input.callerAddress ?? "");
  await inTransaction(pool, async (client) => {
    // The same lock order as an attempt, the account row first.
    await client.query(
      `select 1 from sign_in_attempts where account_key = $1
        order by caller_key for update`,
      [keys.account],
    );
    // openokr:allow-mutation: counters outside the pipeline (D15).
    await client.query(
      "delete from sign_in_attempts where account_key = $1 and last_success_at is null",
      [keys.account],
    );
    // openokr:allow-mutation: counters outside the pipeline (D15).
    await client.query(
      `update sign_in_attempts
          set failures = 0, last_failure_at = null, held_until = null, updated_at = $2
        where account_key = $1 and (failures > 0 or held_until is not null)`,
      [keys.account, now],
    );
    if (input.callerAddress !== undefined) {
      // openokr:allow-mutation: counters outside the pipeline (D15).
      await client.query(
        `insert into sign_in_attempts (account_key, caller_key, last_success_at, updated_at)
         values ($1, $2, $3, $3)
         on conflict (account_key, caller_key) do update
           set last_success_at = excluded.last_success_at,
               updated_at = excluded.updated_at`,
        [keys.account, keys.caller, now],
      );
    }
  });
}

/** Removes rows nobody touched for 30 days (D16). Returns how many. */
export async function purgeStaleSignInAttempts(
  pool: Pool,
  now: Date = new Date(),
): Promise<number> {
  // openokr:allow-mutation: counters outside the pipeline (D15, D16).
  const result = await pool.query(
    `delete from sign_in_attempts
      where updated_at < $1::timestamptz - make_interval(days => ${PURGE_DAYS})`,
    [now],
  );
  return result.rowCount ?? 0;
}
