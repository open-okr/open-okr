-- The approved templates one workspace has at Meta (AI-NATIVE-PLAN.md §5,
-- P5-T04b-a).
--
-- **Synchronised, not declared.** A WhatsApp template is registered and approved
-- inside one customer's own Meta Business account: the words are theirs, the
-- approval is Meta's, and two workspaces cannot share one. So no document in
-- this repository can name them. What the product does instead is ask Meta what
-- this workspace has and record the answer, which is what these rows are.
--
-- Design C3 said the opposite, and is corrected in the design document with the
-- reasoning: it read a template as coaching copy that METHOD.md §11 would own,
-- and §11 is the threshold registry, which holds numbers.
--
-- **A mirror, so it is safe to replace wholesale.** Nothing here is authored in
-- this product and nothing is lost by re-syncing: a template Meta no longer
-- lists is soft-deleted rather than kept, so it stops being offered without the
-- mapping that referred to it losing its own history.
--
-- **`variables` is read from the body, not guessed.** Meta writes a template
-- body with `{{1}}`, `{{2}}` and so on, and a send that supplies the wrong
-- number of parameters is refused. Counting them at sync time is what lets the
-- mapping screen refuse a bad binding when it is saved rather than when a nudge
-- is due at seven in the morning.
create table whatsapp_templates (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Meta's own id for the template. Kept because a name can be reused after a
  -- deletion and the id cannot.
  meta_id text not null,
  -- The name a send refers to, which is what the Cloud API takes.
  name text not null,
  -- Meta requires one on every send, and the same name can exist in several.
  language text not null,
  -- `APPROVED`, `PENDING`, `REJECTED`, `PAUSED`, `DISABLED`. Meta's own words,
  -- kept as text: this is a mirror of their vocabulary and an enum here would
  -- need a migration every time they add one.
  status text not null,
  -- `UTILITY`, `MARKETING`, `AUTHENTICATION`. Shown so an administrator can see
  -- at a glance which of their templates are the ones a reminder may use.
  category text,
  -- The body as Meta holds it, placeholders and all, so the settings screen can
  -- show what will actually arrive.
  body_text text,
  -- How many `{{n}}` placeholders the body has. Counted at sync time from the
  -- body itself.
  variables integer not null default 0,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table whatsapp_templates enable row level security;
alter table whatsapp_templates force row level security;

create policy tenant_isolation on whatsapp_templates
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- One row per template per workspace. Not partial on `deleted_at`: a template
-- Meta removed and then restored is the same template, and a second live row
-- would make "which one does the mapping mean" a question with two answers.
create unique index whatsapp_templates_meta_idx
  on whatsapp_templates (workspace_id, meta_id);

create index whatsapp_templates_name_idx
  on whatsapp_templates (workspace_id, name)
  where deleted_at is null;
