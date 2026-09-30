/**
 * The audit trail a page at a time, for the screen (completeness review L-19).
 *
 * The admin screen could verify the chain and take a file of it, and nobody
 * could look at it. An administrator asked "who suspended Priya" had to
 * download a CSV and search it, which is a spreadsheet standing in for a
 * screen the plan asked for (UIUX-PLAN S-36: "the audit log with filtering,
 * export and chain verification").
 *
 * **Newest first, keyset rather than an offset.** The trail only grows, and a
 * busy workspace writes a row for every change anybody makes, so an offset
 * page would cost more the further back somebody read and would show a row
 * twice whenever one arrived at the top between two pages. The cursor is the
 * last row's own `(at, id)`, which is a total order: two rows can share a
 * millisecond, and the id, a time-ordered UUIDv7, breaks the tie. Migration
 * 0105 gives that order its index.
 *
 * **What a row carries is what the export already hands over, and less.**
 * The payload stays in the database. It is the part of a row whose shape
 * differs per action and the part a list has no column for; the one fact from
 * it the screen shows is the channel, which the pipeline puts there for every
 * write that did not come from the browser (P5-T06a). Somebody who needs the
 * rest takes the export, which records that they did.
 */
import { auditEvents, withWorkspace } from "@openokr/db";
import { and, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { type AuditFilter, auditFilterClauses } from "./export.ts";

interface AuditListRow {
  readonly id: string;
  /** The row's position in the chain, or null while it waits for one. */
  readonly seq: number | null;
  readonly at: Date;
  readonly actorKind: "human" | "agent" | "system" | "operator";
  readonly actorMemberId: string | null;
  readonly actorOperatorUserId: string | null;
  /** Where the write came from, when it was not the browser. */
  readonly channel: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
}

interface AuditListPage {
  readonly rows: readonly AuditListRow[];
  /** True when older rows match the same filter. */
  readonly more: boolean;
}

/**
 * One page of the rows a filter matches, newest first.
 *
 * `cursor` is the last row of the page before, and absent means the newest.
 */
export async function listAuditRows(
  pool: Pool,
  workspaceId: string,
  filter: AuditFilter,
  page: {
    readonly cursor?: { readonly at: Date; readonly id: string };
    readonly limit: number;
  },
): Promise<AuditListPage> {
  const clauses = auditFilterClauses(workspaceId, filter);
  if (page.cursor) {
    // A row comparison rather than `at < x or (at = x and id < y)`, because
    // Postgres can walk a composite index with the first and usually not with
    // the second. The same spelling `goals.list` uses.
    clauses.push(
      sql`(${auditEvents.at}, ${auditEvents.id}) < (${page.cursor.at.toISOString()}::timestamptz, ${page.cursor.id}::uuid)`,
    );
  }

  // One more than asked for, so "there are older rows" is an answer rather
  // than a guess from a full page.
  const rows = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({
        id: auditEvents.id,
        seq: auditEvents.seq,
        at: auditEvents.at,
        actorKind: auditEvents.actorKind,
        actorMemberId: auditEvents.actorMemberId,
        actorOperatorUserId: auditEvents.actorOperatorUserId,
        // Only this key leaves the database. Reading the whole payload to
        // pick one field out of it in JavaScript would carry every other
        // field across the wire for nothing.
        channel: sql<string | null>`${auditEvents.payload} ->> 'channel'`,
        action: auditEvents.action,
        targetType: auditEvents.targetType,
        targetId: auditEvents.targetId,
      })
      .from(auditEvents)
      .where(and(...clauses))
      .orderBy(desc(auditEvents.at), desc(auditEvents.id))
      .limit(page.limit + 1),
  );

  return {
    rows: rows.slice(0, page.limit).map((row) => ({
      ...row,
      seq: row.seq === null ? null : Number(row.seq),
    })),
    more: rows.length > page.limit,
  };
}
