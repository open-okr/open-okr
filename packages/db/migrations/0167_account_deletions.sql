-- Deleting your own account (docs/design/account-deletion.md, plan 0.8.0 Y7,
-- approved by Akmal on 11 November 2026).
--
-- A person asks, every session of theirs ends, and fourteen days later the
-- scheduler erases their member in every workspace they belong to, one
-- workspace per transaction, and then the account. Signing in during the
-- fourteen days cancels it. This table is the request and the ledger the run
-- resumes from when one workspace fails.
--
-- **Above the tenant floor.** A request is about the account, beside `users`
-- and `sessions`, and spans every workspace the person is in, so it has no
-- `workspace_id`. A person reads their own request through the user setting
-- (`withUser`) and nobody else's. Every write, the person's own request and
-- cancellation included, and the scheduler's reads across accounts, go through
-- the instance-admin flag (`withInstanceAdmin`), as the password notice and the
-- instance audit chain do. No other policy names the table, so a workspace
-- transaction reads nothing from it.
--
-- `workspaces_done` is the ledger: each workspace whose erasure committed. The
-- run reads the person's live memberships, so a workspace already done is not
-- erased again even if the ledger write after it was lost.
--
-- openokr:instance-scope: a request belongs to an account across every
-- workspace it is a member of, so no single workspace owns the row.
-- openokr:hard-delete: nothing removes a request. Cancelled or done, the row
-- is the record that a deletion was asked for and what became of it.
CREATE TABLE account_deletions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  -- `requested_at` plus fourteen days, written by core from one constant. A
  -- column rather than a computation so the scheduler's read is an index scan.
  runs_at         timestamptz NOT NULL,
  -- The day-before mail went.
  reminded_at     timestamptz,
  cancelled_at    timestamptz,
  -- 'signed_in': they came back. 'refused': a refusal held when the run
  -- began (Y7-Q1), and the mail named it.
  cancel_reason   text CHECK (cancel_reason IN ('signed_in', 'refused')),
  started_at      timestamptz,
  completed_at    timestamptz,
  workspaces_done uuid[] NOT NULL DEFAULT '{}',
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  CONSTRAINT account_deletions_cancel_shape CHECK (
    (cancelled_at IS NULL AND cancel_reason IS NULL)
    OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)
  ),
  -- A request ends one way: cancelled or done, never both.
  CONSTRAINT account_deletions_one_end CHECK (
    cancelled_at IS NULL OR completed_at IS NULL
  )
);

-- One open request per account. A second click while one is open is an
-- answer, not a second row.
CREATE UNIQUE INDEX account_deletions_one_open
  ON account_deletions (user_id)
  WHERE cancelled_at IS NULL AND completed_at IS NULL;

-- The scheduler's read: open requests by when they run.
CREATE INDEX account_deletions_due
  ON account_deletions (runs_at)
  WHERE cancelled_at IS NULL AND completed_at IS NULL;

ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletions FORCE ROW LEVEL SECURITY;

-- Read-only, as every user-setting policy is: the setting answers "what is
-- mine" and never authorises a write.
CREATE POLICY account_deletions_own ON account_deletions
  FOR SELECT
  USING (user_id = nullif(current_setting('app.user_id', true), ''));

CREATE POLICY account_deletions_admin ON account_deletions
  USING (nullif(current_setting('app.instance_admin', true), '') = 'on')
  WITH CHECK (nullif(current_setting('app.instance_admin', true), '') = 'on');

-- A new inbox reason (design §5, Y7-5 and Y7-6): a workspace's administrators
-- and the person's manager hear that a member deleted their account, with what
-- now needs an owner. Forward-only and safe for a rolling upgrade: each check
-- gains a value the previous release never writes, and no row changes.
-- `subscriptions` is widened too so the one reason enum in the schema matches
-- both tables; nothing writes a subscription with this reason.
alter table notifications
drop constraint if exists notifications_reason_check;

alter table notifications
add constraint notifications_reason_check check (
  reason in (
    'invited',
    'joined',
    'mentioned',
    'role',
    'review',
    'check_in',
    'support_request',
    'support_ended',
    'connection_ended',
    'self_deleted'
  )
);

alter table subscriptions
drop constraint if exists subscriptions_reason_check;

alter table subscriptions
add constraint subscriptions_reason_check check (
  reason in (
    'invited',
    'joined',
    'mentioned',
    'role',
    'review',
    'check_in',
    'support_request',
    'support_ended',
    'connection_ended',
    'self_deleted'
  )
);
