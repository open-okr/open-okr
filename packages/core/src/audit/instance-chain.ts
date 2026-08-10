/**
 * The instance-level audit chain (TECHNICAL-PLAN §8.2, P1/P2-hardening).
 *
 * A parallel to `audit/chain.ts`, not a reuse of it: `AuditRow` there
 * requires a `workspaceId`, `actorMemberId` and `targetType`, because a
 * workspace chain's rows are always about something inside one tenant. An
 * instance-level event (today: a sign-in lockout, which is a fact about an
 * email address and a caller address, resolved before any workspace
 * membership is known) has none of those, so it gets its own smaller row
 * shape and its own chain rather than a workspace chain with every tenant
 * field forced to null.
 *
 * This is the fix for the oldest open item this codebase carried: sign-in
 * lockout has been enforced since P1-T05 without writing an audit entry,
 * because `audit_events.workspace_id` is `not null` and a failed sign-in has
 * no workspace to attach to. `instance_audit_events` is that missing home.
 */
import { createHash } from "node:crypto";
import { instanceAuditEvents, newId, withInstanceAdmin } from "@openokr/db";
import { desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { type ChainVerdict, canonicalJson, GENESIS_HASH } from "./chain.ts";

export interface InstanceAuditRow {
  readonly seq: number;
  readonly action: string;
  readonly payload: Record<string, unknown>;
  readonly at: Date;
  readonly prevHash: string;
}

/** Serialises concurrent appends into the one instance-wide chain. */
const INSTANCE_AUDIT_LOCK_KEY = 761_803_4;

export function instanceAuditRowHash(row: InstanceAuditRow): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        seq: row.seq,
        action: row.action,
        payload: row.payload,
        at: row.at.toISOString(),
        prevHash: row.prevHash,
      }),
    )
    .digest("hex");
}

/** Same three checks `verifyChain` runs, over the instance row shape. */
export function verifyInstanceChain(
  rows: readonly (InstanceAuditRow & { rowHash: string })[],
): ChainVerdict {
  let expectedPrev = GENESIS_HASH;
  let expectedSeq = 1;

  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAtSeq: row.seq,
        reason: `expected sequence ${expectedSeq} but found ${row.seq}: a row is missing or was reordered`,
      };
    }
    if (row.prevHash !== expectedPrev) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAtSeq: row.seq,
        reason: "this row does not follow the one before it",
      };
    }
    if (instanceAuditRowHash(row) !== row.rowHash) {
      return {
        ok: false,
        checked: expectedSeq - 1,
        brokenAtSeq: row.seq,
        reason: "this row's contents do not match its recorded hash",
      };
    }
    expectedPrev = row.rowHash;
    expectedSeq++;
  }

  return { ok: true, checked: rows.length };
}

export interface RecordInstanceAuditEventInput {
  readonly action: string;
  readonly payload?: Record<string, unknown>;
}

/**
 * Appends one row to the instance's own chain.
 *
 * `withInstanceAdmin` sets the same transaction-local flag `system_settings`
 * writes already require, so this is not a second exception to the
 * Operation pipeline rule: it is the same one, for the same reason
 * (`writeSettings` in `secrets/instance-settings.ts`) — an instance-level
 * write has no workspace and no acting member for the pipeline's own audit
 * and activity rows to attach to.
 */
export async function recordInstanceAuditEvent(
  pool: Pool,
  input: RecordInstanceAuditEventInput,
): Promise<void> {
  const db = drizzle(pool);
  await withInstanceAdmin(db, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${INSTANCE_AUDIT_LOCK_KEY})`,
    );

    const [head] = await tx
      .select({
        seq: instanceAuditEvents.seq,
        rowHash: instanceAuditEvents.rowHash,
      })
      .from(instanceAuditEvents)
      .orderBy(desc(instanceAuditEvents.seq))
      .limit(1);

    const row: InstanceAuditRow = {
      seq: head ? Number(head.seq) + 1 : 1,
      action: input.action,
      payload: input.payload ?? {},
      at: new Date(),
      prevHash: head ? head.rowHash : GENESIS_HASH,
    };

    // openokr:allow-mutation: instance audit is not workspace data, the same
    // reasoning `writeSettings` already documents. There is no workspace and
    // no acting member for the Operation pipeline's own rows to attach to.
    await tx.insert(instanceAuditEvents).values({
      id: newId(),
      ...row,
      rowHash: instanceAuditRowHash(row),
    });
  });
}
