-- Legacy keys on checklist items (TECHNICAL-PLAN §7.1 step 4, §7.2, P6-T04a).
--
-- The third and last importable table written before there was an importer to
-- write these columns. `spaces` and `cycles` were the other two and got theirs
-- at migration 0071; `checklist_items` is here because §7.2 maps FlowyTeam's
-- `sub_tasks` onto it and a second run of the same company would otherwise add
-- a second copy of every checklist line.
--
-- **A line of text is not a natural key.** Two sub-tasks on one task can read
-- "Call the supplier" and mean different calls, so matching on the title would
-- silently collapse them. The source's own id is the only identity that says
-- which line is which.
--
-- Additive and forward-only, safe under a rolling upgrade in both directions:
-- the previous release ignores columns it does not know about, and the new one
-- treats a null legacy key as "created in the product", which every existing
-- row is.
--
-- No new policy. The table already carries `workspace_id` and its row-level
-- security policy from its own migration.

alter table checklist_items
  add column legacy_id text,
  add column legacy_type text;

-- The same partial unique index every other importable table carries, with the
-- `deleted_at is null` clause: a line somebody removed in the product is not one
-- the next import should silently revive.
create unique index checklist_items_legacy_idx on checklist_items (
  workspace_id, legacy_type, legacy_id
)
where
  legacy_id is not null
  and deleted_at is null;
