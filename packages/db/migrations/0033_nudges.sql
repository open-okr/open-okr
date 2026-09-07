-- Nudges: every proactive message the product sends, as a row (P4-T04a).
--
-- The column list is TECHNICAL-PLAN.md §4's, not the P4-T00 design document's.
-- The two disagree: the design's §7 names the recipient `member_id`, has no
-- `kind`, no `agent_id`, no `scheduled_for` and no `acted_at`, and splits
-- suppression across two columns. TECHNICAL-PLAN.md outranks a design document
-- in CLAUDE.md's authority order, so it wins and the difference is recorded on
-- the P4-T04a STATUS row rather than resolved quietly.
--
-- CLAUDE.md makes the row itself a hard rule: "Every proactive message is a
-- recorded nudge row with a rule key, a channel, an escalation step and a
-- suppression reason when suppressed." A message the product sent and cannot
-- account for afterwards is one nobody can tune, audit or apologise for.

create table nudges (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,

  -- Which agent's remit this belongs to. AI-NATIVE-PLAN.md §6.4 splits the
  -- catalogue into exactly these two tables, and the volume dashboard reads by
  -- it: "the Champion is noisy this week" is a different finding from "the
  -- Coach is".
  kind text not null check (kind in ('rhythm', 'quality')),

  subject_type text not null
    check (subject_type in ('goal', 'check_in', 'blocker', 'kpi', 'session', 'cycle')),
  subject_id uuid not null,

  -- Cascade: a nudge to a member who no longer exists is not history worth
  -- keeping, and the subject it was about is still there.
  recipient_member_id uuid not null
    references workspace_members (id) on delete cascade,

  -- Null when the product itself produced it rather than a seeded agent. The
  -- due engine runs before either agent exists (P4-T05), and a nudge with a
  -- fabricated agent id would misattribute it forever.
  agent_id uuid references agents (id) on delete set null,

  -- Resolves to the AI-NATIVE-PLAN.md §6.4 catalogue in `packages/method`.
  -- Deliberately not an enum: the catalogue is data in the package and the
  -- conformance suite keeps the two in step. A database enum would hold the
  -- same list a second time and need a migration to add a trigger.
  rule_key text not null,

  -- `in_app`, `email`, and the chat channels from Phase 5. Text for the same
  -- reason as the rule key: the channel list is a port registry, not a schema.
  channel text not null,

  -- When it should go out. Separate from `sent_at` because quiet hours and the
  -- batching window move delivery without changing what was decided, and a
  -- single timestamp could not tell "held until morning" from "never sent".
  scheduled_for timestamptz not null,
  sent_at timestamptz,

  -- When the recipient did the thing it asked for. This is what makes a nudge
  -- measurable rather than merely countable: a rule that fires often and is
  -- never acted on is noise, and §6.3's volume work needs to see that.
  acted_at timestamptz,

  -- 0 for a trigger that does not escalate, 1 and up for a ladder position.
  -- §11's ladders widen rather than repeat, so the step is what makes a second
  -- nudge about one subject legitimate instead of duplication.
  escalation_step smallint not null default 0
    check (escalation_step >= 0),

  -- Null when it was delivered. Set when the product decided to stay quiet, and
  -- four of the five reasons are decisions rather than accidents. A product that
  -- silently drops them cannot answer "why did nobody hear about this".
  suppressed_reason text
    check (suppressed_reason in ('dedup', 'quiet_hours', 'snooze', 'disabled', 'ceiling')),
  -- A suppressed nudge is never also sent. Enforced here because both halves are
  -- meaningless without the other.
  constraint nudges_suppressed_never_sent check (
    suppressed_reason is null or sent_at is null
  ),

  snoozed_until timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table nudges enable row level security;
alter table nudges force row level security;

create policy tenant_isolation on nudges
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The deduplication read: what this member has already heard about this subject.
create index nudges_dedup_idx
  on nudges (workspace_id, recipient_member_id, subject_type, subject_id, created_at desc)
  where deleted_at is null;

-- The volume read: what fired for a member this week, and which rules are the
-- noisiest across the workspace.
create index nudges_volume_idx
  on nudges (workspace_id, rule_key, created_at desc)
  where deleted_at is null;

-- The link `notifications.nudge_id` has carried since 0013 with no target,
-- because nudges did not exist. It has one now.
alter table notifications
  add constraint notifications_nudge_id_fkey
  foreign key (nudge_id) references nudges (id) on delete set null;
