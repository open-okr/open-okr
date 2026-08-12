/**
 * Gives every workspace provisioned before P3-T02 its rhythm settings row and
 * the cycle containing today.
 *
 * Both are things provisioning now writes, and both are things §4.14's hard rule
 * demands exist: "Registering provisions a complete, correct workspace... every
 * card in admin is a later refinement." A workspace with no rhythm settings still
 * resolves the canon (`resolveRhythm` falls back), so that half is tidiness. The
 * cycle is not: a planning tool with no time box to plan in cannot be used, and
 * every Phase 3 surface after this reads the current cycle.
 *
 * **The period arithmetic is repeated in SQL here**, rather than imported from
 * `packages/core/src/cycles/generation.ts`, because `packages/db` sits below
 * `packages/core` and must not depend on it. Restricted to the quarterly cadence
 * on purpose: a workspace with no cycles has no cadence to inherit, so the
 * fallback is the only answer this script can give, and the naming it duplicates
 * is one `Q<n> <year>` expression rather than the whole generator.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";
import { newId } from "../id.ts";

const BATCH_SIZE = 200;

interface Candidate {
  workspace_id: string;
  needs_rhythm: boolean;
  needs_cycle: boolean;
  cycle_name: string;
  starts_on: string;
  ends_on: string;
  [column: string]: unknown;
}

export const backfillRhythmAndCycle: DataChangeScript = {
  name: "0004_backfill_rhythm_and_cycle",
  summary:
    "Creates the rhythm settings row and the current quarterly cycle for every workspace that has none.",
  expects: [
    { table: "workspaces", column: "id", dataType: "uuid" },
    { table: "workspaces", column: "settings", dataType: "jsonb" },
    { table: "rhythm_settings", column: "workspace_id", dataType: "uuid" },
    { table: "cycles", column: "workspace_id", dataType: "uuid" },
    { table: "cycles", column: "name", dataType: "text" },
    { table: "cycles", column: "mode", dataType: "text" },
    { table: "cycles", column: "cadence", dataType: "text" },
    { table: "cycles", column: "starts_on", dataType: "date" },
    { table: "cycles", column: "ends_on", dataType: "date" },
    { table: "cycles", column: "status", dataType: "text" },
    { table: "cycles", column: "phase", dataType: "smallint" },
  ],
  async runBatch(
    client: DataChangeClient,
    cursor: string | null,
  ): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<Candidate>(
      `with candidates as (
         select
           w.id as workspace_id,
           -- The workspace timezone, which every cycle bound is read in. An
           -- unset or unknown zone falls back the same way the settings
           -- registry does, rather than failing the backfill.
           coalesce(nullif(w.settings->>'timezone', ''), 'UTC') as tz
           from workspaces w
          where w.deleted_at is null
            and ($1::uuid is null or w.id > $1::uuid)
            and (
              not exists (
                select 1 from rhythm_settings r where r.workspace_id = w.id
              )
              or not exists (
                select 1 from cycles c
                 where c.workspace_id = w.id and c.deleted_at is null
              )
            )
          order by w.id
          limit $2
       )
       select
         c.workspace_id,
         not exists (
           select 1 from rhythm_settings r where r.workspace_id = c.workspace_id
         ) as needs_rhythm,
         not exists (
           select 1 from cycles cy
            where cy.workspace_id = c.workspace_id and cy.deleted_at is null
         ) as needs_cycle,
         'Q' || to_char(date_trunc('quarter', now() at time zone c.tz), 'Q')
              || ' ' || to_char(date_trunc('quarter', now() at time zone c.tz), 'YYYY')
           as cycle_name,
         (date_trunc('quarter', now() at time zone c.tz))::date as starts_on,
         (date_trunc('quarter', now() at time zone c.tz)
           + interval '3 months' - interval '1 day')::date as ends_on
       from candidates c
       order by c.workspace_id`,
      [cursor, BATCH_SIZE],
    );

    let changed = 0;

    for (const candidate of rows) {
      if (candidate.needs_rhythm) {
        // Every column defaults to the METHOD.md §11 canon, so the row is the
        // canon and the insert names no values.
        await client.query(
          "insert into rhythm_settings (workspace_id) values ($1)",
          [candidate.workspace_id],
        );
        changed += 1;
      }

      if (candidate.needs_cycle) {
        await client.query(
          `insert into cycles
             (id, workspace_id, name, mode, cadence, starts_on, ends_on, status, phase)
           values ($1, $2, $3, 'quarterly', 'quarterly', $4, $5, 'planning', 1)`,
          [
            newId(),
            candidate.workspace_id,
            candidate.cycle_name,
            candidate.starts_on,
            candidate.ends_on,
          ],
        );
        changed += 1;
      }
    }

    const last = rows.at(-1);

    return {
      done: rows.length < BATCH_SIZE,
      cursor: last?.workspace_id ?? undefined,
      rowsChanged: changed,
    };
  },
};
