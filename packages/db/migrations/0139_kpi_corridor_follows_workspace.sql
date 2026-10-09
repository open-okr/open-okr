-- A KPI's corridor follows the workspace unless it was set on the KPI
-- (UAT BUG-011).
--
-- Every KPI stored the workspace's healthy and watch thresholds as they were
-- on the day it was created, so moving them on /admin/rhythm recoloured
-- nothing that already existed. Null now means "the workspace's thresholds,
-- as they are now", and a number means the KPI deviates by design.
--
-- Forward-only. The defaults go too, so a row written without a corridor
-- follows the workspace rather than the canon's 90 and 70. Data change
-- 0026_kpi_corridor_follows_workspace clears the stored values that equal
-- the workspace's current ones; until it runs, every KPI reads exactly as
-- before. The previous release writes both columns on every create, so its
-- rows are never null. `kpis` already has its row-level security policy.
alter table kpis
  alter column healthy_pct drop not null,
  alter column healthy_pct drop default,
  alter column watch_pct drop not null,
  alter column watch_pct drop default;
