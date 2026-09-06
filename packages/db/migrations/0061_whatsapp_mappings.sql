-- Which template a nudge uses, and what fills its variables
-- (AI-NATIVE-PLAN.md §5, P5-T04b-b).
--
-- **The one decision this product makes about templates.** The words are the
-- customer's and the approval is Meta's; what an administrator chooses here is
-- which of their approved templates answers which reminder, and where each of
-- its `{{n}}` placeholders gets its value from.
--
-- **`bindings` is an ordered list, and the order is the placeholder number.**
-- The first entry fills `{{1}}`, the second `{{2}}`, and Meta refuses a send
-- whose parameter count does not match. Storing it as a list rather than a map
-- keyed on "1" is what makes that check a length comparison rather than a walk
-- looking for gaps.
--
-- **One template per rule key.** A reminder that could arrive as either of two
-- templates is a reminder nobody can predict, and the second one would only ever
-- be reached by a rule this table does not have.
create table whatsapp_template_mappings (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- The trigger this answers, from AI-NATIVE-PLAN §6.4's catalogue. Text for
  -- the same reason `nudges.rule_key` is: the catalogue is data in
  -- `packages/method` and a database enum would hold the same list twice.
  rule_key text not null,
  -- Cascade: a mapping to a template row that has gone is a mapping to nothing.
  -- The template row itself is only ever soft-deleted, so this fires when a
  -- workspace is removed rather than when Meta withdraws a template.
  template_id uuid not null
    references whatsapp_templates (id) on delete cascade,
  -- One source name per placeholder, in placeholder order. The vocabulary is
  -- `packages/core`'s and is checked when the mapping is saved.
  bindings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table whatsapp_template_mappings enable row level security;
alter table whatsapp_template_mappings force row level security;

create policy tenant_isolation on whatsapp_template_mappings
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create unique index whatsapp_template_mappings_rule_idx
  on whatsapp_template_mappings (workspace_id, rule_key)
  where deleted_at is null;

-- When this member last wrote to us, per provider.
--
-- **This is what a conversation window is measured from.** WhatsApp will carry a
-- free-form message only within twenty-four hours of the member's own last
-- message; outside that, an approved template or nothing. Nothing else in the
-- product needs it, and it is on the identity rather than in its own table
-- because it is one moment per member per provider and that is exactly what an
-- identity is.
--
-- Null means they have never written, which is outside every window.
alter table channel_identities
  add column last_inbound_at timestamptz;
