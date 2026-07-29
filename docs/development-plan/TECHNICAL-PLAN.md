# TECHNICAL-PLAN.md

Target technical design for `OpenOKR`. This turns REQUIREMENTS.md (what) and PLAN.md (principles) into concrete schema, module, engine, importer and security decisions. IMPLEMENTATION-PLAN.md turns this into ordered tasks.

Authority: below PLAN.md, above IMPLEMENTATION-PLAN.md. When this doc and PLAN.md disagree, PLAN.md wins. When code and this doc diverge during a task, update this doc in the same PR.

Cross-references: the FlowyTeam source facts live in `reference/flowyteam-okr-kpi-tasks-model.md`. The Operately behavioral benchmark is OPERATELY-COMPARISON.md / OPERATELY-GAP-REGISTER.md; where this doc says "reference behavior: Operately", the engine or flow reproduces Operately's *observable* semantics (clean-room, §11). The archived OpenProject references (`reference/legacy-*.md`) are background only — nothing in this plan depends on them.

---

## 1. Stack and layout (from PLAN.md, restated as the contract)

- **Runtime:** Next.js App Router (React, TypeScript strict). Server Components for first-paint shells and read-mostly pages; client-owned data (TanStack Query hydrated from route loaders) for every interactive list/board/map surface. The exact boundary per surface is §13.3.
- **API:** one **action/contract registry** in `packages/core` (§14). tRPC exposes it to the app UI; a versioned REST surface (`/api/v1`) + OpenAPI 3.1, the MCP tool catalog, and the generated CLI are projections of the same registry. CI diffs the generated artifacts (§10).
- **Data:** PostgreSQL via Drizzle only. `DATABASE_URL` is the sole connection. RLS on every business table (§8.1). Forward-only migrations + a separate data-change runner (§8.2).
- **Auth:** Better Auth (email+password, passkeys, TOTP from Phase 1; OIDC/SAML in Phase 7). No hand-rolled sessions. Session tokens hashed at rest.
- **UI:** Tailwind + shadcn/ui on **Base UI** primitives (not Radix), **SmoothUI** on **Motion**, TanStack Query/Table/Virtual. Design system in `packages/ui`.
- **Rich text:** ProseMirror/TipTap **JSON is canonical** (jsonb + `version int`). One shared core module (`packages/core/rich-text`) owns parse, structural validation (node/mark allowlist via Zod), sanitizing render-to-HTML, excerpting, and mention/attachment ID extraction — used identically by app, email, exports, search indexing and the importer's reference-rewrite pass. Markdown is a derived, lossy bridge (import/export/AI authoring) with round-trip golden tests.
- **Validation:** Zod at every boundary.
- **Adapters:** `packages/adapters` for jobs, realtime, storage, mailer, cache, search, ai. v1 ships container drivers; serverless drivers are designed-for stubs (PLAN.md §5).
- **Monorepo:** Turborepo + pnpm. Packages: `core`, `db`, `adapters`, `importer`, `ui`, `config`, `test-support`; app in `apps/web`.

### Package responsibilities

| Package | Owns | May depend on |
|---|---|---|
| `packages/db` | Drizzle schema, migrations, RLS policies, seed, data-change runner, soft-delete scope | nothing app-specific |
| `packages/core` | Domain services, the Operation pipeline, the action/contract registry, `can()` + access-aware getter, pure engines (scoring, cadence, KPI formulas), rich-text core, typed activity/event registry | `db` |
| `packages/adapters` | Ports + drivers (only place vendor SDKs live), the outbox relay | `config` |
| `packages/importer` | FlowyTeam (read-only MySQL) + CSV/XLSX readers, mappers, CLI | `db` (write), read-only source clients |
| `packages/ui` | Shared shadcn components | — |
| `packages/test-support` | The factory (builds through core services), test DB harness | `core`, `db` |
| `apps/web` | Next.js routes, tRPC/REST/MCP endpoints, React UI | `core`, `adapters`, `ui`, `db` (types) |

## 2. Multi-tenancy and identity model

- Top-level tenant is a **workspace**. Every business row carries `workspace_id` and an RLS policy keyed on the `app.workspace_id` GUC, set with `SET LOCAL` per transaction by the request-scoped Drizzle wrapper (never session-level, never from client input). §8.1 has the full discipline.
- **Identity is two-level.** `users` is global to a deployment (email + credentials; Better Auth owns them). `workspace_members` is the per-workspace person: display name, title, avatar, timezone, `manager_id` (self-reference, cycle-safe), `kind` (`human` / `guest` / `ai` / `placeholder`), `status` (`active` / `invited` / `suspended`), `suspended_at`. The same login is a different member per workspace; the app shell has a workspace switcher. All authorship, mentions, assignments and audit reference the *member*, so leaving or being suspended never breaks history.
- Within a workspace: **spaces** are the team homes; **access** is relationship-based (§4.1); **RLS** is the tenant floor. Never rely on the UI to hide anything.

## 3. Naming and ID strategy

- Primary keys are `uuid` v7 (time-ordered, app-generated) — good for index locality and deterministic importer ID assignment.
- **Public identifiers are separate.** Externally addressable aggregates (goals, projects, work items, documents, discussions, KPIs) carry a `short_id` — a random base58 string, unique per workspace — used in URLs, the REST API, MCP tools and the CLI. Internal v7 PKs (which embed a timestamp) are never exposed. A malformed or unknown public id returns **404**, never 400, so the id format is not an oracle.
- Importable tables carry `legacy_id bigint?` + `legacy_type text?` (`flowyteam` / `csv`), unique `(workspace_id, legacy_type, legacy_id)` for idempotent upserts.
- Enumerated values are TypeScript string unions persisted as `text` with a CHECK constraint.
- Soft delete: `deleted_at timestamptz?` where deletion must be reversible; the repo-wide default scope injects `deleted_at IS NULL` (explicit `withDeleted()` opt-in; CI lint).

## 4. Target domain model (new schema, by module)

Tables listed with the columns that matter. All get `id uuid pk`, `workspace_id`, `created_at`, `updated_at`, an RLS policy in the same migration, and (where noted importable) `legacy_id`/`legacy_type` — plus `short_id` on the externally addressable aggregates above. "Rich" columns are ProseMirror JSON + `version int`. The consolidated view of everything below is DATABASE.md (derived; this section is the authority).

### 4.1 Identity & access (the relationship model)

Reference behavior: Operately's access engine (contexts / bindings / groups), which this reproduces with cleaner naming and a single enforcement point.

| Table | Key columns | Notes |
|---|---|---|
| `workspaces` | `name`, `slug`, `state` (`active`/`read_only`/`frozen`), `settings jsonb` (brand, trusted_email_domains, cadence defaults) | tenant root |
| `users` | `email` (unique), auth linkage | global; Better Auth owns credentials, sessions (hashed), passkeys, TOTP |
| `workspace_members` | `user_id?`, `name`, `title?`, `avatar_blob_id?`, `timezone?`, `manager_id?` (→ members), `kind` (`human`/`guest`/`ai`/`placeholder`), `status`, `suspended_at?`, `bio` (rich) | the per-workspace person; `user_id` null for placeholders/agents pre-claim |
| `access_contexts` | `resource_type`, `resource_id` | one per protected aggregate (space, goal, project, resource hub, discussion) |
| `access_groups` | `kind` (`member`/`workspace_standard`/`space_standard`/`anonymous`), `member_id?`, `space_id?` | principals: one per member, one standard per workspace, one per space, one anonymous |
| `access_group_memberships` | `group_id`, `member_id` | who is in a group (standard groups maintained by membership ops) |
| `access_bindings` | `group_id`, `context_id`, `level` (`view`=10 / `comment`=40 / `edit`=70 / `full`=100), `tag?` (`champion`/`reviewer`) | the grant. Effective access = max over reachable bindings |
| `invite_links` | `token_hash`, `mode` (`workspace`/`personal`), `member_id?`, `allowed_domains text[]?`, `use_count`, `max_uses?`, `expires_at?`, `revoked_at?` | reusable + single-use invites |
| `audit_events` | `actor_member_id?`, `action`, `target_type`, `target_id`, `payload jsonb` (typed per action), `at`, `prev_hash`, `row_hash` | append-only (no UPDATE/DELETE grants), written in-transaction, per-workspace hash chain |
| `outbox` | `topic`, `payload jsonb`, `idempotency_key`, `created_at`, `delivered_at?`, `attempts` | the transactional side-effect queue (§5) |
| `system_settings` | singleton: email config (encrypted secrets), instance flags | AES-GCM envelope; admin-editable; env is bootstrap/override |

Rules that make this real:

- **Derived privacy.** A resource's privacy label (`public` / `workspace` / `space` / `invite-only`) is computed from which group tiers hold a binding on its context — never a stored boolean. The access editor exposes three levers (public / everyone in the workspace / members only).
- **One read chokepoint.** Every read of an access-controlled aggregate goes through the core getter, which joins member → groups → bindings → context, takes `max(level)`, excludes `suspended_at IS NOT NULL`, and returns **not-found on forbidden**. List queries use the matching composable filter. A CI lint fails raw selects on protected tables outside the helper.
- **Sub-resources inherit.** Comments, check-ins, reactions, files, activities resolve authorization through a single `(subject_type, subject_id) → owning context` resolver with an exhaustive, fail-closed subject enumeration. New subject types cannot silently ship unsecured.
- **Champion/reviewer are tagged bindings**, so reassignment finds and rebinds exactly the right grants atomically inside the Operation.
- **Freeze overlay.** When `workspaces.state != active`, the permission layer collapses everything to view-only except an admin recovery whitelist.

### 4.2 Spaces

| Table | Key columns | Notes |
|---|---|---|
| `spaces` | `name`, `mission?`, `settings jsonb` | team homes; each owns an access context + a space-standard group |
| `space_members` | `space_id`, `member_id`, `role` (`member`/`manager`) | manager implies the space `full` binding |

Maps FlowyTeam `teams` (tree flattened; sub-teams become sibling spaces with a naming convention — recorded in the import report).

### 4.3 Strategy: cycles, goals, key results, check-ins

#### Cycles & settings

| Table | Key columns | Notes |
|---|---|---|
| `okr_cycles` | `name`, `cadence` (`annual`/`semiannual`/`quarterly`/`monthly`), `starts_on`, `ends_on`, `status` (`upcoming`/`active`/`closed`), `previous_cycle_id?` | generated forward from the cadence; archive job on close |
| `strategy_settings` | one row per workspace: `default_check_in_frequency` (`weekly`/`biweekly`/`monthly`), `check_in_anchor_day` (default Friday), `staleness_grace_days` (default 3), `rag_fail_pct` (50), `rag_pass_pct` (75), `max_goals_per_owner?`, `labels jsonb` | the rhythm + thresholds + house terminology |

#### Goals & key results

