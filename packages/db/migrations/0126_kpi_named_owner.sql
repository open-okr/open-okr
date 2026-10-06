-- A KPI's named owner, and a tier it may go without (METHOD.md §6.2,
-- P9-T17b-b).
--
-- **One named person.** §6.2 gives every KPI an owner who is a person. Where a
-- KPI lives, the workspace, a space or a member's own list, stays as it was:
-- the owner is who answers for it, and who hears when it leaves its corridor.
-- Null is a KPI nobody has named, which is every existing one that does not
-- already belong to a member; data change 0022 names the member for those
-- that do. Nobody is invented for the rest.
--
-- **An optional tier.** §6.2 makes the tier optional, so the column takes
-- null. Its default stays `output`, so the previous release, which always
-- states a tier, writes exactly what it wrote before. Nothing in the product
-- decides anything by tier; it is a label.
--
-- Forward-only and safe for a rolling upgrade: one nullable column and one
-- dropped not-null, which only widens. `kpis` keeps its tenant policy from
-- migration 0026, which neither touches.
alter table kpis
  add column owner_member_id uuid references workspace_members (id),
  alter column tier drop not null;
