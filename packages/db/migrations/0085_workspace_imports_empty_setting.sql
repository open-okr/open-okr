-- The last unguarded tenant policy (P8-T03a).
--
-- 234 policies in this schema compare against
-- `nullif(current_setting('app.workspace_id', true), '')::uuid`. Two did not:
-- `tenants` from 0082, fixed by 0083, and this one from P6-T05b.
--
-- The difference matters on a pooled connection. A connection that has never
-- carried a workspace reads the setting as NULL, the cast is fine, and the
-- comparison yields no rows. One that has already served a tenant-scoped
-- transaction reads it as the empty string, because SET LOCAL reverts to the
-- session value at commit and a custom setting never set at session level is
-- ''. `''::uuid` then raises `invalid input syntax for type uuid`.
--
-- Fail-closed either way, and nothing ever leaked. What it breaks is two
-- things. A second permissive policy cannot apply, because the error is
-- raised first. And a bug that forgets `withWorkspace` produces a type error
-- on some connections and an empty result on others, which is a diagnosis
-- trap.
--
-- Found by the operator wall suite, which points one connection at every
-- table carrying a `workspace_id` and requires zero rows from all of them.
-- It got an exception from this one table and nothing from the other 106.

-- openokr:not-tenant-scoped: this replaces a policy on an existing table and
-- creates none, so the tenant-floor and soft-delete checks have nothing to
-- read here.
DROP POLICY workspace_imports_tenant ON workspace_imports;

CREATE POLICY workspace_imports_tenant ON workspace_imports
  USING (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );
