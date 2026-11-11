/**
 * Deleting your own account (docs/design/account-deletion.md, plan 0.8.0 Y7,
 * approved by Akmal on 11 November 2026).
 *
 * **Asking.** From the foot of Your account. Refused, with the reason and
 * before anything is asked, for a demonstration account, a member a directory
 * manages, and the last full-access holder of any workspace. Confirmed with
 * the password, or a sign-in in the last ten minutes for an account with none.
 * Then one transaction: the request, every session ended, the instance audit
 * row and the first mail.
 *
 * **Waiting, fourteen days.** Signing in cancels it, inside the sign-in itself
 * (`cancelDeletionOnSignIn`, called from `createAuth`'s session hook). The day
 * before it runs, a mail says so. Memberships are untouched meanwhile, and the
 * usual notices still reach the person (Y7-Q3).
 *
 * **Running.** The scheduler's hourly pass checks the three refusals again
 * before the first erasure, and cancels with a mail when one now holds
 * (Y7-Q1). Otherwise it erases the member in each workspace, one Operation per
 * workspace through the body `people.erase` runs (`eraseMemberInTx`), tells
 * each workspace's administrators and the person's manager what now needs an
 * owner, and records each workspace on the ledger. A failure stops the run and
 * the next pass resumes. The last workspace's erasure anonymises the account,
 * as `eraseAccountIfAlone` always has, and queues the last mail before the
 * address goes.
 *
 * **Account actions, not registry actions** (Y7-Q2). A token is the one
 * credential most likely to be held by something other than the person, so
 * REST, the command line, the agent catalogue and chat get no projection.
 */
import { randomUUID } from "node:crypto";
import {
  accountDeletions,
  activeOnly,
  sessions as authSessions,
  enqueueOutbox,
  withInstanceAdmin,
  withUser,
  withWorkspace,
  workspaceMembers,
  workspaces,
} from "@openokr/db";
import { APIError } from "better-auth/api";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  resolveMemberAccessLevel,
  resolveSubjectContext,
} from "../access/reads.ts";
import { appendInstanceAuditInTx } from "../audit/instance-chain.ts";
import { isDemoAccount } from "../demo/persona-list.ts";
import { directoryManagesAccount } from "../directory-sync/managed.ts";
import { notifyRecipients } from "../notifications/create.ts";
import { runOperation } from "../operations/operation.ts";
import {
  eraseMemberInTx,
  erasureAuditPayload,
  loadMemberForErasure,
} from "../people/erase-member.ts";
import { eraseAccountIfAlone } from "../people/erasure.ts";
import {
  isLastFullAccessHolder,
  workspaceAdministratorIds,
} from "../people/lifecycle.ts";
import {
  linkedProviders,
  type SignInAgainProvider,
} from "./account-self-service.ts";
import type { Auth } from "./auth.ts";
import { accountHasPassword } from "./password-change.ts";
import { signedInRecently } from "./recent-sign-in.ts";

/**
 * How long a request waits before it runs. **A constant, not a setting**
 * (design §6): it is a promise made to the person, and an instance that could
 * set it to zero would break it.
 */
export const ACCOUNT_DELETION_WAIT_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The four mails (design §7), each an outbox topic the relay sends. */
export const ACCOUNT_DELETION_REQUESTED_TOPIC = "account.deletionRequested";
export const ACCOUNT_DELETION_TOMORROW_TOPIC = "account.deletionTomorrow";
export const ACCOUNT_DELETION_CANCELLED_TOPIC = "account.deletionCancelled";
export const ACCOUNT_DELETION_DONE_TOPIC = "account.deletionDone";

/** The instance chain's actions for a request's life. */
const REQUESTED_ACTION = "account.deletion_requested";
const CANCELLED_ACTION = "account.deletion_cancelled";
const COMPLETED_ACTION = "account.deletion_completed";

/**
 * What Better Auth answers a sign-in with while the run is erasing the
 * account (design §3.3). The sign-in page turns the code into its sentence.
 */
export const ACCOUNT_BEING_DELETED_CODE = "ACCOUNT_BEING_DELETED";

/** How long "your account is kept" is shown after the sign-in that kept it. */
const KEPT_NOTICE_MS = 10 * 60 * 1000;

/** How many due requests one pass takes on, so a pass ends in good time. */
const BATCH = 25;

