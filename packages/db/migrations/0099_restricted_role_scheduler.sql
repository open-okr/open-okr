-- The application can run as a role that cannot bypass the tenant floor, and
-- its scheduler still starts (completeness review H-01 and H-02).
--
-- **Why this exists.** The Compose install connected as the Postgres image's
-- own role, which is a superuser, so row-level security never applied to the
-- running product. Moving it to a restricted role exposed two things the
-- restricted role cannot do, and both failed silently:
--
--   1. pg-boss creates its own `pgboss` schema when it starts. `CREATE SCHEMA
--      IF NOT EXISTS` checks for CREATE on the database before it checks
--      whether the schema exists, so a role without that privilege is refused
--      even when the schema is already there. The scheduler logged "could not
--      start" and every agent, digest and sweep stopped.
--   2. The scheduler lists every live workspace before it can scope anything.
--      Under the floor, `select ... from workspaces` with no tenant set returns
--      nothing, so a scheduler that did start would have found no one to run.
--
-- **The schema, created here by whoever runs migrations.** The privilege step
-- (`grantAppPrivileges`) then gives the application role USAGE and CREATE on
-- it, so pg-boss installs its own tables as the application role and owns
-- them. The application never needs CREATE on the database.
create schema if not exists pgboss;

-- **A read of workspaces for the scheduler, and nothing else.** The same shape
-- as `workspaces_operator_read` (0084): a named setting that code sets on
-- purpose, inside one transaction, rather than a role that bypasses the floor
-- everywhere. SELECT only, so it lists tenants and can change none of them.
-- `withSystemScan` in packages/db is the one place that sets it.
create policy workspaces_system_scan on workspaces
  for select
  using (nullif(current_setting('app.system_scan', true), '') = 'on');
