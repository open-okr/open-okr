-- The practice a workspace runs (METHOD.md §12, P9-T01).
--
-- **Phase 9 turned METHOD.md's locks into practice settings.** Who may write and
-- when, whether phases bind, how hard each check and publish gate is, and how
-- the close behaves were rules the code applied to everybody. Each is now a
-- setting with the best-practice default first, declared once in
-- packages/method (`PRACTICE`), and grouped into five named profiles.
--
-- **Two columns on the row that already holds the §11 thresholds**, because the
-- two are read together on every policy decision and one row per workspace is
-- the shape both have. `profile` names the starting point the workspace chose.
-- `practice` holds only what the workspace changed on top of it, the same
-- sparse rule `overrides` follows for thresholds: a stored copy of a default
-- would keep winning after the default itself changed.
--
-- **The defaults are the recommended profile with nothing changed**, so every
-- existing workspace reads exactly the defaults METHOD.md §12.1 lists, without
-- a backfill. Nothing reads either column until P9-T02, so this release
-- behaves as the last one did.
--
-- Additive and forward-only. The previous release never names either column,
-- so a rolling upgrade has nothing to reconcile, and `rhythm_settings` carries
-- its tenant policy from migration 0020, which a new column inherits. The
-- check keeps a typo out of the one column a person's choice is read from;
-- the values inside `practice` are validated against the registry in
-- packages/method, which is the one place that knows them.
alter table rhythm_settings
  add column profile text not null default 'recommended'
    check (profile in (
      'recommended', 'googleStyle', 'radicalFocus', 'lightweight', 'governed'
    )),
  add column practice jsonb not null default '{}'::jsonb
    check (jsonb_typeof(practice) = 'object');
