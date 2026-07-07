# IMPLEMENTATION-PLAN.md

The work, as ordered tasks. Each task has an ID, dependencies, a test plan, a development block, and a QA checklist. Claude Code executes one task at a time under the protocol in EXECUTION-GUIDE.md. A human reviews and merges every task.

Authority: this is the execution authority. It implements TECHNICAL-PLAN.md. If a task conflicts with TECHNICAL-PLAN.md, the design doc wins and the task must be corrected first.

The plan runs in **eight sequential phases**. Each phase gates on the one before it (EXECUTION-GUIDE.md §4): no phase's implementation tasks start until the previous phase is `done` and, where the phase opens with a design gate, until the human has approved that gate.

| Phase | Theme | Tasks |
|---|---|---|
| 1 | Prove the pipeline | P1-T01…P1-T10 |
| 2 | Core platform | P2-T01…P2-T12 |
| 3 | Work management | P3-T00…P3-T33 |
| 4 | Strategy — OKR, KPI, Check-ins & Tasks | P4-T00…P4-T19 |
| 5 | AI layer (AI-native) | P5-T00…P5-T12 |
| 6 | Hardening | P6-T01…P6-T07 |
| 7 | Enterprise pack | P7-T01…P7-T07 |
| 8 | Community launch | P8-T01…P8-T06 |

## How to read a task

```
### <ID>: <title>
Depends on: <IDs or "-">
Goal: one sentence.
Deliverables: what exists when done.
Test plan: the tests to write first (red before green).
Development: the implementation steps.
QA: the checklist to pass before opening the PR.
Acceptance: Given/When/Then that a human verifies.
```

Every task also inherits the **Definition of Done** in CLAUDE.md (both runtime profiles, RLS+migration together, Zod at boundaries, audit events for sensitive actions, loading/empty/error states, STATUS.md updated). Tasks below only call out extras.

**Definition of Ready** — before the agent writes code for a task, all must hold (checked during the restate step):

1. Dependencies are `done` in STATUS.md.
2. The task's spec sources exist: UI tasks cite a UIUX-PLAN.md screen spec (S-xx) and the §4 interaction patterns; schema tasks cite TECHNICAL-PLAN.md §4 (strategy schema: §4.12) and have (or add) a row in the relevant mapping table (TECHNICAL-PLAN.md §7.4 for source 1, §7.6 for source 2); importer tasks cite the relevant `reference/` section (source 1: `legacy-data-model.md`; source 2: `flowyteam-okr-kpi-tasks-model.md`).
3. Acceptance criteria are unambiguous; if not, the agent asks before coding.
4. No open `[DECIDE]`/PLAN §12 decision blocks the task.

UI tasks additionally run the **UX quality gates** in UIUX-PLAN.md §9 as part of QA. List-rendering tasks must meet the performance budgets in TECHNICAL-PLAN.md §13.1.

**Design gates:** tasks tagged `[DESIGN GATE]` produce a `docs/design/*.md` doc and require explicit human approval before the implementation tasks in that phase proceed.

**Estimate labels:** S (≤0.5 day), M (~1 day), L (~2–3 days). Guidance only.

---

# Phase 1 — Prove the pipeline

Goal: a walking skeleton (auth + one workspace + one dashboard) deployed to all three targets, CI green under both runtime profiles. No product features. Exit only when Vercel, Docker Compose, and Helm all serve the skeleton.

### P1-T01: Monorepo scaffold [M]
Depends on: -
Goal: Turborepo + pnpm workspace with the package skeleton from TECHNICAL-PLAN.md §1.
Deliverables: `apps/web`, `packages/{core,db,adapters,importer,ui,config}`, root `package.json`, `turbo.json`, `tsconfig` base (strict), Biome config, `.gitignore`, `LICENSE` (AGPL-3.0 placeholder), `CONTRIBUTING.md`, `GOVERNANCE.md` stubs.
Test plan: a trivial Vitest test per package that imports the package entrypoint; `pnpm typecheck` and `pnpm lint` run clean.
Development: init workspace, wire Turbo pipelines (`dev`,`build`,`test`,`typecheck`,`lint`), Biome, strict TS. Add empty barrel exports.
QA: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass locally.
Acceptance: *Given* a clean checkout, *when* `pnpm install && pnpm typecheck && pnpm test` run, *then* all succeed with the package graph resolved.

### P1-T02: CI matrix + env schema [M]
Depends on: P1-T01
Goal: CI that runs the suite under `RUNTIME=container` and `RUNTIME=serverless`, plus a Zod env schema.
Deliverables: GitHub Actions workflow (typecheck, lint, unit, build) as a matrix over both profiles; `packages/config` env schema validated at boot; Dependabot + CodeQL enabled.
Test plan: a test asserting the env schema rejects a missing `DATABASE_URL` and accepts a valid env; CI config validated by a dry `act`-style run or a smoke job.
Development: write the workflow; add `RUNTIME` to the env schema (`container|serverless`); fail fast on invalid env.
QA: push a branch, both matrix legs green.
Acceptance: *Given* an invalid env, *when* the app boots, *then* it exits with a clear Zod error naming the bad variable.

### P1-T03: Database package + first migration + RLS harness [L]
Depends on: P1-T01
Goal: Drizzle wired to Postgres with a migration runner and an RLS test harness.
Deliverables: `packages/db` with Drizzle config, `pnpm db:migrate`, a request-scoped connection wrapper that sets `app.workspace_id` GUC, and a test helper that runs migrations against a throwaway Postgres.
Test plan: integration test that creates two workspaces, inserts rows in each, and asserts a query under workspace A cannot see workspace B's rows (RLS proven on a sample table).
Development: Drizzle setup; migration tooling (forward-only); the GUC-setting wrapper; a `withWorkspace(id, fn)` helper.
QA: migrations apply cleanly from empty; RLS test passes; `pnpm db:migrate` idempotent.
Acceptance: *Given* two workspaces, *when* code runs as workspace A, *then* workspace B rows are invisible even to raw Drizzle queries.

### P1-T04: Adapter ports + both driver sets (stubs) [L]
Depends on: P1-T01
Goal: define all seven ports and provide working (possibly minimal) drivers for both profiles.
Deliverables: `packages/adapters` with interfaces for JobQueue, Realtime, FileStorage, Mailer, Cache, Search, AIProvider; container drivers (pg-boss, WS+LISTEN/NOTIFY, local disk, SMTP-to-console, in-proc cache, PG FTS, AI-off) and serverless drivers (Inngest stub, Supabase Realtime stub, S3 stub, Resend stub, Upstash stub, PG FTS, AI-off); an adapter loader keyed on `RUNTIME`.
Test plan: a contract test suite run against **both** driver sets for each port (enqueue/handle a job, put/get a file, publish/subscribe an event) so parity is enforced.
Development: interfaces first; container drivers real enough to run locally; serverless drivers may be thin but must satisfy the contract tests (use test doubles where a real cloud is needed, documented).
QA: contract tests green for both profiles; no vendor SDK imported outside this package (grep check in CI).
Acceptance: *Given* `RUNTIME=container` or `serverless`, *when* feature code calls `jobs.enqueue`, *then* the correct driver handles it and the contract test passes on both.
Note: only the AIProvider **port interface** (per AI-NATIVE-PLAN.md §3.1) and the `off` driver ship here, so AI is architecturally present in the skeleton. Real providers, config, bring-your-own key, the copilot, and the MCP server are Phase 5 (AI-NATIVE-PLAN.md §12).

### P1-T05: Better Auth integration [M]
Depends on: P1-T03
Goal: email+password auth via Better Auth, no hand-rolled sessions.
Deliverables: Better Auth mounted in `apps/web`, user table wired, sign-up/sign-in/sign-out, session middleware exposing the current user.
Test plan: integration tests for register, login, bad-password, logout; a test that protected routes 401 without a session.
Development: configure Better Auth with the Drizzle adapter; seed no users; add server-side session read.
QA: auth flows pass; passwords never logged; both profiles.
Acceptance: *Given* a registered user, *when* they sign in with correct credentials, *then* a session is established and the current user is readable server-side.

### P1-T06: Workspaces + membership bootstrap [M]
Depends on: P1-T03, P1-T05
Goal: create a workspace on first run and make the signed-in user its owner.
Deliverables: `workspaces`, `users` link, `memberships`, `roles` (Owner builtin), migration + RLS; a bootstrap flow that provisions the first workspace and owner.
Test plan: integration test: fresh DB → register → a workspace exists with the user as Owner; RLS scoping verified.
Development: schema + RLS in one migration; bootstrap service; set `app.workspace_id` from the user's active workspace.
QA: DoD; audit event on workspace create.
Acceptance: *Given* a first-run instance, *when* the first user registers, *then* a workspace is created with them as Owner and an audit event recorded.

### P1-T07: Hello dashboard (server-rendered) [S]
Depends on: P1-T06
Goal: an authenticated dashboard page proving the whole stack end to end.
Deliverables: `/` shows the workspace name and the signed-in user via a Server Component reading through `core`; loading/empty/error states.
Test plan: one Playwright e2e: register → land on dashboard → see workspace name; a test for the unauthenticated redirect.
Development: minimal page + a tRPC `me`/`workspace` query.
QA: e2e green under both profiles.
Acceptance: *Given* a signed-in user, *when* they open `/`, *then* they see their workspace and name.

### P1-T08: Docker Compose target [M]
Depends on: P1-T07
Goal: `docker compose up` runs app + Postgres + Caddy serving the skeleton.
Deliverables: `deploy/docker/Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example`; `RUNTIME=container`.
Test plan: a CI job that builds the image and boots compose, then curls the health endpoint and the login page.
Development: multi-stage Dockerfile; compose with volumes; health check endpoint.
QA: fresh `docker compose up` yields a working login within ~30 min setup budget; migrations run on boot.
Acceptance: *Given* a clean host, *when* `docker compose up`, *then* the skeleton is reachable and a user can register.

### P1-T09: Vercel + Supabase target [M]
Depends on: P1-T07
Goal: the same skeleton deploys serverless.
Deliverables: `deploy/vercel/` notes + env template; `RUNTIME=serverless`; serverless drivers wired (jobs/realtime/storage) against Supabase/Inngest per PLAN.md §12 decision.
Test plan: a preview deploy smoke test (documented manual + a scripted health check).
Development: adapt build for Vercel; document env vars; confirm serverless drivers load.
QA: a preview deployment serves login and dashboard.
Acceptance: *Given* the env template filled, *when* deployed to Vercel, *then* the skeleton works under `RUNTIME=serverless`.

