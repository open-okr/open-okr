/**
 * Changing the sign-in email: the pieces the request, the link and the
 * completion share (docs/design/account-self-service.md §2.3, D14 to D21,
 * plan 0.8.0 Y4, approved by Akmal on 11 November 2026).
 *
 * **Better Auth's verified change**, with OpenOKR's rules around it. The
 * request is a server action (`changeOwnEmail` in `account-self-service.ts`)
 * that calls `auth.api.changeEmail`; Better Auth mints a signed link bound to
 * the account and its old address, and hands it to the confirmation
 * callback, which queues it here. Nothing changes until the link is opened,
 * inside a live session of the same account (D19), and the completion is
 * recorded once (D20).
 *
 * **No address in clear on the instance chain** (D6). The chain is permanent
 * and outlives erasure, so an address appears as its domain and a keyed
 * hash: the domain shows a move off a company, and the hash lets somebody
 * holding the secret confirm a suspected address without the chain naming
 * anyone.
 *
 * The numbers are constants, not settings (design §7).
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { enqueueOutbox, withInstanceAdmin } from "@openokr/db";
import { isEmailAddress } from "@openokr/formats";
import { verifyJWT } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { appendInstanceAuditInTx } from "../audit/instance-chain.ts";
import { isDemoAccount } from "../demo/persona-list.ts";
import { directoryManagesAccount } from "../directory-sync/managed.ts";
import { emailDomain } from "../invitations/tokens.ts";
import { defaultMetrics, METRIC } from "../telemetry/recorder.ts";
import { addressRuleRefuses } from "../workspaces/registration.ts";
import {
  type EnforcingProvider,
  enforcedProviderForUser,
} from "./sso-enforcement.ts";

/** The link that makes the new address the sign-in email, to that address. */
export const CHANGE_EMAIL_TOPIC = "account.changeEmail";

/** The notice to the current address, sent for every accepted request. */
export const EMAIL_CHANGE_NOTICE_TOPIC = "account.emailChangeNotice";

/**
 * What an address that already has an account hears instead of a link
 * (AS-Q5 (b)): "This address already has an account here, so nothing
 * changed." Both branches queue one mail to the new address, so the answer
 * takes the same work either way.
 */
export const EMAIL_CHANGE_TAKEN_TOPIC = "account.emailChangeTaken";

/** Requests one account may make in a day (D16). */
const EMAIL_CHANGES_PER_ACCOUNT_PER_DAY = 3;

/** Requests for one new address in a day, from any account (D16). */
const EMAIL_CHANGES_PER_ADDRESS_PER_DAY = 3;

/** The soonest an accepted request is answered, in milliseconds (D17). */
export const EMAIL_CHANGE_ANSWER_FLOOR_MS = 500;

/**
 * Where an opened link lands. Better Auth appends `&error=<code>` when the
 * link itself is refused, so Your account reads the code first.
 */
export const EMAIL_CHANGE_CALLBACK = "/account?emailChange=changed";

/** Where a link opened signed out sends the person (D19). */
export const EMAIL_CHANGE_SIGN_IN = "/sign-in?notice=email-change";

const DAY_SECONDS = 24 * 60 * 60;

/** The instance chain's actions (design §4.1). */
const REQUESTED_ACTION = "auth.email_change_requested";
const CHANGED_ACTION = "auth.email_changed";

/**
 * An address as the instance chain may hold it (D6): its domain and an
 * HMAC-SHA-256 under a key derived from the auth secret with the label
 * `openokr:account-audit`, as `lockout.ts` derives its own keys. The
 * per-address limit counts under the same key, so it names nobody either.
 */
export function auditedAddress(
  secret: string,
  email: string,
): { readonly domain: string; readonly key: string } {
  const address = email.trim().toLowerCase();
  const key = createHmac("sha256", secret)
    .update("openokr:account-audit")
    .digest();
  return {
    domain: emailDomain(address),
    key: createHmac("sha256", key).update(address).digest("hex"),
  };
}

/** A change link, read from its signed token. */
export interface ChangeLink {
  readonly userId: string;
  /** The address the account had when the change was asked for. */
  readonly from: string;
  /** The address the link makes the sign-in email. */
  readonly to: string;
}

/**
 * The change a token asks for, or null when it is not a valid change link:
 * a confirmation link, an expired or forged token, or none at all (D18).
 *
 * Better Auth signs one kind of token for both links. A change link carries
 * `updateTo` and the account it is bound to; a confirmation link carries
 * neither.
 */
