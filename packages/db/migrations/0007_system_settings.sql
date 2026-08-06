-- Instance settings (TECHNICAL-PLAN §4.2, §8.2).
--
-- One table for everything that describes the deployment rather than a
-- workspace: mail configuration, the registration policy, instance flags, and
-- the record that the first-run wizard has finished. It is the "environment as
-- bootstrap" half of §4.2: the environment seeds an instance, and from then on
-- the wizard and instance administration own these values.
--
-- Key and value rather than one row of fixed columns, because a settings map
-- grows. A new instance flag is then a registry entry with a default, not a
-- migration.
--
-- Secrets live in the same row as their setting, sealed. A mail configuration
-- is a host, a port and a username in `value`, plus a password in the three
-- `secret_*` columns, so reading the configuration and reading the credential
-- are the same lookup and cannot drift apart. Envelope encryption means the
-- root key never reaches the database: `secret_data_key` is the per-secret key
-- wrapped by a root key held only in the environment, and `secret_key_id`
-- names which root key wrapped it so rotation knows what to re-wrap.

-- openokr:instance-scope: instance configuration, above every workspace rather
-- than beneath one, so it holds no workspace_id and its policies key on the
-- instance-admin setting instead
-- openokr:hard-delete: a setting is reset by removing its row, which restores
-- the registry default; there is nothing to recover, because the default is
-- the value
create table system_settings (
  key text primary key,
  -- The non-secret part. `null` is a real stored value, distinct from absence,
  -- which is why the default is the JSON null rather than an empty object.
  value jsonb not null default 'null'::jsonb,
  -- The secret part, sealed. All three are set together or all left null; the
  -- check below holds that.
  secret_ciphertext text,
  secret_data_key text,
  secret_key_id text,
  -- Free text describing where the value came from, for the admin screen:
  -- 'wizard', 'environment' or 'admin'. Not a check constraint, because a new
  -- source should not need a migration.
  source text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A half-written secret is unopenable, so refuse to store one.
  constraint system_settings_secret_complete check (
    (secret_ciphertext is null
      and secret_data_key is null
      and secret_key_id is null)
    or
    (secret_ciphertext is not null
      and secret_data_key is not null
      and secret_key_id is not null)
  )
);

alter table system_settings enable row level security;
alter table system_settings force row level security;

-- Readable by the application, because the mailer needs its configuration on
-- every send and the sign-in page needs the registration policy on every
-- request. What is read is ciphertext: without the root key from the
-- environment, a secret column is bytes.
create policy instance_settings_read on system_settings
  for select
  using (true);

-- Writes need an explicit transaction-local opt-in, the same shape as the
-- tenant floor. An ordinary request path never sets it, so a stray insert or
-- update from a request handler is refused by the database rather than caught
-- in review. The wizard and instance administration set it deliberately.
create policy instance_settings_write on system_settings
  for all
  using (nullif(current_setting('app.instance_admin', true), '') = 'on')
  with check (nullif(current_setting('app.instance_admin', true), '') = 'on');

-- The wizard asks "is this instance configured" on every request to the setup
-- route and on every boot. It is one key lookup by primary key, so no index is
-- needed beyond the one the primary key already provides.
