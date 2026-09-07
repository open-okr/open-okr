/**
 * Gives every workspace provisioned before P4-T05a the OKR Champion that
 * provisioning now creates (AI-NATIVE-PLAN.md §6.2).
 *
 * Without this, a workspace created before 2026-08-19 has no rhythm agent and
 * never will: seeding runs at provisioning and nowhere else. The screen at
 * `/admin/agents` would tell those workspaces they have no agents, which is
 * true and useless.
 *
 * **Faithful to what provisioning does, and no more.** One member of kind
 * `agent`, one `agents` row with the same persona and instructions, its own
 * member group, and a `view` binding on every space that already exists. No
 * binding on the workspace context, because that is the grant the whole
 * least-privilege shape exists to refuse, and a backfill is not the place to
 * make an exception.
 *
 * **The persona text is duplicated from `packages/core/src/agents/champion.ts`
 * rather than imported.** `packages/db` cannot depend on `packages/core`: the
 * dependency runs the other way. A script that imported it would also break the
 * rule that a data change runs against the schema of its own moment rather than
 * against whatever the application later becomes. If the persona is ever
 * edited, this text stays as it was, which is correct: it is what those
 * workspaces would have been given on the day they were made.
 *
 * Batched by a keyset on `workspaces.id`, the same shape as 0001 to 0005.
 * Idempotent by predicate: a workspace with a Champion is not selected.
 */

import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";
import { newId } from "../id.ts";

const BATCH_SIZE = 200;
const VIEW_LEVEL = 10;

const CHAMPION_NAME = "OKR Champion";

const CHAMPION_PERSONA =
  "Guards the rhythm. Chases check-ins, acknowledgements and blockers, opens " +
  "and closes the weekly session, and watches the KPI corridors. Direct and " +
  "brief. Never re-opens a discussion: it moves the clock.";

const CHAMPION_PLANNING_INSTRUCTIONS =
  "List what is due now, per member and per channel, from the nudge engine. " +
  "Never invent a reason to speak: every message you plan must carry a rule " +
  "key the method package defines.";

const CHAMPION_EXECUTION_INSTRUCTIONS =
  "Deliver what is due and record why. Escalate only by the ladder, and never " +
  "past somebody without them seeing it. Propose, never write, anything that " +
  "changes a goal, a check-in or a KPI.";

interface Candidate {
  workspace_id: string;
  /** `DataChangeClient.query` rows are open records. */
  [column: string]: unknown;
}

export const seedChampionAgent: DataChangeScript = {
  name: "0006_seed_champion_agent",
  summary:
    "Creates the OKR Champion, its member row and a view binding on every existing space, for every workspace that has none.",
  expects: [
    { table: "workspaces", column: "id", dataType: "uuid" },
    { table: "workspace_members", column: "workspace_id", dataType: "uuid" },
    { table: "workspace_members", column: "name", dataType: "text" },
    { table: "workspace_members", column: "kind", dataType: "text" },
    { table: "workspace_members", column: "status", dataType: "text" },
    { table: "agents", column: "workspace_id", dataType: "uuid" },
    { table: "agents", column: "member_id", dataType: "uuid" },
    { table: "agents", column: "name", dataType: "text" },
    { table: "agents", column: "kind", dataType: "text" },
    { table: "agents", column: "persona", dataType: "text" },
    { table: "agents", column: "planning_instructions", dataType: "text" },
    { table: "agents", column: "execution_instructions", dataType: "text" },
    { table: "agents", column: "schedule", dataType: "text" },
    { table: "agents", column: "autonomy", dataType: "text" },
    { table: "agents", column: "enabled", dataType: "boolean" },
    { table: "access_groups", column: "kind", dataType: "text" },
    { table: "access_groups", column: "member_id", dataType: "uuid" },
    { table: "access_contexts", column: "resource_type", dataType: "text" },
    { table: "access_contexts", column: "resource_id", dataType: "uuid" },
    { table: "access_bindings", column: "context_id", dataType: "uuid" },
    { table: "access_bindings", column: "level", dataType: "integer" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<Candidate>(
      `select w.id as workspace_id
         from workspaces w
        where w.deleted_at is null
          and ($1::uuid is null or w.id > $1::uuid)
          and not exists (
            select 1 from agents a
             where a.workspace_id = w.id
               and a.kind = 'champion'
               and a.deleted_at is null
          )
        order by w.id
        limit $2`,
      [cursor, BATCH_SIZE],
    );

    let seeded = 0;

    for (const candidate of rows) {
      const memberId = newId();
      await client.query(
        `insert into workspace_members (id, workspace_id, name, kind, status)
         values ($1, $2, $3, 'agent', 'active')`,
        [memberId, candidate.workspace_id, CHAMPION_NAME],
      );

      await client.query(
        `insert into agents
           (id, workspace_id, member_id, name, kind, persona,
            planning_instructions, execution_instructions, schedule, autonomy, enabled)
         values ($1, $2, $3, $4, 'champion', $5, $6, $7, 'hourly', 'propose', true)`,
        [
          newId(),
          candidate.workspace_id,
          memberId,
          CHAMPION_NAME,
          CHAMPION_PERSONA,
          CHAMPION_PLANNING_INSTRUCTIONS,
          CHAMPION_EXECUTION_INSTRUCTIONS,
        ],
      );

      const memberGroupId = newId();
      await client.query(
        `insert into access_groups (id, workspace_id, kind, member_id)
         values ($1, $2, 'member', $3)`,
        [memberGroupId, candidate.workspace_id, memberId],
      );

      // One binding per space that already exists. A space created after this
      // runs gets its binding from `createSpaceInTx`, which is where the
      // product does it; this closes the gap behind, not in front.
      const { rows: contexts } = await client.query<{ id: string }>(
        `select id from access_contexts
          where workspace_id = $1
            and resource_type = 'space'
            and deleted_at is null`,
        [candidate.workspace_id],
      );
      for (const context of contexts) {
        await client.query(
          `insert into access_bindings (id, workspace_id, group_id, context_id, level)
           values ($1, $2, $3, $4, $5)`,
          [
            newId(),
            candidate.workspace_id,
            memberGroupId,
            context.id,
            VIEW_LEVEL,
          ],
        );
      }

      seeded += 1;
    }

    const last = rows.at(-1);

    return {
      done: rows.length < BATCH_SIZE,
      cursor: last?.workspace_id ?? undefined,
      rowsChanged: seeded,
    };
  },
};
