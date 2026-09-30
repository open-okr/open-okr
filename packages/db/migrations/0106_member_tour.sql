-- When a member finished the first-visit tour (UIUX-PLAN S-34, completeness
-- review L-08).
--
-- **S-34 asks for "a five-stop tour" per user on first visit, and nothing
-- remembered who had seen it.** A tour that is offered again on every visit is
-- a banner nobody can close, so the answer has to outlive the browser and
-- follow the person to a second machine, which is the same reason the theme
-- and the density moved onto this row at P6-G23.
--
-- **Null means the tour is still offered.** A member who joined before this
-- column existed has never been shown it either, so they meet it once on their
-- next visit to the Work Map. Filling it for them here would be a backfill in a
-- schema change, which the data-change runner exists to keep apart, and it
-- would decide for every existing member that the tour is not for them.
--
-- Additive and nullable, so the previous release reads the table unchanged and
-- a rolling upgrade has nothing to reconcile. `workspace_members` carries its
-- tenant policy from migration 0005, and a new column inherits it.
alter table workspace_members
  add column tour_finished_at timestamptz;