/** Why a deletion is refused before anything is asked (design §4). */
export type DeletionBlock =
  | { readonly kind: "demo" }
  | { readonly kind: "directory" }
  | {
      readonly kind: "last_owner";
      readonly workspaceId: string;
      readonly workspaceName: string;
    };

interface Membership {
  readonly memberId: string;
  readonly workspaceId: string;
}

/**
 * Every membership the account still has: active and suspended alike, since
 * each holds what identifies the person, and none an erasure already cut
 * loose (its `user_id` is null). Read under the person's own identity, the
 * one question the user setting answers across workspaces.
 */
async function membershipsOf(
  pool: Pool,
  userId: string,
): Promise<readonly Membership[]> {
  return withUser(drizzle(pool), userId, (tx) =>
    tx
      .select({
        memberId: workspaceMembers.id,
        workspaceId: workspaceMembers.workspaceId,
      })
      .from(workspaceMembers)
      .where(activeOnly(workspaceMembers, eq(workspaceMembers.userId, userId)))
      .orderBy(asc(workspaceMembers.createdAt)),
  );
}

/**
 * The first refusal that holds, in the design's order: a demonstration
 * account, a directory-managed one, the last full-access holder of any
 * workspace. Null when the account may be deleted.
 *
 * The last-owner question is the one `people.erase` refuses with
 * (`isLastFullAccessHolder`), asked in each workspace under its own tenant
 * setting, so a request that passes here is not refused halfway through its
 * run for the same reason.
 */
export async function deletionBlock(
  pool: Pool,
  input: { readonly userId: string; readonly email: string },
): Promise<DeletionBlock | null> {
  if (isDemoAccount(input.email)) {
    return { kind: "demo" };
  }
  if (await directoryManagesAccount(pool, input.userId)) {
    return { kind: "directory" };
  }
  const db = drizzle(pool);
  for (const membership of await membershipsOf(pool, input.userId)) {
    const blocked = await withWorkspace(
      db,
      membership.workspaceId,
      async (tx) => {
        // Somebody without full access is nobody's last owner, and asking
        // `isLastFullAccessHolder` walks every member, so ask the cheap
        // question first. This page loads for everybody.
        const context = await resolveSubjectContext(
          tx,
          "workspace",
          membership.workspaceId,
          membership.workspaceId,
        );
        if (
          context &&
          (await resolveMemberAccessLevel(tx, {
            workspaceId: membership.workspaceId,
            memberId: membership.memberId,
            contextId: context.contextId,
          })) < ACCESS_LEVELS.full
        ) {
          return null;
        }
        if (
          !(await isLastFullAccessHolder(
            tx,
            membership.workspaceId,
            membership.memberId,
          ))
        ) {
          return null;
        }
        const [workspace] = await tx
          .select({ name: workspaces.name })
          // openokr:allow-raw-read: the name of a workspace the person belongs to, read under its own tenant setting only to name it in the refusal.
          .from(workspaces)
          .where(
            activeOnly(workspaces, eq(workspaces.id, membership.workspaceId)),
          )
          .limit(1);
        return workspace?.name ?? null;
      },
    );
    if (blocked !== null) {
      return {
        kind: "last_owner",
        workspaceId: membership.workspaceId,
        workspaceName: blocked,
      };
    }
  }
  return null;
}

/** What Your account's danger card draws (design §3.1, §7). */
export type DeletionCard =
  | DeletionBlock
  | {
      readonly kind: "confirm";
      readonly hasPassword: boolean;
      /** A sign-in in the last ten minutes, for an account with no password. */
      readonly recent: boolean;
      readonly providers: readonly SignInAgainProvider[];
    };

export async function deletionCardFor(
  pool: Pool,
  input: {
    readonly userId: string;
    readonly email: string;
    readonly sessionCreatedAt: Date | string;
    readonly now?: Date;
  },
): Promise<DeletionCard> {
  const block = await deletionBlock(pool, input);
  if (block) {
    return block;
  }
  const hasPassword = await accountHasPassword(pool, input.userId);
  return {
    kind: "confirm",
    hasPassword,
    recent: signedInRecently({ createdAt: input.sessionCreatedAt }, input.now),
    providers: hasPassword ? [] : await linkedProviders(pool, input.userId),
  };
}

