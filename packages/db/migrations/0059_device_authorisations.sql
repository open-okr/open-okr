-- The device login a terminal starts and a browser finishes
-- (TECHNICAL-PLAN.md §14, P5-T07c-b).
--
-- **A row that exists before a workspace does.** A terminal running `okr login`
-- has no session, no token and no idea which workspace it will end up in:
-- finding that out *is* the flow. So `workspace_id` is null until somebody
-- approves the request in a browser, and the policy admits a null-workspace row
-- through a second key, `app.device_code_hash`, exactly as `api_tokens` does for
-- the token lookup and `channel_installations` for the inbound webhook. Three
-- tables now read before a tenant is known, all three the same shape: the caller
-- reaches only the row whose secret it already holds.
--
-- **Two codes, both hashed, for two different readers.** `device_code` stays in
-- the terminal and is what the poll presents; `user_code` is short, goes in the
-- URL a person opens, and is what the browser looks the request up by. Neither
-- is stored in the clear, for the same reason an invitation token is not: a table
-- of live codes would otherwise be a table of ways to be granted somebody's
-- access.
--
-- **No raw token is ever stored here.** Approval records who approved and when;
-- the token is minted at poll time, in one transaction with the row being marked
-- consumed, and handed over once. Keeping a granted token on this row for the
-- minutes before a poll would be a credential at rest in a table whose whole
-- purpose is to be short-lived.
--
-- **State is the timestamps, not a column beside them.** Pending is
-- `approved_at` and `denied_at` both null; approved and unused is `approved_at`
-- set with `consumed_at` null; and so on. A `state` column next to the same
-- facts is a second answer that can disagree with the first.
create table device_authorisations (
  id uuid primary key,
  -- Null until approved. The approver's workspace is the one the token belongs
  -- to, which is why this cannot be known at insert time.
  workspace_id uuid references workspaces (id) on delete cascade,
  -- SHA-256 hex. Unique because the poll has only the hash to go on.
  device_code_hash text not null,
  -- SHA-256 hex of the short code. Unique because the browser looks up by it
  -- and two requests sharing one code would be ambiguous.
  user_code_hash text not null,
  -- What the terminal calls itself, shown on the approval screen so a person
  -- approving knows which machine asked. Untrusted text: it is displayed
  -- escaped and nothing reads it as a fact.
  client_name text not null,
  -- The scopes the terminal asked for, in the action registry's own vocabulary.
  -- What is granted is exactly this, never more: the approve action takes no
  -- scopes at all, so there is nothing to widen.
  requested_scopes text[] not null,
  approved_member_id uuid references workspace_members (id) on delete cascade,
  approved_at timestamptz,
  denied_at timestamptz,
  -- Set in the same transaction that mints the token, so approving twice grants
  -- once.
  consumed_at timestamptz,
  -- Rate limiting the protocol's own way (RFC 8628 `slow_down`): a poll that
  -- arrives sooner than the interval is told to wait rather than served.
  last_polled_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table device_authorisations enable row level security;
alter table device_authorisations force row level security;

create policy tenant_isolation on device_authorisations
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    or device_code_hash = nullif(current_setting('app.device_code_hash', true), '')
    or user_code_hash = nullif(current_setting('app.device_code_hash', true), '')
  )
  with check (
    -- An unapproved request may only be written by a caller that already names
    -- its own code, so nobody can insert or edit a row they do not hold.
    (
      workspace_id is null
      and (
        device_code_hash = nullif(current_setting('app.device_code_hash', true), '')
        or user_code_hash = nullif(current_setting('app.device_code_hash', true), '')
      )
    )
    or workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create unique index device_authorisations_device_idx
  on device_authorisations (device_code_hash);

create unique index device_authorisations_user_idx
  on device_authorisations (user_code_hash);
