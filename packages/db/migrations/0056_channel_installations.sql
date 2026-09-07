-- Which OpenOKR workspace a provider's own workspace maps to (P5-T02a).
--
-- **The problem this table exists to solve.** An inbound webhook has not
-- identified a workspace yet: finding out which one it is *is* the question.
-- Every business table carries `workspace_id` and a policy keyed on
-- `app.workspace_id`, so a lookup with nothing to set that to reads nothing at
-- all. The first version of the inbound endpoint asked
-- `channel_connections` for this and could never have worked; a test caught it
-- on 27 August 2026 before it shipped.
--
-- **The tenant floor is kept, and a second key is added beside it.** The policy
-- below admits a row two ways: the ordinary tenant setting, and
-- `app.channel_team_id` matching this row's own `external_team_id`. That is the
-- same shape `app.user_id` already has on `workspace_members`, where the
-- membership lookup answers "which workspaces are mine" before a workspace is
-- known. A caller can only see the row for a team id they already hold, so the
-- exposure is "is this provider workspace installed here", answered to somebody
-- who already named it.
--
-- Unique on `(provider, external_team_id)`: one Slack workspace installs into
-- one OpenOKR workspace. Two would make an inbound message ambiguous, and the
-- product cannot ask Slack which one it meant.

-- openokr:hard-delete: an installation is a routing fact, not a record of anything that happened. Disconnecting removes the route, and a soft-deleted row would keep the unique index occupied, so the same Slack workspace could never be reconnected.
create table channel_installations (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  provider text not null
    check (provider in ('slack', 'teams', 'whatsapp', 'telegram')),
  -- The provider's own workspace, tenant or account identifier. Opaque, not
  -- secret, and never a person.
  external_team_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table channel_installations enable row level security;
alter table channel_installations force row level security;

create policy tenant_isolation on channel_installations
  using (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    or external_team_id = nullif(current_setting('app.channel_team_id', true), '')
  )
  with check (
    workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
  );

create unique index channel_installations_team_idx
  on channel_installations (provider, external_team_id);

create index channel_installations_workspace_idx
  on channel_installations (workspace_id, provider);