/** Why a request was refused, or when it will run. */
export type DeletionRequestOutcome =
  | { readonly ok: true; readonly runsAt: Date }
  | {
      readonly ok: false;
      readonly reason: "signed_out" | "demo" | "directory" | "wrong_password";
    }
  | {
      readonly ok: false;
      readonly reason: "last_owner";
      readonly workspaceId: string;
      readonly workspaceName: string;
    }
  | {
      readonly ok: false;
      readonly reason: "held";
      readonly retryAfterSeconds: number;
    }
  | {
      readonly ok: false;
      readonly reason: "not_recent";
      readonly providers: readonly SignInAgainProvider[];
    };

/**
 * Asks to delete the signed-in account (design §3.1).
 *
 * **In this order.** (1) The three refusals, each before anything is asked.
 * (2) Proof: the password through `auth.api.verifyPassword`, which counts
 * toward the sign-in hold (account-lockout.md), or a sign-in in the last ten
 * minutes for an account with none. (3) One transaction: the request row,
 * every session of the account ended, `account.deletion_requested` on the
 * instance chain, and the first mail on the outbox.
 */
export async function requestOwnDeletion(
  auth: Pick<Auth, "api">,
  pool: Pool,
  input: {
    readonly headers: Headers;
    /** The current password. Ignored for an account that has none. */
    readonly password: string;
    readonly now?: Date;
  },
): Promise<DeletionRequestOutcome> {
  const session = await auth.api.getSession({ headers: input.headers });
  if (!session) {
    return { ok: false, reason: "signed_out" };
  }
  const user = session.user as { id: string; email: string };

  // (1) The refusals.
  const block = await deletionBlock(pool, {
    userId: user.id,
    email: user.email,
  });
  if (block?.kind === "last_owner") {
    return {
      ok: false,
      reason: "last_owner",
      workspaceId: block.workspaceId,
      workspaceName: block.workspaceName,
    };
  }
  if (block) {
    return { ok: false, reason: block.kind };
  }

  // (2) Proof.
  if (await accountHasPassword(pool, user.id)) {
    if (input.password === "") {
      return { ok: false, reason: "wrong_password" };
    }
    try {
      await auth.api.verifyPassword({
        headers: input.headers,
        body: { password: input.password },
      });
    } catch (error) {
      const body = (error instanceof APIError ? error.body : undefined) as
        | { code?: unknown; retryAfterSeconds?: unknown }
        | undefined;
      if (body?.code === "SIGN_IN_HELD") {
        const seconds = Number(body.retryAfterSeconds);
        return {
          ok: false,
          reason: "held",
          retryAfterSeconds: Number.isFinite(seconds) ? seconds : 60,
        };
      }
      if (body?.code === "INVALID_PASSWORD") {
        return { ok: false, reason: "wrong_password" };
      }
      throw error;
    }
  } else if (!signedInRecently(session.session, input.now)) {
    return {
      ok: false,
      reason: "not_recent",
      providers: await linkedProviders(pool, user.id),
    };
  }

  // (3) One transaction.
  const requestedAt = input.now ?? new Date();
  const runsAt = new Date(
    requestedAt.getTime() + ACCOUNT_DELETION_WAIT_DAYS * DAY_MS,
  );
  const stored = await withInstanceAdmin(drizzle(pool), async (tx) => {
    // An open request already there is the answer, not a second row. It
    // cannot normally exist, since the request ended every session and a
    // sign-in cancels it, but two clicks can race.
    // openokr:allow-mutation: identity data above the tenant floor, on the
    // instance flag, in the transaction that also audits it (design §6).
    const [created] = await tx
      .insert(accountDeletions)
      .values({ userId: user.id, requestedAt, runsAt })
      .onConflictDoNothing()
      .returning({ runsAt: accountDeletions.runsAt });
    const [open] = created
      ? [created]
      : await tx
          .select({ runsAt: accountDeletions.runsAt })
          .from(accountDeletions)
          .where(openRequestOf(user.id))
          .limit(1);
    // openokr:allow-mutation: identity data outside any workspace, written
    // in the request's own transaction. Every device is signed out at once
    // (Y7-1), which is what makes a sign-in the only way to cancel.
    const ended = await tx
      .delete(authSessions)
      .where(eq(authSessions.userId, user.id))
      .returning({ id: authSessions.id });
    if (created) {
      await appendInstanceAuditInTx(tx, {
        action: REQUESTED_ACTION,
        payload: {
          userId: user.id,
          runsAt: runsAt.toISOString(),
          sessionsEnded: ended.length,
        },
      });
      await enqueueOutbox(tx, {
        topic: ACCOUNT_DELETION_REQUESTED_TOPIC,
        payload: {
          userId: user.id,
          to: user.email,
          runsAt: runsAt.toISOString(),
        },
        idempotencyKey: `${ACCOUNT_DELETION_REQUESTED_TOPIC}:${randomUUID()}`,
      });
    }
    return open?.runsAt ?? runsAt;
  });
  return { ok: true, runsAt: stored };
}

