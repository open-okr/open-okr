/**
 * Per-workspace byte accounting (TECHNICAL-PLAN §4.9, P2-T05).
 *
 * "Exactly one warning" is read as one per crossing, not one per upload
 * while already over the threshold: `checkQuota` compares the total before
 * this upload against the total after it, and only reports a new crossing
 * when the boundary sits strictly between the two. A workspace that stays
 * over ninety percent across many later uploads is not warned again for
 * each one; it already knows.
 */
import { activeOnly, blobs, type WorkspaceTx } from "@openokr/db";
import { and, eq, sql } from "drizzle-orm";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/** Live bytes counted as occupying space: reserved, uploaded or scanning. */
const OCCUPYING_STATUSES = ["ok", "scanning", "quarantined"] as const;

export async function usedBytes<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${blobs.filesize}), 0)` })
    .from(blobs)
    .where(
      and(
        activeOnly(blobs, eq(blobs.workspaceId, workspaceId)),
        sql`${blobs.status} in ('ok', 'scanning', 'quarantined')`,
      ),
    );
  return Number(row?.total ?? 0);
}

export const QUOTA_OCCUPYING_STATUSES = OCCUPYING_STATUSES;

export interface QuotaCheckInput {
  readonly usedBeforeBytes: number;
  readonly newFileBytes: number;
  readonly quotaBytes: number;
}

export interface QuotaCheckResult {
  readonly usedAfterBytes: number;
  /** True when the total after this upload would exceed the quota. */
  readonly overQuota: boolean;
  /** True the first time the total crosses ninety percent, and only then. */
  readonly warningCrossed: boolean;
}

export function checkQuota(input: QuotaCheckInput): QuotaCheckResult {
  const usedAfterBytes = input.usedBeforeBytes + input.newFileBytes;
  const warningThreshold = input.quotaBytes * 0.9;
  return {
    usedAfterBytes,
    overQuota: usedAfterBytes > input.quotaBytes,
    warningCrossed:
      input.usedBeforeBytes < warningThreshold &&
      usedAfterBytes >= warningThreshold,
  };
}
