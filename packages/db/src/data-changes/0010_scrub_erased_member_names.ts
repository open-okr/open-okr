/**
 * Takes erased members' names out of the feed (completeness review M-18).
 *
 * `people.erase` wrote the name from before erasure into the `member.erased`
 * activity, "because the row no longer carries it", which put the one thing
 * erasure removes into a new row every member can read. Earlier feed entries
 * about the member kept it too. Erasure now writes neither; this repairs the
 * rows written before it stopped.
 *
 * Two passes over `activities`, one statement each and both idempotent:
 *
 * | Rows | Change |
 * |---|---|
 * | `member.erased` carrying a `name` | The key is removed |
 * | Any other entry about a member erasure has anonymised, carrying a real `name` | The name becomes "Erased member", the word the member row itself holds |
 *
 * An erased member is recognised by what erasure leaves: the name "Erased
 * member", no user, and suspended. The sign-in accounts of people erased
 * before this change are not touched: erasure had already cut the link from
 * the member to the account, so nothing here can say whose account it was.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

export const scrubErasedMemberNames: DataChangeScript = {
  name: "0010_scrub_erased_member_names",
  summary:
    "Removes erased members' names from the member.erased activity and from earlier feed entries about them.",
  expects: [
    { table: "activities", column: "kind", dataType: "text" },
    { table: "activities", column: "payload", dataType: "jsonb" },
    { table: "activities", column: "subject_type", dataType: "text" },
    { table: "activities", column: "subject_id", dataType: "uuid" },
    { table: "workspace_members", column: "name", dataType: "text" },
    { table: "workspace_members", column: "user_id", dataType: "text" },
    { table: "workspace_members", column: "status", dataType: "text" },
  ],
  async runBatch(client: DataChangeClient): Promise<DataChangeBatchResult> {
    const erased = await client.query<{ n: number }>(
      `with changed as (
         update activities
            set payload = payload - 'name'
          where kind = 'member.erased' and payload ? 'name'
          returning 1
       )
       select count(*)::int as n from changed`,
    );
    const earlier = await client.query<{ n: number }>(
      `with changed as (
         update activities a
            set payload = jsonb_set(a.payload, '{name}', '"Erased member"'::jsonb)
           from workspace_members m
          where a.subject_type = 'workspace_member'
            and a.subject_id = m.id
            and a.workspace_id = m.workspace_id
            and m.name = 'Erased member'
            and m.user_id is null
            and m.status = 'suspended'
            and a.payload ? 'name'
            and a.payload->>'name' <> 'Erased member'
          returning 1
       )
       select count(*)::int as n from changed`,
    );
    return {
      done: true,
      rowsChanged: (erased.rows[0]?.n ?? 0) + (earlier.rows[0]?.n ?? 0),
    };
  },
};
