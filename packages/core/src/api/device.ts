/**
 * The device login (TECHNICAL-PLAN §14, P5-T07c-b).
 *
 * A terminal cannot open a browser and a browser cannot write to a terminal, so
 * the two meet through a row: the terminal creates a request and polls it, and a
 * person approves it in a browser they are already signed in to. This is RFC
 * 8628's device authorization grant, narrowed to what this product needs.
 *
 * **The token is minted at poll time, never stored.** Approval records who
 * approved and when. The poll mints the token and marks the row consumed in one
 * transaction, so a code approved twice grants once, and no granted token ever
 * sits in a table waiting to be collected.
 *
 * **What is granted is exactly what was asked, because approval takes no
 * scopes.** The screen shows the scopes the terminal asked for and offers
 * approve or deny. There is no input through which a scope could be added, which
 * is a stronger guarantee than checking afterwards that none was.
 *
 * **Every refusal is one of the protocol's own words.** `authorization_pending`,
 * `slow_down`, `expired_token` and `access_denied` are RFC 8628's, so a client
 * that already speaks the protocol needs no special case for this instance.
 */

import { createHash, randomInt } from "node:crypto";
import {
  activeOnly,
  apiTokens,
  deviceAuthorisations,
  type TokenScope,
  withDeviceCode,
} from "@openokr/db";
import { eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { withoutTrailingSlashes } from "../urls.ts";
import { mintApiToken } from "./tokens.ts";

/**
 * How long a request is good for.
 *
 * Ten minutes: long enough to find the right browser tab and sign in, short
 * enough that an abandoned code is not a standing offer. A constant rather than
 * a §4.14 setting, for the same reason the inbound channel rate limit is one: it
 * is a protocol parameter rather than a practice choice, and nobody should have
 * to configure it to be safe.
 */
export const DEVICE_CODE_TTL_SECONDS = 600;

/** How often a terminal may poll. RFC 8628's `interval`. */
export const DEVICE_POLL_INTERVAL_SECONDS = 5;

/** No 0/O and no 1/I/L, so a code read off a screen cannot be mistyped. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Both codes hash through here, and both are normalised first.
 *
 * Upper-cased and trimmed, because a person retypes the short one and a shell
 * can add whitespace to either. A code that changes when it is normalised could
 * not be looked up, which is why the codes are drawn from an alphabet that
 * survives it.
 */
export const hashDeviceCode = (code: string): string =>
  createHash("sha256").update(code.trim().toUpperCase()).digest("hex");

/**
 * The long code, which stays in the terminal. Forty characters of the alphabet.
 *
 * `randomInt` rather than a byte modulo the alphabet length. The alphabet has
 * thirty-one characters and a byte has two hundred and fifty-six values, so
 * `byte % 31` makes the first eight characters of the alphabet very slightly
 * more likely than the rest: real, measurable bias in a code that is the whole
 * credential. CodeQL flagged it, correctly, and `randomInt` rejects out-of-range
 * draws instead of folding them.
 */
export function generateDeviceCode(): string {
  let code = "";
  for (let index = 0; index < 40; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** The short code a person sees: `ABCD-EFGH`. */
export function generateUserCode(): string {
  const half = (): string => {
    let text = "";
    for (let index = 0; index < 4; index += 1) {
      text += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return text;
  };
  return `${half()}-${half()}`;
}

export interface StartedDevice {
  /** Held by the terminal. Shown to nobody. */
  readonly deviceCode: string;
  /** Goes in the URL a person opens. */
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresIn: number;
  readonly interval: number;
}

/**
 * Starts a request.
 *
 * Runs with no workspace and no member, which is why the row's `workspace_id` is
 * null and the insert goes through the device-code key: a caller can write only
 * the row whose code it just generated.
 */
export async function startDeviceAuthorisation(
  pool: Pool,
  input: {
    readonly clientName: string;
    readonly scopes: readonly TokenScope[];
    readonly baseUrl: string;
    readonly now: Date;
  },
): Promise<StartedDevice> {
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const deviceCodeHash = hashDeviceCode(deviceCode);

  await withDeviceCode(drizzle(pool), deviceCodeHash, async (tx) => {
    // openokr:allow-mutation: there is no Operation to run this through. The
    // pipeline needs a workspace and an actor, and this row is written before
    // either exists: a terminal asking to log in is not yet anybody, anywhere.
    // Nothing is granted by it either, so there is no privileged change for an
    // audit row to describe; the audit event is written when a member approves
    // it, by `tokens.approveDevice`, which does go through the pipeline.
    await tx.insert(deviceAuthorisations).values({
      deviceCodeHash,
      userCodeHash: hashDeviceCode(userCode),
      clientName: input.clientName.slice(0, 120),
      requestedScopes: [...input.scopes],
      expiresAt: new Date(input.now.getTime() + DEVICE_CODE_TTL_SECONDS * 1000),
    });
  });

  return {
    deviceCode,
    userCode,
    verificationUri: `${withoutTrailingSlashes(input.baseUrl)}/account/device?code=${encodeURIComponent(userCode)}`,
    expiresIn: DEVICE_CODE_TTL_SECONDS,
    interval: DEVICE_POLL_INTERVAL_SECONDS,
  };
}

/** What a request looks like to the person being asked to approve it. */
export interface PendingDevice {
  readonly id: string;
  readonly clientName: string;
  readonly requestedScopes: readonly TokenScope[];
  readonly expiresAt: string;
}

/**
 * The pending request one user code names, for the approval screen.
 *
 * Answers null for a code that does not exist, has expired, or has already been
 * decided, because all three mean the same thing to the screen: there is nothing
 * here to approve. Telling them apart would tell somebody guessing codes which
 * of their guesses had once been real.
 */
export async function pendingDevice(
  pool: Pool,
  input: { readonly userCode: string; readonly now: Date },
): Promise<PendingDevice | null> {
  const hash = hashDeviceCode(input.userCode);
  const row = await withDeviceCode(drizzle(pool), hash, async (tx) => {
    const [found] = await tx
      .select()
      .from(deviceAuthorisations)
      .where(
        activeOnly(
          deviceAuthorisations,
          eq(deviceAuthorisations.userCodeHash, hash),
        ),
      )
      .limit(1);
    return found;
  });

  if (
    !row ||
    row.approvedAt !== null ||
    row.deniedAt !== null ||
    row.expiresAt.getTime() <= input.now.getTime()
  ) {
    return null;
  }
  return {
    id: row.id,
    clientName: row.clientName,
    requestedScopes: row.requestedScopes,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export type DeviceGrant =
  | { readonly kind: "granted"; readonly token: string; readonly name: string }
  /** RFC 8628's own words, so a client that speaks the protocol needs no case. */
  | {
      readonly kind: "pending" | "slow_down" | "expired" | "denied" | "invalid";
    };

/**
 * One poll.
 *
 * The whole decision is one transaction, which is what makes "approved twice
 * grants once" a property of the database rather than of the order two requests
 * happened to arrive in: the row is claimed with `consumed_at is null` in the
 * where clause, and only the poll that actually claimed it mints anything.
 *
 * The tenant setting is applied *inside* the transaction, after the row has said
 * which workspace it belongs to. That is the one place in the product where the
 * workspace is learned rather than given, and it is why: a terminal polling has
 * no session to learn it from, and the token being minted belongs to the
 * workspace whose member approved the request.
 */
export async function pollDeviceAuthorisation(
  pool: Pool,
  input: { readonly deviceCode: string; readonly now: Date },
): Promise<DeviceGrant> {
  const hash = hashDeviceCode(input.deviceCode);

  return withDeviceCode(drizzle(pool), hash, async (tx) => {
    const [row] = await tx
      .select()
      .from(deviceAuthorisations)
      .where(
        activeOnly(
          deviceAuthorisations,
          eq(deviceAuthorisations.deviceCodeHash, hash),
        ),
      )
      .limit(1);

    if (!row || row.consumedAt !== null) {
      // No such request, or one whose token has already been handed over. The
      // same answer for both: a token is collected once.
      return { kind: "invalid" } as const;
    }
    if (row.deniedAt !== null) {
      return { kind: "denied" } as const;
    }
    if (row.expiresAt.getTime() <= input.now.getTime()) {
      return { kind: "expired" } as const;
    }

    // The protocol's own back-off, decided before anything else: a client
    // hammering the endpoint is told to wait rather than served faster.
    const since = row.lastPolledAt
      ? input.now.getTime() - row.lastPolledAt.getTime()
      : Number.POSITIVE_INFINITY;
    if (since < DEVICE_POLL_INTERVAL_SECONDS * 1000) {
      return { kind: "slow_down" } as const;
    }

    if (
      row.approvedAt === null ||
      row.approvedMemberId === null ||
      row.workspaceId === null
    ) {
      // openokr:allow-mutation: the poll stamp, so the interval above can be
      // enforced at all. Not domain state, and no activity or audit row
      // describes a terminal asking again.
      await tx
        .update(deviceAuthorisations)
        .set({ lastPolledAt: input.now })
        .where(
          activeOnly(deviceAuthorisations, eq(deviceAuthorisations.id, row.id)),
        );
      return { kind: "pending" } as const;
    }

    // **The tenant setting goes on before the claim, not after it.** The row now
    // carries the approver's workspace, so the policy's check clause needs that
    // workspace to be set for the update to be allowed at all: the branch that
    // admits a workspace-less row no longer applies once one has been approved.
    // Written the other way round first, and the database refused it, which is
    // the floor doing its job.
    await tx.execute(
      sql`select set_config('app.workspace_id', ${row.workspaceId}, true)`,
    );

    // openokr:allow-mutation: claiming the request is what this transaction
    // exists to do, and the token below is minted in the same one.
    const claimed = await tx
      .update(deviceAuthorisations)
      .set({ consumedAt: input.now, updatedAt: input.now })
      .where(
        activeOnly(
          deviceAuthorisations,
          eq(deviceAuthorisations.id, row.id),
          isNull(deviceAuthorisations.consumedAt),
        ),
      )
      .returning({ id: deviceAuthorisations.id });
    if (claimed.length === 0) {
      // Another poll got there first, in a transaction this one could not see.
      return { kind: "invalid" } as const;
    }

    const minted = mintApiToken("rest");
    const name = `Terminal: ${row.clientName}`;
    // openokr:allow-mutation: the token this grant exists to issue, in the same
    // transaction as the claim above so neither can happen without the other.
    await tx.insert(apiTokens).values({
      workspaceId: row.workspaceId,
      memberId: row.approvedMemberId,
      name,
      audience: "rest",
      tokenHash: minted.hash,
      prefix: minted.prefix,
      // Exactly what was asked, and there is no path by which it could be more:
      // the approve action takes no scopes.
      scopes: [...row.requestedScopes],
      expiresAt: null,
    });

    return { kind: "granted", token: minted.raw, name } as const;
  });
}
