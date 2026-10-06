-- The week's wins, and a line on why a commitment was or was not delivered
-- (METHOD.md §7.2 step 3, P9-T19a-d-c).
--
-- METHOD v2's step 3 is "Commitments and wins": close last week's commitments,
-- delivered or not, "with a line on why where it helps"; set three or four for
-- this week; and name the week's wins, which the digest then carries.
--
-- `okr_sessions.wins` holds the wins a weekly session named, in order: a list
-- of short lines owned by the session, read and written whole, like `elapsed`
-- and `added_minutes` beside it. `commitments.closing_note` is the optional
-- line written when a commitment is closed.
--
-- Forward-only and safe for a rolling upgrade: a column with a default and a
-- nullable one, which the previous release names nowhere. Both tables keep
-- their tenant policies from migrations 0036 and 0041, which this does not
-- touch.
alter table okr_sessions
  add column wins jsonb not null default '[]'::jsonb;

alter table commitments
  add column closing_note text;
