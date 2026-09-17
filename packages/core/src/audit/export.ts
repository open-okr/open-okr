/**
 * The audit trail, filtered and taken out as a file (P8-T10).
 *
 * An auditor asks a narrow question: what did this person do last quarter,
 * who changed access in March, what happened to this goal. The trail answers
 * all three and a screen that could only scroll it would answer none of them,
 * so the filters are the feature and the file is the delivery.
 *
 * **What comes out is what the chain covers.** The same rows, in sequence
 * order, with the position and the row hash in the file: an auditor who holds
 * the export and runs the verification can line one up against the other, and
 * an export with no position in it would be a list of claims about a trail
 * rather than a copy of one.
 *
 * **The payload is included and it is the reason this is an admin action.**
 * An audit row's payload names what changed, which is the detail that makes
 * the trail worth keeping and also the detail a bulk file should not be handed
 * to somebody who cannot already read those rows.
 */
import { auditEvents, withWorkspace } from "@openokr/db";
import { and, asc, eq, gte, lte, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { type CsvTable, toCsv } from "../exports/csv.ts";

/** What an auditor narrows the trail by. */
export interface AuditExportFilter {
  /** Inclusive, on the recorded time. */
  readonly from?: Date;
  /** Inclusive, on the recorded time. */
  readonly to?: Date;
  /** One registry action name, exactly. */
  readonly action?: string;
  /** One member, by their id in this workspace. */
  readonly actorMemberId?: string;
  /** One kind of target, such as `goal` or `workspace_member`. */
  readonly targetType?: string;
  /** One target, by id. */
  readonly targetId?: string;
  /**
   * How many rows at most.
   *
   * A ceiling rather than a page: an export is one file and a caller asking
   * for a quarter of a busy workspace should get a file that says it was
   * truncated rather than a silent half of one.
   */
  readonly limit: number;
}

export interface AuditExportRow {
  readonly seq: number | null;
  readonly at: Date;
  readonly actorKind: string;
  readonly actorMemberId: string | null;
  readonly actorOperatorUserId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly payload: Record<string, unknown>;
  readonly rowHash: string | null;
}

export interface AuditExport {
  readonly rows: readonly AuditExportRow[];
  /** True when the filter matched more rows than the ceiling allowed. */
  readonly truncated: boolean;
}

/**
 * The rows one filter matches, oldest first.
 *
 * Sequence order rather than time order, because the chain is defined on the
 * sequence and two rows can share a timestamp. Rows with no position yet sort
 * last, which is where they belong: they are the tail the chainer has not
 * reached.
 */
export async function exportAuditRows(
  pool: Pool,
  workspaceId: string,
  filter: AuditExportFilter,
): Promise<AuditExport> {
  // **The workspace is named here as well as in the tenant setting.** The
  // floor is the floor, not the only scope: a connection that bypasses
  // row-level security would otherwise hand an export one workspace asked for
  // and every other workspace as well. The verifier beside this had the same
  // shape and the same correction (P8-T10).
  const clauses: SQL[] = [eq(auditEvents.workspaceId, workspaceId)];
  if (filter.from) {
    clauses.push(gte(auditEvents.at, filter.from));
  }
  if (filter.to) {
    clauses.push(lte(auditEvents.at, filter.to));
  }
  if (filter.action) {
    clauses.push(eq(auditEvents.action, filter.action));
  }
  if (filter.actorMemberId) {
    clauses.push(eq(auditEvents.actorMemberId, filter.actorMemberId));
  }
  if (filter.targetType) {
    clauses.push(eq(auditEvents.targetType, filter.targetType));
  }
  if (filter.targetId) {
    clauses.push(eq(auditEvents.targetId, filter.targetId));
  }

  // One more than asked for, so "there were more" is an answer rather than a
  // guess from a full page.
  const rows = await withWorkspace(drizzle(pool), workspaceId, (tx) => {
    const query = tx
      .select({
        seq: auditEvents.seq,
        at: auditEvents.at,
        actorKind: auditEvents.actorKind,
        actorMemberId: auditEvents.actorMemberId,
        actorOperatorUserId: auditEvents.actorOperatorUserId,
        action: auditEvents.action,
        targetType: auditEvents.targetType,
        targetId: auditEvents.targetId,
        payload: auditEvents.payload,
        rowHash: auditEvents.rowHash,
      })
      .from(auditEvents)
      .orderBy(asc(auditEvents.seq), asc(auditEvents.at))
      .limit(filter.limit + 1);
    return clauses.length > 0 ? query.where(and(...clauses)) : query;
  });

  return {
    rows: rows.slice(0, filter.limit).map((row) => ({
      seq: row.seq === null ? null : Number(row.seq),
      at: row.at,
      actorKind: row.actorKind,
      actorMemberId: row.actorMemberId,
      actorOperatorUserId: row.actorOperatorUserId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      payload: row.payload,
      rowHash: row.rowHash,
    })),
    truncated: rows.length > filter.limit,
  };
}

/** The column order the file carries. */
export const AUDIT_EXPORT_COLUMNS = [
  "seq",
  "at",
  "actor_kind",
  "actor_member_id",
  "actor_operator_user_id",
  "action",
  "target_type",
  "target_id",
  "payload",
  "row_hash",
] as const;

/**
 * The export as a CSV table.
 *
 * The payload is one JSON column rather than spread across columns, because an
 * audit payload's shape is per action and a file with a column per key would
 * have a different shape for every filter.
 */
export function auditCsv(rows: readonly AuditExportRow[]): CsvTable {
  return {
    columns: [...AUDIT_EXPORT_COLUMNS],
    rows: rows.map((row) => [
      row.seq ?? "",
      row.at.toISOString(),
      row.actorKind,
      row.actorMemberId ?? "",
      row.actorOperatorUserId ?? "",
      row.action,
      row.targetType,
      row.targetId ?? "",
      JSON.stringify(row.payload),
      row.rowHash ?? "",
    ]),
  };
}

/** The whole file, ready to hand over. */
export function auditCsvFile(rows: readonly AuditExportRow[]): string {
  return toCsv(auditCsv(rows));
}

/** What the file is called, dated so two exports do not collide. */
export function auditExportFilename(now: Date): string {
  return `audit-${now.toISOString().slice(0, 10)}.csv`;
}
