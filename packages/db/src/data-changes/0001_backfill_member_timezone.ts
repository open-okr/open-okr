/**
 * A worked example for the data-change runner's own conventions doc
 * (`docs/design/data-change-conventions.md`), not a production need this
 * repository currently has: every member the Operation pipeline provisions
 * already gets a timezone from the workspace's own at insert time
 * (`packages/core/src/workspaces/provisioning.ts`), so `timezone is null` is
 * empty on every workspace built through the app. It earns its place as a
 * real backfill candidate anyway, because the importer (P6-T01/P6-T02) can
 * land members without one, and that is exactly the "reshape rows the
 * schema migration that added the column never touched" case this runner
 * exists for.
 *
 * Batched by a keyset on `id` (this schema's ids are time-ordered per
 * `packages/db/src/id.ts`, so ascending `id` order is stable and cheap to
 * resume from). A member whose own workspace has no timezone in its
 * settings either is left null on purpose: there is nothing to backfill it
 * from, and inventing one here would be a product decision, not a data
 * repair.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

const BATCH_SIZE = 500;

export const backfillMemberTimezone: DataChangeScript = {
  name: "0001_backfill_member_timezone",
  summary:
    "Sets workspace_members.timezone from the workspace's own settings, for any member row that has none.",
  expects: [
    { table: "workspace_members", column: "id", dataType: "uuid" },
    { table: "workspace_members", column: "workspace_id", dataType: "uuid" },
    { table: "workspace_members", column: "timezone", dataType: "text" },
    { table: "workspaces", column: "settings", dataType: "jsonb" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{
      batch_size: number;
      last_id: string | null;
      updated_count: number;
    }>(
      `with batch as (
         select id from workspace_members
          where timezone is null
            and ($1::uuid is null or id > $1::uuid)
          order by id
          limit $2
       ),
       updated as (
         update workspace_members m
            set timezone = w.settings->>'timezone'
           from workspaces w
          where m.id in (select id from batch)
            and m.workspace_id = w.id
            and w.settings->>'timezone' is not null
          returning m.id
       )
       select
         (select count(*) from batch)::int as batch_size,
         -- Not max(id): Postgres's max() aggregate has no uuid overload.
         -- batch is already ordered by id ascending, so its last row is the
         -- same answer.
         (select id from batch order by id desc limit 1) as last_id,
         (select count(*) from updated)::int as updated_count`,
      [cursor, BATCH_SIZE],
    );
    const row = rows[0];
    const batchSize = row?.batch_size ?? 0;

    return {
      done: batchSize < BATCH_SIZE,
      cursor: row?.last_id ?? undefined,
      rowsChanged: row?.updated_count ?? 0,
    };
  },
};
