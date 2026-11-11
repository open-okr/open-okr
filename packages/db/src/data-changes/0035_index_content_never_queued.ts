/**
 * Queues the check-ins, key results, blockers and objectives that never reached
 * the copilot's index or the search index (0.8.1).
 *
 * Every write queues what its activity names, and the writes that create or
 * change a check-in, a key result or a blocker named the goal or the space
 * instead, so none of them was ever queued. The carry of kept objectives and a
 * KPI's recovery named the cycle and the KPI, so the objectives and key results
 * they created were not queued either. 0.8.1 names the right thing; this queues
 * what was written before it.
 *
 * **Queues, does not index.** Each row is an ordinary `content.embed` or
 * `content.index` job, which the relay drains the way it drains every write's,
 * so the text is read and indexed by the same workers under the same rules: a
 * draft or a deleted row is skipped there as well as here. An instance whose
 * provider can embed pays for those embeddings when the relay runs them.
 *
 * **Only what the index lacks.** A row the index already holds, which every
 * objective `goals.create` wrote does, is left alone. The key carries this
 * script's number, so a batch never queues a row an earlier batch queued, and a
 * second run queues nothing.
 *
 * **One workspace at a time, inside its own tenant setting**, as 0034 does: the
 * admin connection may be the table owner, FORCE ROW LEVEL SECURITY binds the
 * owner too, and both indexes are tenant scoped. The outbox row takes the
 * workspace from the same setting, which the relay reads to order fairly.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

/** What is queued, from where, for which index. */
const QUEUES = [
  { table: "goals", type: "goal", only: "true" },
  { table: "key_results", type: "key_result", only: "true" },
  // A draft is its author's alone, and neither worker reads one.
  { table: "check_ins", type: "check_in", only: "t.state = 'published'" },
  { table: "blockers", type: "blocker", only: "true" },
].flatMap((source) => [
  { ...source, topic: "content.embed", index: "embeddings" },
  // Search holds no blocker: its subject list has none.
  ...(source.type === "blocker"
    ? []
    : [{ ...source, topic: "content.index", index: "search_documents" }]),
]);

/** The most jobs one batch queues, across every source. */
const BATCH = 1_000;

const KEY_SUFFIX = ":0035";

/** Queues up to `limit` rows of one source the index lacks; answers how many. */
async function queue(
  client: DataChangeClient,
  workspaceId: string,
  source: (typeof QUEUES)[number],
  limit: number,
): Promise<number> {
  const key = `$2 || ':' || $3 || ':' || t.id || '${KEY_SUFFIX}'`;
  const { rows } = await client.query<{ id: string }>(
    `insert into outbox (topic, payload, idempotency_key)
     select $2,
            jsonb_build_object('workspaceId', t.workspace_id,
                               'entityType', $3::text,
                               'entityId', t.id),
            ${key}
       from ${source.table} t
      where t.workspace_id = $1
        and t.deleted_at is null
        and ${source.only}
        and not exists (
          select 1 from ${source.index} i
           where i.workspace_id = t.workspace_id
             and i.entity_type = $3
             and i.entity_id = t.id
        )
        and not exists (
          select 1 from outbox o where o.idempotency_key = ${key}
        )
      order by t.id
      limit $4
     on conflict (idempotency_key) do nothing
     returning id`,
    [workspaceId, source.topic, source.type, limit],
  );
  return rows.length;
}

export const indexContentNeverQueued: DataChangeScript = {
  name: "0035_index_content_never_queued",
  summary:
    "Queues for indexing every check-in, key result, blocker and objective that neither the copilot's index nor search holds.",
  expects: [
    ...["goals", "key_results", "check_ins", "blockers"].flatMap((table) => [
      { table, column: "id", dataType: "uuid" },
      { table, column: "workspace_id", dataType: "uuid" },
      { table, column: "deleted_at", dataType: "timestamp with time zone" },
    ]),
    { table: "check_ins", column: "state", dataType: "text" },
    ...["embeddings", "search_documents"].flatMap((table) => [
      { table, column: "workspace_id", dataType: "uuid" },
      { table, column: "entity_type", dataType: "text" },
      { table, column: "entity_id", dataType: "uuid" },
    ]),
    { table: "outbox", column: "topic", dataType: "text" },
    { table: "outbox", column: "payload", dataType: "jsonb" },
    { table: "outbox", column: "idempotency_key", dataType: "text" },
    { table: "outbox", column: "workspace_id", dataType: "uuid" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    // The scheduler's read-only scan lists tenants without a role that
    // bypasses the floor (migration 0099). Local to this batch.
    await client.query("select set_config('app.system_scan', 'on', true)");
    const { rows: next } = await client.query<{ id: string }>(
      `select id from workspaces
        where ($1::uuid is null or id > $1::uuid)
        order by id limit 2`,
      [cursor],
    );
    await client.query("select set_config('app.system_scan', '', true)");

    const workspace = next[0];
    if (!workspace) {
      return { done: true, rowsChanged: 0 };
    }

    await client.query("select set_config('app.workspace_id', $1, true)", [
      workspace.id,
    ]);
    let queued = 0;
    for (const source of QUEUES) {
      if (queued >= BATCH) {
        break;
      }
      queued += await queue(client, workspace.id, source, BATCH - queued);
    }
    await client.query("select set_config('app.workspace_id', '', true)");

    // A full batch may have left more here: visit this workspace again. The
    // cursor stays on the workspace before this one.
    if (queued >= BATCH) {
      return {
        done: false,
        ...(cursor === null ? {} : { cursor }),
        rowsChanged: queued,
      };
    }
    return {
      done: next.length < 2,
      cursor: workspace.id,
      rowsChanged: queued,
    };
  },
};