function openRequestOf(userId: string) {
  return and(
    eq(accountDeletions.userId, userId),
    isNull(accountDeletions.cancelledAt),
    isNull(accountDeletions.completedAt),
  );
}

/** What a sign-in found: nothing open, a request it cancelled, or a run. */
export type SignInDeletionState = "none" | "cancelled" | "running";

/**
 * Cancels an open request because its account signed in (design §3.2), or
 * says the run has begun and the sign-in must be refused (§3.3).
 *
 * Called from the session hook, so every way of signing in meets it: a
 * password, a passkey, a second factor, single sign-on. The row is locked
 * while it is read, so a sign-in and the scheduler's claim cannot both win.
 */
export async function cancelDeletionOnSignIn(
  pool: Pool,
  userId: string,
  now: Date = new Date(),
): Promise<SignInDeletionState> {
  return withInstanceAdmin(drizzle(pool), async (tx) => {
    const [open] = await tx
      .select({
        id: accountDeletions.id,
        startedAt: accountDeletions.startedAt,
      })
      .from(accountDeletions)
      .where(openRequestOf(userId))
      .limit(1)
      .for("update");
    if (!open) {
      return "none";
    }
    if (open.startedAt !== null) {
      return "running";
    }
    // openokr:allow-mutation: the request's own row, on the instance flag.
    await tx
      .update(accountDeletions)
      .set({ cancelledAt: now, cancelReason: "signed_in" })
      .where(eq(accountDeletions.id, open.id));
    await appendInstanceAuditInTx(tx, {
      action: CANCELLED_ACTION,
      payload: { userId, reason: "signed_in" },
    });
    const to = await addressOf(tx, userId);
    if (to !== null) {
      await enqueueOutbox(tx, {
        topic: ACCOUNT_DELETION_CANCELLED_TOPIC,
        payload: { userId, to, reason: "signed_in" },
        idempotencyKey: `${ACCOUNT_DELETION_CANCELLED_TOPIC}:${randomUUID()}`,
      });
    }
    return "cancelled";
  });
}

/** The refusal a sign-in meets while the run is erasing the account. */
export function accountBeingDeletedError(): APIError {
  return new APIError("FORBIDDEN", {
    message:
      "Your account is being deleted. You will get a mail when it is done.",
    code: ACCOUNT_BEING_DELETED_CODE,
  });
}

/**
 * Whether this account's request was cancelled by a sign-in in the last few
 * minutes, so the page after sign-in says the account is kept (design §3.2).
 * Read under the person's own identity, which is all the policy lets it see.
 */
export async function deletionJustCancelled(
  pool: Pool,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const since = new Date(now.getTime() - KEPT_NOTICE_MS);
  const rows = await withUser(drizzle(pool), userId, (tx) =>
    tx
      .select({ id: accountDeletions.id })
      .from(accountDeletions)
      .where(
        and(
          eq(accountDeletions.userId, userId),
          eq(accountDeletions.cancelReason, "signed_in"),
          sql`${accountDeletions.cancelledAt} >= ${since}`,
        ),
      )
      .limit(1),
  );
  return rows.length > 0;
}

/** The address the account has now, or null for one that is gone. */
async function addressOf(
  tx: Pick<ReturnType<typeof drizzle>, "execute">,
  userId: string,
): Promise<string | null> {
  const { rows } = await tx.execute<{ email: string }>(
    sql`select email from users where id = ${userId}`,
  );
  const email = rows[0]?.email;
  // An erased account's address is undeliverable on purpose.
  return email && !email.endsWith("@erased.invalid") ? email : null;
}

/** What one scheduled pass did. */
export interface DeletionPass {
  readonly reminded: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly failed: number;
}

/**
 * The scheduler's hourly pass, and `pnpm account:delete-due` (design §7):
 * the day-before mails, then every request whose fourteen days have passed.
 */
