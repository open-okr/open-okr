-- The reminder seven days before a closed workspace is erased
-- (docs/design/workspace-erasure.md §12, decision 3).
--
-- When the owners and administrators were reminded. Null until then, and back to
-- null on every lifecycle move, so a workspace closed a second time is reminded a
-- second time. One column rather than a table: there is one reminder per closure.
ALTER TABLE tenants
  ADD COLUMN erasure_reminded_at timestamptz;
