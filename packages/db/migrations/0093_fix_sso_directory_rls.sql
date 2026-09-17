-- Fix RLS policies for sso_connections, directory_sync_tokens and
-- directory_sync_log to use nullif, matching the pattern every other
-- tenant-scoped table uses since migration 0005.
--
-- Without nullif, an empty-string setting (the state on an operator
-- connection or an unscoped test) fails with "invalid input syntax for
-- type uuid: ''" instead of returning zero rows. Found by the
-- operator-wall test in CI on PR #76.

drop policy sso_connections_tenant on sso_connections;
create policy sso_connections_tenant on sso_connections
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

drop policy directory_sync_tokens_tenant on directory_sync_tokens;
create policy directory_sync_tokens_tenant on directory_sync_tokens
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

drop policy directory_sync_log_tenant on directory_sync_log;
create policy directory_sync_log_tenant on directory_sync_log
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