### P1-T10: Helm chart target + Phase 1 exit [L]
Depends on: P1-T08
Goal: the skeleton runs on Kubernetes via Helm with external Postgres.
Deliverables: `deploy/helm/` chart (deployment, service, ingress, secrets, migration job/hook), values for external Postgres; signed image published to GHCR on tag.
Test plan: `helm template` lints; a kind-cluster CI job installs the chart and checks readiness.
Development: chart + migration pre-install hook; GHCR release workflow.
QA: chart installs on kind; image signed; **Phase 1 exit checklist** (below) all green.
Acceptance: *Given* a kind cluster + Postgres, *when* the chart installs, *then* the skeleton serves and a user can register.

**Phase 1 exit checklist:** skeleton runs on Compose, Vercel, and Helm; CI matrix green on both profiles; RLS proven; adapter contract tests green on both driver sets; no vendor SDK outside `packages/adapters`; auth works; audit table exists.

---

# Phase 2 — Core platform

Goal: the shared machinery every module needs: full RBAC, audit log, notifications spine, file uploads, workspace/project settings, invitations, and the importer skeleton. Still no product modules.

### P2-T01: RBAC schema + permission catalogue [L]
Depends on: P1-T06
Goal: roles, permissions, membership-roles with the legacy-derived permission set.
Deliverables: `roles`, `role_permissions`, `membership_roles` (with `inherited_from_membership_id`), the permission string enum (from `reference/legacy-feature-inventory.md` §2, plus `manage_ai` for the AI console — AI-NATIVE-PLAN.md §4), seeded default roles (Owner, Project admin, Member, Reader, plus builtin Non-member/Anonymous). Migration + RLS.
Test plan: unit tests for the permission enum completeness; integration test seeding roles and asserting `role_permissions` rows.
Development: schema; seed; a typed `Permission` union in `core`.
QA: DoD; mapping table in TECHNICAL-PLAN.md still accurate.
Acceptance: *Given* the seed, *when* roles load, *then* the default roles carry the expected permissions.

### P2-T02: Authorization layer in core [M]
Depends on: P2-T01
Goal: a single `can(user, permission, context)` used everywhere; group role inheritance computed here.
Deliverables: `packages/core` authz service; group-inherited roles resolved at check time or via a materialized `membership_roles` rebuild; a tRPC `authz` middleware.
Test plan: unit matrix: Member vs Reader vs Project admin vs Non-member across a sample of permissions; group inheritance test (user in a group with a role gets the permission).
Development: resolution logic; middleware; deny-by-default.
QA: DoD; UI-hiding never used as the only guard.
Acceptance: *Given* a user in a group granted Member, *when* they act, *then* they have Member permissions via inheritance.

### P2-T03: Audit log [M]
Depends on: P1-T06
Goal: append-only audit events for sensitive actions.
Deliverables: `audit_events` table (append-only, no update/delete grants), a `recordAudit` core service, wiring for auth, role/member, and workspace changes so far.
Test plan: unit test the writer; integration test that a role change emits an audit row; a test that update/delete on the table is denied.
Development: schema + RLS; service; hook into existing sensitive actions.
QA: DoD; no PII beyond actor id and target ids in payload.
Acceptance: *Given* an admin changes a role, *when* it commits, *then* an immutable audit event exists.

### P2-T04: Invitations + membership management [M]
Depends on: P2-T02, P2-T03
Goal: invite users to a workspace/project and assign roles.
Deliverables: invitation tokens (via Better Auth or a `tokens` equivalent), invite-by-email, accept flow, member add/remove/role-change UI + API.
Test plan: integration tests for invite→accept→membership; permission tests (only `manage_members` can invite); e2e happy path.
Development: token issuance via Mailer adapter; member management tRPC; audit on changes.
QA: DoD; email sending through the adapter only.
Acceptance: *Given* an admin with `manage_members`, *when* they invite an email, *then* the invitee can accept and gains the assigned role.

### P2-T05: File uploads via FileStorage adapter [M]
Depends on: P1-T04
Goal: attachment upload/download that works on local disk and S3.
Deliverables: `attachments` table (polymorphic container), direct-upload flow (prepare → store → attach on save), download with signed URLs, size/type validation (Zod).
Test plan: integration test upload→attach→download on both drivers; a test rejecting oversized/blocked types; orphan-cleanup job test.
Development: prepare/finish endpoints; pending-attachment claim on container save; cleanup job via JobQueue.
QA: DoD; virus-scan hook stubbed (enterprise later).
Acceptance: *Given* a user, *when* they upload a file and save the container, *then* the attachment is linked and downloadable.

### P2-T06: Notifications spine [L]
Depends on: P2-T02, P1-T04
Goal: in-app + email notifications with per-user settings, no product triggers yet.
Deliverables: `notifications`, `notification_settings` (global + per-project), a `notify(recipient, reason, subject)` core API, in-app notification center UI, email via Mailer, a digest job scaffold.
Test plan: unit tests for setting resolution (involved/watched/mentioned/assignee); integration test that `notify` creates an in-app row and enqueues a mail; UI e2e for the center.
Development: schema + RLS; core API; Realtime publish for live badge; digest job stub.
QA: DoD; both profiles; mails through adapter.
Acceptance: *Given* a user with in-app enabled, *when* `notify` runs, *then* a notification appears live and (if enabled) an email is queued.

### P2-T07: Workspace & project settings shell [M]
Depends on: P1-T06
Goal: settings storage + admin shell to hang module settings on.
Deliverables: `workspaces.settings jsonb`, `projects.settings jsonb`, a settings service with Zod schemas, admin navigation shell, `LEGACY_`-style env overrides pattern (`APP_` prefix) documented.
Test plan: unit tests for settings get/set with Zod validation; a test that env overrides win.
Development: settings service; admin layout; nav registration pattern (see P2-T08).
QA: DoD.
Acceptance: *Given* an admin, *when* they change a setting, *then* it persists and validates.

