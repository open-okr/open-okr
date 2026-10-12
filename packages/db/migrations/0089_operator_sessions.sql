-- Support access, and who said yes (P8-T04a).
--
-- Design: docs/design/p8-t01b-support-access.md.
--
-- **Consent is the only way in, and break-glass is not built.** P8-T04's card
-- asks for "an explicit grant", and that phrase has two opposite readings: the
-- owner says yes, or the operator does and it is logged. The second was
-- refused at the design gate for two reasons. The lockout case that motivates
-- it holds the least content of any support case, because an account is
-- `users`, sessions and `workspace_members.status`, none of which needs a
-- session here. And an unbuilt path cannot be quietly widened, whereas one
-- built "just in case" becomes the normal path within a year, because it is
-- faster than waiting for a customer to answer an email.
--
-- **The session is a binding, not a bypass.** Granting one creates a real
-- `workspace_members` row of kind `guest` through the one member-provisioning
-- funnel, so `can()` answers for an operator exactly as it answers for
-- anybody else, every read goes through the access getter, every write goes
-- through the Operation pipeline, and the freeze overlay still refuses writes
-- into a suspended workspace. There is no second authorisation path that
-- could disagree with the first.

CREATE TABLE operator_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  operator_user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Written by the operator when requesting, shown to the owner before they
  -- decide. Not optional and not defaulted: a request with no reason is one
  -- nobody can weigh.
  reason               text NOT NULL CHECK (length(btrim(reason)) > 0),
  -- **Separate from granted_at on purpose.** The gap between them is the
  -- customer's decision, and it is what an auditor looks at. One timestamp
  -- would lose the fact that a request was ever made and refused.
  requested_at         timestamptz NOT NULL DEFAULT now(),
  granted_at           timestamptz,
  -- The member who said yes. Null until somebody does.
  granted_by_member_id uuid REFERENCES workspace_members(id) ON DELETE SET NULL,
  expires_at           timestamptz,
  ended_at             timestamptz,
  -- Why it ended, for the owner's own record: 'expired', 'revoked' or
  -- 'finished'. Null while live.
  ended_reason         text CHECK (ended_reason IN ('expired', 'revoked', 'finished', 'refused')),
  -- The member row the grant created, so ending the session can suspend it.
  member_id            uuid REFERENCES workspace_members(id) ON DELETE SET NULL,
  -- An `ACCESS_LEVELS` value. `full` is deliberately not offered by the
  -- product: it includes granting access, and an operator who can extend
  -- their own session has no time box.
  level                integer NOT NULL DEFAULT 10 CHECK (level IN (10, 40, 70)),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  -- A granted session has an expiry and a member; an ungranted one has
  -- neither. Without this a grant could half-apply and nothing would say so.
  CONSTRAINT operator_sessions_granted_shape CHECK (
    (granted_at IS NULL AND expires_at IS NULL AND granted_by_member_id IS NULL)
    OR (granted_at IS NOT NULL AND expires_at IS NOT NULL AND granted_by_member_id IS NOT NULL)
  ),
  CONSTRAINT operator_sessions_ended_shape CHECK (
    (ended_at IS NULL AND ended_reason IS NULL)
    OR (ended_at IS NOT NULL AND ended_reason IS NOT NULL)
  )
);

-- One live session per workspace per operator. Two would make the audit trail
-- ambiguous about which one an action belonged to.
CREATE UNIQUE INDEX operator_sessions_one_live
  ON operator_sessions (workspace_id, operator_user_id)
  WHERE ended_at IS NULL AND deleted_at IS NULL;

-- What the at-use expiry check reads, on a path that already loads a member.
CREATE INDEX operator_sessions_member_idx
  ON operator_sessions (member_id)
  WHERE member_id IS NOT NULL AND ended_at IS NULL;

-- The sweep's own read.
CREATE INDEX operator_sessions_expiry_idx
  ON operator_sessions (expires_at)
  WHERE ended_at IS NULL AND expires_at IS NOT NULL;

ALTER TABLE operator_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_sessions FORCE ROW LEVEL SECURITY;

-- The workspace sees its own sessions, live and finished. That is the whole
-- promise: the owner can see who was in their workspace, when, and why,
-- without asking anybody.
CREATE POLICY operator_sessions_tenant ON operator_sessions
  USING (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  )
  WITH CHECK (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

-- An operator sees and writes their own requests, across workspaces, so the
-- console can list what they have asked for and what was granted. Scoped to
-- their own rows: an operator cannot see what another operator asked for, and
-- cannot grant anything, because granting writes `granted_at` from the
-- workspace side under the tenant policy above.
CREATE POLICY operator_sessions_operator ON operator_sessions
  USING (
    app_is_live_operator()
    AND operator_user_id = nullif(current_setting('app.operator_user_id', true), '')
  )
  WITH CHECK (
    app_is_live_operator()
    AND operator_user_id = nullif(current_setting('app.operator_user_id', true), '')
  );

-- Instance administration can list sessions across tenants.
--
-- The expiry sweep runs on the scheduler host and has to find every session
-- whose time is up before it can scope anything, and the policies above are
-- both scoped: one to a workspace, one to an operator's own rows. This is the
-- third table to need it, after `tenants` at 0083 and `workspaces` at 0086,
-- and it is the same select-only shape.
--
-- SELECT only. The sweep ends a session through the Operation pipeline, with
-- the workspace setting applied, so the write is authorised and audited like
-- any other. Listing is not ending.
CREATE POLICY operator_sessions_instance_admin_read ON operator_sessions
  FOR SELECT
  USING (nullif(current_setting('app.instance_admin', true), '') = 'on');
