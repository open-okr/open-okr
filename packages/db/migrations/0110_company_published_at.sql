-- The first of the two publish steps (METHOD.md §4.5, P9-T03b).
--
-- **A cycle publishes in up to two steps.** The company set goes out before
-- the cycle starts, and the department and team sets by the time the team
-- publication window closes, each through the publish gates. This column
-- records the first step.
--
-- **`published_at` keeps its meaning**: the whole set is published, which a
-- dozen readers rely on (the check-in rhythm, the digests, the review, the
-- nudges). So the new column is the company step rather than the team step,
-- and a set published in one go sets both. That keeps every cycle published
-- before this release reading exactly as it did, with no backfill: its company
-- set went out with the rest, and `published_at` already says when.
--
-- Additive and nullable, so the previous release reads `cycles` unchanged.
-- The table carries its tenant policy from migration 0020, which a new
-- column inherits.
alter table cycles
  add column company_published_at timestamptz;
