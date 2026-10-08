-- When an objective or a key result was started mid-cycle (METHOD.md §2.9,
-- P9-T13-a).
--
-- **Start is one of the four moves**, and the method asks for it to be
-- visible in lists and at the close. An OKR created once the team publication
-- window has closed, into a cycle whose set is already published, is an
-- addition rather than the plan, and this is the moment it was added. Null is
-- the plan, which every existing row is: a mark set on history after the fact
-- would claim a date nobody recorded.
--
-- A marked OKR faces only the checks set to block, never the set-level
-- publish gates (§4.5), which is why the gates read this column.
--
-- Forward-only and safe for a rolling upgrade: the previous release names
-- neither column. `goals` and `key_results` carry their tenant policies from
-- migration 0022, which new columns do not touch.
alter table goals
  add column added_mid_cycle_at timestamptz;
alter table key_results
  add column added_mid_cycle_at timestamptz;
