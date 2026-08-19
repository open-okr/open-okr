-- Per-rule nudge configuration, and workspace quiet mode (P4-T04b).
--
-- TECHNICAL-PLAN.md §4 line 221. One row per rule a workspace has changed its
-- mind about; the absence of a row is the canon default, which is what §4.14
-- means by "every setting has a working default and nothing must be configured
-- before the product works". A fresh workspace has no rows here and every rule
-- in the AI-NATIVE-PLAN.md §6.4 catalogue is enabled on the member's primary
-- channel with the canon ladder.
--
-- Not seeded with forty-four rows. Seeding them would make the table the
-- catalogue's second home, and then adding a trigger to the package would need
-- a data change in every workspace before it could ever fire.

create table nudge_rules (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,

  -- Resolves to the §6.4 catalogue. Text rather than an enum, for the same
  -- reason `nudges.rule_key` is: the catalogue is data in `packages/method`.
  rule_key text not null,

  enabled boolean not null default true,

  -- Overrides the member's primary channel for this rule only. Null means the
  -- member's own choice stands, which is the default and the respectful answer.
  channel_override text,

  -- A workspace ladder for this rule, replacing §11's. Null is the canon
  -- ladder, and that is what almost every workspace should leave it at: §11
  -- carries the argument for each number beside it.
  escalation_ladder jsonb,

  -- Whether this rule still speaks while workspace quiet mode is on. §6.3 puts
  -- escalations through quiet mode; this is how a workspace names which others
  -- also earn that.
  quiet_mode_exempt boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- One row per rule per workspace. Two rows would let a workspace disagree
  -- with itself and make the read order-dependent.
  constraint nudge_rules_unique_per_workspace unique (workspace_id, rule_key)
);

alter table nudge_rules enable row level security;
alter table nudge_rules force row level security;

create policy tenant_isolation on nudge_rules
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- Workspace quiet mode: everything silent except escalations and whatever a
-- rule is explicitly exempted for. On `rhythm_settings` rather than a table of
-- its own, because it is one boolean about the workspace's rhythm and it is
-- read on the same query that resolves the thresholds.
alter table rhythm_settings
  add column quiet_mode boolean not null default false;