export async function runDueDeletions(
  pool: Pool,
  options: { readonly now?: Date } = {},
): Promise<DeletionPass> {
  const now = options.now ?? new Date();
  const reminded = await remindDeletions(pool, now);
  const due = await withInstanceAdmin(drizzle(pool), (tx) =>
    tx
      .select({
        id: accountDeletions.id,
        userId: accountDeletions.userId,
        startedAt: accountDeletions.startedAt,
        workspacesDone: accountDeletions.workspacesDone,
      })
      .from(accountDeletions)
      .where(
        and(
          isNull(accountDeletions.cancelledAt),
          isNull(accountDeletions.completedAt),
          lte(accountDeletions.runsAt, now),
        ),
      )
      .orderBy(asc(accountDeletions.runsAt))
      .limit(BATCH),
  );
  let completed = 0;
  let cancelled = 0;
  let failed = 0;
  for (const request of due) {
    const outcome = await runOne(pool, request, now);
    if (outcome === "completed") {
      completed++;
    } else if (outcome === "cancelled") {
      cancelled++;
    } else if (outcome === "failed") {
      failed++;
    }
  }
  return { reminded, completed, cancelled, failed };
}

/** "Your account will be deleted tomorrow", once per request (Y7-1). */
async function remindDeletions(pool: Pool, now: Date): Promise<number> {
  const tomorrow = new Date(now.getTime() + DAY_MS);
  return withInstanceAdmin(drizzle(pool), async (tx) => {
    // openokr:allow-mutation: the requests' own rows, on the instance flag.
    const rows = await tx
      .update(accountDeletions)
      .set({ remindedAt: now })
      .where(
        and(
          isNull(accountDeletions.cancelledAt),
          isNull(accountDeletions.completedAt),
          isNull(accountDeletions.startedAt),
          isNull(accountDeletions.remindedAt),
          lte(accountDeletions.runsAt, tomorrow),
          sql`${accountDeletions.runsAt} > ${now}`,
        ),
      )
      .returning({
        userId: accountDeletions.userId,
        runsAt: accountDeletions.runsAt,
      });
    for (const row of rows) {
      const to = await addressOf(tx, row.userId);
      if (to === null) {
        continue;
      }
      await enqueueOutbox(tx, {
        topic: ACCOUNT_DELETION_TOMORROW_TOPIC,
        payload: {
          userId: row.userId,
          to,
          runsAt: row.runsAt.toISOString(),
        },
        idempotencyKey: `${ACCOUNT_DELETION_TOMORROW_TOPIC}:${randomUUID()}`,
      });
    }
    return rows.length;
  });
}

type RunOutcome = "completed" | "cancelled" | "failed" | "skipped";

/**
 * Runs one due request: the refusals again, then a workspace at a time.
 *
 * **Nothing is ever half done because of a refusal** (design §3.3). The
 * refusals are checked while no workspace is erased yet. Once one workspace is
 * erased there is no going back, and a later failure is retried by the next
 * pass rather than cancelled.
 */
