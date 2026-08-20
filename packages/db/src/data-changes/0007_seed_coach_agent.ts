/**
 * Gives every workspace provisioned before P4-T06a the OKR Coach that
 * provisioning now creates (AI-NATIVE-PLAN.md §6.1).
 *
 * The same gap 0006 closed for the Champion, one task later and for the other
 * agent: seeding runs at provisioning and nowhere else, so a workspace made
 * before this has no quality agent and never would.
 *
 * Separate from 0006 rather than folded into it. A data change that has already
 * run is never edited, and a workspace whose 0006 is in the ledger would never
 * see an added Coach.
 *
 * **Faithful to what provisioning does, and no more.** One member of kind
 * `agent`, one `agents` row with the same persona and instructions, its own
 * member group, and a `view` binding on every space that already exists. No
 * binding on the workspace context, because that is the grant the whole
 * least-privilege shape exists to refuse, and a backfill is not the place to
 * make an exception.
 *
 * **The persona text is duplicated from `packages/core/src/agents/coach.ts`
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

const COACH_NAME = "OKR Coach";

const COACH_PERSONA =
  "Guards quality. Reads every objective and key result against the method " +
  "catalogue and says which rule is not met and why. Never rewrites without " +
  "being asked, never softens a rule to be liked, and never says a goal is " +
  "bad: it names the rule and asks the question that exposes the gap.";

const COACH_PLANNING_INSTRUCTIONS =
  "List the checks that are failing, per goal, from the stored verdicts and " +
  "the alignment findings. Never invent a reason to speak: every message you " +
  "plan must carry a rule key the method package defines.";

const COACH_EXECUTION_INSTRUCTIONS =
  "Name the rule, say what was seen, and ask the question that exposes the " +
  "gap. Propose, never write, anything that changes a goal or a key result. " +
  "A dismissed finding stays dismissed.";

interface Candidate {
  workspace_id: string;
  /** `DataChangeClient.query` rows are open records. */
  [column: string]: unknown;
}

export const seedCoachAgent: DataChangeScript = {
  name: "0007_seed_coach_agent",
  summary:
    "Creates the OKR Coach, its member row and a view binding on every existing space, for every workspace that has none.",
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
               and a.kind = 'coach'
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
        [memberId, candidate.workspace_id, COACH_NAME],
      );

      await client.query(
        `insert into agents
           (id, workspace_id, member_id, name, kind, persona,
            planning_instructions, execution_instructions, schedule, autonomy, enabled)
         values ($1, $2, $3, $4, 'coach', $5, $6, $7, 'continuous', 'propose', true)`,
        [
          newId(),
          candidate.workspace_id,
          memberId,
          COACH_NAME,
          COACH_PERSONA,
          COACH_PLANNING_INSTRUCTIONS,
          COACH_EXECUTION_INSTRUCTIONS,
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
