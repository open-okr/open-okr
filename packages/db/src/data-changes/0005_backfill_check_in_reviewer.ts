/**
 * Gives every check-in published before P3-T08 its reviewer of record.
 *
 * The column arrives nullable in migration 0024 because a schema migration must
 * not carry a data change, so between the two there is a window where a
 * published check-in has no reviewer on it and the review inbox would show
 * nobody an obligation they really owe. This closes it.
 *
 * Two sources, in this order, and the order is the whole point:
 *
 *   An acknowledged check-in takes `acknowledged_by_id`, the member who actually
 *   closed the loop. That is a recorded fact about the past, and it stays true
 *   however many times the goal's reviewer changes afterwards.
 *
 *   An open one takes the goal's current `reviewer_id`, because whoever reviews
 *   the goal today is exactly who owes the open acknowledgement. This is the
 *   same answer reassignment step 4 would have produced had the column existed
 *   at the time.
 *
 * Drafts are left null on purpose: a draft has no reviewer of record, since
 * publication is what creates the obligation.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

const BATCH_SIZE = 500;

interface Candidate {
  id: string;
  [column: string]: unknown;
}

export const backfillCheckInReviewer: DataChangeScript = {
  name: "0005_backfill_check_in_reviewer",
  summary:
    "Stamps the reviewer of record on every check-in published before the column existed.",
  expects: [
    { table: "check_ins", column: "id", dataType: "uuid" },
    { table: "check_ins", column: "state", dataType: "text" },
    { table: "check_ins", column: "subject_id", dataType: "uuid" },
    { table: "check_ins", column: "reviewer_member_id", dataType: "uuid" },
    { table: "check_ins", column: "acknowledged_by_id", dataType: "uuid" },
    { table: "goals", column: "id", dataType: "uuid" },
    { table: "goals", column: "reviewer_id", dataType: "uuid" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<Candidate>(
      `select c.id
         from check_ins c
         join goals g on g.id = c.subject_id
        where c.state = 'published'
          and c.reviewer_member_id is null
          and c.deleted_at is null
          and ($1::uuid is null or c.id > $1::uuid)
        order by c.id
        limit $2`,
      [cursor, BATCH_SIZE],
    );

    if (rows.length === 0) {
      return { rowsChanged: 0, done: true };
    }

    const ids = rows.map((row) => row.id);
    // `returning id` rather than a driver row count, because the client contract
    // this runner defines exposes rows and nothing else.
    const updated = await client.query<{ id: string }>(
      `update check_ins c
          set reviewer_member_id = coalesce(c.acknowledged_by_id, g.reviewer_id),
              updated_at = now()
         from goals g
        where g.id = c.subject_id
          and c.id = any($1::uuid[])
      returning c.id`,
      [ids],
    );

    return {
      cursor: ids[ids.length - 1],
      rowsChanged: updated.rows.length,
      done: rows.length < BATCH_SIZE,
    };
  },
};
