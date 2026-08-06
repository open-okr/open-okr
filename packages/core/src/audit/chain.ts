/**
 * The audit hash chain (TECHNICAL-PLAN §8.2).
 *
 * Each row commits to the row before it, so altering, removing or back-dating
 * one breaks every hash that follows and the verifier says exactly where. The
 * chain is per workspace, because workspaces are independent tenants and one
 * shared chain would let activity in one workspace be inferred from another's
 * sequence numbers.
 *
 * Everything here is pure. The database side lives in `verify.ts` and in the
 * pipeline, so the hashing can be reasoned about and tested on its own.
 */
import { createHash } from "node:crypto";
import type { ActorKind } from "@openokr/db";

/** The `prev_hash` of the first row in a workspace. */
export const GENESIS_HASH = "0".repeat(64);

export interface AuditRow {
  readonly workspaceId: string;
  readonly seq: number;
  readonly actorMemberId: string | null;
  readonly actorKind: ActorKind;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly payload: Record<string, unknown>;
  readonly at: Date;
  readonly prevHash: string;
}

/**
 * JSON with object keys in a fixed order.
 *
 * `JSON.stringify` preserves insertion order, so the same facts assembled in a
 * different order would hash differently and a valid chain would fail to
 * verify. Array order is left alone, because there it carries meaning.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
  return `{${entries.join(",")}}`;
}

/**
 * The hash of one row, over every field that carries meaning plus the previous
 * hash. Anything left out of this could be changed without detection, so the
 * list is deliberately complete rather than convenient.
 */
export function auditRowHash(row: AuditRow): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        workspaceId: row.workspaceId,
        seq: row.seq,
        actorMemberId: row.actorMemberId,
        actorKind: row.actorKind,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        payload: row.payload,
        at: row.at.toISOString(),
        prevHash: row.prevHash,
      }),
    )
    .digest("hex");
}

export interface ChainVerdict {
  readonly ok: boolean;
  /** How many rows were checked. */
  readonly checked: number;
  /** The first sequence number that did not add up. */
  readonly brokenAtSeq?: number;
  readonly reason?: string;
}

/**
 * Verifies a workspace's chain, in sequence order.
 *
 * Three things have to hold, and each catches a different attack. The hashes
 * must recompute, which catches an edit. Each row's `prevHash` must be the
 * previous row's hash, which catches an edit that was covered up by
 * recomputing that one row. And the sequence must start at 1 and be
 * contiguous, which catches a deletion whose whole tail was rebuilt.
 */
export function verifyChain(
  rows: readonly (AuditRow & { rowHash: string })[],
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
    if (auditRowHash(row) !== row.rowHash) {
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
