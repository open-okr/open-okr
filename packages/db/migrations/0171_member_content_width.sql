-- A member's content width (docs/design/content-width.md, approved by the
-- product owner on 16 November 2026).
--
-- Compact caps the main content at 1152 px and centres it. Full width is the
-- screen as it was. Stored per member like `theme` and `density`, so it
-- follows the person to another machine.
--
-- Nullable, with no default and no backfill. Null reads as `compact`, the
-- default the owner chose, so nobody has to open a menu to get a readable
-- column on a wide screen.
--
-- Forward-only and safe for a rolling upgrade: the previous release ignores a
-- column it does not know.
--
-- No new policy. `workspace_members` already carries `workspace_id` and its
-- row-level security policy, and its soft delete.

alter table workspace_members
  add column width text;

-- A closed set, checked here as well as in the action, because a row written
-- by an import or a data change never passes through the action.
alter table workspace_members
  add constraint workspace_members_width_known
    check (width is null or width in ('compact', 'full'));
