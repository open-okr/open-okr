/**
 * Building the audit chain behind the write path (P7-T02a,
 * TECHNICAL-PLAN §8.2).
 *
 * **Why this exists.** `appendAudit` used to hold a per-workspace advisory
 * lock for the tail of every write so each row could commit to the one before
 * it. P7-T02 measured what that cost: reads scale and writes queue, 14.8
 * seconds at the 95th percentile at fifty concurrent members in one workspace.
 * The row is still written inside the change's own transaction; what moved
 * here is deciding where it sits in the chain.
 *
 * **A single writer, so there is nothing to race.** The lock did not vanish,
 * it moved: this takes the same advisory lock, once per pass, and holds it
 * while it assigns a contiguous run of sequence numbers. One background pass
 * contending with another background pass is a wait of milliseconds between
 * two jobs. Fifty members' writes contending with each other was the problem.
 *
 * **Insertion order is `id` order.** Ids are time-ordered UUIDv7 (see
 * `packages/db/src/id.ts`), so ordering by id is ordering by the moment the
 * row was minted, to the millisecond. Using `at` instead would order by a
 * timestamp the caller supplied; using the insertion sequence of the table
 * would need one, which is the thing being removed.
 *
 * **Idempotent and resumable.** It claims only rows whose `seq` is null and
 * writes each one once. A pass that dies halfway leaves a shorter chain and a
 * longer pending tail, and the next pass continues from the new head.
 */
import { auditEvents, withWorkspace } from "@openokr/db";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { auditRowHash, GENESIS_HASH } from "./chain.ts";

/**
 * Rows chained in one statement's worth of work.
 *
 * Large enough that a busy workspace catches up in a pass or two, small
 * enough that the advisory lock is never held for long. The pass loops until
 * there is nothing left, so this is a latency knob rather than a ceiling.
 */
const CHAIN_BATCH = 500;

export interface ChainedReport {
  readonly workspaceId: string;
  /** How many rows gained a position this pass. */
  readonly chained: number;
  /** How many were still unchained when the pass finished. Normally zero. */
  readonly pending: number;
}

/**
 * Gives every unchained row in one workspace its position.
 *
 * Returns what it did, so a scheduler can log a number rather than a promise.
 */
export async function chainWorkspace(
  pool: Pool,
  workspaceId: string,
  batchSize: number = CHAIN_BATCH,
): Promise<ChainedReport> {
  const db = drizzle(pool);
  let chained = 0;

  for (;;) {
    const written = await withWorkspace(db, workspaceId, async (tx) => {
      // The same lock the write path used to take, held by one background
      // pass instead of by every member's write.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`audit:${workspaceId}`}))`,
      );

      const [head] = await tx
        .select({ seq: auditEvents.seq, rowHash: auditEvents.rowHash })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.workspaceId, workspaceId),
            isNotNull(auditEvents.seq),
          ),
        )
        .orderBy(desc(auditEvents.seq))
        .limit(1);

      const pending = await tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.workspaceId, workspaceId),
            isNull(auditEvents.seq),
          ),
        )
        .orderBy(asc(auditEvents.id))
        .limit(batchSize);

      if (pending.length === 0) {
        return 0;
      }

      let seq = head?.seq ? Number(head.seq) : 0;
      let prevHash = head?.rowHash ?? GENESIS_HASH;

      for (const row of pending) {
        seq += 1;
        const chainedRow = {
          workspaceId: row.workspaceId,
          seq,
          actorMemberId: row.actorMemberId,
          actorKind: row.actorKind,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          payload: row.payload,
          at: row.at,
          prevHash,
        };
        const rowHash = auditRowHash(chainedRow);
        // openokr:allow-mutation: this is the chainer, not a domain write. It
        // fills three columns that were left null on purpose and touches
        // nothing a person authored, so there is no change to audit, no
        // activity to report and no side effect to enqueue. Running it
        // through the Operation pipeline would make the audit trail audit
        // itself, one row per row, for ever.
        await tx
          .update(auditEvents)
          .set({ seq, prevHash, rowHash })
          .where(eq(auditEvents.id, row.id));
        prevHash = rowHash;
      }
      return pending.length;
    });

    chained += written;
    if (written < batchSize) {
      break;
    }
  }

  const pending = await countPending(pool, workspaceId);
  return { workspaceId, chained, pending };
}

/** How many rows in one workspace are recorded but not yet chained. */
export async function countPending(
  pool: Pool,
  workspaceId: string,
): Promise<number> {
  const db = drizzle(pool);
  const rows = await withWorkspace(db, workspaceId, (tx) =>
    tx
      .select({ n: sql<string>`count(*)::text` })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.workspaceId, workspaceId), isNull(auditEvents.seq)),
      ),
  );
  return Number(rows[0]?.n ?? "0");
}

/**
 * Chains every workspace on the instance.
 *
 * Needs a role that can enumerate tenants, the same bar `pnpm audit:verify`
 * asks for and for the same reason: forced row-level security hides
 * workspaces from the table owner too, so a pass that could see none would
 * report success having done nothing.
 */
export async function chainAllWorkspaces(pool: Pool): Promise<ChainedReport[]> {
  const workspaces = await pool.query<{ id: string }>(
    "select id from workspaces order by created_at",
  );
  const reports: ChainedReport[] = [];
  for (const workspace of workspaces.rows) {
    reports.push(await chainWorkspace(pool, workspace.id));
  }
  return reports;
}
