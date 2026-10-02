-- A goal's reviewer becomes optional (METHOD.md §2.5, §12, P9-T04).
--
-- **Every goal had to name a reviewer**, and the database enforced it, so a
-- team that runs OKRs without per-goal review had to name somebody anyway, and
-- that person then owed an acknowledgement on every check-in. METHOD v2 makes
-- the reviewer a practice setting: off, optional (the default) or required.
-- A goal with no reviewer simply owes no acknowledgement.
--
-- **Only the constraint goes.** Every existing goal keeps its reviewer, and
-- the setting decides whether that reviewer is asked to acknowledge. Where a
-- workspace requires reviewers, the write path refuses a goal without one,
-- through the one policy every caller asks (`requirePolicy`), so the rule is
-- the practice's and not the column's.
--
-- Forward-only and safe for a rolling upgrade in the direction that matters:
-- the previous release always writes a reviewer, and this one reads a goal
-- with or without one. `goals` carries its tenant policy from migration 0022,
-- which a changed constraint does not touch.
alter table goals
  alter column reviewer_id drop not null;
