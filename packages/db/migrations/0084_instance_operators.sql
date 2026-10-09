-- The cloud operator, and the wall between them and the content (P8-T03a).
--
-- Design: docs/design/p8-t01b-operator-console.md.
--
-- CLAUDE.md's least-privilege rule is written about agents: "there is no
-- service account with ambient authority". An operator is the much larger
-- version of the same risk, a human login that done carelessly reads every
-- customer's objectives forever with nothing recorded.
--
-- **The wall is the absence of a policy, not a check in application code.**
-- Every table below names `app.operator_user_id`. No content table does, and
-- none ever should. An operator's connection returns zero rows from `goals`
-- even if every line above it were wrong.

-- openokr:instance-scope: an operator is granted on the instance and is a
-- member of no workspace. Giving them a member row in every workspace is
-- exactly the ambient authority the rule forbids.
-- openokr:hard-delete: there is nothing to soft delete. Revocation is a
-- stamp on `revoked_at`, kept forever, because the trail of who could see
-- what and when is the whole point of the table.
CREATE TABLE instance_operators (
  user_id             text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Never null and never self. The first operator is created by the
  -- deployment rather than by a screen: a screen that creates the first
  -- operator can be reached by whoever gets there first.
  granted_by_user_id  text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  granted_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  note                text,
  CONSTRAINT instance_operators_not_self CHECK (user_id <> granted_by_user_id)
);

ALTER TABLE instance_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE instance_operators FORCE ROW LEVEL SECURITY;

-- An operator sees who else holds a grant, which is how a console shows the
-- list. Writing one is instance administration, the same bar `system_settings`
-- sets, and is deliberately not reachable with the operator key: an operator
-- who can grant an operator has no meaningful revocation.
CREATE POLICY instance_operators_operator_read ON instance_operators
  FOR SELECT
  USING (nullif(current_setting('app.operator_user_id', true), '') IS NOT NULL);

CREATE POLICY instance_operators_admin ON instance_operators
  USING (nullif(current_setting('app.instance_admin', true), '') = 'on')
  WITH CHECK (nullif(current_setting('app.instance_admin', true), '') = 'on');

-- Whether the caller is a live operator. A function rather than the same
-- subquery written five times, so a sixth policy cannot get it subtly wrong.
--
-- `revoked_at is null` is read on every query, which is what makes revoking a
-- grant take effect at the database rather than at the operator's next
-- sign-in.
--
-- STABLE, not IMMUTABLE: it reads a table and a setting. SECURITY DEFINER so
-- the lookup itself is not subject to the policy it is deciding, which would
-- be circular.
CREATE FUNCTION app_is_live_operator() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM instance_operators
     WHERE user_id = nullif(current_setting('app.operator_user_id', true), '')
       AND revoked_at IS NULL
  );
$$;

-- The named tables, and nothing else.
--
-- SELECT only on `tenants` and `workspaces`. The lifecycle writes an operator
-- makes arrive at P8-T03b, and they go through the Operation pipeline with
-- the workspace setting applied, not through this key.
CREATE POLICY tenants_operator_read ON tenants
  FOR SELECT
  USING (app_is_live_operator());

CREATE POLICY workspaces_operator_read ON workspaces
  FOR SELECT
  USING (app_is_live_operator());

-- **Per-tenant usage is not here, and the reason is worth writing down.**
--
-- The design asks for member, goal and check-in counts an operator can read
-- without any policy on a content table, answered by a view. That view was
-- written, and it counted zero.
--
-- `force row level security` applies to the table owner too, which is the
-- whole point of it (TECHNICAL-PLAN §8.2 control 1: the application role
-- cannot bypass the floor and does not own the tables). So a
-- `security_invoker = off` view and a `security definer` function over it
-- are both still filtered, and a count taken that way is always zero.
--
-- Every way out of that is a decision rather than a detail: give one role
-- BYPASSRLS and own the counting to it, keep a maintained per-workspace
-- counter table above the floor, or let the operator read counts through the
-- workspace setting for one workspace at a time. The first is the privileged
-- connection the P8-T01b design gate refused; the other two are new machinery.
--
-- So it belongs with P8-T03b, which is the task that builds the screen those
-- counts appear on. Shipping a usage view that silently reports zero would be
-- worse than shipping none, because a zero reads as a quiet workspace.
