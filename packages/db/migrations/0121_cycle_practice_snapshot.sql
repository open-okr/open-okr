-- The rules a cycle was graded under, kept with it (METHOD.md §12, P9-T14b).
--
-- **A cycle keeps the rules it was graded under.** When a cycle closes, the
-- practice settings and every threshold in force are recorded with it, so an
-- admin who later moves a score band or a cap does not rewrite a closed
-- cycle's verdicts. `practice_snapshot` holds both, resolved, as they stood
-- at the close.
--
-- **Null on every cycle closed before this release.** The method that
-- resolves the canon lives in a package the data-change runner does not
-- reach, so instead of a backfill a closed cycle with no snapshot reads
-- today's canon, which no workspace setting moves. A snapshot from an older
-- release takes the canon for any setting it predates.
--
-- Forward-only and safe for a rolling upgrade: the previous release names
-- the column nowhere. `cycles` carries its tenant policy from migration
-- 0020, which a new column does not touch.
alter table cycles
  add column practice_snapshot jsonb;