### P2-T08: Navigation & module registration framework [M]
Depends on: P2-T02
Goal: a registry so modules add menu items + permissions + settings without touching core wiring (replaces the legacy system's engine/MenuManager pattern).
Deliverables: a typed module registry (`registerModule({ menu, permissions, settings })`), global/project/admin/account menu builders that filter by permission.
Test plan: unit test that a registered module appears in the right menu only when the user has the permission.
Development: registry + menu builders; migrate the hello dashboard nav onto it.
QA: DoD.
Acceptance: *Given* a module registers a project menu item requiring `view_x`, *when* a user lacks `view_x`, *then* the item is hidden and the route is denied.

### P2-T09: Importer skeleton + read-only source connection [L]
Depends on: P1-T03
Goal: the `packages/importer` CLI that connects read-only to a legacy DB, introspects, and reports — no mapping yet. Covers source 1 (PostgreSQL) and both of its topologies from TECHNICAL-PLAN.md §7.2; the FlowyTeam (MySQL) source is added by P4-T13 on this skeleton.
Deliverables: `pnpm import:legacy --source <url> --workspace <slug> [--source-schema public] --dry-run`; read-only connection (`default_transaction_read_only`, and `search_path` to the source schema in mode B); works whether the source is a separate database (mode A) or another schema in the same instance as the target (mode B); schema introspection + required-table assertions; the legacy system-version guess; empty `import-report.json`; the `(legacy_type, legacy_id) -> uuid` mapping table in the target.
Test plan: integration tests against a seeded legacy database for **both** topologies (separate DB, and same-instance-two-schemas): connect, introspect, assert it detects core tables and refuses to write to the source.
Development: CLI scaffold; source-schema flag; introspection; report writer; the legacy-id map table + upsert helper.
QA: DoD; verify the source connection cannot write (attempt an insert, expect failure) in both modes.
Acceptance: *Given* an legacy DB (separate or same-instance schema), *when* `import:legacy --dry-run` runs, *then* it prints a schema summary and writes an (empty) report without touching the source.

### P2-T10: Seed + demo workspace [M]
Depends on: P2-T01
Goal: `pnpm db:seed` builds a realistic demo workspace for dev and the public demo.
Deliverables: seed script creating a workspace, users, roles, a couple of projects, sample work packages (once WP schema lands, extend).
Test plan: a test that the seed runs idempotently and produces expected counts.
Development: seed with fixed IDs; guard against double-seeding.
QA: DoD.
Acceptance: *Given* an empty DB, *when* `db:seed` runs, *then* a demo workspace exists and login works.

### P2-T11: App shell + design system foundation [L]
Depends on: P1-T07, P2-T08
Goal: the global UI everything else plugs into, per UIUX-PLAN.md §2–§3 and §5.
Deliverables: **shadcn/ui initialized on the Base UI registry (not Radix)** as the primitive layer for all of `packages/ui`, the **shadcn MCP** configured (`npx shadcn@latest mcp init --client claude`) with the shadcn/Base-UI and **SmoothUI** (`https://smoothui.dev`) registries, and **Motion** (`motion`) added as the approved animation runtime — all vendored/build-time, no runtime network call (UIUX-PLAN §2); a couple of SmoothUI-backed motion components (e.g. `Toast+Undo`, `SidePanel` transitions) wired to `prefers-reduced-motion`; design tokens (type scale, spacing, semantic colors, density modes), dark mode (light/dark/system user preference), the app shell (sidebar with Home/Inbox/My work/Favorites placeholder/Projects tree, topbar with breadcrumb + search field + `+ New` + bell + avatar menu), responsive behavior (collapse, mobile tab bar), core `packages/ui` components with preview pages: `DataTable` (virtualized base), `EntityPicker`, `EmptyState`, `SkeletonTable`, `Toast+Undo`, `SidePanel`, `KbdHint`; keyboard shortcut registry + `?` overlay; i18n pipeline (ICU catalogs, `en` + `ms` stub, pseudo-locale CI check).
Test plan: component tests for keyboard/focus behavior on DataTable, SidePanel, pickers; visual states (light/dark) in preview pages; e2e: shell navigation, theme toggle persistence, mobile viewport smoke.
Development: tokens; shell layout on the module registry (P2-T08); components; shortcut registry; i18n wiring.
QA: DoD + UIUX-PLAN §9 gates; axe clean on the shell.
Acceptance: *Given* a signed-in user, *when* they toggle dark mode and compact density, *then* the whole shell and components respond and the preference persists across sessions.

### P2-T12: Security baseline: rate limiting, headers, sessions UI [M]
Depends on: P1-T05, P2-T03
Goal: the TECHNICAL-PLAN §8.2 controls that belong in the platform layer.
Deliverables: rate limiting via the Cache port on auth endpoints + API (per-IP and per-user, envelope headers), account lockout with backoff + audit event, nonce-based strict CSP + HSTS + frame/referrer headers, secure cookie settings verified, session management UI in account settings (list active sessions with device/last-seen, revoke one/all others), startup refusal of placeholder secrets in production.
Test plan: integration: N failed logins → lockout + audit row + retry-after; rate limit returns 429 with headers; CSP header present and nonce varies; session revoke kills the other session (e2e with two contexts).
Development: middleware; Better Auth session enumeration/revocation; settings for thresholds; docs of defaults.
QA: DoD; verify on both runtime profiles.
Acceptance: *Given* a user signed in on two devices, *when* they revoke the other session, *then* that device's next request is unauthenticated; *and given* repeated failed logins, *then* the account locks with backoff and the event is audited.

**Phase 2 exit checklist:** RBAC + authz enforced; audit events on sensitive actions; invitations work; file upload works on both storage drivers; notification spine live; module registry drives menus; app shell + design system in place (dark mode, i18n pipeline, virtualized DataTable base); security baseline live (rate limits, lockout, CSP, sessions UI); importer connects read-only and reports; seed builds a demo.

---

# Phase 3 — Work management

Built from REQUIREMENTS.md in vertical slices: schema + RLS + API + UI + tests per slice, each with its importer mapper. The execution pillar — work packages and everything around them (queries, boards, gantt, wiki, meetings, time/cost). Starts with a design gate.

### P3-T00: Domain design docs [DESIGN GATE] [L]
Depends on: Phase 2 complete
Goal: write `docs/design/01-domain-model.md` … `10-roadmap.md` (per CLAUDE.md list) focused on the P0/P1 work-management modules, plus formalize the **query DSL** and **scheduling engine** specs and the **importer mapping** as living tables.
Deliverables: the design doc set; Zod schemas sketched for the query DSL and custom-field values; acceptance criteria as Given/When/Then per module.
Test plan: n/a (docs). Reviewer checks completeness against REQUIREMENTS.md.
QA: every P0 module has a design section and testable acceptance criteria.
Acceptance: **human approves** with "Design approved for Phase 3" before any Phase 3 implementation task starts.

## Slice A — Projects & versions

### P3-T01: Projects schema + tree + CRUD [L]
Depends on: P3-T00
Goal: projects with hierarchy, identifier rules, archive/template flags.
Deliverables: `projects` (+ closure `project_hierarchy`), `project_enabled_modules`, CRUD API, list + create/edit UI, identifier uniqueness + slug rules, archive.
Test plan: unit for identifier validation + tree ops (move subtree); integration for RLS + cascade rules; e2e create/archive.
Development: schema + RLS; closure maintenance; tRPC; UI; audit on create/archive.
QA: DoD.
Acceptance: *Given* `add_project`, *when* a user creates a project under a parent, *then* it appears in the tree and hierarchy queries include it.

### P3-T02: Versions + categories [M]
Depends on: P3-T01
Goal: milestones (versions) and WP categories per project.
Deliverables: `versions` (status/sharing/dates), `categories`, admin UI, API.
Test plan: unit for sharing scope resolution; integration RLS; e2e create version.
Development: schema; services; UI.
QA: DoD.
Acceptance: *Given* `manage_versions`, *when* a version is created with sharing `descendants`, *then* subprojects can target it.

### P3-T03: Import projects/versions/categories [M]
Depends on: P2-T09, P3-T02
Goal: importer mappers for projects, enabled modules, versions, categories.
Deliverables: mappers + tests; tree rebuilt from `parent_id`; report counts.
Test plan: integration against seeded legacy DB: project count matches, tree correct, versions/categories present; idempotency (run twice).
Development: extract/map/load; update mapping table.
QA: DoD; lossy items logged.
Acceptance: *Given* an legacy DB, *when* the projects mapper runs, *then* target projects match source count and hierarchy.

## Slice B — Work package foundations

### P3-T04: Types, statuses, workflow, priorities [L]
Depends on: P3-T00
Goal: the configuration behind work packages.
Deliverables: `types` (+ `form_config`), `statuses`, `workflows`, `priorities`; admin UIs; seed of a default set.
Test plan: unit for workflow transition resolution (allowed next statuses for type+role+author/assignee); integration RLS; e2e admin edits.
Development: schema; workflow resolver in `core`; admin UI; seed.
QA: DoD.
Acceptance: *Given* a workflow for type T and role R, *when* resolving next statuses, *then* only permitted transitions are returned.

### P3-T05: Work package CRUD + hierarchy + relations [L]
Depends on: P3-T04, P3-T01
Goal: the core object.
Deliverables: `work_packages` (+ closure), `work_package_relations`, `work_package_watchers`; create/read/update/delete with optimistic locking (`lock_version`); parent/child; relations with cycle prevention; split/full view UI (basic).
Test plan: unit for cycle prevention + lock-version conflict (409); integration RLS + cascade; e2e create/edit/relate.
Development: schema (incl. `work_package_versions` join per TECHNICAL-PLAN §4.3/T7); services + contracts (permission checks per attribute); UI per UIUX-PLAN **S-01/S-02** with inline edit + optimistic conflict handling (§4 patterns); audit.
QA: DoD + UIUX-PLAN §9 gates; both profiles.
Acceptance: *Given* a member with `add_work_packages`, *when* they create and then relate two WPs with `precedes`, *then* the relation exists and a cycle attempt is rejected.

### P3-T06: Custom fields engine [L]
Depends on: P3-T05, P3-T01
Goal: all field formats on work packages and projects.
Deliverables: `custom_fields`, `custom_field_options`, `custom_field_values` (typed sidecar per T1 decision), `custom_field_activations`, `custom_field_sections`; admin UI; value editing on WP form; validation (required/regexp/min-max/multi).
Test plan: unit per field_format (store/read/validate); multi-value; integration RLS; e2e add a list field and set it on a WP.
Development: schema; value service keyed by format; form integration; activation per project/type.
QA: DoD.
Acceptance: *Given* a required list custom field active on type T, *when* a WP of type T is saved without it, *then* validation fails with a field error.

### P3-T07: Import work packages + custom values [L]
Depends on: P3-T03, P3-T05, P3-T06, P2-T09
Goal: the biggest import mapper.
Deliverables: mappers for work_packages (two-pass for `parent_id`, incl. `story_points`/`remaining_hours`), version links (`work_package_versions` kinds on 2026+ sources, synthesized `target` from `version_id` on older ones — data-model §10), relations, watchers, categories link, and custom_values; derived fields recomputed post-load; report.
Test plan: integration against seeded legacy DB: WP counts match, parents/relations correct, custom values present; idempotency.
Development: extract/map/load in FK order; recompute closure + derived; update mapping table.
QA: DoD; lossy items (unknown custom formats) logged.
Acceptance: *Given* an legacy DB, *when* the WP mapper runs, *then* target WP count and parent/relation structure match source.

## Slice C — Queries, scheduling, planning views

### P3-T08: Query DSL + saved queries + table view [L]
Depends on: P3-T05
Goal: the filter/sort/group/columns engine and the work package table.
Deliverables: `queries` (`definition jsonb`), `views`, `query_orderings`; a Zod-validated query DSL; filter operators (from TECHNICAL-PLAN §4.5); the **S-01** table (virtualized DataTable, FilterBar chips, group-by with sums, split-view SidePanel, URL-stable state) with keyset pagination per TECHNICAL-PLAN §13.2; save public/private/star.
Test plan: unit for DSL→SQL translation per operator; unit for permission-scoped visibility; a query-count budget test on the list endpoint (≤15 queries); e2e filter+save+reload+deep-link restore.
Development: DSL parser→Drizzle; S-01 UI; save/pin.
QA: DoD + UIUX §9 gates; §13.1 table budget spot-checked on seeded data.
Acceptance: *Given* a saved public query filtering `status=open`, *when* another member opens it, *then* they see the same filtered list.

### P3-T09: Import queries/views (DSL translation) [M]
Depends on: P3-T08, P3-T07
Goal: translate the legacy system serialized YAML filters to the new DSL.
Deliverables: a YAML-filter→DSL translator, operator map, mappers for queries/views; unknown filters dropped with warnings.
Test plan: unit for a table of known the legacy system filters→expected DSL; integration against seeded DB; idempotency.
Development: parse YAML (safe), map classes+operators; log drops.
QA: DoD; every drop appears in the report.
Acceptance: *Given* a legacy system query with a status filter, *when* imported, *then* it renders the same result set in the new table view.

### P3-T10: Scheduling engine (pure) [L]
Depends on: P3-T05
Goal: the working-days calendar + date math + graph propagation as a pure, tested function.
Deliverables: working-days calendar (instance working days + holidays), duration↔dates math, follows-relation propagation with lag, manual vs automatic mode, parent rollups (dates/effort/progress); golden-master tests.
Test plan: golden-master unit tests capturing documented the legacy system behaviors (a matrix of scenarios: lag, non-working days, manual parent, ignore_non_working_days); no DB needed.
Development: pure functions in `core`; a `reschedule(graph, change)` entry point.
QA: DoD; parity notes recorded in the design doc.
Acceptance: *Given* B follows A with lag 2 and weekends off, *when* A's due date moves, *then* B's start recomputes across the weekend + lag.
Note: this is the highest-risk task; the human should review golden-master cases closely.

### P3-T11: Reschedule job + working-days admin [M]
Depends on: P3-T10, P1-T04
Goal: apply the engine on writes and on working-day changes.
Deliverables: a JobQueue reschedule job triggered by WP date/relation changes and by holiday/working-day edits; admin UI for working days + holidays.
Test plan: integration: change a holiday → dependent WPs reschedule; a WP date change cascades to followers.
Development: hook services into the engine; enqueue jobs; admin UI + settings.
QA: DoD; both profiles (job runs under pg-boss and Inngest).
Acceptance: *Given* a chain of auto-scheduled WPs, *when* an instance holiday is added mid-chain, *then* affected dates shift and an activity records the cause.

### P3-T12: Gantt view [L]
Depends on: P3-T08, P3-T10
Goal: timeline rendering with dependencies and drag-reschedule.
Deliverables: a `gantt` view type over a query: bars, milestones, dependency arrows, zoom; drag to change dates respecting scheduling mode.
Test plan: unit for bar/position math; e2e render + drag a bar and see dates change.
Development: gantt component; wire to query + scheduling.
QA: DoD.
Acceptance: *Given* WPs with follows relations, *when* the gantt renders, *then* arrows connect them and dragging a predecessor reschedules successors.

### P3-T13: Boards (kanban) [L]
Depends on: P3-T08
Goal: free and action boards.
Deliverables: `boards`, `board_columns` (query per column + action value), free/status/assignee/version/subproject/parent board types, drag between columns changes the keyed attribute, manual order (`query_orderings`).
Test plan: unit for action-column attribute application; integration RLS; e2e drag a card and assert the WP attribute changed.
Development: board schema; column-as-query; drag handlers; realtime updates.
QA: DoD.
Acceptance: *Given* a status board, *when* a card is dragged to the "Closed" column, *then* the WP status changes to a closed status and others viewing update live.

### P3-T14: Calendar + team planner [L]
Depends on: P3-T08, P3-T10
Goal: calendar view + assignee swimlanes + ICS feed.
Deliverables: `calendar` and `team_planner` view types; ICS subscription tokens/feed; drag to reschedule/reassign in team planner.
Test plan: unit for ICS generation; e2e reassign in team planner.
Development: views; ICS via a signed token; drag handlers.
QA: DoD.
Acceptance: *Given* a team planner, *when* a WP is dragged to another assignee's row, *then* its assignee updates.

### P3-T15: Import boards/queries-backed views + manual order [M]
Depends on: P3-T09, P3-T13
Goal: map the legacy system grids (boards, my page, overview) + ordered_work_packages.
Deliverables: mappers for `grids`/`grid_widgets`→boards/dashboards and `ordered_work_packages`→`query_orderings`.
Test plan: integration against seeded DB with a board; idempotency.
Development: map grid STI + widget options (query ids remapped).
QA: DoD.
Acceptance: *Given* a legacy system board, *when* imported, *then* the new board shows the same columns and card order.

## Slice D — History, comments, notifications wiring

### P3-T16: Comments + activity feed + reactions [L]
Depends on: P3-T05
Goal: the comment thread and field-change activity on work packages.
Deliverables: `comments` (with `internal` flag placeholder), `activities` (field diffs), `reactions`; WP activity tab UI; mention parsing.
Test plan: unit for diff computation; integration for mention→notification; e2e comment + react.
Development: comment service; activity recorder on WP writes; mention parser feeding P2-T06.
QA: DoD.
Acceptance: *Given* a member comments and @mentions another, *when* saved, *then* a comment appears in the feed and the mentioned user is notified.

### P3-T17: Wire notifications to work packages [M]
Depends on: P3-T16, P2-T06
Goal: real notification triggers (assignment, watching, mention, status change).
Deliverables: triggers on WP events respecting `notification_settings`; reminders on WPs; date-alert scaffold (P1 feature).
Test plan: unit for each reason; integration end-to-end (assign → assignee notified if enabled).
Development: event→notify wiring; reminder job.
QA: DoD.
Acceptance: *Given* a user watching a WP, *when* it changes, *then* they get a notification per their settings.

### P3-T18: Import comments + activity [M]
Depends on: P3-T16, P3-T07
Goal: import journal notes as comments and a simplified activity feed.
Deliverables: mapper from `journals` (notes→comments with author/time; field diffs→activities per T2 decision); reactions from `emoji_reactions`.
Test plan: integration against seeded DB: comment counts match notes count; idempotency.
Development: read journals, map notes + diffs; two-phase reference rewrite for mentions/links.
QA: DoD; history-depth decision (T2) respected and documented.
Acceptance: *Given* a legacy system WP with comments, *when* imported, *then* the comment thread appears with authors and timestamps.

## Slice E — Time, cost, wiki, meetings (P1 modules)

### P3-T19: Time tracking + timer [L]
Depends on: P3-T05
Goal: log time on work packages with activities and a start/stop timer.
Deliverables: `time_entries`, `time_entry_activities` (+ per-project activation), timer (`ongoing`), logging UI, permissions (`log_own_time`/`log_time`/`edit_*`).
Test plan: unit for one-ongoing-timer-per-user; permission tests; e2e log time.
Development: schema; services; timer; UI.
QA: DoD.
Acceptance: *Given* `log_own_time`, *when* a user logs 2h against a WP, *then* the entry appears and totals update.

### P3-T20: Costs + rates [L]
Depends on: P3-T19
Goal: cost entries, cost types, hourly/default/cost rates with valid-from history and rate-visibility permissions.
Deliverables: `cost_types`, `cost_entries`, `rates`; rate resolution by date; visibility gated by `view_hourly_rates`/`view_own_hourly_rate`/`view_cost_entries`.
Test plan: unit for rate resolution by `valid_from`; permission tests for rate visibility; e2e log a cost.
Development: schema; rate resolver; UI.
QA: DoD.
Acceptance: *Given* a user with `view_own_hourly_rate` only, *when* they view costs, *then* they see their own rate but not others'.

### P3-T21: Import time/cost/rates [M]
Depends on: P3-T20, P3-T07
Goal: mappers for time entries, activities, cost types, cost entries, rates.
Deliverables: mappers + tests; report.
Test plan: integration against seeded DB (with costs module data if available); idempotency.
Development: map STI rates; activation join tables.
QA: DoD.
Acceptance: *Given* the legacy system time entries, *when* imported, *then* counts and totals match per project.

### P3-T22: Wiki [L]
Depends on: P3-T01
Goal: per-project wiki with page tree, rich text, versioning, links.
Deliverables: `wikis`, `wiki_pages` (tree, `body` rich, protected), wiki menu, page history via the activity/history tier, `[[wiki]]` link resolution.
Test plan: unit for slug/tree; integration RLS; e2e create + link pages.
Development: schema; editor; link rewriter; menu.
QA: DoD.
Acceptance: *Given* `edit_wiki_pages`, *when* a user creates a child page and links to it, *then* the tree and link resolve.

### P3-T23: Meetings (structured + recurring) [L]
Depends on: P3-T01, P3-T05
Goal: structured meetings with agenda items, sections, participants, outcomes, recurrence, ICS invites, WP links.
Deliverables: `meetings`, `meeting_sections`, `meeting_agenda_items` (with `work_package_id`), `meeting_participants`, `recurring_meetings` (RRULE), ICS invite mails via Mailer.
Test plan: unit for RRULE next-occurrence; integration for ICS; e2e create meeting + agenda item linked to a WP.
Development: schema; recurrence; ICS; UI.
QA: DoD.
Acceptance: *Given* `create_meetings`, *when* a recurring meeting is created, *then* occurrences generate and participants receive ICS invites.

### P3-T24: Import wiki + meetings [M]
Depends on: P3-T22, P3-T23, P3-T18
Goal: mappers for wikis/pages and meetings.
Deliverables: wiki page mapper (latest journal body → `body`, tree from `parent_id`); meeting mapper (structured items; classic minutes → body); report.
Test plan: integration against seeded DB; idempotency.
Development: map + two-phase link rewrite.
QA: DoD; classic-meeting minutes handling documented.
Acceptance: *Given* the legacy system wiki pages, *when* imported, *then* the page tree and content appear with working internal links.

## Slice F — Dashboards, search, my page

### P3-T25: Dashboards (my page + project overview) [M]
Depends on: P3-T08
Goal: configurable widget dashboards.
Deliverables: `dashboards`, `dashboard_widgets`; my page + project overview; a core widget set (assigned WPs, calendar, news, project attributes).
Test plan: unit for layout serialization; e2e add/remove a widget.
Development: schema; widget registry; UI.
QA: DoD.
Acceptance: *Given* a user, *when* they add the "assigned to me" widget, *then* it renders their WPs.

### P3-T26: Global search [M]
Depends on: P3-T05, P1-T04
Goal: full-text search across work packages, projects, wiki via the Search port.
Deliverables: `search_documents` (or generated tsvector columns) + GIN index; reindex job; search UI with permission filtering.
Test plan: integration for indexing + permission-scoped results; e2e search.
Development: FTS via adapter; reindex on write.
QA: DoD; identical on both profiles (Postgres FTS).
Acceptance: *Given* a WP containing a term, *when* a permitted user searches it, *then* it appears; a non-permitted user does not see it.

### P3-T27: Exports (CSV/XLSX/PDF) [M]
Depends on: P3-T08
Goal: export work package lists.
Deliverables: CSV, XLSX, PDF exporters from a query; async for large sets via JobQueue.
Test plan: unit for each format from a fixture; e2e export CSV.
Development: exporters; job for big exports; audit on export.
QA: DoD.
Acceptance: *Given* a query, *when* a user exports XLSX, *then* the file matches the visible columns and rows.

### P3-T28: Backlogs / Scrum + sprint import (P1) [L]
Depends on: P3-T05, P3-T08, P3-T07
Goal: sprints, story points, backlog ordering, burndown — modeled on the legacy system's 2026 standalone-sprints design, plus the importer mapper.
Deliverables: `sprints` (name, state, start/finish, goal via `sprint_goals` equivalent, `sharing` scope for **cross-project sprint sharing** — the SAFe enabler, the legacy system enterprise `sprint_sharing`), sprint backlog + product backlog ordering per UIUX **S-09**, burndown data, start/complete sprint flow; importer mapper handling **both source generations** (2026+ `sprints`/`sprint_goals`/`backlog_buckets`; pre-2026 versions + `version_settings`) per data-model §10.
Test plan: unit for burndown computation + ordering; import generation-detection tests; e2e move a story into a sprint.
Development: schema; backlog UI (S-09); burndown; mapper.
QA: DoD + UIUX §9 gates.
Acceptance: *Given* the backlogs module, *when* a story is dragged into a sprint, *then* it leaves the product backlog and appears in the sprint; *and given* either the legacy system generation, *when* imported, *then* sprints appear with correct membership.

### P3-T29: GitHub/GitLab integration (P1) [M]
Depends on: P3-T05, P3-T16
Goal: link PRs/MRs/issues/pipelines to work packages via inbound webhooks.
Deliverables: `github_links`/`gitlab_links`, inbound webhook endpoints (signature-verified, Zod-validated), WP tab showing links, comment-based linking (mention `#id`).
Test plan: unit for payload parsing + signature; integration webhook→link created; e2e view links on a WP.
Development: webhook routes; parsers; UI tab.
QA: DoD; secrets via env.
Acceptance: *Given* a configured webhook, *when* a PR mentions a WP, *then* a link appears on that WP.

### P3-T30: Full import dry-run + reconciliation + report polish [M]
Depends on: all Phase 3 import tasks
Goal: a single end-to-end import run with a complete, trustworthy report and a source-vs-target reconciliation.
Deliverables: orchestrated full pipeline (`import:legacy` runs all mappers in FK order), consolidated `import-report.json`, a **reconciliation pass** (per-domain source vs target row counts with mismatch flags), `--only`/`--dry-run`/`--source-schema` flags verified, a human-readable summary.
Test plan: integration: full import of a seeded legacy demo database in both source topologies (mode A and mode B); assert totals, reconciliation clean, zero unexpected drops; idempotency across a second run.
Development: orchestration; report aggregation; reconciliation queries.
QA: DoD; every lossy category from data-model §10 surfaced in the report.
Acceptance: *Given* a legacy demo database, *when* `import:legacy` runs to completion, *then* the report shows mapped counts, reconciliation passes, all skips explained, and a re-run makes no changes.

### P3-T31: Favorites + quick navigation [S]
Depends on: P2-T11, P3-T01, P3-T08
Goal: star projects and saved views; surface them in the sidebar and Home (beats the legacy system's deep-menu navigation; parity with its 2025 `favorites`).
Deliverables: `favorites` (polymorphic: project/query), star toggles on project header and view switcher, sidebar Favorites section (drag-reorder), Home favorites row; importer mapper for the legacy system `favorites`.
Test plan: unit for toggle idempotency; e2e star a project → appears in sidebar → reorder persists.
Development: schema + RLS; UI; mapper.
QA: DoD + UIUX §9 gates.
Acceptance: *Given* a user stars a project, *when* they reload, *then* it sits in their Favorites in their chosen order.

### P3-T32: Command palette + keyboard shortcuts + quick create [M]
Depends on: P2-T11, P3-T26
Goal: the ⌘K layer from UIUX-PLAN §3/**S-08** — the headline UX differentiator over the legacy system.
Deliverables: CommandPalette component wired to Search port + client recents (actions, entity jump by #id/title, navigation), `+ New` quick-create (WP from anywhere with project picker, project, meeting), global shortcut set from UIUX §4 registered in the `?` overlay, `/` inline search focus.
Test plan: component tests for palette keyboard flow; e2e: ⌘K → type WP id → land on it; `c` creates a WP in project context.
Development: palette; quick-create modal; shortcut wiring.
QA: DoD + UIUX §9 gates; palette results respect permissions.
Acceptance: *Given* any screen, *when* the user presses ⌘K and types a work package id, *then* they land on that work package within the §13 budget.

### P3-T33: Project lifecycle phases & gates (optional — human gates) [M]
Depends on: P3-T01, P3-T05
Goal: parity with the legacy system's stage/gate project life cycle — the PM²/PMflex/PRINCE2 governance backbone — **only if the human funds it** (REQUIREMENTS marks it P2; skip = `skipped` in STATUS.md with sign-off).
Deliverables: workspace-level phase definitions (name, position, color, **start/finish gates with names** per data-model reference §5), per-project phases with date ranges, WP `project_phase_id`, gantt/overview phase strip incl. gate markers, project-list gate columns/filters; importer mapper for `project_phases`/`project_phase_definitions` (incl. gate columns).
Test plan: unit date-range + gate-name validation; import test; e2e assign a WP to a phase and see the gate on the overview strip.
QA: DoD.
Acceptance: *Given* phase definitions with a finish gate "Ready for Executing", *when* a project activates phases with dates, *then* WPs can be assigned to a phase and the overview strip shows phases and gate markers, filterable in the project list.

**Phase 3 exit checklist:** all P0 work-management modules usable end to end; P1 modules (time/cost, wiki, meetings, calendar/team planner, backlogs, GitHub/GitLab) shipped or explicitly deferred by the human; favorites + command palette live; a full the legacy system demo import runs green and idempotent; e2e happy paths for every P0 feature pass under both profiles; §13.1 budgets spot-checked on the primary surfaces (table, board, gantt, palette).

---

# Phase 4 — Strategy: OKR, KPI, Check-ins & Tasks

The product's namesake modules, scoped from the FlowyTeam source: the strategy pillar (OKR cycles, objectives and key results with a pure scoring engine, KPIs with per-period records and calculated formulas, check-ins, scorecard), the tasks-into-work-packages unification, and the FlowyTeam importer. Starts with a design gate.

Spec authorities for Phase 4: schema → TECHNICAL-PLAN.md §4.12 (+ §7.6 FlowyTeam mapping); scoring engine → TECHNICAL-PLAN.md §6.2; task unification → TECHNICAL-PLAN.md §4.12; UI → UIUX-PLAN.md §6 (S-16…S-23); source facts → `reference/flowyteam-okr-kpi-tasks-model.md`. The OKR AI assists build on Phase 5 and are indexed there as P5-T11.

### P4-T00: OKR/KPI/Tasks design gate [DESIGN GATE] [L]
Depends on: Phase 3 complete
Goal: write `docs/design/11-okr-kpi-model.md`, `12-scoring-engine.md`, `13-flowyteam-importer.md`, formalizing the TECHNICAL-PLAN §4.12 schema, the §6.2 scoring-engine spec (with the golden-master case list), the §4.12 task-unification rules, the UIUX-PLAN §6 screen specs, the OKR/KPI permission set (TECHNICAL-PLAN §4.12), and the FlowyTeam→target mapping (TECHNICAL-PLAN §7.6) as living tables.
Deliverables: the three design docs; Zod schemas sketched for the KPI formula expression tree, the query filters for OKR/KPI lists, and check-in inputs; acceptance criteria as Given/When/Then per module.
Test plan: n/a (docs). Reviewer checks completeness against REQUIREMENTS §3 and `reference/flowyteam-okr-kpi-tasks-model.md`.
QA: every P0 module here has a design section and testable acceptance criteria; the scoring engine golden-master cases are enumerated.
Acceptance: **human approves** with "Design approved for Phase 4" before any Phase 4 implementation task starts.

### P4-T01: Org units + membership + designations [M]
Depends on: P4-T00, P2-T01
Goal: the OKR/KPI owner model — teams/departments as a tree, with members and leads.
Deliverables: `org_units` (tree, `kind`, `lead_id`), `org_unit_members`, optional `org_unit_hierarchy` closure; a light designation attribute on the user profile; CRUD API + admin UI; migration + RLS.
Test plan: unit for tree ops (move subtree, cycle prevention); integration RLS; e2e create a team under a parent and add members.
Development: schema + RLS; closure maintenance; tRPC; UI; audit on create/delete.
QA: DoD.
Acceptance: *Given* `manage_org_units`, *when* a user creates a team under a parent and assigns a lead, *then* it appears in the org tree and can own objectives/KPIs.

### P4-T02: OKR cycles + settings [M]
Depends on: P4-T01
Goal: cycles that bound OKRs by date, generated from a cadence, plus workspace OKR/KPI settings.
Deliverables: `okr_cycles` (cadence, dates, status, previous link, lock), `performance_settings` (cadence, quotas, RAG thresholds, labels); cycle auto-generation from cadence (pure date math, honoring workspace timezone); admin UI (S-23) for create/archive/next-cycle; migration + RLS.
Test plan: unit for cadence→cycle name/date generation across all six cadences (quarter/half/year boundaries, timezone); integration RLS; e2e switch active cycle.
Development: pure cycle generator in `core`; settings service with Zod; admin UI; audit on cycle create/archive.
QA: DoD + UIUX §9 gates.
Acceptance: *Given* a workspace with quarterly cadence, *when* the current date is 2026-08-01, *then* the active cycle is "Q3 2026" with the correct bounds, auto-created if absent.

### P4-T03: Objectives + key results schema + CRUD [L]
Depends on: P4-T02
Goal: the OKR core objects with ownership, weights, confidence, and values.
Deliverables: `objectives` (owner_type/team_id/user_id, lead, two alignment pointers, weight, confidence, derived result/status), `key_results` (numeric range, direction, unit, weight, confidence, KPI-backed slot, work_package link slot), `key_result_values` history; CRUD API with optimistic locking; create/edit UI; weight/confidence clamping; move-OKR-between-cycles.
Test plan: unit for weight clamp + owner resolution + alignment single-parent invariant; integration RLS + cascade delete; e2e create objective with two KRs.
Development: schema (TECHNICAL-PLAN §4.12) + RLS; services + permission checks per the OKR/KPI permission set; UI per S-16/S-17 create flows; audit.
QA: DoD + UIUX §9 gates.
Acceptance: *Given* `manage_objectives` in an active cycle, *when* a user creates an objective owned by their team with two weighted KRs, *then* it persists with `result_percentage = 0`, `status = not_tracked`, and appears in the explorer.

### P4-T04: Scoring & alignment engine (pure) [L]
Depends on: P4-T03
Goal: the weighted rollup, direction-aware progress, cascade, RAG, and status as a pure tested function.
Deliverables: `packages/core` functions for KR progress (direction-aware, capped), objective score (weighted incl. child KRs), upward cascade with cycle detection, RAG from thresholds, status from confidence; a `recomputeOkr(graph, change)` entry point; derived columns updated via a job on write; golden-master tests.
Test plan: golden-master unit tests capturing FlowyTeam behaviors (weighted rollup, decrease-goal KR, aligned child cascade, KPI-backed KR, equal-endpoint→0); no DB needed. A cascade-cycle test asserts termination.
Development: pure functions; invalidation job hooking KR/objective writes.
QA: DoD; parity notes in `docs/design/12-scoring-engine.md`.
Acceptance: *Given* objective A with KRs of weights 2 and 1 at 100% and 40%, *when* recomputed, *then* A's score is 80%; *and given* a child objective aligned under a parent KR, *when* the child score changes, *then* the parent objective score updates.
Note: highest-risk Phase 4 task; the human reviews golden masters closely.

### P4-T05: OKR check-ins [M]
Depends on: P4-T04, P2-T06
Goal: dated check-in snapshots for objectives and key results, sessions, and a review step.
Deliverables: `check_in_sessions`, `check_ins` (polymorphic subject, confidence, value, remark, category), `check_in_reviews`; check-in flow UI (S-21); confidence/value updates feed the engine and record history; discussion via `comments`.
Test plan: unit for snapshot creation + engine recompute on check-in; integration for session submit → review; e2e a weekly check-in updating a KR and confidence.
Development: schema + RLS; check-in service; UI; notification trigger (check-in due) on the P2-T06 spine.
QA: DoD + UIUX §9 gates.
Acceptance: *Given* an open check-in, *when* a user sets a KR value and confidence 6 with a "blocker" remark, *then* the KR progress and objective status recompute and a dated snapshot is stored.

### P4-T06: OKR views UI (explorer, detail, alignment) [L]
Depends on: P4-T04
Goal: the primary OKR surfaces.
Deliverables: S-16 explorer (scope tabs, cycle switcher, RAG/confidence chips, inline edit, group-by owner, virtualized list/tree), S-17 objective detail (score ring, KRs with inline check-in, alignment panel, discussion, activity, watchers), S-18 alignment diagram (pan/zoom cascade tree); URL-stable state.
Test plan: component tests for inline edit + keyboard; unit for diagram layout from parent pointers; e2e explorer → detail → check-in → score updates live.
Development: UI on `packages/ui`; realtime score updates; palette entries.
QA: DoD + UIUX §9 gates; §13.1 list budget spot-checked.
Acceptance: *Given* the explorer filtered to the current cycle, *when* a KR is checked in from the detail panel, *then* the objective's progress and RAG update live in both the detail and the explorer row.

### P4-T07: KPIs + categories + records [L]
Depends on: P4-T02
Goal: KPIs with periods, targets vs actuals, and RAG.
Deliverables: `kpi_categories`, `kpi` (frequency, unit, direction, target, thresholds, tree), `kpi_records` (unique per period), `kpi_shares`; period-bucket normalization; achievement % + RAG (direction-aware); CRUD + record-entry API; KPI grid UI (S-19).
Test plan: unit for period-key normalization per frequency + achievement % (both directions) + RAG bands; integration RLS + unique-per-period; e2e record an actual and see RAG.
Development: schema (TECHNICAL-PLAN §4.12) + RLS; period + scoring helpers in `core`; S-19 grid; audit.
QA: DoD + UIUX §9 gates.
Acceptance: *Given* a monthly KPI (fail 50/pass 75, target 100), *when* a user records 80 for July, *then* the July cell shows 80% in amber and is unique for that period.

### P4-T08: KPI formula engine (calculated KPIs) [L]
Depends on: P4-T07
Goal: calculated KPIs from a formula over other KPIs, with cross-frequency aggregation and cascade recompute.
Deliverables: a typed formula expression tree (Zod), `kpi_dependencies` edges, a safe evaluator (no `eval`) that resolves `kpi(id)` references, aggregates finer-frequency source records via the `aggregate` function, writes the parent record, and cascades through dependents with cycle detection; formula builder UI (S-20).
Test plan: unit for expression evaluation (operators, parentheses, precedence), cross-frequency aggregation (daily→monthly sum/avg), cascade + cycle detection, divide-by-zero handling; e2e build a "sum of two KPIs" and see it recompute.
Development: parser/evaluator in `core`; dependency graph; recompute job; UI.
QA: DoD; no `eval`; golden masters from FlowyTeam formula cases.
Acceptance: *Given* KPI C = A + B where A,B are monthly, *when* A's July actual changes, *then* C's July record recomputes and any KPI depending on C recomputes.

### P4-T09: KPI ↔ key result linkage [M]
Depends on: P4-T07, P4-T03, P4-T04
Goal: measure a key result by a KPI.
Deliverables: `key_result_kpis` link; a KPI-backed KR reads its progress from the KPI's latest achievement (engine path from P4-T04); UI to attach a KPI on the KR editor and show the live value.
Test plan: unit for KPI-backed KR progress in the engine; integration link create/remove; e2e attach a KPI to a KR and see the KR progress track the KPI.
Development: link schema + RLS; engine branch; UI.
QA: DoD.
Acceptance: *Given* a KR linked to a monthly KPI at 80% achievement, *when* the objective recomputes, *then* the KR contributes 80%.

### P4-T10: KPI views UI (grid, detail, tree, dashboards) [M]
Depends on: P4-T07, P4-T08
Goal: the KPI surfaces and dashboard widgets.
Deliverables: S-19 grid polish (period columns, inline entry, grouping), S-20 detail (period chart + parent/child tree + formula builder), KPI dashboard widgets (single KPI, category rollup) for the dashboards from P3-T25.
Test plan: component tests for grid inline entry + keyboard; e2e edit a cell and see RAG + any dependent KPI update.
Development: UI; widgets registered with the dashboard registry (P3-T25).
QA: DoD + UIUX §9 gates; §13.1 grid budget spot-checked.
Acceptance: *Given* the KPI grid, *when* a user edits a period cell, *then* the cell RAG updates optimistically and dependent calculated KPIs refresh live.

### P4-T11: Performance snapshot + scorecard (points off by default) [M]
Depends on: P4-T04, P4-T07
Goal: per-owner per-cycle rollup and an optional points layer.
Deliverables: `performance_snapshots` (result value + RAG bucket counts), an archive job that recomputes them per owner on cycle close; `scorecard_settings` (all toggles, **points off by default**), `score_entries` created only when points enabled; scorecard UI (S-22) + export.
Test plan: unit for snapshot aggregation (weighted result, bucket counts); integration archive on cycle close; e2e view a scorecard; a test asserting no `score_entries` exist when points disabled.
Development: archive job; settings; UI; audit on archive.
QA: DoD.
Acceptance: *Given* a closed cycle, *when* it is archived, *then* each owner has a snapshot with correct RAG bucket counts, and points exist only if the scorecard points toggle is on.

### P4-T12: Tasks unification into work packages [L]
Depends on: P3-T05, P4-T03
Goal: extend work packages to cover FlowyTeam tasks and link work to OKR/KPI.
Deliverables: new columns on `work_packages` (`objective_id`, `key_result_id`, `kpi_id`, `recurrence jsonb`), `checklist_items` table, recurrence expansion job, board-column↔status mapping honored, the "cannot complete while blockers open" guard, task↔KR backlink kept in sync; UI: OKR/KPI link picker on the work-package detail (S-02), checklist section, recurrence editor; the work-package table gains an "OKR" filter.
Test plan: unit for recurrence expansion + blocker guard + KR backlink sync; integration RLS on new columns; e2e link a task to a KR and complete a checklist item.
Development: migration + RLS (link columns + checklist); recurrence job; UI additions to S-02.
QA: DoD + UIUX §9 gates.
Acceptance: *Given* a work package, *when* a user links it to a key result and adds two checklist items, *then* the KR shows the linked work and the checklist tracks done/total without rolling up to the task status.

### P4-T13: FlowyTeam importer — read-only MySQL source + company selection [L]
Depends on: P2-T09
Goal: extend the importer to a second source: a read-only MySQL FlowyTeam database, selecting one company per workspace.
Deliverables: a source abstraction so `import:legacy --from flowyteam --source <MYSQL_URL> --company <id> --workspace <slug> [--dry-run]` connects read-only to MySQL, introspects, asserts required OKR/KPI/task tables exist, guesses the FlowyTeam version, and writes an (empty) report; the `(legacy_type, legacy_id)→uuid` map keyed with `legacy_type='flowyteam'`; multi-company guardrail (refuse to run without `--company`).
Test plan: integration against a seeded FlowyTeam MySQL database: connect, introspect, refuse to write to the source, refuse without `--company`, detect core tables.
Development: MySQL read-only client (the one pre-approved importer dependency, CLAUDE.md importer rules); source-selector flag; introspection; report writer.
QA: DoD; verify the source connection cannot write (attempt an insert, expect failure).
Acceptance: *Given* a FlowyTeam MySQL DB, *when* `import:legacy --from flowyteam --company 7 --dry-run` runs, *then* it prints a schema summary for company 7 and writes an empty report without touching the source.

### P4-T14: FlowyTeam importer — org, cycles, objectives, KRs, check-ins [L]
Depends on: P4-T13, P4-T05
Goal: the OKR mappers.
Deliverables: mappers for `teams`→`org_units` (rebuild tree, drop `_lft`/`_rgt`), `other_departments`→`org_unit_members`, `performance_settings`/`performance_cycles`, `objectives`→`objectives` (owner from `model_type`, two alignment pointers, two-pass for `objective_parent_id`), `key_results` (numeric values, direction inferred from initial vs target), `key_result_records`+check-in snapshots→`key_result_values`/`check_ins`, `objective_checkins`/`key_result_checkins`→`check_ins`, discussions→`comments`; derived scores recomputed post-load; report with lossy items.
Test plan: integration against seeded FlowyTeam DB: objective/KR counts match, alignment tree correct, recomputed scores match a documented expectation; idempotency (run twice).
Development: extract/map/load in FK order (`reference/flowyteam-okr-kpi-tasks-model.md` §11); recompute via the P4-T04 engine; update the mapping table.
QA: DoD; lossy items (broken `objective_type`, truncated targets) logged.
Acceptance: *Given* a FlowyTeam company, *when* the OKR mappers run, *then* objectives/KRs match source counts, ownership and alignment are correct, and re-running changes nothing.

### P4-T15: FlowyTeam importer — KPIs, categories, records, formulas [L]
Depends on: P4-T13, P4-T08, P4-T09
Goal: the KPI mappers.
Deliverables: mappers for `indicator_types`→`kpi_categories`, `indicators`→`kpi` (owner from `model_type`, `occurance`→`frequency`, tree via `indicator_parent_id`, thresholds), `indicator_records`→`kpi_records` (period-key normalized, unique), `indicator_calculates`+`calculated_value` token strings→`formula` expression trees + `kpi_dependencies`, `keyresult_indicator`→`key_result_kpis`, `indicator_accesses`→`kpi_shares`; recompute achievements; report.
Test plan: integration against seeded FlowyTeam DB: KPI counts match, records unique per period, a calculated KPI's formula translates and recomputes to the same value; unparseable formulas dropped with a warning; idempotency.
Development: token-string→expression-tree translator; extract/map/load; update mapping table.
QA: DoD; every dropped formula and `direction=down` re-score appears in the report.
Acceptance: *Given* FlowyTeam KPIs including a calculated one, *when* imported, *then* categories/KPIs/records match and the calculated KPI recomputes to the source value (or is logged if untranslatable).

### P4-T16: FlowyTeam importer — tasks into work packages [L]
Depends on: P4-T13, P4-T12, P3-T07
Goal: import FlowyTeam tasks as work packages with OKR links.
Deliverables: mappers for `taskboard_columns`→`statuses`/board columns, `task_boards`→boards, `task_category`→`categories`, `tasks`→`work_packages` (state from board column, `key_results_id`→`key_result_id` + derived `objective_id`, single assignee, two-pass for `dependent_task_id`→relations and `recurring_task_id`), `sub_tasks`→`checklist_items`, `tasks_accesses`→watchers, `task_comments`→`comments`, `task_files`→`attachments`/`file_links`, `project_time_logs`→`time_entries`; report.
Test plan: integration against seeded FlowyTeam DB: task counts match, board state correct, OKR links present, checklist items attached, dependencies become relations; idempotency.
Development: extract/map/load; two-phase reference rewrite of HTML→Markdown bodies; update mapping table.
QA: DoD; external file links logged (not copied).
Acceptance: *Given* FlowyTeam tasks linked to KRs, *when* imported, *then* they appear as work packages in the right board columns with the KR link and checklist intact.

### P4-T17: FlowyTeam full import dry-run + reconciliation + report [M]
Depends on: P4-T14, P4-T15, P4-T16
Goal: one end-to-end FlowyTeam import with a trustworthy report and reconciliation.
Deliverables: orchestrated full pipeline for `--from flowyteam` (all Phase 4 mappers in FK order), consolidated `import-report.json`, a per-domain source-vs-target reconciliation (counts per company), `--only`/`--dry-run`/`--company` verified, a human-readable summary; coexistence with the Rails-source rows verified (both `legacy_type`s in the same tables).
Test plan: integration: full import of a seeded FlowyTeam company in dry-run and real modes; assert totals, reconciliation clean, zero unexpected drops; idempotency; a mixed-source test loading both an OpenProject demo and a FlowyTeam company into one workspace with no id collisions.
Development: orchestration; report aggregation; reconciliation queries.
QA: DoD; every lossy category from `reference/flowyteam-okr-kpi-tasks-model.md` §11 surfaced.
Acceptance: *Given* a seeded FlowyTeam company, *when* `import:legacy --from flowyteam --company N` runs, *then* the report shows mapped counts, reconciliation passes, all skips explained, and a re-run makes no changes.

### P4-T18: OKR/KPI reminders + notifications [M]
Depends on: P4-T05, P4-T07, P2-T06
Goal: real triggers on the notification spine (replacing FlowyTeam's single daily digest).
Deliverables: notification reasons + triggers for check-in due, cycle opening/closing, key result at-risk (confidence 1–4 or overdue), KPI period due, objective/KR mention and assignment; per-user, per-channel settings; a digest option.
Test plan: unit per reason; integration end-to-end (cycle closes → owners notified if enabled); e2e a check-in-due reminder.
Development: event→notify wiring on P2-T06; reminder jobs; settings.
QA: DoD; both runtime profiles.
Acceptance: *Given* an active cycle nearing its end and a user with the setting on, *when* the reminder job runs, *then* they receive a "check-in due" notification.

### P4-T19: OKR/KPI/Tasks REST + MCP-compatible API [M]
Depends on: P4-T03, P4-T07, P4-T12
Goal: a clean public surface mirroring FlowyTeam's v2/MCP shapes.
Deliverables: REST `/api/rest/v1` resources for `objectives`, `key-results`, `okr-cycles`, `kpi`, `kpi-records`, `kpi-categories`, `tasks` (work packages), `task-categories`, with cursor pagination, scoped tokens, OpenAPI from Zod; MCP tool definitions matching the field lists in `reference/flowyteam-okr-kpi-tasks-model.md` §8 (FlowyTeam's own tool names stay as documented there); form-validation endpoints for objective/KR/KPI create.
Test plan: contract tests per resource; a compatibility test asserting the documented canonical fields exist; e2e create an objective via REST.
Development: REST routers; OpenAPI; MCP tool registration behind the AIProvider/adapter.
QA: DoD; scoped-token auth verified.
Acceptance: *Given* a scoped token, *when* a client POSTs an objective with title + owner + cycle, *then* it is created and returned with the canonical field shape.
Note: the **actual MCP server** (transports, auth, per-user enforcement) is built in Phase 5 (P5-T09) on top of these REST/field shapes; P5-T09 depends on this task.

**Phase 4 exit checklist:** OKR core usable end to end (create objectives/KRs in a cycle, align them, check in, see scores and RAG update live); KPI core usable (categories, indicators, per-period records with RAG, calculated KPIs recomputing, KR↔KPI links); tasks unified into work packages with OKR/KPI links, checklists, recurrence, and the blocker guard; scoring-engine golden-master tests pass and the alignment cascade terminates on cycles; scorecard snapshots archive on cycle close with points off by default; the FlowyTeam importer runs a full company import green and idempotent, reconciliation clean, coexisting with Rails-source rows in one workspace; real RBAC enforces OKR/KPI permissions (no module-only gating); reminders fire on the notification spine and the public REST surface matches the documented shapes; all UI passes UIUX §9 gates and the §13.1 budgets on the OKR explorer and KPI grid. (The OKR AI assists are delivered in Phase 5 as P5-T11.)

---

# Phase 5 — The AI layer (AI-native)

The AI domain: the provider abstraction with bring-your-own-key and local models, the admin AI console, usage/cost metering, the permission-checked tool registry, the in-app copilot, embeddings/RAG, the MCP server that lets any AI agent drive OKRs and projects as the user, and the per-module AI assists over the OKR and work-management surfaces. **Full task detail — deliverables, test plan, development, QA, acceptance — lives in [AI-NATIVE-PLAN.md](AI-NATIVE-PLAN.md) §12.** This section is the index.

Two foundations reach earlier by design: the AIProvider port interface + `off` driver ship in P1-T04, and `manage_ai` joins the permission catalogue in P2-T01. The per-module assist tasks (P5-T11, P5-T12) sit at the end of this phase because they depend on both the AI foundation (P5-T06/T07) and their module cores (Phase 3 work management, Phase 4 OKR). It opens with a design gate.

Spec authorities for Phase 5: architecture → AI-NATIVE-PLAN.md §3–§6; schema → §7 (+ DATABASE.md domain S); security → §8; UI → UIUX-PLAN.md §4 + S-24/S-25; provider reference shapes → `reference/flowyteam-okr-kpi-tasks-model.md` §8.

| Task | Title | Depends on | Goal (one line) |
|---|---|---|---|
| P5-T00 | AI design gate [DESIGN GATE] | Phase 4 complete | design docs 14–16 (ai-architecture, mcp-server, ai-safety); human approves "Design approved for Phase 5" |
| P5-T01 | AIProvider port full surface + drivers | P1-T04 | chat/stream/tools/embed/extract/capabilities; anthropic/openai/google/openrouter/ollama/openai-compatible/off; contract tests on both runtimes |
| P5-T02 | AI config + BYO-key + encryption | P5-T01, P2-T07 | providers/credentials, envelope encryption, precedence resolver, test-connection, Provider card (S-24) |
| P5-T03 | Model catalog + routing | P5-T02 | catalog (seed+refresh+validate), tier policies, sampling/JSON-mode |
| P5-T04 | Usage + cost metering + quotas + caps | P5-T02, P1-T04 | usage events, cost from catalog, token/cost/call quotas, hard caps, usage dashboard + logs |
| P5-T05 | Structured output + prompt registry | P5-T03 | extract with Zod validation + retry; versioned prompts + editor; per-feature toggles |
| P5-T06 | Tool registry + agent authz + confirmation | P5-T05, P2-T02 | core tool registry (Zod + per-tool permission), tool-use loop, write preview/confirm, tool-call audit, deny-by-default + RLS |
| P5-T07 | Embeddings + RAG | P5-T01, P3-T26 | pgvector embeddings, indexing job, permission-filtered hybrid retrieval, FTS degradation |
| P5-T08 | In-app copilot | P5-T06, P5-T07, P2-T11 | threads/messages, copilot SidePanel (S-25), streaming, grounded answers + confirmed actions, degradation |
| P5-T09 | MCP server (inbound) | P5-T06, P4-T19, P2-T12 | stdio + Streamable HTTP, scoped-token auth, per-user identity + RLS + `can()`, tool/resource/prompt catalog, rate limit, audit, token admin (S-24) |
| P5-T10 | AI eval + safety harness + CI | P5-T05, P5-T06 | golden fixtures, mock provider, schema/tool/latency/no-leak asserts, `AI_PROVIDER=off` degradation leg, egress + redaction + base-URL SSRF checks |
| P5-T11 | OKR AI authoring + coaching | P5-T06, P4-T04, P4-T05 | generator / rate / improve / suggest / align / check-in-draft / coach on the AI foundation; proposes-then-confirms; provenance; hidden when AI is `off` |
| P5-T12 | Work / project AI assists + NL-query | P5-T06, P5-T07, P3-T08, P3-T16, P3-T23 | WP summary, objective→WP decomposition, draft WP, meeting-notes→actions, wiki draft/Q&A, NL→query DSL, project-status narrative |

Both P5-T11 and P5-T12 propose-then-confirm, are toggleable and quota-bound (AI-NATIVE-PLAN.md §4), write AI provenance (`ai_generated`/`ai_source_id`), and are hidden when AI is `off` — the manual create/edit paths (P4-T03 for OKR; the Phase 3 work-management tasks) are unchanged. P5-T11 is the direct upgrade of the source product's OKR AI tool (AI-NATIVE-PLAN.md §11); it must not regress the manual OKR flow. P5-T12's NL-query emits a validated §4.5 query DSL, never raw SQL.

**Phase 5 exit checklist:** in AI-NATIVE-PLAN.md §12 and §15 (port on both runtimes with a hosted + local driver; admin can configure / BYO-key / route tiers / toggle features / budget / monitor; the tool registry enforces `can()` + RLS for every action; the copilot answers grounded and applies confirmed writes; the MCP server drives OKRs/projects as the authenticated user within scope, fully audited; RAG runs locally where required and degrades to FTS; the OKR authoring assists (P5-T11) and work/meeting/wiki assists (P5-T12) are live; the eval harness is green and the `AI_PROVIDER=off` leg proves every P0 flow still works; every AI table ships `workspace_id` + RLS; no secret is logged).

---

# Phase 6 — Hardening

### P6-T01: Performance budgets + indexing at scale [L]
Depends on: Phase 3
Goal: hit the ~2s list-view target at university scale.
Deliverables: seed a large dataset (tens of thousands of WPs); add/verify indexes; pagination + keyset for large lists; query plans reviewed; performance tests in CI.
Acceptance: primary list/gantt/board views render within budget on the large dataset.

### P6-T02: Load & soak testing [M]
Depends on: P6-T01
Goal: prove stability under concurrent load.
Deliverables: load-test scripts (thousands of users, one workspace); results + fixes.
Acceptance: no errors and within budget under target concurrency.

### P6-T03: Backup & restore [M]
Depends on: Phase 3
Goal: documented, tested backup/restore for self-hosters.
Deliverables: a backup job (DB + files) and a restore runbook; a `backups` record of runs.
Acceptance: a restore from a backup reproduces the workspace.

### P6-T04: Observability [M]
Depends on: Phase 3
Goal: OpenTelemetry with self-hostable backends, opt-in.
Deliverables: OTel instrumentation, dashboards (Grafana stack), documented opt-in; no telemetry leaves the instance by default.
Acceptance: traces/metrics visible in a self-hosted backend when enabled.

### P6-T05: Security review + supply chain [M]
Depends on: Phase 3
Goal: pass a baseline security review against the TECHNICAL-PLAN §8.2 control checklist.
Deliverables: every §8.2 control verified or ticketed; CSP/headers audit, dependency audit, SBOM on releases, signed images verified, RLS coverage audit (automated: migration linter proving every business table has a policy), rate-limit coverage, SSRF checks on outbound URLs, PDPA/GDPR export + erasure flows tested.
Acceptance: no high findings open; the §8.2 table has a ✅ or an accepted-risk note per row, signed off by the human.

### P6-T06: Accessibility audit + Web Vitals budgets in CI [M]
Depends on: Phase 3
Goal: enforce UIUX-PLAN §7 (WCAG 2.1 AA) and TECHNICAL-PLAN §13.1 continuously.
Deliverables: axe-driven Playwright checks across every UIUX §6 screen (S-01…S-25) wired into CI; keyboard-only walkthrough scripts for the P0 flows; Lighthouse/Web Vitals budget job (LCP/INP/CLS thresholds from §13.1) on the seeded large dataset; a11y fixes from the audit; documented screen-reader smoke procedure.
Test plan: the deliverable is tests; the task fails while any S-xx screen has serious/critical axe violations or budget breaches.
Acceptance: CI blocks a PR that introduces a serious axe violation or busts a Web Vitals budget on the audited screens.

### P6-T07: Cutover rehearsal + rollback drill [M]
Depends on: P3-T30
Goal: prove the maintenance-window cutover and the rollback path from TECHNICAL-PLAN.md §7.2 on a realistic copy.
Deliverables: a documented cutover runbook (maintenance mode → backup → dry-run → import → reconcile → switch → rollback window); a **mode B** migration script (legacy schema + new schema in one Postgres instance, old schema left read-only); a tested rollback (switch back to the read-only old schema); a reconciliation report artifact.
Test plan: rehearsal against a restored real-shaped dataset: run the full runbook end to end, then execute the rollback and confirm the old app still serves read-only.
Development: runbook; mode-B SQL wrapper; read-only lockdown of the source schema; rollback steps.
QA: DoD; reconciliation clean; rollback verified; every lossy item acknowledged by a human sign-off checkbox in the runbook.
Acceptance: *Given* a production-shaped dataset, *when* the cutover runbook runs, *then* the new app serves the migrated data, reconciliation passes, and rollback restores read-only access to the original within the window.

---

# Phase 7 — Enterprise pack

### P7-T01: SSO (OIDC + SAML) [L]
Depends on: Phase 2
Goal: OIDC and SAML via Better Auth for institutions.
Acceptance: a user logs in via a configured OIDC/SAML provider and is provisioned.

### P7-T02: LDAP sync + groups [L]
Depends on: P7-T01
Goal: LDAP auth source + group sync.
Acceptance: LDAP users/groups sync and map to roles.

### P7-T03: SCIM provisioning [M]
Depends on: P7-T01
Acceptance: a SCIM client can create/deactivate users.

### P7-T04: 2FA (TOTP + WebAuthn) [M]
Depends on: Phase 2
Acceptance: a user enrolls TOTP/passkey and is challenged on login; backup codes work.

### P7-T05: Audit export + advanced Helm + air-gap guide [M]
Depends on: Phase 6
Acceptance: audit events export; Helm values cover HA/external services; a documented air-gap install (AI off, no external calls) succeeds.

### P7-T06: Enterprise feature gating [M]
Depends on: P7-T01
Goal: the paid-tier gate (only if the human chooses open-core).
Deliverables: a licensing check analogous to `enterprise_tokens` gating the agreed feature set (see feature inventory §3); **requires human decision** on which features are gated.
Acceptance: gated features are unavailable without a valid license and degrade gracefully.

### P7-T07: Project initiation request wizard [L]
Depends on: P3-T01, P3-T33
Goal: guided multi-step project creation for governance-heavy orgs — the legacy system's PM²/PMflex `project_creation_wizard` equivalent (enterprise there; placement here is a human pricing decision, see P7-T06).
Deliverables: mark a template project as a wizard basis; a multi-step creation flow (collect key attributes, roles/members, department; produce the project from the template) with a submission work package (the "initiation request" artifact) and optional PDF export of the request; admin settings per template (wizard steps, artifact type/status).
Test plan: unit for step validation; e2e run the wizard from a seeded PM²-style template to a created project with the artifact WP.
QA: DoD; wizard respects `add_project` permission and audit-logs creation.
Acceptance: *Given* a template configured as a wizard, *when* a user completes the steps, *then* a project is created from the template with the collected attributes and an initiation-request work package attached.

---

# Phase 8 — Community launch

### P8-T01: Docs site [M] — user + admin + API docs, importer runbook.
### P8-T02: One-click deploy buttons [S] — Vercel + Compose + Helm quickstarts.
### P8-T03: Hosted demo instance [M] — seeded demo, reset on schedule.
### P8-T04: Contributor onboarding [S] — CONTRIBUTING, good-first-issues, CLA bot.
### P8-T05: Launch [S] — release, changelog, posts.

### P8-T06: Methodology template gallery + guides [M]
Depends on: P3-T01 (templates), P3-T13, P3-T28, P4-T03 (OKR template); enriched by P3-T33 and P7-T07 if built
Goal: ship the standards support promised in REQUIREMENTS §4: ready-made, seeded template projects + short guides for **PM², PMflex, PRINCE2, SAFe, Scrum, and OKR** (no per-methodology code — templates and docs only, matching how the legacy system delivers this).
Deliverables: one seeded template project per methodology (PM²/PMflex: four phases with gates where P3-T33 exists, artifact WP types like Business Case/Project Handbook, standard meeting agendas; PRINCE2: stage-gate template with tolerances register pattern; SAFe/Scrum: program + team projects with shared sprints and boards; OKR: a starter cycle with sample objectives/key-results wired to the native Strategy module from Phase 4), selectable from the onboarding template gallery (UIUX S-15); a docs-site guide per methodology mapping its terms to product features.
Test plan: seed test instantiating each template and asserting its structure (types, phases/gates, boards, sprints present); e2e create-project-from-template for one methodology.
QA: DoD; templates work without any enterprise/optional feature that was skipped (graceful degradation documented per template).
Acceptance: *Given* a fresh workspace, *when* a user creates a project from the PM² template, *then* they get the four phases (with gates if available), artifact work package types, and the guide linked from the project overview.

**Phase 8 exit:** anyone can deploy in under 30 minutes via a documented path; a legacy system admin can follow the importer runbook end to end; the methodology template gallery (PM², PMflex, PRINCE2, SAFe, Scrum, OKR) is available in onboarding and documented.

---

## Appendix: task ID index

Phase 1: P1-T01…P1-T10. Phase 2: P2-T01…P2-T12. Phase 3: P3-T00…P3-T33. Phase 4: P4-T00…P4-T19. Phase 5: P5-T00…P5-T12 (detail in AI-NATIVE-PLAN.md §12; P5-T11 = OKR AI authoring, P5-T12 = work/project AI assists). Phase 6: P6-T01…P6-T07. Phase 7: P7-T01…P7-T07. Phase 8: P8-T01…P8-T06. (109 tasks.)

Import tasks (must keep the mapping tables current — TECHNICAL-PLAN.md §7.4 for source 1, §7.6 for source 2): P2-T09, P3-T03, P3-T07, P3-T09, P3-T15, P3-T18, P3-T21, P3-T24, P3-T28 (sprints), P3-T30, P3-T31 (favorites), P3-T33 (phases, optional), P4-T13…P4-T17 (FlowyTeam), P6-T07 (cutover/rollback).

Design gates (need human approval): P3-T00, P4-T00, P5-T00 (and any future module design gate). Optional/human-gated tasks: P3-T33, P7-T07 (pricing placement); P4-T11's scorecard points sub-feature (off by default); AI open decisions confirmed at P5-T00 (AI-NATIVE-PLAN.md §13).

Methodology/standards coverage (REQUIREMENTS §4): enabling features P3-T01 (templates), P3-T13 (boards), P3-T28 (sprint sharing), P3-T33 (phases+gates), P7-T07 (initiation wizard); delivery P8-T06 (template gallery + guides); the native OKR/KPI modules (Phase 4) are the differentiator over the legacy tool's docs-only OKR pattern.

Spec authorities per task type: UI → UIUX-PLAN.md (screen S-xx + §4 patterns + §9 gates); schema → TECHNICAL-PLAN.md §4 + §7 mapping (strategy schema: §4.12 + §7.6 mapping); performance-sensitive → TECHNICAL-PLAN.md §13; security-touching → TECHNICAL-PLAN.md §8.2; AI-touching → AI-NATIVE-PLAN.md (§3 architecture, §7 schema, §8 security, §12 tasks).
