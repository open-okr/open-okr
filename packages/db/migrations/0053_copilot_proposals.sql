-- Copilot proposals (AI-NATIVE-PLAN.md §2.4, screen S-39, P4-T14b-a).
--
-- A proposal the copilot makes in one member's conversation, reviewed and
-- applied by that member. Everything it needs is on `proposed_changes` already
-- except where it came from and what applying it did.

-- **`run_id` becomes optional, and that is the honest shape.** Every proposal
-- until now came from an agent run, so the column was mandatory. A copilot
-- proposal came from a member asking a question, and inventing an agent run to
-- hang it off would put a run in the run log that nobody scheduled and nothing
-- executed. So a proposal names its origin: a run, or a thread, exactly one.
alter table proposed_changes alter column run_id drop not null;

alter table proposed_changes
  add column thread_id uuid references ai_threads (id) on delete cascade;

alter table proposed_changes
  add constraint proposed_changes_origin
  check ((run_id is null) <> (thread_id is null));

-- What applying it actually produced, as the action's own return value. Undo
-- needs it: reversing a creation means naming the thing that was created, and
-- the only place that identifier exists is the applied action's result.
alter table proposed_changes add column result jsonb;

-- Set when the member reversed an applied proposal. Not a status: it was
-- applied, and then it was undone, and both are true.
alter table proposed_changes add column undone_at timestamptz;

-- No `deleted_at` predicate: migration 0018 records why `proposed_changes` has
-- no soft-delete column at all. A decision, once made, is not un-made by hiding
-- the row that records it.
create index proposed_changes_thread_idx
  on proposed_changes (workspace_id, thread_id)
  where thread_id is not null;
