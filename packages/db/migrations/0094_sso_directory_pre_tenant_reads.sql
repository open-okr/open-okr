-- The SSO and directory-sync reads that run before a tenant is known
-- (P8-T07a).
--
-- **Migrations 0091 and 0092 gave three tables a tenant-only policy, and all
-- three of their reads run with no tenant setting.** The application role is
-- `nosuperuser nobypassrls` and owns nothing, and both tables carry `force
-- row level security`, so every one of those reads answered with nothing:
--
--   loadSSOConnections   boot, no workspace          0 providers, always
--   listSSOProviders     the sign-in page, no session 0 buttons, always
--   resolveToken         a SCIM request, no workspace every request 401
--
-- Single sign-on could therefore never have been configured and no SCIM
-- request could ever have been accepted. Nothing failed loudly, because
-- returning no rows is what a correct tenant floor looks like from above.
-- Three tests now hold each of those three reads to a row it can see.
--
-- Migration 0093 fixed the *error* these policies produced on an unscoped
-- connection ("invalid input syntax for type uuid") by adding `nullif`. This
-- fixes the emptiness underneath it, which is the half that made the feature
-- inert rather than noisy.
--
-- Two different arrangements, because the two reads are different questions.

-- 1. `sso_connections`: a list, not a row.
--
-- Neither caller is asking about a row. The boot sequence needs every enabled
-- provider on the instance to build the OAuth client; the sign-in page needs
-- every enabled provider to draw its buttons, and a visitor who has not
-- signed in has no workspace to be scoped to. So the key names no row, and
-- what keeps it narrow is the other direction: `for select` only, on this
-- table only, and the client secret in those rows is envelope-encrypted and
-- worthless without the instance root key.
--
-- `app.instance_admin` (0007, 0083) would also have opened this read and was
-- refused: it additionally opens `system_settings` writes and the `tenants`
-- rows, and the transaction asking here is an unauthenticated page load.
--
-- Writes are untouched. The tenant policy below still decides those, so a
-- workspace can only configure its own providers.
create policy sso_connections_provider_list
  on sso_connections
  for select
  using (nullif(current_setting('app.sso_lookup', true), '') = 'on');

-- 2. `directory_sync_tokens`: one row, named by the digest the caller holds.
--
-- The eighth pre-tenant key, and the same shape as `api_tokens` (P5-T07a),
-- `channel_installations` (P5-T02a), `device_authorisations` (P5-T07c-b), the
-- three OAuth secret tables (P5-T08a) and `invite_links` (P6-G06b). An
-- identity provider's request carries a bearer token and nothing else, so
-- which workspace it provisions into is the question rather than the context.
-- Somebody without the token learns nothing, including whether it exists.
--
-- **The `with check` clause is written out and stays tenant-only.** The
-- policy 0093 left has no `with check` at all, and Postgres then uses the
-- `using` expression for inserts too. Adding the second key to `using`
-- without this would have let a caller holding one token hash insert a row
-- for any workspace. The pre-tenant key opens a read and never a write, which
-- is the rule 0075 wrote down for the same clause.
drop policy directory_sync_tokens_tenant on directory_sync_tokens;
create policy directory_sync_tokens_tenant on directory_sync_tokens
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    or token_hash = nullif(current_setting('app.directory_token_hash', true), '')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

-- The lookup is by digest across the instance, so it needs an index that is
-- not per workspace. `directory_sync_tokens_hash_unique` from 0092 already
-- covers it: a unique constraint on `token_hash` alone. Named here so the
-- next person does not add a second one.

-- Forward-only and safe under a rolling upgrade. The previous release scopes
-- every query on these tables by workspace or reaches nothing at all, so a
-- policy that admits rows it never asks for changes nothing for it.
