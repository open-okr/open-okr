/**
 * Puts blockers on the check-in's clock (P9-T19a-a).
 *
 * METHOD.md §7.3 gave a blocker twenty-four hours to its next action until
 * METHOD v2 made it the next check-in of the goal it blocks. Two §11 keys
 * left the registry with it, and the ladder a workspace could store for
 * blockers changed shape from three hour counts to one day count.
 *
 * | Stored | This script |
 * |---|---|
 * | `cadence.blockerClockHours` in a workspace's overrides | Removed. The check-in is the clock, and it has no number to carry |
 * | `cadence.blockerLadderHours` in a workspace's overrides | Removed. Its hours have no meaning against a check-in; the canon's one-day reminder applies until the workspace sets another |
 * | A `blocker.escalated` ladder in hours, in `nudge_rules` | Cleared, for the same reason. Reads already fall back to the canon on a shape they do not recognise |
 * | An open blocker due before its goal's next check-in | Due by that check-in instead, where the check-in falls after the blocker was a day old |
 * | A resolved blocker, or one on no goal | Left alone |
 *
 * **The last row moves deadlines later, never earlier.** A blocker opened
 * yesterday on the old clock would otherwise be escalated to its coordinator
 * tomorrow, days before the team's check-in. The comparison is with the stored
 * deadline, which on the old clock was the opening plus the workspace's hours:
 * a goal whose next check-in is later than that is one whose check-in falls
 * after the day the blocker was opened, which is the rule a new blocker gets.
 * Runs once, by the runner's ledger: a second run after the goal had checked
 * in would move the blocker on to the next one.
 */
import type {
  DataChangeBatchResult,
  DataChangeClient,
  DataChangeScript,
} from "../data-change.ts";

export const blockerClockToCheckIn: DataChangeScript = {
  name: "0023_blocker_clock_to_check_in",
  summary:
    "Removes the hour-based blocker clock and ladder, and moves each open blocker's deadline to its goal's next check-in.",
  expects: [
    { table: "rhythm_settings", column: "overrides", dataType: "jsonb" },
    { table: "nudge_rules", column: "rule_key", dataType: "text" },
    { table: "nudge_rules", column: "escalation_ladder", dataType: "jsonb" },
    {
      table: "blockers",
      column: "due_at",
      dataType: "timestamp with time zone",
    },
    { table: "blockers", column: "goal_id", dataType: "uuid" },
    {
      table: "blockers",
      column: "resolved_at",
      dataType: "timestamp with time zone",
    },
    {
      table: "goals",
      column: "next_check_in_at",
      dataType: "timestamp with time zone",
    },
  ],
  async runBatch(client: DataChangeClient): Promise<DataChangeBatchResult> {
    const { rows } = await client.query<{ n: number }>(
      `with settings as (
         update rhythm_settings
            set overrides = overrides
                          - 'cadence.blockerClockHours'
                          - 'cadence.blockerLadderHours'
          where overrides ?| array['cadence.blockerClockHours',
                                   'cadence.blockerLadderHours']
          returning 1
       ),
       ladders as (
         update nudge_rules
            set escalation_ladder = null
          where rule_key = 'blocker.escalated'
            and escalation_ladder is not null
            and not (escalation_ladder ? 'reminder')
          returning 1
       ),
       clocks as (
         update blockers b
            set due_at = g.next_check_in_at,
                updated_at = now()
           from goals g
          where g.id = b.goal_id
            and g.workspace_id = b.workspace_id
            and b.resolved_at is null
            and b.deleted_at is null
            and g.next_check_in_at is not null
            and g.next_check_in_at > b.due_at
          returning 1
       )
       select (select count(*) from settings)::int
            + (select count(*) from ladders)::int
            + (select count(*) from clocks)::int as n`,
    );
    return { done: true, rowsChanged: rows[0]?.n ?? 0 };
  },
};
