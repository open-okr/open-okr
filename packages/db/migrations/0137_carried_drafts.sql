-- A kept or modified objective pre-fills the next cycle (METHOD.md §8.9,
-- P9-T20e-b).
--
-- v2's §8.9: "Every kept or modified objective | Phase 4, a pre-filled draft
-- whose key results start from their last recorded values as baselines." The
-- draft is an ordinary objective in the next cycle. This column remembers the
-- objective it was carried from, which is how the closed cycle says what it
-- handed on and how a second feed-forward knows to write nothing.
--
-- **Unique whether or not the draft has been deleted since.** Deleting a
-- carried draft is a decision about the next cycle, made after the room's,
-- and a re-run that put it back would overrule it.
--
-- Forward-only and safe for a rolling upgrade: one nullable column the
-- previous release never reads. `goals` already has its row-level security
-- policy, which covers a new column as it covers the rest of the row.
alter table goals
  add column carried_from_goal_id uuid references goals (id) on delete set null;

create unique index goals_carried_once
  on goals (workspace_id, cycle_id, carried_from_goal_id)
  where carried_from_goal_id is not null;