async function runOne(
  pool: Pool,
  request: {
    readonly id: string;
    readonly userId: string;
    readonly startedAt: Date | null;
    readonly workspacesDone: readonly string[];
  },
  now: Date,
): Promise<RunOutcome> {
  const db = drizzle(pool);
  // The claim. A sign-in that cancelled meanwhile holds the same row lock, so
  // exactly one of the two wins.
  const claimed = await withInstanceAdmin(db, async (tx) => {
    // openokr:allow-mutation: the request's own row, on the instance flag.
    return tx
      .update(accountDeletions)
      .set({
        startedAt: request.startedAt ?? now,
        attempts: sql`${accountDeletions.attempts} + 1`,
      })
      .where(
        and(
          eq(accountDeletions.id, request.id),
          isNull(accountDeletions.cancelledAt),
          isNull(accountDeletions.completedAt),
        ),
      )
      .returning({ id: accountDeletions.id });
  });
  if (claimed.length === 0) {
    return "skipped";
  }

  // Read before anything changes: the last workspace's erasure anonymises it.
  const to = await withInstanceAdmin(db, (tx) => addressOf(tx, request.userId));

  // Before the first erasure, which is also a pass resumed after one that
  // erased nothing: the refusals are asked again whenever nothing is done.
  if (request.workspacesDone.length === 0) {
    const block = await deletionBlock(pool, {
      userId: request.userId,
      email: to ?? "",
    });
    if (block) {
      await cancelRefused(pool, request, to, block, now);
      return "cancelled";
    }
  }

  try {
    for (const membership of await membershipsOf(pool, request.userId)) {
      await eraseForDeletion(pool, membership, to);
      await withInstanceAdmin(db, async (tx) => {
        // openokr:allow-mutation: the ledger, on the instance flag.
        await tx
          .update(accountDeletions)
          .set({
            workspacesDone: sql`array_append(${accountDeletions.workspacesDone}, ${membership.workspaceId}::uuid)`,
          })
          .where(eq(accountDeletions.id, request.id));
      });
    }
    // A membership that appeared during the run is erased by the next pass.
    if ((await membershipsOf(pool, request.userId)).length > 0) {
      throw new Error("A membership appeared while the account was erased.");
    }
    await finish(pool, request, to);
    return "completed";
  } catch (error) {
    // The driver's own reason rather than Drizzle's wrapper, which leads with
    // the query text and would fill the column before saying what went wrong.
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause
        : error;
    const message = cause instanceof Error ? cause.message : String(cause);
    await withInstanceAdmin(db, async (tx) => {
      // openokr:allow-mutation: the ledger, on the instance flag.
      await tx
        .update(accountDeletions)
        .set({ lastError: message.slice(0, 500) })
        .where(eq(accountDeletions.id, request.id));
    });
    process.stderr.write(
      `account deletion ${request.id}: ${message.slice(0, 500)}\n`,
    );
    return "failed";
  }
}

/** A refusal held when the run began: cancelled, audited and mailed. */
async function cancelRefused(
  pool: Pool,
  request: { readonly id: string; readonly userId: string },
  to: string | null,
  block: DeletionBlock,
  now: Date,
): Promise<void> {
  await withInstanceAdmin(drizzle(pool), async (tx) => {
    // openokr:allow-mutation: the request's own row, on the instance flag.
    await tx
      .update(accountDeletions)
      .set({ cancelledAt: now, cancelReason: "refused" })
      .where(eq(accountDeletions.id, request.id));
    await appendInstanceAuditInTx(tx, {
      action: CANCELLED_ACTION,
      payload: { userId: request.userId, reason: "refused", block: block.kind },
    });
    if (to !== null) {
      await enqueueOutbox(tx, {
        topic: ACCOUNT_DELETION_CANCELLED_TOPIC,
        payload: {
          userId: request.userId,
          to,
          reason: "refused",
          block: block.kind,
          ...(block.kind === "last_owner"
            ? { workspace: block.workspaceName }
            : {}),
        },
        idempotencyKey: `${ACCOUNT_DELETION_CANCELLED_TOPIC}:${randomUUID()}`,
      });
    }
  });
}

/**
 * Erases one membership, in that workspace's own Operation, through the body
 * `people.erase` runs. The actor is the system on the person's behalf; the
 * audit row says `by: "self"` and names no person (design §3.3).
 */
async function eraseForDeletion(
  pool: Pool,
  membership: Membership,
  to: string | null,
): Promise<void> {
  await runOperation(
    { pool },
    {
      action: "people.erase",
      workspaceId: membership.workspaceId,
      actor: { kind: "system" },
      requires: ACCESS_LEVELS.full,
      load: ({ tx, workspaceId }) =>
        loadMemberForErasure(tx, {
          workspaceId,
          memberId: membership.memberId,
          withExport: false,
        }),
      async execute({ tx, workspaceId, loaded }) {
        const owed = await whatNeedsAnOwner(
          tx,
          workspaceId,
          membership.memberId,
        );
        const manager = await managerOf(tx, workspaceId, membership.memberId);

        const erasure = await eraseMemberInTx(tx, pool, {
          workspaceId,
          memberId: membership.memberId,
          loaded,
        });

        // The last workspace: the account went with it, so the last mail is
        // queued now, to the address read before it was anonymised.
        if (erasure.account?.anonymised && to !== null) {
          await enqueueOutbox(tx, {
            topic: ACCOUNT_DELETION_DONE_TOPIC,
            payload: { userId: loaded.userId, to },
            idempotencyKey: `${ACCOUNT_DELETION_DONE_TOPIC}:${randomUUID()}`,
          });
        }

        // Y7-5, Y7-6: one notice to each administrator and the manager, only
        // when something now needs an owner. Nothing is handed to anybody.
        if (owed.goals + owed.keyResults + owed.reviews > 0) {
          const recipients = new Set(
            await workspaceAdministratorIds(tx, workspaceId),
          );
          if (manager !== null) {
            recipients.add(manager);
          }
          recipients.delete(membership.memberId);
          await notifyRecipients(tx, {
            workspaceId,
            subjectType: "workspace_member",
            subjectId: membership.memberId,
            recipients: [...recipients].map((memberId) => ({
              memberId,
              reason: "self_deleted" as const,
            })),
          });
        }

        return {
          result: erasure.memberId,
          activity: {
            kind: "member.self_deleted",
            subjectType: "workspace_member",
            subjectId: erasure.memberId,
            payload: { ...owed },
          },
          audit: {
            action: "people.erase",
            targetType: "workspace_member",
            targetId: erasure.memberId,
            payload: { ...erasureAuditPayload(erasure), by: "self" },
          },
        };
      },
    },
  );
}