export async function readChangeLink(
  secret: string,
  token: unknown,
): Promise<ChangeLink | null> {
  if (typeof token !== "string" || token === "") {
    return null;
  }
  const payload = await verifyJWT<{
    email?: unknown;
    updateTo?: unknown;
    userId?: unknown;
  }>(token, secret);
  if (
    !payload ||
    typeof payload.updateTo !== "string" ||
    payload.updateTo === "" ||
    typeof payload.userId !== "string" ||
    typeof payload.email !== "string"
  ) {
    return null;
  }
  return {
    userId: payload.userId,
    from: payload.email.toLowerCase(),
    to: payload.updateTo.toLowerCase(),
  };
}

/** The token a `/verify-email` request carries, read from its address. */
export function tokenOfRequest(request: Request | undefined): string | null {
  if (!request) {
    return null;
  }
  try {
    return new URL(request.url).searchParams.get("token");
  } catch {
    return null;
  }
}

/**
 * What refuses a change before any address is typed (D16 (1)): the account
 * itself. Only the asker's own account is read, so a refusal here says
 * nothing about anybody else.
 */
export type AccountBlock =
  /** A demonstration account keeps its email (D1). */
  | { readonly kind: "demo" }
  /** A directory finds people by address (AS-Q3). */
  | { readonly kind: "directory" }
  /** Single sign-on claims the address's domain (D16). */
  | { readonly kind: "enforced"; readonly provider: EnforcingProvider };

export async function emailChangeBlock(
  pool: Pool,
  account: { readonly userId: string; readonly email: string },
): Promise<AccountBlock | null> {
  if (isDemoAccount(account.email)) {
    return { kind: "demo" };
  }
  if (await directoryManagesAccount(pool, account.userId)) {
    return { kind: "directory" };
  }
  const provider = await enforcedProviderForUser(pool, account.userId);
  if (provider) {
    return { kind: "enforced", provider };
  }
  return null;
}

/**
 * What refuses the new address itself (D16 (2)): not an address, the one the
 * account already has, or a free mail address where only company addresses
 * are accepted (AS-Q2 (a)). The rule reads only the domain, so it says
 * nothing about who has an account.
 */
export type AddressRefusal = "invalid" | "same" | "company";

export async function newAddressRefusal(
  pool: Pool,
  addresses: { readonly current: string; readonly next: string },
): Promise<AddressRefusal | null> {
  const next = addresses.next.trim().toLowerCase();
  if (!isEmailAddress(next)) {
    return "invalid";
  }
  if (next === addresses.current.trim().toLowerCase()) {
    return "same";
  }
  if (await addressRuleRefuses(pool, next)) {
    return "company";
  }
  return null;
}

/**
 * Whether another account signs in with this address. `users` is Better
 * Auth's own table and carries no workspace column or soft delete.
 */
export async function addressHasAccount(
  pool: Pool,
  email: string,
  exceptUserId?: string,
): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1 from users
      where lower(email) = $1 and ($2::text is null or id <> $2)
      limit 1`,
    [email.trim().toLowerCase(), exceptUserId ?? null],
  );
  return rows.length > 0;
}

/** Why an opened link changed nothing, after the request was accepted (D19). */
export type CompletionRefusal =
  | "demo"
  | "directory"
  | "enforced"
  | "company"
  | "taken";

/**
 * Checks D16 (1) and (2) again when the link is opened, and that the new
 * address is still free (D19). Anything may have changed in the day the link
 * works: a directory connected, enforcement turned on, the address rule
 * tightened, or somebody signing up with the address.
 */
export async function completionRefusal(
  pool: Pool,
  input: {
    readonly userId: string;
    readonly email: string;
    readonly to: string;
  },
): Promise<CompletionRefusal | null> {
  const block = await emailChangeBlock(pool, input);
  if (block) {
    return block.kind;
  }
  if (await addressRuleRefuses(pool, input.to)) {
    return "company";
  }
  if (await addressHasAccount(pool, input.to, input.userId)) {
    return "taken";
  }
  return null;
}

/**
 * Queues the link to the new address (D18). Its own one-statement
 * transaction on the pool, as a confirmation link is, because Better Auth
 * hands the callback no transaction to join. Never throws: the request has
 * already been recorded and the owner told, and a person whose link never
 * comes asks again.
 *
 * The idempotency key is the token's digest, so one link is queued once.
 */
export async function queueChangeLink(
  pool: Pool,
  link: ChangeLink & {
    readonly url: string;
    readonly token: string;
    readonly lifetimeSeconds: number;
  },
): Promise<void> {
  try {
    await enqueueOutbox(drizzle(pool), {
      topic: CHANGE_EMAIL_TOPIC,
      payload: {
        userId: link.userId,
        from: link.from,
        to: link.to,
        url: link.url,
        expiresAt: new Date(
          Date.now() + link.lifetimeSeconds * 1000,
        ).toISOString(),
      },
      idempotencyKey: `${CHANGE_EMAIL_TOPIC}:${createHash("sha256").update(link.token).digest("hex")}`,
    });
  } catch (error) {
    const failure = error as { code?: unknown; cause?: { code?: unknown } };
    if (failure.code === "23505" || failure.cause?.code === "23505") {
      return;
    }
    defaultMetrics().count(METRIC.accountChangeRecordFailures, {
      via: "email",
    });
    process.stderr.write(
      `auth: could not queue a change-of-email link for ${link.userId}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/**
 * Records an accepted request (D16 (5), design §4.1 and §4.2): the audit row,
 * the notice to the current address, and for an address another account
 * holds, the mail that says nothing changed. One transaction, so the owner is
 * told of every request the chain holds.
 *
 * Throws on failure, and the caller sends no link: a change the owner was
 * not told about is the one thing this must not allow.
 */
