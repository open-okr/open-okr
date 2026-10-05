-- A KPI judged in its own units, by its own kind of target (METHOD.md §6.2,
-- §6.4, P9-T17a).
--
-- **Target types.** Stay at or above, stay at or below, increase to, decrease
-- to, stay within a range. Null is a KPI written before this release, which
-- reads as the type its direction implies; data change 0020 writes that type
-- onto every existing row. Nullable rather than defaulted, so the previous
-- release, which names no such column, keeps inserting rows that read right.
--
-- **Thresholds**, in the KPI's own units and all optional: a KPI with none is
-- judged by the ratio of current to target, as every KPI was. A high-is-good
-- type uses the low pair, a low-is-good type the high pair, and a range uses
-- green_low to green_high as its band with a red boundary on either side. The
-- rules that tie them together are refused at the boundary in words
-- (`thresholdsProblem`) rather than as a check constraint that could only say
-- that something is wrong.
--
-- **Aggregates.** `last` and `first` join, for a balance or a headcount.
--
-- Forward-only and safe for a rolling upgrade: four nullable columns, one
-- nullable column with a check, and a check that only widens. `kpis` keeps its
-- tenant policy from migration 0026, which none of this touches.
alter table kpis
  add column target_type text check (
    target_type is null
    or target_type in ('at_least', 'at_most', 'increase_to', 'decrease_to', 'range')
  ),
  add column green_low numeric,
  add column green_high numeric,
  add column red_low numeric,
  add column red_high numeric,
  drop constraint kpis_aggregate_check,
  add constraint kpis_aggregate_check check (
    aggregate in ('sum', 'avg', 'max', 'min', 'count', 'last', 'first')
  );
