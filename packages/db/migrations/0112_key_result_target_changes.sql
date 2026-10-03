-- Every change to a key result's target, with its reason where it eased one
-- (P9-T06b, METHOD v2 §2.9).
--
-- **The original target stays on record.** §2.9 lets a target change at any
-- time and asks a written reason only for easing it, toward its baseline, so
-- that the close can see both what was promised and what it became. Before
-- this, `goals.updateKeyResult` overwrote `key_results.target_value` and kept
-- nothing, which is the gap METHOD-REVIEW §2.9 names.
--
-- `eased` is stored rather than recomputed, because the baseline can move
-- after the change and the question the close asks is whether this change
-- eased the target when it was made. `mid_cycle` records whether the cycle's
-- plan was already published, which is what P9-T13's added-mid-cycle mark
-- and the close read.

create table key_result_target_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  key_result_id uuid not null references key_results(id) on delete cascade,
  from_value numeric not null,
  to_value numeric not null,
  -- The baseline the change was judged against, for the same reason as eased.
  baseline_value numeric not null,
  eased boolean not null,
  reason text,
  mid_cycle boolean not null default false,
  actor_member_id uuid references workspace_members(id) on delete set null,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- An easing with no reason can only come from a workspace that made the
  -- reason optional, so the column stays nullable; an empty string is never
  -- a reason.
  constraint key_result_target_changes_reason_not_blank
    check (reason is null or btrim(reason) <> '')
);

create index key_result_target_changes_key_result_idx
  on key_result_target_changes (workspace_id, key_result_id, changed_at)
  where deleted_at is null;

alter table key_result_target_changes enable row level security;
alter table key_result_target_changes force row level security;

create policy key_result_target_changes_tenant on key_result_target_changes
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
