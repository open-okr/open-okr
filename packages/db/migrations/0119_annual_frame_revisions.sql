-- Every revision of an agreed annual frame, with its reason (METHOD.md §2.1,
-- P9-T13-c-c).
--
-- **The frame may be revised mid-year now, with a written reason.** METHOD
-- v1 said the annual frame was "never rewritten mid-year"; v2 lets the annual
-- OKRs and the not-doing list be revised at a quarterly revalidation, with a
-- written reason. A frame is edited in place within its year, so without this
-- table a revision would leave nothing to say what the list was in March or
-- why it changed in June, which is NW-Q2-22's test.
--
-- **One row per revision**: which fields changed, what they held before,
-- the reason, who and when. `before` holds the previous values of the
-- changed fields only, in the shapes the frame stores them: editor JSON for
-- the prose, a list of texts for the strategies. Written only once the frame
-- is agreed; before that a frame is a draft, and drafting keeps no history.
--
-- Forward-only and safe for a rolling upgrade: a new table the previous
-- release names nowhere. The tenant policy ships in the same migration.
create table annual_frame_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  frame_id uuid not null references annual_frames(id) on delete cascade,
  fields text[] not null,
  before jsonb not null,
  reason text not null,
  author_member_id uuid references workspace_members(id) on delete set null,
  revised_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint annual_frame_revisions_reason_not_blank
    check (btrim(reason) <> ''),
  constraint annual_frame_revisions_fields_named
    check (cardinality(fields) > 0)
);

create index annual_frame_revisions_frame_idx
  on annual_frame_revisions (workspace_id, frame_id, revised_at)
  where deleted_at is null;

alter table annual_frame_revisions enable row level security;
alter table annual_frame_revisions force row level security;

create policy annual_frame_revisions_tenant on annual_frame_revisions
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
