-- Why a goal stands alone, when it does (METHOD.md §5.2, P9-T16a).
--
-- METHOD v2 makes a goal with no parent legitimate when it says why: Finance's
-- month-end close supports no strategy and is not a mistake. The alignment
-- score counts a goal with a reason here as aligned, and the coach stops
-- listing it as a gap.
--
-- Free text rather than a choice from a list, because the reasons are the
-- organisation's own ("the operating cadence the board relies on"), and a
-- list would either be too short or be ignored. Null is every existing row,
-- which is what "no reason given" means.
--
-- A goal holds a parent or a reason, and `goals.update` clears one when it
-- sets the other. Not a check constraint: an importer or a relink that sets a
-- parent on a goal with a reason would then fail outright, where the score
-- already reads a parent as aligned whatever else is there.
--
-- Forward-only and safe for a rolling upgrade: the previous release names the
-- column nowhere and writes null by leaving it out. `goals` carries its tenant
-- policy from migration 0022, which a new column does not touch.
alter table goals
  add column standalone_reason text
    check (standalone_reason is null or length(btrim(standalone_reason)) > 0);