/** What the member leaves without an owner: counts, never titles. */
async function whatNeedsAnOwner(
  tx: Pick<ReturnType<typeof drizzle>, "execute">,
  workspaceId: string,
  memberId: string,
): Promise<{ goals: number; keyResults: number; reviews: number }> {
  const { rows } = await tx.execute<{
    goals: number;
    key_results: number;
    reviews: number;
  }>(sql`
    select
      (select count(*)::int from goals
        where workspace_id = ${workspaceId} and champion_id = ${memberId}
          and closed_at is null and deleted_at is null) as goals,
      (select count(*)::int from key_results kr
         join goals g on g.id = kr.goal_id
        where kr.workspace_id = ${workspaceId} and kr.owner_id = ${memberId}
          and kr.deleted_at is null and g.deleted_at is null
          and g.closed_at is null) as key_results,
      (select count(*)::int from check_ins
        where workspace_id = ${workspaceId}
          and reviewer_member_id = ${memberId}
          and state = 'published' and acknowledged_at is null
          and deleted_at is null) as reviews
  `);
  const row = rows[0];
  return {
    goals: Number(row?.goals ?? 0),
    keyResults: Number(row?.key_results ?? 0),
    reviews: Number(row?.reviews ?? 0),
  };
}

/** The member's manager, when they have one who can be told. */
async function managerOf(
  tx: Pick<ReturnType<typeof drizzle>, "select">,
  workspaceId: string,
  memberId: string,
): Promise<string | null> {
  const [member] = await tx
    .select({ managerId: workspaceMembers.managerId })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!member?.managerId) {
    return null;
  }
  const [manager] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.id, member.managerId),
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.status, "active"),
        eq(workspaceMembers.kind, "human"),
      ),
    )
    .limit(1);
  return manager?.id ?? null;
}

/**
 * Stamps the request done, on the instance chain too. An account that
 * belonged to no workspace when the run began is anonymised here, since no
 * workspace erasure did it.
 */
async function finish(
  pool: Pool,
  request: { readonly id: string; readonly userId: string },
  to: string | null,
): Promise<void> {
  await withInstanceAdmin(drizzle(pool), async (tx) => {
    const [row] = await tx
      .select({ workspacesDone: accountDeletions.workspacesDone })
      .from(accountDeletions)
      .where(eq(accountDeletions.id, request.id))
      .limit(1);
    // Still deliverable means no workspace erasure anonymised it.
    if ((await addressOf(tx, request.userId)) !== null) {
      await eraseAccountIfAlone(tx, pool, { userId: request.userId });
      if (to !== null) {
        await enqueueOutbox(tx, {
          topic: ACCOUNT_DELETION_DONE_TOPIC,
          payload: { userId: request.userId, to },
          idempotencyKey: `${ACCOUNT_DELETION_DONE_TOPIC}:${randomUUID()}`,
        });
      }
    }
    // openokr:allow-mutation: the request's own row, on the instance flag.
    await tx
      .update(accountDeletions)
      .set({ completedAt: new Date(), lastError: null })
      .where(eq(accountDeletions.id, request.id));
    await appendInstanceAuditInTx(tx, {
      action: COMPLETED_ACTION,
      payload: {
        userId: request.userId,
        workspaces: row?.workspacesDone.length ?? 0,
      },
    });
  });
}
