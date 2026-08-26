-- Learnings, next-cycle drafts, decisions and actions (DATABASE.md §11,
-- METHOD.md §8.9 and §8.1 stage 11, P4-T11c-b).
--
-- Stage ten turns what happened into what the team now knows, and drafts what
-- the next cycle might carry. Stage eleven gives every action a name and a date.

-- openokr:soft-delete: a learning is history the next cycle's pack reads.
create table learnings (
  id            uuid        primary key,
  workspace_id  uuid        not null references workspaces (id) on delete cascade,
  -- Nullable, because a learning can be captured outside a review. Every
  -- learning belongs to a cycle; not every one comes out of a session.
  session_id    uuid        references okr_sessions (id) on delete set null,
  cycle_id      uuid        not null references cycles (id) on delete cascade,
  -- §8.9: capture learnings as "we learned that...". The phrasing is guidance
  -- for humans rather than a format to enforce, so this is free text.
  text          text        not null,
  -- §8.9: "Mark the ones to carry forward." Carried work re-enters the next
  -- cycle as an issue and has to survive prioritisation on its merits.
  carry_forward boolean     not null default false,
  source        text        not null default 'manual',
  -- Set when this learning was promoted from a retro note, so the minutes can
  -- show where it came from and the same note cannot be promoted twice.
  retro_note_id uuid        references retro_notes (id) on delete set null,
  created_by_id uuid        not null references workspace_members (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint learnings_source
    check (source in ('manual', 'retro_theme', 'coach')),
  constraint learnings_text_present check (length(btrim(text)) > 0),
  -- A retro-promoted learning names the note it came from, and a manual one
  -- cannot claim to have come from one.
  constraint learnings_retro_source
    check (
      (source = 'retro_theme' and retro_note_id is not null)
      or (source <> 'retro_theme' and retro_note_id is null)
    )
);

-- One learning per promoted note. §8.9 promotes the top themes, and promoting
-- the same note twice would double a theme's weight in the next cycle.
create unique index learnings_one_per_retro_note_idx
  on learnings (workspace_id, retro_note_id)
  where deleted_at is null and retro_note_id is not null;

create index learnings_cycle_idx
  on learnings (workspace_id, cycle_id)
  where deleted_at is null;

alter table learnings enable row level security;
alter table learnings force row level security;

create policy learnings_tenant on learnings
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- openokr:soft-delete: a discarded draft should read as discarded.
create table next_cycle_drafts (
  id                  uuid        primary key,
  workspace_id        uuid        not null references workspaces (id) on delete cascade,
  session_id          uuid        not null references okr_sessions (id) on delete cascade,
  title               text        not null,
  why                 text        not null,
  -- Set when the draft became a real objective in a later cycle. §8.9's rule is
  -- that carried work re-enters as an issue and earns its place, so a draft is
  -- a candidate rather than a commitment.
  promoted_to_goal_id uuid        references goals (id) on delete set null,
  created_by_id       uuid        not null references workspace_members (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  constraint next_cycle_drafts_title_present check (length(btrim(title)) > 0),
  -- METHOD.md §1's habit: a draft with no reason behind it is a title somebody
  -- liked, and the next cycle cannot prioritise it.
  constraint next_cycle_drafts_why_present check (length(btrim(why)) > 0)
);

create index next_cycle_drafts_session_idx
  on next_cycle_drafts (workspace_id, session_id)
  where deleted_at is null;

alter table next_cycle_drafts enable row level security;
alter table next_cycle_drafts force row level security;

create policy next_cycle_drafts_tenant on next_cycle_drafts
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- openokr:soft-delete: the actions are the review's outstanding obligations.
create table review_actions (
  id            uuid        primary key,
  workspace_id  uuid        not null references workspaces (id) on delete cascade,
  session_id    uuid        not null references okr_sessions (id) on delete cascade,
  what          text        not null,
  -- **Both required, and that is a correction to TECHNICAL-PLAN §4.** That row
  -- had `owner_id?` and `due_on?` optional while METHOD.md §8.1 stage 11 says
  -- "Every action has a name and a date, or it is a wish". The canon is
  -- unambiguous and the task's own test plan asks for the refusal, so the
  -- columns are not null and the plan row is corrected in this change.
  owner_id      uuid        not null references workspace_members (id),
  due_on        date        not null,
  done          boolean     not null default false,
  created_by_id uuid        not null references workspace_members (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint review_actions_what_present check (length(btrim(what)) > 0)
);

create index review_actions_session_idx
  on review_actions (workspace_id, session_id)
  where deleted_at is null;

create index review_actions_owner_idx
  on review_actions (workspace_id, owner_id, due_on)
  where deleted_at is null and done = false;

alter table review_actions enable row level security;
alter table review_actions force row level security;

create policy review_actions_tenant on review_actions
  using      (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
