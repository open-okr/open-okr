-- Per-tenant usage, as a snapshot above the tenant floor (P8-T03b).
--
-- Design: docs/design/p8-t01b-operator-console.md §5, which this migration
-- corrects. That section says the counts come from "named read-only views".
-- They cannot. `force row level security` applies to the table owner too,
-- which is the whole point of it, and migrations run as the owner rather than
-- as a superuser ("exactly as production will", says the test harness). So a
-- `security_invoker = off` view and a `security definer` function over one are
-- both still filtered, and a count taken that way is always zero. P8-T03a
-- wrote that view, measured zero, and cut it rather than ship it.
--
-- Three ways out, and this is the third:
--
--   1. Give the owner role BYPASSRLS. Refused: it disables the floor for
--      every table to make one count work, and it is the privileged
--      connection the P8-T01b design gate already refused.
--   2. Maintain counters on every write. Refused: a counter touched by every
--      domain write is a second source of truth that drifts, and the drift is
--      invisible.
--   3. **Snapshot them.** A scheduled job enumerates workspaces above the
--      floor, which `listWorkspaces()` in the scheduler already does for the
--      agent cadences with the same reason written beside it, opens each
--      workspace properly through the tenant setting, counts, and writes one
--      row here. The operator reads this table and never a content table.
--
-- The cost is that counts are as of the last sweep rather than live. For an
-- operator deciding whether a workspace is active enough to matter, a figure
-- from this morning is the same answer as a figure from this second.

-- openokr:instance-scope: this is what the vendor knows about a tenant in
-- aggregate, and an operator reads it without any workspace applied. Keyed on
-- a workspace, but it sits above the floor rather than beneath it, the same
-- way `tenants` holds vendor knowledge rather than workspace content.
-- openokr:hard-delete: a snapshot is replaced, never archived. Keeping old
-- ones would be a second history nobody reads.
CREATE TABLE operator_workspace_usage (
  workspace_id     uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  member_count     integer NOT NULL DEFAULT 0,
  goal_count       integer NOT NULL DEFAULT 0,
  check_in_count   integer NOT NULL DEFAULT 0,
  storage_bytes    bigint  NOT NULL DEFAULT 0,
  last_activity_at timestamptz,
  -- When these numbers were taken. Shown beside them, because a figure with
  -- no timestamp invites somebody to treat a stale one as live.
  measured_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE operator_workspace_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_workspace_usage FORCE ROW LEVEL SECURITY;

-- Read by a live operator. Nothing here is content: five numbers and two
-- timestamps, and no title, name or body from any table a member wrote in.
CREATE POLICY operator_workspace_usage_operator_read
  ON operator_workspace_usage
  FOR SELECT
  USING (app_is_live_operator());

-- Written by the sweep, which runs as instance administration rather than as
-- a member or an operator. An operator cannot write its own usage figures.
CREATE POLICY operator_workspace_usage_admin ON operator_workspace_usage
  USING (nullif(current_setting('app.instance_admin', true), '') = 'on')
  WITH CHECK (nullif(current_setting('app.instance_admin', true), '') = 'on');

-- Instance administration can list workspaces.
--
-- The sweep above has to know which workspaces exist before it can open any
-- of them, and it runs as instance administration rather than as a member.
-- On the application pool with no workspace applied the floor hides every
-- row, so `select id from workspaces` returned nothing and the first sweep
-- measured zero workspaces.
--
-- `tenants` got exactly this policy at 0083 and for the same reason. Both are
-- SELECT only: listing is not managing, and every write to a workspace still
-- goes through the Operation pipeline with the workspace setting applied.
--
-- This is also what `listWorkspaces` in the scheduler and `pnpm audit:chain`
-- have been working around by requiring a role that can see past the floor.
-- They can use this instead, which is a smaller privilege than BYPASSRLS on a
-- whole connection.
CREATE POLICY workspaces_instance_admin_read ON workspaces
  FOR SELECT
  USING (nullif(current_setting('app.instance_admin', true), '') = 'on');

-- The ordinary tenant policy, as well.
--
-- The P7-T03a fuzz suite requires every table carrying a `workspace_id` to
-- have a policy that reads the tenant setting, and it refused this one. That
-- is the suite being right rather than being in the way: a universal claim
-- with one exemption is not a universal claim, and the next table to want an
-- exemption will cite this one.
--
-- Adding it costs nothing and gains something. A workspace reading its own
-- usage row is a reasonable thing for a workspace to do, and P8-T05's plan
-- and seats screen will want exactly these numbers for the customer's own
-- side. Postgres combines permissive policies with OR, so this widens reading
-- to the workspace itself and leaves the operator's read and the sweep's
-- write exactly where they were.
CREATE POLICY operator_workspace_usage_tenant ON operator_workspace_usage
  FOR SELECT
  USING (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );
