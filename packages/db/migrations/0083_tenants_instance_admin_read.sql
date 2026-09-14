-- Two changes to `tenants`, both so the closure sweep can run (P8-T02c).

-- 1. The empty string is not a workspace id.
--
-- Migration 0082 wrote the tenant policy the way every other business table
-- writes it:
--
--     using (workspace_id = current_setting('app.workspace_id', true)::uuid)
--
-- On a connection that has never carried a workspace that setting reads back
-- as NULL, the cast is fine, and the comparison yields no rows. On a pooled
-- connection that has already served a tenant-scoped transaction it reads
-- back as the empty string, because SET LOCAL reverts to the session value at
-- commit and a custom setting never set at session level is ''. `''::uuid`
-- then raises `invalid input syntax for type uuid`.
--
-- Both behaviours are fail-closed, so nothing ever leaked. What broke is the
-- policy underneath: an error is raised before Postgres can OR in the
-- permissive policy added below, so the sweep could not read its own table on
-- a reused connection and could on a fresh one.
--
-- `nullif(..., '')` is what 0007 and 0014 already write for
-- `app.instance_admin`, for the same reason. This brings `tenants` into line.
--
-- **Every other business table still carries the original expression.** No
-- read of one has hit this yet, because nothing else reads a tenant-scoped
-- table under `app.instance_admin` on the application pool. Changing 106
-- policies is a change to the tenant floor and wants a human's decision, so
-- it is written down rather than done here.
DROP POLICY tenants_tenant ON tenants;

CREATE POLICY tenants_tenant ON tenants
  USING (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

-- 2. The closure sweep has to see every tenant.
--
-- It runs on the scheduler host, asks one question across every tenant, and
-- the answer is a list of workspace ids and closure instants. Nothing about
-- any customer's content passes through it.
--
-- SELECT only. Postgres combines permissive policies with OR, so this widens
-- reading and leaves writing exactly where 0082 put it, behind the tenant
-- floor. An instance administrator can list closed tenants and cannot change
-- one. The operator's own read, which is a different principal with a
-- different key, is P8-T03's and arrives as its own policy.

-- openokr:not-tenant-scoped: this file adds and replaces policies on an
-- existing table and creates none, so the tenant-floor and soft-delete
-- checks have nothing to read here.
CREATE POLICY tenants_instance_admin_read ON tenants
  FOR SELECT
  USING (nullif(current_setting('app.instance_admin', true), '') = 'on');
