-- A dependency names the key result that delivers it (plan 0.7.0 O5,
-- docs/design/key-result-dependencies.md K1 and K11, approved by Akmal on
-- 9 November 2026).
--
-- Until now the register named the providing team and not what the team
-- delivers, so nothing could show a dependency as delivered when the
-- providing milestone was done (Northwind NW-Q1-20). Whether it is delivered
-- is read from that key result's progress every time and never stored here,
-- so this is the only column the change needs.
--
-- Nullable, because a supplier or a regulator has no key result in this
-- workspace. `on delete set null`, as `provider_space_id` is: a key result
-- removed for good leaves an entry that still names its team. A key result
-- cannot be what delivers its own dependency.
--
-- The index is for the foreign key. Erasing a workspace deletes its key
-- results, and without it each delete would scan the register to find what
-- to set null. Partial, because most entries name no key result.
--
-- Forward-only and additive: the previous release neither reads nor writes
-- the column, so a rolling upgrade is safe. `key_result_dependencies` keeps
-- the tenant policy migration 0025 gave it, which a new column does not touch.
alter table key_result_dependencies
  add column provider_key_result_id uuid references key_results (id) on delete set null,
  add constraint key_result_dependencies_provider_is_another_key_result check (
    provider_key_result_id is null or provider_key_result_id <> key_result_id
  );

create index key_result_dependencies_provider_key_result_idx
  on key_result_dependencies (provider_key_result_id)
  where provider_key_result_id is not null;