export async function recordEmailChangeRequest(
  pool: Pool,
  secret: string,
  request: {
    readonly userId: string;
    readonly from: string;
    readonly to: string;
    readonly outcome: "link_sent" | "address_taken";
    readonly at?: Date;
  },
): Promise<void> {
  const at = (request.at ?? new Date()).toISOString();
  const to = auditedAddress(secret, request.to);
  await withInstanceAdmin(drizzle(pool), async (tx) => {
    await appendInstanceAuditInTx(tx, {
      action: REQUESTED_ACTION,
      payload: {
        userId: request.userId,
        toDomain: to.domain,
        toKey: to.key,
        outcome: request.outcome,
      },
    });
    // The same words in both branches, so the notice says nothing about
    // whether the new address has an account.
    await enqueueOutbox(tx, {
      topic: EMAIL_CHANGE_NOTICE_TOPIC,
      payload: {
        userId: request.userId,
        to: request.from,
        newEmail: request.to,
        at,
      },
      idempotencyKey: `${EMAIL_CHANGE_NOTICE_TOPIC}:${randomUUID()}`,
    });
    if (request.outcome === "address_taken") {
      await enqueueOutbox(tx, {
        topic: EMAIL_CHANGE_TAKEN_TOPIC,
        payload: { to: request.to, at },
        idempotencyKey: `${EMAIL_CHANGE_TAKEN_TOPIC}:${randomUUID()}`,
      });
    }
  });
}

/**
 * Records a completed change (D20): one `auth.email_changed` row with both
 * addresses as domains and keys. Never throws: the address has changed
 * already, and a missing row never undoes it. A failure is logged and
 * counted.
 */
export async function recordEmailChanged(
  pool: Pool,
  secret: string,
  change: ChangeLink,
): Promise<void> {
  const from = auditedAddress(secret, change.from);
  const to = auditedAddress(secret, change.to);
  try {
    await withInstanceAdmin(drizzle(pool), (tx) =>
      appendInstanceAuditInTx(tx, {
        action: CHANGED_ACTION,
        payload: {
          userId: change.userId,
          fromDomain: from.domain,
          fromKey: from.key,
          toDomain: to.domain,
          toKey: to.key,
        },
      }),
    );
  } catch (error) {
    defaultMetrics().count(METRIC.accountChangeRecordFailures, {
      via: "email",
    });
    process.stderr.write(
      `auth: could not record a changed sign-in email for ${change.userId}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

/** The two daily limits (D16 (4)), counted in the shared cache. */
export async function emailChangeAllowance(
  limits: {
    consume(
      key: string,
      rule: { readonly window: number; readonly max: number },
    ): Promise<{ allowed: boolean }>;
  },
  input: { readonly userId: string; readonly toKey: string },
): Promise<"allowed" | "account_limit" | "address_limit"> {
  const account = await limits.consume(`email-change:account:${input.userId}`, {
    window: DAY_SECONDS,
    max: EMAIL_CHANGES_PER_ACCOUNT_PER_DAY,
  });
  if (!account.allowed) {
    return "account_limit";
  }
  const address = await limits.consume(`email-change:address:${input.toKey}`, {
    window: DAY_SECONDS,
    max: EMAIL_CHANGES_PER_ADDRESS_PER_DAY,
  });
  return address.allowed ? "allowed" : "address_limit";
}
