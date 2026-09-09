-- An annual objective names the strategy it serves (METHOD.md §2.1, P6-G14b).
--
-- **§2.1's frame is two to five strategies, and nothing pointed at one.**
-- `annual_strategies` has held them since migration 0020, and a goal could name
-- a parent goal, a parent key result, a cycle, a space and a member, but never
-- the strategy it exists to advance. So phase 0 could list the year's
-- objectives and could not say which of the year's strategies each one moved,
-- which is the question the phase is for.
--
-- Nullable, and it stays nullable. A quarterly objective serves its parent
-- objective and not a strategy directly, which is §2.1's own shape: the
-- strategy is the annual layer. Requiring it would be requiring every team
-- goal to reach past its own parent.
--
-- `on delete set null` rather than cascade. Replacing a frame supersedes its
-- strategies, and an objective that pointed at a superseded one is still a real
-- objective with real key results. Losing it because the strategy list was
-- rewritten in March is the opposite of what the supersede rule protects.
--
-- Forward-only in both directions. The previous release ignores a column it
-- does not know, and every read here treats a null as "not linked yet" rather
-- than as an error, so a rolling upgrade sees objectives with no strategy named
-- and says so. Nothing is backfilled: no earlier release could have set it.
--
-- No new policy. `goals` already carries `workspace_id` and its row-level
-- security policy from migration 0003.

alter table goals
  add column strategy_id uuid references annual_strategies (id) on delete set null;

-- The read phase 0 makes: this workspace's objectives grouped by the strategy
-- each serves. Partial, because the column is null for every quarterly goal and
-- an index over those is an index over almost the whole table.
create index goals_strategy_idx
  on goals (workspace_id, strategy_id)
  where deleted_at is null and strategy_id is not null;
