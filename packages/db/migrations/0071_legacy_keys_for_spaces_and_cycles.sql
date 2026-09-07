-- Legacy keys on spaces and cycles (TECHNICAL-PLAN §7.1 step 4, §7.2, P6-T03a).
--
-- Every table §7.2 imports into has carried `legacy_type` and `legacy_id` since
-- its own migration, except these two. `spaces` predates the mapping by
-- seventeen migrations and `cycles` by thirteen: both were written before there
-- was an importer to write those columns, and the spreadsheet importer never
-- touched either, so the gap has never been visible.
--
-- It is visible now. §7.2 maps FlowyTeam's teams onto `spaces` and its
-- performance cycles onto `cycles`, and §7.1 step 4 makes idempotency a
-- property of the unique key `(workspace_id, legacy_type, legacy_id)`. Without
-- these columns a second run of the same company would create a second copy of
-- every team.
--
-- Additive and forward-only. Nothing reads these columns yet on a released
-- instance, so this is safe under a rolling upgrade in both directions: the
-- previous release ignores columns it does not know about, and the new one
-- treats a null legacy key as "created in the product", which is what every
-- existing row is.
--
-- No new policy. Both tables already carry `workspace_id` and their row-level
-- security policy from their own migrations, and adding a column to a table
-- does not change what a policy covers.

alter table spaces
  add column legacy_id text,
  add column legacy_type text;

alter table cycles
  add column legacy_id text,
  add column legacy_type text;

-- The same constraint the other importable tables carry, including the
-- `deleted_at is null` clause `goals_legacy_idx` added: a row somebody removed
-- from the product is not one the next import should silently revive, so it
-- comes back as a create.
create unique index spaces_legacy_idx on spaces (
  workspace_id, legacy_type, legacy_id
)
where
  legacy_id is not null
  and deleted_at is null;

create unique index cycles_legacy_idx on cycles (
  workspace_id, legacy_type, legacy_id
)
where
  legacy_id is not null
  and deleted_at is null;

-- The address a placeholder member is waiting to be claimed by (§7.2, P6-T03a).
--
-- `workspace_members` has carried `kind = 'placeholder'` and a nullable
-- `user_id` since migration 0005, so the row shape was always ready for a
-- member nobody has signed in as. What it never had was the one fact that makes
-- such a row claimable: the address the source system knew the person by. A
-- placeholder without it is a name and a legacy key, and the person it stands
-- for can never be matched to it.
--
-- Nullable, because every member created in the product has a real account and
-- this says nothing about them. Unique per workspace where it is set, so two
-- imported employees sharing an address cannot become two members waiting for
-- one person.
alter table workspace_members
  add column placeholder_email text;

create unique index workspace_members_placeholder_email_idx on workspace_members (
  workspace_id, placeholder_email
)
where
  placeholder_email is not null
  and deleted_at is null;

-- The enum is enforced in the Drizzle schema rather than in the column type,
-- exactly as it is on every other table carrying these two: `workspaces`,
-- `goals`, `key_results`, `check_ins`, `kpis`, `initiatives` and `tasks` all
-- declare `text` here. A check constraint on eight tables would be eight places
-- to change when a third source arrives.