| Table | Key columns | Notes |
|---|---|---|
| `goals` | `title`, `description` (rich), `cycle_id?`, `timeframe jsonb?` (contextual: `{start, end, granularity: day\|month\|quarter\|year, label}` — defaults to cycle bounds), `owner` (`workspace`/`space`/`member` + `space_id?`/`member_id?`), `champion_id` (→ members, required), `reviewer_id` (→ members, required), `parent_goal_id?`, `parent_key_result_id?` (alignment: at most one set; cycles prevented), `weight numeric` (1–100), `check_in_frequency`, `next_check_in_at timestamptz` (never null while open), `last_check_in_id?`, `closed_at?`, `closed_by_id?`, `success_status?` (`achieved`/`missed`), `progress_pct numeric` (derived), `health` (derived; see §6.1), `position` | importable (flowyteam objectives). AI provenance: `ai_generated bool`, `ai_source_id?` |
| `key_results` | `goal_id`, `title`, `unit`, `direction` (`increase`/`decrease`), `initial_value numeric`, `target_value numeric`, `current_value numeric`, `progress_pct` (derived, capped 0–100), `weight numeric`, `kpi_id?` (KPI-backed KR reads the KPI's latest achievement), `position` | importable |
| `key_result_values` | `key_result_id`, `value numeric`, `at`, `author_member_id`, `check_in_id?` | full value history; drives sparklines + trend forecasting |
| `check_ins` | `goal_id`, `author_member_id`, `state` (`draft`/`published`), `published_at?`, `status` (`on_track`/`caution`/`off_track`), `confidence smallint?` (0–10), `narrative` (rich, required to publish), `snapshot jsonb` (immutable: every KR `{id, value, previous_value, progress_pct}` + checklist state at publish), `acknowledged_by_id?`, `acknowledged_at?` | drafts emit no activity/notification and do not advance the cadence; publish stamps the snapshot, advances `next_check_in_at`, sets `last_check_in_id`; edits allowed within a window (latest check-in, ≤3 days) and re-snapshot; delete rolls the goal pointers back |
| `goal_retrospectives` | `goal_id`, `body` (rich), `author_member_id` | created at close; editable; reopening keeps it |

Alignment integrity: a goal sets exactly one of `parent_goal_id` / `parent_key_result_id` (or neither). Discussions on goals use the §4.7 `discussions` object; watchers use §4.7 subscriptions.

#### Review inbox (assignments)

No table — a computed query in core: for member M, union of (goals/projects where M is champion and `next_check_in_at` ≤ horizon or overdue), (published check-ins awaiting M's acknowledgement as reviewer, respecting reviewer-change history via the binding tag's `granted_at`), (work items assigned to M due/overdue), (milestones M champions due). Ranked overdue → due-today → due-soon; served by one endpoint; badge count cached and invalidated by the relevant Operations.

### 4.4 KPIs & scorecard

| Table | Key columns | Notes |
|---|---|---|
| `kpi_categories` | `name` | maps FlowyTeam `indicator_types` |
| `kpis` | `category_id`, `title`, `description` (rich), `owner` (as goals), `frequency` (`daily`/`weekly`/`monthly`/`quarterly`/`yearly`), `unit`, `direction` (`higher_better`/`lower_better`), `target_default numeric?`, `aggregate` (`sum`/`avg`/`max`/`min`/`count`), `is_calculated bool`, `formula jsonb?` (typed expression tree, no eval), `rag_fail_pct`, `rag_pass_pct`, `parent_kpi_id?`, `starts_on?`, `ends_on?` | importable (`indicators`) |
| `kpi_records` | `kpi_id`, `period_start date` (normalized bucket), `target_value?`, `actual_value?`, `remark?`, `author_member_id` | unique `(workspace_id, kpi_id, period_start)` |
| `kpi_dependencies` | `kpi_id`, `depends_on_kpi_id` | formula edges; drives cascade recompute (cycle-checked) |
| `key_result_kpis` | (folded into `key_results.kpi_id` — one KPI measures one KR; the many-to-many variant is a §12 open item) | |
| `kpi_shares` | `kpi_id`, `member_id`, `access` (`read`/`update`) | maps `indicator_accesses`; broader scoping via normal bindings |
| `performance_snapshots` | `owner…`, `cycle_id`, `result_value`, per-bucket goal/KR counts | recomputed by the archive job; never trusted from import |
| `scorecard_settings` / `score_entries` | as before; **points off by default**, human-gated | importable if funded |

### 4.5 Execution: projects, milestones, work items, boards

Reference behavior: Operately's project lifecycle, check-in and milestone semantics.

| Table | Key columns | Notes |
|---|---|---|
| `projects` | `space_id`, `name`, `description` (rich), `goal_id?` (the goal this project serves), `state` (`active`/`paused`/`closed`), `paused_at?`, `closed_at?`, `success_status?` (`achieved`/`missed`), `check_in_frequency`, `next_check_in_at`, `last_check_in_id?`, `health` (derived), `next_step` (derived: earliest-due open milestone; tie-break by position) | importable (flowyteam projects, csv) |
| `project_contributors` | `project_id`, `member_id`, `role` (`champion`/`reviewer`/`contributor`), `responsibility?` | champion/reviewer unique per project; kept in lockstep with tagged bindings; person-swap downgrades the outgoing holder to contributor |
| `project_check_ins` | same shape as `check_ins` minus KR snapshot: `state`, `status` (`on_track`/`caution`/`off_track`), `narrative` (rich), `snapshot jsonb` (milestone states at publish), `acknowledged_by_id?/_at?` | pausing a project suspends the cadence; resuming reschedules it |
| `project_retrospectives` | `project_id`, `body` (rich), `author_member_id` | required at close |
| `milestones` | `project_id`, `title`, `description?` (rich), `timeframe jsonb` (contextual), `status` (`open`/`done`), `completed_at?`, `position`, `ordering_state jsonb` (kanban column order, normalized against deleted/closed items, row-locked on write) | comments may carry a `complete`/`reopen` action |
| `work_items` | `project_id`, `milestone_id?`, `title`, `description` (rich), `status` (`todo`/`in_progress`/`done`/`canceled`), `due jsonb?` (contextual), `key_result_id?`, `goal_id?`, `kpi_id?`, `position` | importable (flowyteam tasks). The strategy join: closing linked work moves the KR/goal |
| `work_item_assignees` | `work_item_id`, `member_id` | **multi-assignee**; assignment grants edit access via the member's group |
| `checklist_items` | `work_item_id`, `title`, `assignee_id?`, `done`, `position` | maps `sub_tasks`; no rollup |
| `work_item_relations` | `from_id`, `to_id`, `kind` (`blocks`) | minimal v1; cannot-complete-while-blocked guard |
| `reminders` | `work_item_id`, `member_id`, `kind` (`on_date`/`before_due`/`on_due`/`overdue`), `offset_days?`, `remind_at?` | relative kinds require a due date; auto-stripped if due removed |
| `time_entries` | `work_item_id?`, `project_id`, `member_id`, `hours`, `spent_on`, `comment?` | **import-preservation only in v1** (read-only display); tracking UI is post-v1 |

Boards are views over `work_items` grouped by status per milestone/project — no separate board tables in v1; `ordering_state` on the milestone (and a project-level equivalent in `projects.settings`) holds manual order.

### 4.6 Resource Hub

| Table | Key columns | Notes |
|---|---|---|
| `resource_hubs` | `owner_type` (`space`/`project`/`goal`), `owner_id`, `name` | each owner gets a default hub; hub inherits the owner's access context |
| `resource_nodes` | `hub_id`, `parent_id?` (folder tree), `type` (`document`/`folder`/`file`/`link`), `name`, `position` | breadcrumbs via recursive CTE; deep copy/move are transactional |
| `documents` | `node_id`, `body` (rich), `state` (`draft`/`published`), `published_at?`, `author_member_id` | drafts author-private (enforced in the getter's SQL, excluded from counts); publish emits the activity; version history + visual diff via the rich-text `version` + activities |
| `files` | `node_id`, `blob_id`, `preview_blob_id?`, `width?`, `height?` | previews generated by a job |
| `links` | `node_id`, `url`, `provider` (`google_doc`/`google_sheet`/`google_slides`/`figma`/`notion`/`airtable`/`dropbox`/`other`), `description?` (rich), `preview jsonb?` | metadata enrichment via an SSRF-safe fetcher (egress allow-list, resolved-address checks, no redirects, size/time caps) |

### 4.7 Collaboration: discussions, comments, reactions, subscriptions

One subscription model beneath everything (reference behavior: Operately's subscription lists, with its three overlapping thread shapes unified into one).

| Table | Key columns | Notes |
|---|---|---|
| `discussions` | `space_id?` or (`subject_type`,`subject_id`) anchor, `title`, `body` (rich), `author_member_id`, `state` (`draft`/`published`), `published_at?` | space-scoped = message board / announcements; anchored = goal/project discussions. Drafts silent |
| `comments` | `subject_type`, `subject_id` (work_item / milestone / check_in / project_check_in / discussion / document / file / link / goal / retrospective), `author_member_id`, `body` (rich), `edited_at?`, `action?` (`complete_milestone`/`reopen_milestone`) | deep-linkable (`#comment-<short_id>`); edit history via activities |
| `reactions` | `subject_type`, `subject_id`, `member_id`, `emoji` | on all major subjects, not just comments |
| `subscription_lists` | `subject_type`, `subject_id`, `send_to_everyone bool` | one per notifiable artifact |
| `subscriptions` | `list_id`, `member_id`, `reason` (`invited`/`joined`/`mentioned`), `canceled bool` | unique (list, member); authors auto-`joined`; mentions auto-`mentioned`; edits re-diff mentions and cancel only stale `mentioned` rows; suspended/placeholder/`ai` members excluded at the join |

Mention extraction is decode-safe (malformed content yields `[]`, never an error) and shared with the importer's reference-rewrite pass.

### 4.8 Feed, notifications, audit

Two systems, deliberately separate: the **typed social activity feed** and the **append-only audit log** (§4.1).

| Table | Key columns | Notes |
|---|---|---|
| `activities` | `kind` (typed catalog: `goal.created`, `goal.checked_in`, `goal.closed`, `check_in.acknowledged`, `project.paused`, `milestone.completed`, `member.joined`, `document.published`, …), `payload jsonb` (Zod-validated per kind, snapshots human labels at write), `actor_member_id`, `subject_type`, `subject_id`, `space_id?`, `context_id` (access scope — set by an exhaustive resolver that fails closed), `at` | written in the mutating transaction; feeds (company/space/goal/project/profile) filter by the requester's access to `context_id`, hide soft-deleted subjects, keyset-paginate, and aggregate consecutive same-actor/same-day edits; live via Realtime |
| `notifications` | `recipient_member_id`, `activity_id`, `reason`, `read_at?`, `should_send_email bool`, `email_batch_id?`, `email_sent_at?` | recipients resolved from subscriptions + assignment/mention/review reasons, **access-checked at send time**, author excluded |
| `notification_email_batches` | `member_id`, `status` (`scheduled`/`sending`/`sent`/`failed`/`skipped`), `window_minutes`, `send_at`, `sent_at?`, `error?` | per-user coalescing; find-or-create under a row lock (no duplicate batches under bursts); idempotent worker |
| `notification_settings` | `member_id`, per-reason channel routing, `mention_immediate bool`, `email_window_minutes`, `send_daily_summary bool`, `daily_summary_time` | daily summary scheduled in the member's own timezone (validated against `pg_timezone_names`, UTC fallback, DST-correct) |

Email rendering: a per-reason registry rendering HTML + plain text + a one-line digest variant, with a dev-only preview page enumerating every reason × (single/digest) × (html/text). A daily "your work today" assignments email (due/overdue/needs-review; suppressed when empty; reminders-only on non-working days).

### 4.9 Attachments & blobs

| Table | Key columns | Notes |
|---|---|---|
| `blobs` | `filename`, `content_type`, `filesize`, `digest`, `storage_key`, `author_member_id`, `status` (`ok`/`scanning`/`quarantined`), `width?`, `height?` | bytes behind the FileStorage adapter; prepare → upload → claim on save; orphan cleanup job; inline editor blobs use optimistic placeholders with progress, submit-gating and delete-on-failure |
| storage accounting | per-workspace running byte total in `workspaces.settings` + a quota and a once-at-90% warning | enforced on upload-finish |

### 4.10 Importer & portability

| Table | Key columns | Notes |
|---|---|---|
| `import_runs` | `source` (`flowyteam`/`csv`), `mode` (`dry_run`/`real`), `status`, `report jsonb`, `started_at`, `finished_at?` | every run persisted, including failures |
| `export_runs` / `workspace_imports` | archive manifest, checksum, status, progress | the §7.3 portability engine |

### 4.11 AI + MCP domain

Specified at this document's level of detail in **AI-NATIVE-PLAN.md §7** (DATABASE.md domain M/N): providers, encrypted credentials, model catalog + tier policies, feature settings, versioned prompts, copilot threads/messages, tool-call + usage/cost events, embeddings (pgvector), **agents + agent_runs**, and the **MCP OAuth tables** (clients, grants, codes, access/refresh tokens with lineage, sessions). All follow §3 conventions; none carries legacy provenance. `ai_credentials` and all token hashes are never selected to the client.

## 5. Adapter ports (concrete interfaces)

| Port | Methods (sketch) | v1 driver | Post-v1 (designed) |
|---|---|---|---|
| JobQueue | `enqueue(name, payload, opts)` **via outbox only**, `schedule(cron)` | pg-boss | Inngest |
| Realtime | `publish(channel, event)` (typed registry; compact id+version payloads; 8 KB guard), `subscribe(channel)` | WS + LISTEN/NOTIFY | Supabase Realtime |
| FileStorage | `put`, `get`, `signedUrl`, `delete` | local/MinIO | S3/R2 |
| Mailer | `send(message)` | SMTP (DB-stored encrypted settings) | Resend |
| Cache | `get`, `set`, `incr`, `rateLimit` | in-proc + Postgres | Upstash |
| Search | `index`, `query` | Postgres FTS | Postgres FTS |
| AIProvider | `chat`, `stream`, `chatWithTools`, `embed`, `extract`, `capabilities` | per AI-NATIVE-PLAN §3 | same |

**The outbox contract (load-bearing):** the only legal enqueue inside a write is `outbox.insert(topic, payload, idempotencyKey)` in the caller's transaction. The relay (a pg-boss worker in v1) drains committed rows to the real driver at-least-once; consumers are idempotent. Direct driver calls on a write path fail CI. This is what keeps write + audit + notify atomic on every current and future driver.

## 6. The pure engines (highest-risk cores)

Pure, DB-free function sets in `packages/core`, golden-master tested. Derived columns are recomputed by jobs on write (via the outbox), never per-row at render.

### 6.1 The goal health & scoring engine

Reference behavior: Operately's status cascade + FlowyTeam's weighted scoring. Golden-master matrix written and human-approved at P3-T00.

1. **KR progress** — direction-aware linear interpolation, clamped 0–100. `increase`: `(current−initial)/(target−initial)`; `decrease`: `(initial−current)/(initial−target)`; equal endpoints → 0. KPI-backed KRs read the KPI's latest achievement.
2. **Goal progress** — weighted average of its KRs' clamped progress, including aligned child goals' contribution (weight-normalized; cascade walks upward KR → goal → parent KR → parent goal with cycle detection).
3. **Health (the precedence cascade — never a bare formula):**
   `success_status (achieved/missed, goal closed)` → **`outdated`** (`now > next_check_in_at + staleness_grace`) → `latest published check-in status (on_track/caution/off_track)` → `pending` (no check-in yet).
4. **RAG color** — from workspace thresholds over progress (`rag_pass_pct`/`rag_fail_pct`) — a *progress* signal, displayed alongside (never instead of) health.
5. **Trend forecast (differentiator)** — from `key_result_values` history, project end-of-cycle attainment per KR (linear fit over the recent window) and flag `trending_off_track` before the human status turns.

`recomputeGoal(graph, change)` is the single entry point; the invalidation job fans out from the outbox.

### 6.2 The cadence engine

Pure date math (workspace timezone aware): given a frequency, anchor day and the just-published check-in time, compute the next due date (weekly → next anchor day; biweekly/monthly analogous), with a ±1-day on-time tolerance so an early/late-by-a-day check-in does not double-advance. `outdated` evaluation, reminder scheduling and the review inbox all read `next_check_in_at`. Pausing a project suspends it; resuming recomputes it. Golden masters cover anchor-day edges, month ends, timezone/DST.

### 6.3 The KPI formula engine

A typed expression tree (Zod-validated; operators, parentheses, `kpi(id)` references), a safe evaluator (no `eval`), cross-frequency aggregation (finer-period sources roll up via the source KPI's `aggregate` function), divide-by-zero handling, dependency-graph cascade with cycle detection. Recompute jobs flow through the outbox. Golden masters from documented FlowyTeam formula cases; the importer's formula translator (§7.2) targets this tree.

### 6.4 Scheduling engine — deferred (design-for note)

The automatic dependency-scheduling engine (working-day calendars, lag propagation, parent date rollups) is **post-v1**, spike-gated (PLAN.md §13 R-note). v1 uses contextual dates + the derived `next_step` — the model Operately validates in production. Nothing in v1 blocks the engine later: dates are typed values, relations exist (`blocks`), and derived columns are already job-recomputed.

## 7. Importer architecture (`packages/importer`)

Two sources, one target, one pipeline. The OpenProject importer was **cut** (decision 2026-07-08); its reference docs are archived.

```
# Generic CSV/XLSX (P0)
pnpm import:csv --entity goals|key-results|kpis|kpi-records|projects|work-items \
  --file <path> --workspace <slug> [--dry-run]

# FlowyTeam (MySQL, per-company)
pnpm import:flowyteam --source <MYSQL_URL> --company <id> --workspace <slug> \
  [--dry-run] [--only objectives,indicators,tasks]
```

### 7.1 Pipeline (both sources)

1. **Connect read-only** (FlowyTeam: read-only MySQL session; never write/lock/migrate a source). Introspect; assert required tables; guess the source version.
2. **Extract → map → load** per domain in FK order (`reference/flowyteam-okr-kpi-tasks-model.md` §11), through the normal Operation pipeline with notification dispatch suppressed (a bulk-import flag the notify spine honors).
3. **Deterministic IDs:** upsert on `(workspace_id, legacy_type, legacy_id)`; re-runs are idempotent.
4. **Two-phase rich text:** load bodies (HTML → ProseMirror JSON through the sanitizing parser — imported content is untrusted), then a reference-rewrite pass remaps mentions/attachment refs using the shared extraction API.
5. **Report + reconcile:** `import-report.json` — counts per table, skips with reasons, lossy items — plus a per-domain source-vs-target count reconciliation. `--dry-run` produces both without writing. Every run persists an `import_runs` row.

### 7.2 FlowyTeam mapping table (the contract; keep current in every schema PR)

| Target | FlowyTeam source | Notes / lossy |
|---|---|---|
| `spaces` / `space_members` | `teams` / `other_departments` (+`leader_id`) | tree flattened to siblings (report notes depth); leader → space manager |
| `workspace_members` | employees/users of the company | placeholder members for unclaimed emails |
| `okr_cycles` / `strategy_settings` | `performance_cycles` / `performance_settings` | thresholds direct; edit-matrix → bindings, not booleans |
| `goals` | `objectives` | owner from `model_type`; two-pass alignment; champion=owner, reviewer=manager/lead fallback (report flags unmapped); health/progress recomputed |
| `key_results` | `key_results` | numeric restore; `direction` inferred; `task_id` → `work_items` link (phase-4 pass) |
| `key_result_values` | `key_result_records` + check-in snapshots | recompute % |
| `check_ins` | `checkins` + `objective_checkins`/`key_result_checkins` | one narrative check-in per objective per period; KR values land in the snapshot + value history; reviews → acknowledgements where reviewer known |
| `kpi_categories` / `kpis` / `kpi_records` | `indicator_types` / `indicators` / `indicator_records` | `occurance`→frequency; period-key normalized; unique per period |
| `kpi_dependencies` + `kpis.formula` | `indicator_calculates` + `calculated_value` token strings | token → expression tree; unparseable dropped + logged |
| `kpi_shares` | `indicator_accesses` | view-scope → bindings/shares |
| `projects` | FlowyTeam projects | state mapped; champion from owner |
| `work_items` (+assignees, checklist, relations, watchers) | `tasks` (+`sub_tasks`, `dependent_task_id`, `tasks_accesses`) | status from board-column slug (`completed` → done); `key_results_id` → KR link; recurrence flags recorded in report (recurrence engine post-v1) |
| `comments` / `blobs` | `task_comments` / `task_files` (+KR files) | HTML→JSON; external file URLs → `links` |
| `time_entries` | `project_time_logs` | **preserved losslessly, read-only in v1** |
| `performance_snapshots` / points | `performance_records` / `reward_settings`+`scores` | recomputed / imported only if points funded (off by default) |
| **not imported** | resthooks, universal-search cache, notification rows, attendance/HR modules | see reference §11 |

### 7.3 Workspace portability (export/import between OpenOKR instances)

A first-class feature, not an ops script: any workspace admin exports a **versioned, checksummed, AES-GCM-encrypted archive** (all workspace rows in FK order + blobs + a manifest; secrets, sessions, tokens, audit chain excluded by a policy registry) and imports it into any OpenOKR instance with a **dry-run diff first** (what will be created/merged), deterministic PK remap, member de-dup by email, and blob re-upload. Powers self-host ↔ cloud moves, clones, and per-workspace restore. Built in Phase 6 (P6-T04); simpler here than in Operately because every table already carries `workspace_id` + provenance columns.

## 8. Security design (must beat Operately, not just match it)

### 8.1 Layered enforcement (each layer has a distinct job)

| Layer | Mechanism | What it guarantees | Fails how |
|---|---|---|---|
| 1. Tenant floor | RLS `USING (workspace_id = current_setting('app.workspace_id')::uuid)` on every business table; GUC via `SET LOCAL` per transaction; app role has no `BYPASSRLS` and doesn't own tables | a forgotten filter can never cross workspaces | zero rows, not leaks |
| 2. Object access | the §4.1 relationship model through one `can(member, level, resource)` + the mandatory access-aware getter/filters; not-found on forbidden; suspended excluded; freeze overlay | per-object view/comment/edit/full, sharing, privacy tiers | denied by default at one chokepoint |
| 3. Write integrity | the **Operation pipeline**: authorize (against freshly loaded, access-scoped rows) → one transaction: mutate + bindings + activity + audit + outbox → commit | no partial writes; audit cannot drift from state; side effects never fire for rolled-back writes | transaction aborts atomically |
| 4. UI | hides what layer 2 denies | cosmetics only | never load-bearing |

RLS operational discipline (the classic footguns, closed): `SET LOCAL` only (survives no pool reuse); a CI test that an unset-GUC connection reads zero rows from every business table; the Phase 1 spike proves behavior under transaction-pooling; a migration linter fails any `CREATE TABLE` without an RLS policy in the same file.

### 8.2 Control checklist (each maps to a task)

| Control | Detail | Task |
|---|---|---|
| Session security | Better Auth; httpOnly+SameSite; **session tokens hashed at rest**; session list + revoke UI | P1-T05, P2-T09 |
| MFA | passkeys + TOTP + backup codes **from Phase 1**; org-mandated MFA policy in P7 | P1-T05, P7-T04 |
| Brute force / rate limits | lockout with backoff + audit; per-IP/per-user limits on auth, API, exports | P2-T09 |
| Headers | nonce-based strict CSP (no `unsafe-inline`), HSTS, frame/referrer policies | P2-T09 |
| Input | Zod everywhere; rich-text structural validation + sanitizing allowlist renderer (no raw HTML) at every surface incl. email; upload type/size allowlist; images re-encoded | P2-T05, P2-T11, all |
| Authorization | §8.1 layers 1–2; CI lint on raw reads; multi-path grant composition = max, deduped; suspended excluded; sub-resource context resolver fail-closed | P2-T01/T02 |
| Audit | append-only `audit_events` (no UPDATE/DELETE grants) written in-transaction; per-workspace hash chain + verification tool; ACL-scoped audit reads | P1-T07, P7-T05 |
| Workspace freeze | `state` overlay with admin recovery whitelist | P2-T09 |
| Secrets | env + encrypted DB settings; envelope encryption with a key ring; one-command master-key rotation (re-wraps data keys only); startup refuses placeholder secrets in prod | P1-T09, P5-T02 |
| SSRF | outbound fetches (link enrichment, AI base URLs, OAuth client metadata) validate literal host **and** DNS-resolved addresses; block private/link-local/metadata ranges; no redirects; size/time caps | P4-T07, P5-T02/T09 |
| API tokens | scoped (read/write/admin), expiring, hashed at rest, last-used; token/OAuth-authed callers are **403-forbidden from token administration**; every token/MCP request revalidates live membership + suspension | P5-T06/T09 |
| MCP OAuth | full OAuth 2.1 authorization server: PKCE-S256, discovery (RFC 9728/8414/OIDC + /mcp variants), DCR (RFC 7591) + CIMD with SSRF-safe fetch, RFC 8707 resource/audience binding validated on issue and every use, 15-min access + 30-day rotating refresh with reuse-detection lineage revocation, single-use codes, consent + workspace picker, grant revoked on membership loss, Origin/DNS-rebinding validation, session-to-grant binding | P5-T09 |
| AI/agents | acting-principal only (no ambient authority); shared-registry authz + validation; read/write/destructive classes; sandbox + batch approval + hard cost caps for teammates; RAG content untrusted | AI-NATIVE-PLAN §8 |
| Privacy | PDPA/GDPR export + erasure-as-anonymization; last-owner/last-site-admin invariants; PII minimization | P2-T03, P6-T06 |
| Supply chain | Dependabot, CodeQL, pinned lockfile, cosign-signed images, SBOM, license gate, DCO | P1-T02, P6-T06 |
| Support access | (Phase 7) time-boxed, encrypted, **tenant-visible** operator impersonation, every action audited | P7-T06 |

### 8.3 Explicit improvements over Operately (the security scorecard rows)

- RLS tenant floor (Operately: app-code scoping only — one missed filter leaks).
- Passkeys/TOTP at launch; session tokens hashed (Operately stores session tokens raw).
- Append-only, hash-chained, typed audit distinct from the feed (Operately's audit *is* its mutable activities table).
- Transactional outbox portable to any driver (Operately's atomicity depends on Oban sharing its repo).
- Three-tier token scopes + expiry + no-token-mints-token (Operately: two-tier, no expiry model).
- Tenant-visible support impersonation (Operately's is invisible to the customer).
- Uniform Zod boundary validation incl. full JSON-schema on MCP tools (Operately's MCP validator covers a subset).

## 9. Search

Postgres FTS via the Search port: a `search_documents` table (entity type/id, tsvector, GIN) refreshed by outbox-driven jobs; queries filtered through the access layer. Semantic/hybrid search arrives with the AI layer (pgvector, AI-NATIVE-PLAN §9) and degrades back to FTS. Identical on every deploy target; air-gap safe.

## 10. Testing strategy

- **10.1 Isolation.** Unit/integration: per-worker database from a migrated **template DB** (fast reset); the workspace GUC set per test by the harness. E2E: Playwright runs against a real server on a per-worker database with truncate-between-tests — transaction-rollback isolation cannot cross Playwright's connection, so we do not pretend it can. Built in Phase 1.
- **10.2 Factory.** `packages/test-support` builds every entity **through core Operations** (never raw inserts), so setup itself exercises RLS, bindings and `can()`. Multi-persona helpers (champion/reviewer/member/guest/suspended/agent).
- **10.3 Conventions.** Interactive elements carry stable `data-testid`; Playwright uses `getByRole`/`getByTestId`; a failure helper dumps the DOM's available test-ids.
- **10.4 Flaky policy.** Playwright retries + trace-on-retry; Vitest retry; merged report surfaces passed-on-retry as a tracked metric; auto-quarantine + ticket after N flakes in a window.
- **10.5 Engines.** Golden-master suites for scoring/health cascade (§6.1), cadence (§6.2), KPI formulas (§6.3) — matrices human-reviewed at design gates.
- **10.6 Security.** RLS property/fuzz suite (random cross-tenant reads across every table must return zero rows; removing any policy must fail the suite); an unset-GUC zero-row test; suspended-member access-loss tests; a mutation-without-audit-row impossibility test.
- **10.7 Out-of-process e2e.** MCP: drive the real OAuth/PKCE + Streamable HTTP transport end to end; assert an under-privileged tool call is denied and no cross-tenant data appears in results. REST: token-scoped equivalents. CLI: run the generated binary against a live server.
- **10.8 Contract drift.** Regenerate OpenAPI, the MCP catalog and the CLI from the action registry in CI; diff against committed artifacts; fail on drift.
- **10.9 Importer.** Unit per mapper; integration against a seeded FlowyTeam MySQL in CI (multi-company, `--company` exercised); idempotency (run twice, no diffs); CSV golden files.

## 11. Licensing and clean-room

OpenOKR's own code is licensed per PLAN.md §4 (AGPL-3.0 + CLA, pending sign-off). Two clean-room stances:

- **FlowyTeam** (proprietary): we read its *database* (data, not code) via the reference docs and reproduce observable behavior described in our own words. No source code is ever copied.
- **Operately** (Apache-2.0): legally copyable with attribution, but the §2 PLAN decision is original code — so the same rule applies by policy: we study observable behavior, UI semantics and public docs as the reference spec; we do not copy source. If any Operately code were ever ported, Apache-2.0 attribution obligations apply — treat that as a decision for the human, not a default.

## 12. Open technical decisions (ask the human)

**Decided (2026-07-08):** greenfield vs fork (PLAN §2); v1 scope trim + power floor (REQUIREMENTS §6); single runtime v1 (PLAN §3); importers = CSV + FlowyTeam full strategy+tasks, OpenProject cut (§7); rich text = ProseMirror JSON canonical (§1); relationship access model + RLS floor (§4.1/§8.1); transactional outbox (§5); hosted SaaS designed-for (REQUIREMENTS §5).

| # | Decision | Lean |
|---|---|---|
| T1 | KR↔KPI: single `kpi_id` on the KR vs many-to-many | single link for v1; revisit with real demand |
| T2 | Trend-forecast model (linear fit window, thresholds) | decide at P3-T00 with the golden masters |
| T3 | Space tree vs flat spaces | flat + naming in v1 (imports flatten); tree post-v1 if demanded |
| T4 | Public read (anonymous) surfaces in v1 | design the anonymous group now; ship no public pages until a use case lands |
| T5 | FlowyTeam points/rewards history import | only if the points layer is funded (off by default) |
| T6 | Better Auth bcrypt import feasibility for FlowyTeam passwords | verify; fallback = invite-reset flow |
| T7 | Embedding model + dimension | decide at P5-T07 (AI-NATIVE §13 A7) |

## 13. Performance engineering (budgets are requirements, not hopes)

### 13.1 Budgets (measured on the P6-T01 large dataset: 100k work items + 10k goals in one workspace)

| Surface | Budget |
|---|---|
| Work Map first paint (100 nodes visible) | < 1.0 s server render, < 2.0 s interactive |
| Work Map / list scroll | 60 fps virtualized; no cliff to 10k loaded rows |
| Goal/project page open from a list | < 300 ms perceived (optimistic + hydrated cache) |
| Board render (6 columns × 50 cards) | < 1.5 s |
| Review inbox | < 500 ms p95 server |
| Global search suggestions | < 300 ms p95 |
| Save actions (check-in publish, field edit) | optimistic instant; server ack < 500 ms p95 |
| Core Web Vitals (app shell) | LCP < 2.5 s, INP < 200 ms, CLS < 0.1 on mid-range hardware |

### 13.2 Techniques (mandatory patterns)

- Server Components + streaming for first paint; hydration only where interactive.
- **Keyset pagination everywhere** (no OFFSET beyond ~page 10).
- Virtualized trees/tables/boards (TanStack Virtual).
- **N+1 budget in CI:** list endpoints load relations set-based; a dev-mode query counter fails tests over budget (>15 queries on a list view).
- **Indexes ship with the feature**; composite `(workspace_id, space_id, common-filter)` where lists filter on it.
- Derived values (progress, health, next_step, counts) recomputed by outbox-driven jobs into columns — never per-row at render.
- **Response shapes:** every resource declares a `summary` (list) and `full` (detail) Zod shape; list endpoints return only `summary`.
- Client: TanStack Query with a **persisted cache keyed by buildId** (instant back/forward; corruption-tolerant; quota-aware) — a maintained-library equivalent of Operately's hand-rolled PageCache.
- **Stale-deploy handshake:** an `x-app-version` header; a shared interceptor detects mismatch on not-found/gone and triggers a one-time debounced reload with an "app updated" toast; persisted caches bust on buildId.
- Realtime instead of polling; compact events + refetch through the access-checked read path.

### 13.3 Data-loading boundary

RSC-streamed: the shell, auth/onboarding, settings, read-mostly detail first paint. Client-owned (loader-prefetched, TanStack-hydrated): Work Map, review inbox, explorers, boards, KPI grid, feeds, notification inbox — everywhere inline edit, virtualization, realtime and URL-stable view state live. Share-stable URL state parses client-side.

## 14. API conventions (one contract, five projections)

- **The action/contract registry** (`packages/core`): every read and write is defined once — name, Zod input/output (`summary`/`full` shapes), required access level, `readOnly`/`write`/`destructive` class, handler calling a core service through the Operation pipeline. tRPC procedures, REST routes, MCP tools, OpenAPI 3.1 and the CLI are generated projections. One permission decision, everywhere; CI drift checks (§10.8).
- **REST `/api/v1`:** JSON, cursor pagination (`?cursor=&limit=`), `filters` grammar matching the list contracts, OpenAPI from Zod, scoped bearer tokens (hashed), audience-separated from MCP tokens (RFC 8707). Errors: typed enum (`FORBIDDEN` collapsed to `NOT_FOUND` for invisible resources, `CONFLICT` for stale versions, `VALIDATION`).
- **Optimistic concurrency:** updates carry `version`; mismatch → 409 → client refetch/reapply or conflict banner.
- **Form-validation endpoints:** `POST /…/validate` returns field errors + computed defaults without committing (powers rich client forms and the CSV importer preview).
- **CLI:** generated from the registry/OpenAPI — every resource becomes a command with typed flags, `--field-file` inputs, multi-profile config (0600), and a browser device-login flow that mints a scoped token. Ships in Phase 5 with the registry.
- **Webhooks (outbound, P1 within Phase 5/6):** signed (HMAC per-hook secret), SSRF-checked, delivering the same `summary` resource shapes, with delivery logs.
- **Deprecation:** `/api/v1` is stable; breaking changes require `/api/v2` side-by-side.

## 15. Where OpenOKR must beat Operately (the scorecard)

The reason to exist, re-benchmarked against the real competitor (decision 2026-07-08; the old OpenProject scorecard is retired). Each row is verified at a phase exit; "same as Operately" is the parity bar unless marked *(parity)*.

| Dimension | Operately today | OpenOKR target | Where |
|---|---|---|---|
| Operating rhythm | weekly cadence, outdated staleness, ack loop — shipped | *(parity is mandatory)* + configurable grace/cadence per goal, AI-drafted overdue check-ins, reviewer SLA + escalation | P3 |
| OKR depth | goals + targets; no weights, no KPI system, no forecasting | weighted direction-aware KRs, value history + trend forecast, full KPI module with calculated formulas, KPI-backed KRs | P3 |
| Work Map | shipped, goals+projects+tasks | *(parity)* + KPI tiles, staleness surfaced, 100k-item virtualization, RLS-filtered | P4 |
| Check-ins | narrative + snapshot + ack | *(parity)* + diff timeline UI, draft AI assist, acknowledgement SLA | P3/P5 |
| Execution core | projects, milestones, tasks, boards, docs | *(parity)* + multi-assignee, due-relative reminders, blocked-guard, KR-linked progress flow | P4 |
| Resource hub | shipped (space/project/goal) | *(parity)* + doc version diff, link auto-enrichment, quotas, semantic search over content | P4/P5 |
| Tenant isolation | app-code scoping | **Postgres RLS floor + relationship layer**; fuzz-tested | P1/P2 |
| Authorization | bindings engine (app-level) | *(parity on expressiveness)* + one registry-enforced `can()` across UI/REST/MCP/CLI, CI-linted chokepoint | P2 |
| Audit | mutable activities table doubles as audit | separate append-only, hash-chained, typed, ACL-scoped audit + verification tool | P1/P7 |
| Write integrity | Ecto.Multi + Oban-in-repo | *(parity)* via Operation pipeline + **portable transactional outbox** | P1 |
| MCP server | 102 tools, full OAuth 2.1, ChatGPT connectors | *(parity is mandatory — port the flow)* + Resources & Prompts primitives, stdio for air-gap, per-token rate limits + cost caps, admin scope tier | P5 |
| AI providers & governance | 2 cloud providers, env keys, no metering | BYO-key 3-level, local models/air-gap, tier routing, per-token metering + hard caps, versioned prompts, egress controls | P5 |
| AI teammates | autonomous agents, company-wide edit grant, no cost control | *(parity on autonomy)* + least-privilege principal, sandbox, batch-approval, cost-capped, local-model capable | P5 |
| Portability | owner-gated company transfer | self-serve encrypted workspace export/import with dry-run diff; CI-verified restore | P6 |
| API surface | typed RPC + private catalog CLI | public OpenAPI 3.1 + generated SDK-able surface + generated CLI + drift CI | P5 |
| Setup | shell installer | first-run web wizard, secrets auto-generated, <30 min | P1 |
| First load | client-rendered SPA | RSC streaming, LCP < 2.5 s cold | P2/P6 |
| Accessibility & i18n | partial | WCAG 2.1 AA CI-gated; en+ms ICU catalogs | P6 |
| Parity risks (must not regress) | polished feeds, notifications, editor, demo builder | typed feed engine, buffered digests, editor design doc, demo builder — all specified, not improvised | P2 |
