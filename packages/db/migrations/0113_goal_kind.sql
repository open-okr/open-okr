-- The kind of promise an objective makes (METHOD.md §2.8, P9-T11b-a).
--
-- **Committed or aspirational.** A committed objective is expected to be
-- delivered in full; an aspirational one is a stretch. P9-T11a split every
-- rule that judges ambition by kind and passed "aspirational" from every
-- caller, because there was nowhere to keep the answer. This is where.
--
-- **Every existing objective reads as aspirational**, which is what the
-- rules already treated it as, so nothing an existing workspace sees changes
-- until somebody marks an objective committed. It is also the default for a
-- new one (decision D2): a commitment is a promise somebody makes on purpose.
--
-- Forward-only and safe for a rolling upgrade: the previous release never
-- names the column, and the default fills it for every row it inserts.
-- `goals` carries its tenant policy from migration 0022, which a new column
-- does not touch.
alter table goals
  add column kind text not null default 'aspirational'
    check (kind in ('committed', 'aspirational'));
