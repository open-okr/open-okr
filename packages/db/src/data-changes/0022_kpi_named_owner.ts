/**
 * Names the owner of every KPI that already belongs to a member (P9-T17b-b).
 *
 * METHOD.md §6.2 gives a KPI one named person who owns it, and migration 0126
 * added the column. A KPI on a member's own list has always had that person on
 * the row, as `member_id`; this copies it across. A KPI owned by the workspace
 * or a space is left unnamed, because nothing says which person it is, and
 * the product does not invent one. One statement, idempotent by predicate.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

export const kpiNamedOwner: DataChangeScript = {
  name: "0022_kpi_named_owner",
  summary:
    "Names the member as the owner of each KPI that already belongs to a member.",
  expects: [
    { table: "kpis", column: "owner_kind", dataType: "text" },
    { table: "kpis", column: "member_id", dataType: "uuid" },
    { table: "kpis", column: "owner_member_id", dataType: "uuid" },
  ],
  async runBatch(client: DataChangeClient): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ n: number }>(
      `with changed as (
         update kpis
            set owner_member_id = member_id
          where owner_kind = 'member'
            and member_id is not null
            and owner_member_id is null
          returning 1
       )
       select count(*)::int as n from changed`,
    );
    return { done: true, rowsChanged: rows[0]?.n ?? 0 };
  },
};
