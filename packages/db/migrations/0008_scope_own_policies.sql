-- Return the tenant floor to being a floor.
--
-- 0005 added two permissive read policies, `own_memberships` and
-- `own_workspaces`, so that "which workspaces do I belong to" could be
-- answered inside row-level security rather than around it. That part was
-- right. What was missed is that Postgres combines permissive policies with
-- OR, and the Operation pipeline applies both `app.workspace_id` and
-- `app.user_id` to every write transaction.
--
-- The result: inside any operation, a select on `workspace_members` or
-- `workspaces` returned the scoped workspace's rows OR the acting user's rows
-- from every other workspace. Every read inside every operation was wider than
-- the floor it was supposed to sit on. A test asserted that union as correct,
-- which is how it survived review.
--
-- The two settings answer different questions and are never both the right
-- answer at once:
--
--   app.workspace_id set    one workspace is in scope. The tenant policy is
--                           the whole truth, and nothing may widen it.
--   app.workspace_id unset  the question is "which workspaces are mine",
--                           which crosses tenants by definition.
--
-- So the cross-workspace policies now apply only when no workspace is scoped.
-- The switcher and the provisioning membership check both call `withUser`,
-- which sets no workspace, so both keep working unchanged.
--
-- This is declarative on purpose. Scoping the policies fixes every caller at
-- once, including the ones Phase 2 has not written yet, which a rule about how
-- to call `withContext` would not.

drop policy own_memberships on workspace_members;
drop policy own_workspaces on workspaces;

create policy own_memberships on workspace_members
  for select
  using (
    nullif(current_setting('app.workspace_id', true), '') is null
    and user_id = nullif(current_setting('app.user_id', true), '')
    -- 0005 filtered soft-deleted rows in `own_workspaces` but not here, so a
    -- removed member could still read their own membership row across every
    -- workspace. The two policies now agree.
    and deleted_at is null
  );

create policy own_workspaces on workspaces
  for select
  using (
    nullif(current_setting('app.workspace_id', true), '') is null
    and exists (
      select 1
        from workspace_members m
       where m.workspace_id = workspaces.id
         and m.user_id = nullif(current_setting('app.user_id', true), '')
         and m.deleted_at is null
    )
  );
