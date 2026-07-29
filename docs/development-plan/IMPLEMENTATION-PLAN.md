# IMPLEMENTATION-PLAN.md

The work, as ordered tasks. Each task has an ID, dependencies, a test plan, a development block, and a QA checklist. Claude Code executes one task at a time under the protocol in EXECUTION-GUIDE.md. A human reviews and merges every task.

Authority: this is the execution authority. It implements TECHNICAL-PLAN.md (and AI-NATIVE-PLAN.md for Phase 5). If a task conflicts with a design doc, the design doc wins and the task must be corrected first.

The plan runs in **eight sequential phases**, deliberately **strategy-first**: the OKR + operating-rhythm core (the differentiator, Phase 3) ships before the execution pillar (Phase 4). Each phase gates on the one before it; phases with a `[DESIGN GATE]` task also need explicit human approval of that gate's docs.

| Phase | Theme | Tasks |
|---|---|---|
| 1 | Walking skeleton (container-only) | P1-T01…P1-T10 |
| 2 | Core platform | P2-T01…P2-T13 |
| 3 | Strategy core — goals, rhythm, KPIs | P3-T00…P3-T18 |
| 4 | Execution core — projects, work, docs | P4-T00…P4-T14 |
| 5 | The AI layer | P5-T00…P5-T14 (bodies in AI-NATIVE-PLAN.md §12) |
| 6 | Hardening | P6-T01…P6-T08 |
| 7 | Enterprise & operator pack | P7-T01…P7-T07 |
| 8 | Community launch | P8-T01…P8-T06 |

**93 tasks.** Sizing: S (≤0.5 day), M (~1 day), L (~2–3 days) — guidance, not promises. With the PLAN.md §12 throughput assumption (one human reviewer, 3–5 merged tasks/week, L counts double), Phases 1–6 are a realistic **6–9 months**. If actuals diverge >±50% over a month, re-baseline (PLAN.md §13 R6) — do not silently slip.

**What was cut from the previous revision** (decision 2026-07-08, OPERATELY-COMPARISON.md): the OpenProject importer and all its mappers; the automatic scheduling engine and Gantt; custom fields; configurable types/statuses/workflows; the query DSL + saved views; backlogs; time/cost UI; meetings; wiki (folded into the Resource Hub); the dual container/serverless CI matrix. All live in the **post-v1 backlog** (appendix B) with design-for notes.

## How to read a task

```
### <ID>: <title> [size]
Depends on: <IDs or "-">
Goal: one sentence.
Deliverables: what exists when done.
Test plan: the tests to write first (red before green).
Development: the implementation steps.
QA: the checklist to pass before opening the PR.
Acceptance: Given/When/Then that a human verifies.
```

Every task inherits the **Definition of Done** in CLAUDE.md (Operation pipeline for writes, access getter for reads, RLS + migration together, Zod at boundaries, audit events, factory-based tests, loading/empty/error/denied states, STATUS.md updated). Tasks below only call out extras.

**Definition of Ready** — before code, all must hold:

1. Dependencies are `done` in STATUS.md.
2. Spec sources exist: UI tasks cite a UIUX-PLAN screen (S-xx) + the §4 patterns; schema tasks cite TECHNICAL-PLAN §4 and keep the FlowyTeam mapping (§7.2) current (or mark "new, no legacy source"); importer tasks cite `reference/flowyteam-okr-kpi-tasks-model.md`.
3. Acceptance criteria are unambiguous; if not, ask before coding.
4. No open PLAN §14 / AI-NATIVE §13 decision blocks the task.

UI tasks additionally run the UX quality gates (UIUX-PLAN §9). List-rendering tasks meet the TECHNICAL-PLAN §13.1 budgets. Tasks marked **[SPIKE]** end in a written go/no-go against their PLAN §13 risk-register row.

---

# Phase 1 — Walking skeleton (container-only)

Goal: auth + one workspace + the write/read spine (Operation pipeline, outbox, RLS, access-ready) + a dashboard, deployed to Compose and Helm, CI green. No product features. Exit only when both targets serve the skeleton and the R1 spike has a go.

### P1-T01: Monorepo scaffold [M]
Depends on: -
Goal: Turborepo + pnpm workspace with the package skeleton from TECHNICAL-PLAN §1.
Deliverables: `apps/web`, `packages/{core,db,adapters,importer,ui,config,test-support}`, root `package.json`, `turbo.json`, strict `tsconfig` base, Biome config, `.gitignore`, `LICENSE` (AGPL-3.0 placeholder), `CONTRIBUTING.md`, `GOVERNANCE.md` stubs.
Test plan: a trivial Vitest test per package importing its entrypoint; `pnpm typecheck` and `pnpm lint` clean.
Development: init workspace; wire Turbo pipelines (`dev`,`build`,`test`,`typecheck`,`lint`); strict TS; empty barrels.
QA: `pnpm install && pnpm typecheck && pnpm lint && pnpm test` pass from a clean checkout.
Acceptance: *Given* a clean checkout, *when* the four commands run, *then* all succeed with the package graph resolved.

### P1-T02: CI pipeline + env schema [M]
Depends on: P1-T01
Goal: CI that stays fast and honest at scale, plus a Zod env schema.
Deliverables: GitHub Actions using Turbo **affected-graph** (`--filter=[origin/main]`) + remote cache; Vitest/Playwright **sharding** scaffolds; `concurrency: cancel-in-progress`; a **flaky-test policy** (retry + trace-on-retry, merged report surfacing passed-on-retry, quarantine annotation); **knip** dead-code gate; **license-compatibility** gate; **DCO/CLA** check; Dependabot + CodeQL; `packages/config` env schema validated at boot (fails fast naming the bad variable).
Test plan: env schema rejects a missing `DATABASE_URL`, accepts a valid env; a deliberately flaky sample test shows up in the flakiness report, not as silent green.
QA: push a branch: only affected tasks run; a re-push cancels the superseded run.
Acceptance: *Given* an invalid env, *when* the app boots, *then* it exits with a clear Zod error; *and given* a doc-only change, *then* CI skips unaffected packages.

### P1-T03: Database package + RLS floor + test isolation [SPIKE] [L]
Depends on: P1-T01
Goal: Drizzle + Postgres with the RLS tenant floor proven safe under pooling, and the test-DB harness every later task uses.
Deliverables: `packages/db` with migration tooling (forward-only); the request-scoped wrapper that opens a transaction and issues `SET LOCAL app.workspace_id` (never session-level); an app role with no `BYPASSRLS` that doesn't own tables; the migration linter (any `CREATE TABLE` on a business table without an RLS policy in the same file fails); the **repo-wide soft-delete scope** helper (`deleted_at IS NULL` default, `withDeleted()` opt-in, CI lint); test harness: **template-database** creation + per-worker clone for unit/integration, truncate-between-tests reset for e2e, per-test GUC setting. **R1 spike:** run the isolation suite through a transaction-pooling proxy (pgbouncer-style) and document the result.
Test plan: two workspaces, rows in each: workspace A cannot see B even via raw Drizzle; a connection with **no GUC set reads zero rows**; the pooling spike suite passes (or the fallback in PLAN §13 R1 is invoked and recorded); soft-delete scope hides deleted rows and `withDeleted()` reveals them.
QA: migrations apply from empty; linter catches a policy-less table; harness resets are < 1 s per test file.
Acceptance: *Given* the spike suite under pooling, *when* it runs, *then* isolation holds and the go/no-go is recorded in `docs/design/spike-rls-pooling.md`.

### P1-T04: Adapter ports + container drivers + the transactional outbox [L]
Depends on: P1-T03
Goal: the seven ports with working container drivers, and the outbox as the only enqueue path.
Deliverables: `packages/adapters` interfaces for JobQueue, Realtime, FileStorage, Mailer, Cache, Search, AIProvider; container drivers (pg-boss; WS + LISTEN/NOTIFY with compact typed events + 8 KB guard + self-echo suppression; local disk; SMTP-to-console; in-proc+PG cache; PG FTS; AI `off`); serverless driver **stubs** (interfaces only, not CI-gated — post-v1); the `outbox` table + `outbox.insert(topic,payload,idempotencyKey)` + the relay worker (drains committed rows at-least-once); a CI grep failing any direct driver call on a write path and any vendor SDK import outside the package.
Test plan: port contract tests on the container drivers; outbox: a rolled-back transaction delivers nothing, a committed one delivers exactly-once-per-idempotency-key across relay retries; NOTIFY payload over 8 KB raises.
QA: no vendor SDK outside `packages/adapters` (grep in CI).
Acceptance: *Given* a write that inserts an outbox row and then rolls back, *when* the relay runs, *then* nothing is delivered; committed, it is delivered once.

### P1-T05: Better Auth: email+password, passkeys, TOTP [M]
Depends on: P1-T03
Goal: real authentication with modern factors from day one (TECHNICAL-PLAN §8.2; UIUX S-22).
Deliverables: Better Auth mounted with the Drizzle adapter; sign-up/sign-in/sign-out; passkey enrollment + login; TOTP enrollment + challenge + backup codes; session middleware exposing the current user; **session tokens hashed at rest**; protected routes 401 without a session.
Test plan: register/login/bad-password/logout; passkey + TOTP happy paths; a raw DB read of the sessions table yields only hashes.
QA: passwords/tokens never logged.
Acceptance: *Given* a user with TOTP enrolled, *when* they sign in, *then* they are challenged and a hashed session is established.

### P1-T06: Workspaces + members bootstrap [M]
Depends on: P1-T05
Goal: the two-level identity: global user, per-workspace member.
Deliverables: `workspaces`, `workspace_members` (name, kind, status per TECHNICAL-PLAN §4.1), a bootstrap flow (first registration provisions a workspace with the user as its first member + owner-level access placeholder until P2-T01), the workspace switcher stub, `SET LOCAL` wiring from the member's active workspace.
Test plan: fresh DB → register → workspace + member exist; RLS scoping verified across two workspaces; the same user joins a second workspace as a distinct member.
QA: DoD; audit event on workspace create (via P1-T07 once it lands — sequence-safe stub until then).
Acceptance: *Given* a first-run instance, *when* the first user registers, *then* a workspace exists with them as an active member and the GUC scopes every query to it.

### P1-T07: Operation pipeline + action registry + audit spine [L]
Depends on: P1-T04, P1-T06
Goal: the write path and the single contract everything projects from (TECHNICAL-PLAN §8.1 layer 3, §14).
Deliverables: the `Operation` abstraction in `packages/core` (authorize against freshly loaded rows → one transaction: mutate + bindings + activity stub + **audit row** + outbox → typed result); `audit_events` append-only (no UPDATE/DELETE grants) with the per-workspace hash chain (`prev_hash`/`row_hash`); the **action/contract registry** (name, Zod in/out, required access level, read/write/destructive class, handler) with its tRPC projection wired into `apps/web`; a CI lint that mutating tRPC procedures resolve to a registry action (no ad-hoc writes).
Test plan: a sample operation: rolled-back mutation leaves **no** audit row and no outbox row; committed leaves exactly one of each; the hash chain verifies; UPDATE on `audit_events` is denied at the DB; a mutating procedure outside the registry fails the lint.
QA: DoD.
Acceptance: *Given* any committed mutation, *when* the audit chain is verified, *then* it is intact, and a mutation without its audit row is impossible by construction.

### P1-T08: Hello dashboard [S]
Depends on: P1-T07
Goal: an authenticated page proving the whole stack.
Deliverables: `/` shows workspace + member via a registry query through the getter; loading/empty/error states; one Playwright e2e (register → dashboard) on the P1-T03 harness.
Acceptance: *Given* a signed-in member, *when* they open `/`, *then* they see their workspace and name, rendered via RSC with client hydration per TECHNICAL-PLAN §13.3.

### P1-T09: Docker Compose target + first-run web setup wizard [L]
Depends on: P1-T08
Goal: `docker compose up` to a working instance in under 30 minutes, no shell editing.
Deliverables: `deploy/docker/` (multi-stage Dockerfile, compose with app + Postgres + Caddy auto-TLS + optional MinIO, volumes, health checks, migrations-on-boot with DB-readiness polling); the **first-run web setup wizard**: detects an unconfigured instance, generates and persists all secrets (refusing placeholder secrets in prod thereafter), tests DB/SMTP connections live, creates the admin + workspace, offers the demo seed; the `openokr` lifecycle helper (`upgrade` = pull + migrate + restart, `status`, `logs`, `rotate-keys`) with a documented rollback; `.env.example` for the override path.
Test plan: CI job builds the image, boots compose, drives the wizard headlessly, asserts login works; upgrade helper re-runs migrations idempotently.
Acceptance: *Given* a clean VPS, *when* `docker compose up` + the wizard run, *then* a secured instance with an admin exists inside the 30-minute budget.

### P1-T10: Helm chart target + Phase 1 exit [L]
Depends on: P1-T09
Goal: the same skeleton on Kubernetes.
Deliverables: `deploy/helm/` (deployment, service, ingress, secrets, migration hook, external-Postgres values); cosign-signed image published to GHCR on tag; the Phase 1 exit checklist run.
Test plan: `helm template` lints; a kind-cluster CI job installs and passes readiness + register.
Acceptance: *Given* a kind cluster + Postgres, *when* the chart installs, *then* the skeleton serves and a user can register.

**Phase 1 exit checklist:** skeleton on Compose + Helm; CI green with the §P1-T02 machinery; RLS proven incl. the pooling spike go; outbox semantics proven; Operation pipeline + hash-chained audit live; action registry driving tRPC; passkeys/TOTP work; wizard provisions an instance in budget; no vendor SDK outside adapters.

---

# Phase 2 — Core platform

Goal: the shared machinery every module needs — the relationship access model, people, invitations, files, subscriptions + notifications, the typed feed, settings, security baseline, the demo builder, the app shell + editor, the data-change runner. Still no product modules.

### P2-T01: Access model: contexts, bindings, groups [L]
Depends on: P1-T07
Goal: the relationship authorization model (TECHNICAL-PLAN §4.1).
Deliverables: `access_contexts`, `access_groups` (member / workspace_standard / space_standard / anonymous), `access_group_memberships`, `access_bindings` (levels 10/40/70/100, tags champion/reviewer); creation wiring so every protected aggregate is born with its context + default bindings inside its Operation; derived privacy computation (public/workspace/space/invite-only) from binding tiers; the permission catalogue constants (incl. `manage_ai` for Phase 5).
Test plan: creating a sample aggregate produces context + bindings atomically; privacy label derives correctly for each lever combination; deleting a binding downgrades access immediately.
Acceptance: *Given* an aggregate created with "workspace can view, space can edit", *when* privacy is computed, *then* it reads `workspace` and a non-space member gets view only.

### P2-T02: can() + access-aware reads [L]
Depends on: P2-T01
Goal: one enforcement point for every surface.
Deliverables: `can(member, level, resource)` in core; the **access-aware getter** (join member → groups → bindings → context; `max(level)`; `suspended_at IS NULL`; **not-found on forbidden**) + composable list filters; the sub-resource `(subject_type, subject_id) → context` resolver with an exhaustive, fail-closed enumeration; the CI lint failing raw selects on protected tables outside the helper; effective-access composition rules (union, max-wins, deduped) documented + tested.
Test plan: a permission matrix across member/guest/suspended/anonymous × view/comment/edit/full × multiple overlapping grants (direct + space + workspace) asserting max-wins; a suspended member loses all reads/writes everywhere; forbidden reads return not-found (no existence oracle); an unknown subject type in the resolver throws.
Acceptance: *Given* a member holding view via the workspace group and full via a champion binding, *when* access is computed, *then* it is full; *and given* their suspension, *then* every read returns not-found.

### P2-T03: People: profiles, manager chain, lifecycle [L]
Depends on: P2-T02
Goal: members as real people with an org structure and a safe lifecycle (UIUX S-20).
Deliverables: member profiles (title, timezone, avatar, rich bio; self-vs-others editable field sets); `manager_id` with a cycle-safe possible-managers query (recursive CTE excluding the member's own report subtree); the people directory + org-chart view; **suspend/restore** (suspension excluded from every authz join by P2-T02; restore reinstates); guest kind + **convert-to-guest** that strips prior bindings and rebuilds minimal access; **erasure as anonymization** (placeholder identity, authorship FKs intact, audit event, machine-readable export) with last-owner / last-site-admin invariants.
Test plan: manager cycle attempt rejected; suspend → all access gone, restore → back; convert-to-guest leaves no stale binding (regression test); erasure keeps comments readable with an anonymized author; removing the last owner is refused.
Acceptance: *Given* a suspended member, *when* they hit any endpoint or their agent token is used, *then* access is denied; *and given* erasure, *then* their content survives anonymized and an export is produced.

### P2-T04: Invitations: email, reusable links, trusted domains [M]
Depends on: P2-T03
Goal: every joining path through one provisioning funnel.
Deliverables: invite-by-email (token via Mailer through the outbox); **reusable workspace invite links** (hashed token, use count, max uses, expiry, revoke/reset, allowed email domains); single-use personal links (24 h, revoke-on-use); workspace `trusted_email_domains` auto-join; all paths land in one member-provisioning operation (consistent defaults + audit).
Test plan: invite→accept→member; a link past `max_uses`/expiry/revocation refuses; a domain-restricted link rejects other domains; trusted-domain self-serve join works; permission tests (only members with manage-level access invite).
Acceptance: *Given* a reusable link limited to `@acme.com`, *when* `bob@other.com` tries, *then* joining is refused and audited.

### P2-T05: Files: blobs, quotas, previews [M]
Depends on: P1-T04, P2-T02
Goal: upload/download that later modules (editor, Resource Hub) build on.
Deliverables: `blobs` + prepare→upload→claim flow with signed URLs; type/size validation (Zod allowlist; images re-encoded); per-workspace storage byte accounting + quota + once-at-90% warning (via the notification spine when it lands — outbox topic now); a preview/thumbnail worker (image resize, pdf first page, video poster); the ClamAV scan hook driving `ok/scanning/quarantined` (adapter-optional, documented); orphan-cleanup job.
Test plan: upload→claim→download on the disk driver; oversized/blocked types rejected; quota crossing fires exactly one warning; orphans reaped.
Acceptance: *Given* an upload finishing over the 90% threshold, *when* accounting runs, *then* one warning event is emitted and the file still saves (hard stop only at 100%).

### P2-T06: Subscriptions + notification spine + email batching [L]
Depends on: P2-T02, P1-T04
Goal: the delivery machinery every module wires into (TECHNICAL-PLAN §4.8; UIUX S-03).
Deliverables: `subscription_lists` + `subscriptions` (reasons invited/joined/mentioned; author auto-joined; mention auto-subscribe with edit-time re-diff; suspended/placeholder/`ai` excluded); `notifications` with **access-gating at send time** (recipient must still pass `can(view)` on the subject); routing per member settings: immediate email for direct mentions (opt-in), otherwise a **buffered batch** (`notification_email_batches`, find-or-create under a row lock, idempotent send worker, single-email vs digest rendering); the per-user-local-time **daily summary** cron (SQL against `pg_timezone_names`, UTC fallback); per-reason HTML+text templates + a one-line digest variant + the dev **email preview page**; a bulk-import/seed suppression flag; the in-app Inbox (S-03) with live badge, mute, snooze.
Test plan: mention → immediate email when opted; three rapid events → one batch (no duplicates under concurrency — race test); a recipient who lost access after enqueue receives nothing; un-mentioning on edit stops their notification but keeps watchers; DST-boundary daily summary fires at the member's local time; suppression flag silences a bulk insert.
Acceptance: *Given* a member with a 10-minute window, *when* four notifications arrive in it, *then* they get one digest email listing four items, each deep-linked.

### P2-T07: Typed activity feed engine [L]
Depends on: P2-T06
Goal: the human-readable event log (TECHNICAL-PLAN §4.8; UIUX S-18) — distinct from audit.
Deliverables: the typed event catalog (Zod discriminated union; payload snapshots human labels); `activities` with `context_id` access scope set by the fail-closed resolver; feed queries for company/space/goal/project/profile scopes (access-filtered, soft-delete-hiding, keyset-paginated); consecutive same-actor/same-day edit aggregation (never collapsing narrative events); per-kind React renderers (registry pattern — adding an event kind is one module); live inserts via Realtime; notification fan-out driven off activities.
Test plan: an event kind outside the catalog is unpersistable; a private-space activity never appears in a non-member's company feed (the leak test); aggregation collapses five field edits into one row but never a check-in; feeds paginate stably under concurrent inserts.
Acceptance: *Given* a member without access to space X, *when* they read the company feed, *then* no X activity appears, while an X member sees typed, readable entries.

### P2-T08: Workspace settings + navigation registry [M]
Depends on: P2-T02
Goal: the settings shell and module registration (UIUX S-23 skeleton).
Deliverables: settings service (Zod-validated jsonb, env overrides win); the admin two-level shell; a typed module registry (`registerModule({nav, permissions, settings})`) driving the sidebar/admin menus by access.
Acceptance: *Given* a module registering a nav item requiring an access level, *when* a member lacks it, *then* the item is hidden and the route is denied.

### P2-T09: Security baseline [M]
Depends on: P1-T05, P2-T02
Goal: the platform-layer controls from TECHNICAL-PLAN §8.2.
Deliverables: rate limiting via the Cache port (per-IP + per-member on auth/API/exports, 429 + headers); account lockout with backoff + audit; nonce-based strict CSP + HSTS + frame/referrer headers; secure cookie audit; the sessions UI (list devices, revoke one/all); the **workspace freeze overlay** (`state` active/read_only/frozen collapsing writes with an admin recovery whitelist); startup placeholder-secret refusal verified in prod mode.
Test plan: N failed logins → lockout + audit + retry-after; revoked session's next request is 401; a frozen workspace rejects every write except the whitelist; CSP nonce varies per response.
Acceptance: *Given* a workspace set read_only, *when* any member saves anything, *then* it is refused with a clear banner while admins can still manage members/billing-class settings.

### P2-T10: Demo workspace builder + seed [M]
Depends on: P2-T07
Goal: the demo as a product feature (UIUX S-21).
Deliverables: `pnpm db:seed` for dev; an in-product, env-gated (`DEMO_BUILDER_ALLOWED`) "Explore with demo data" action building a realistic org — spaces, members, goals with check-in history (some deliberately `outdated`), KPIs with records, projects with milestones/work items, documents, discussions — in one transaction with notification dispatch suppressed; idempotent.
Acceptance: *Given* a fresh workspace, *when* the demo builds, *then* the Work Map, review inbox and feeds are populated and believable, and nobody got an email.

### P2-T11: App shell + design system foundation [L]
Depends on: P1-T08, P2-T08
Goal: the global UI everything plugs into (UIUX §2–§3, §5).
Deliverables: shadcn/ui on the **Base UI** registry + SmoothUI/Motion vendored into `packages/ui` (build-time only); design tokens (type scale, spacing, semantic colors, density modes); dark mode (light/dark/system, persisted); the shell (sidebar Home/Review/Inbox/Goals/Projects/KPIs/Spaces/Admin, topbar with breadcrumb + search + `+ New` + bell + avatar + workspace switcher); responsive behavior (collapse, mobile tab bar); core components with preview pages (`DataTable` virtualized base, `EntityPicker`, `EmptyState`, skeletons, `Toast+Undo`, `SidePanel`, `KbdHint`, `AvatarStack`, `HealthBadge`/`StalenessBadge`); the keyboard registry + `?` overlay; the i18n pipeline (ICU `en` + `ms` stub, pseudo-locale CI check); the persisted TanStack Query cache keyed by buildId + the **stale-deploy reload toast**.
Test plan: keyboard/focus component tests; theme + density persistence e2e; mobile viewport smoke; pseudo-locale build catches a hardcoded string; a simulated version-mismatch response triggers exactly one reload.
QA: DoD + UIUX §9 gates; axe clean on the shell.
Acceptance: *Given* a deploy bumping the app version, *when* a stale tab makes its next request, *then* it shows "app updated" and reloads once, with caches invalidated.

### P2-T12: Rich text editor [L]
Depends on: P2-T11, P2-T05
Goal: the one editor everywhere, done once, properly (UIUX S-26; TECHNICAL-PLAN §1 rich-text contract).
Deliverables: `docs/design/rich-text-editor.md`; the TipTap editor over the canonical ProseMirror schema (node/mark allowlist enforced by the shared core validator); slash commands, @mentions (contextually enabled), `##short-id` autolink, tables, code blocks; inline attachments (optimistic placeholder → progress → uploaded; submit-gated while uploading; delete-on-failure; image preview modal); local draft autosave (per entity+member, base-content fingerprint + TTL, cleared on submit); the sanitizing HTML renderer + the excerpt utility (server + client from one core module); mention/attachment extraction API (decode-safe: malformed → `[]`).
Test plan: schema round-trip goldens (JSON → HTML → excerpt); a malicious pasted payload renders inert; a draft against changed base content does not resurrect; mention extraction on legacy/malformed JSON returns `[]`.
Acceptance: *Given* a comment with an in-flight upload, *when* the user hits submit, *then* submission waits for (or fails with) the upload, never dropping the attachment silently.

### P2-T13: Data-change runner [M]
Depends on: P1-T03
Goal: production data backfills decoupled from DDL.
Deliverables: `pnpm db:change` — versioned, idempotent, batched, resumable change scripts that freeze their own column expectations (no imports of live schema), with a completion ledger; conventions doc; one sample change with tests.
Acceptance: *Given* a change script run twice across a deploy boundary, *when* it re-runs, *then* it no-ops cleanly and the ledger shows one completion.

**Phase 2 exit checklist:** relationship access enforced through one `can()`/getter with the CI lint; people lifecycle safe (suspend/guest/erasure invariants); invitations + links + trusted domains; files with quotas/previews; subscriptions + access-gated notifications + buffered/daily email with preview page; the typed feed live and leak-tested; settings + registry; security baseline (rate limits, lockout, CSP, sessions UI, freeze); demo builder; shell + tokens + editor + i18n + stale-deploy handshake; data-change runner.

---

# Phase 3 — Strategy core

The namesake: goals with real accountability, the rhythm engines, check-ins, the review inbox, KPIs with formulas, the Work Map, and the importers. Starts with a design gate.

### P3-T00: Strategy design gate [DESIGN GATE] [L]
Depends on: Phase 2 complete
Goal: the strategy design docs, with the risk-register de-risking artifacts (PLAN §13 R2/R3).
Deliverables: `docs/design/` — `strategy-domain.md` (goals/KRs/cycles/check-ins schema + lifecycles as Given/When/Then), `scoring-engine.md` (**the golden-master matrix**: weighted rollups, decrease-direction KRs, KPI-backed KRs, aligned cascades with cycles, the health precedence cascade incl. `outdated` overrides, equal-endpoint edge cases, the trend-forecast model per TECHNICAL-PLAN §12 T2), `cadence-engine.md` (anchor-day math, tolerance, timezone/DST cases), `kpi-formula-engine.md` (grammar, aggregation, cascade, failure modes), `flowyteam-import.md` (mapping walkthrough against §7.2).
Acceptance: **human approves** with "Design approved for Phase 3" before any Phase 3 implementation task starts; the golden-master matrices are explicitly reviewed.

### P3-T01: Spaces [M]
Depends on: P3-T00
Goal: team homes (TECHNICAL-PLAN §4.2).
Deliverables: `spaces` + `space_members` (member/manager); space creation Operation wiring context + standard group + manager bindings; the space home shell (goals/projects/docs/discussions tabs fill in as modules land); join/leave; audit.
Acceptance: *Given* a space manager, *when* they add a member, *then* that member gains space-standard access to the space's aggregates immediately.

### P3-T02: Cycles + strategy settings [M]
Depends on: P3-T01
Goal: time-boxing and the workspace rhythm defaults (UIUX S-23 strategy section).
Deliverables: `okr_cycles` (auto-generation forward from cadence, timezone-honoring, archive step) + `strategy_settings` (frequency default, anchor day, staleness grace, RAG thresholds, quotas, labels); admin UI; audit on create/archive.
Test plan: cycle generation across quarter/half/year boundaries and timezones; label overrides render in the UI catalogs.
Acceptance: *Given* quarterly cadence on 2026-08-01, *then* the active cycle is "Q3 2026" with correct bounds, auto-created if absent.

### P3-T03: Goals + key results CRUD [L]
Depends on: P3-T02
Goal: the core objects with accountability and an explicit lifecycle (TECHNICAL-PLAN §4.3; UIUX S-04/S-05 create/edit slices).
Deliverables: `goals` (champion + reviewer required, owner scope, cycle + optional contextual timeframe, weight, alignment pointers with cycle prevention, close lifecycle: close-with-outcome creates a `goal_retrospectives` row (S-08), reopen restores) + `key_results` (direction-aware ranges, units, weights, KPI-link slot) + `key_result_values` history; create/edit UI with inline patterns; champion/reviewer reassignment rebinding tagged bindings atomically; move-between-cycles.
Test plan: alignment single-parent invariant + cycle rejection; close requires an outcome and creates the retro; reopen clears outcome but keeps the retro; reassigning reviewer rebinds and reassigns pending acknowledgements (with the P3-T06 hook noted); weight clamping.
Acceptance: *Given* goal-edit access in an active cycle, *when* a goal with champion, reviewer and two weighted KRs is created, *then* it persists at 0% `pending`, and closing it as `achieved` requires and produces a retrospective.

### P3-T04: Scoring & health engine (pure) [L]
Depends on: P3-T03
Goal: TECHNICAL-PLAN §6.1 as pure functions against the approved golden masters.
Deliverables: KR progress (direction-aware, clamped), weighted goal progress incl. aligned children, upward cascade with cycle detection, RAG from thresholds, the **health precedence cascade** (`success_status → outdated → latest check-in status → pending`), the trend forecast (`trending_off_track`); `recomputeGoal(graph, change)`; the outbox-driven invalidation job writing derived columns.
Test plan: the P3-T00 golden-master suite passes verbatim; a cascade over a 1k-goal chain terminates within budget; forecast flags a decaying KR before its status changes.
QA: parity notes recorded in `docs/design/scoring-engine.md`.
Acceptance: *Given* KRs weighted 2 and 1 at 100% and 40%, *then* the goal scores 80%; *and given* a stale goal whose last check-in said on_track, *then* health reads `outdated`.

### P3-T05: Cadence engine + staleness [M]
Depends on: P3-T04
Goal: TECHNICAL-PLAN §6.2 — the rhythm that makes health honest.
Deliverables: pure next-due math (frequency, anchor day, tolerance, workspace timezone); `next_check_in_at` maintained on publish/create/frequency-change; the staleness sweep job flipping health to `outdated` past grace; reminder scheduling hooks (consumed by P3-T15).
Test plan: golden masters incl. DST and month-end; publishing early/late within tolerance advances exactly one period; a paused entity (Phase 4 projects) is exempt — interface noted.
Acceptance: *Given* a weekly Friday-anchored goal checked in on Thursday, *when* the cadence advances, *then* the next due is the following Friday, and 3+grace days after a miss the goal renders `outdated` everywhere.

### P3-T06: Check-ins: snapshots, draft/publish, acknowledgement [L]
Depends on: P3-T05, P2-T06
Goal: the narrative ritual (TECHNICAL-PLAN §4.3; UIUX S-06).
Deliverables: `check_ins` (status vocabulary, confidence, required narrative, the **immutable snapshot** of all KR values with previous values, draft/publish with full side-effect suppression on draft, the edit window with re-snapshot, delete-with-pointer-rollback); the acknowledgement action (reviewer-only, stamps + notifies + clears the obligation); the composer + check-in session walker (S-06) and the `CheckInCard` with value-diff rendering; reactions/comments/subscriptions wired.
Test plan: a draft produces zero activity/notification/cadence movement; publish snapshots values, advances cadence, notifies subscribers, creates the reviewer obligation; editing after the window is refused; deleting the latest check-in restores prior goal pointers; acknowledge by a non-reviewer is denied.
Acceptance: *Given* a published check-in setting a KR from 40→55 with status caution, *then* the goal's health reads caution, the snapshot shows 40→55, and the reviewer sees "Review goal progress" in their Review inbox until they acknowledge.

### P3-T07: Review inbox [M]
Depends on: P3-T06
Goal: "what do I owe right now" (UIUX S-02).
Deliverables: the computed assignments query (check-ins due as champion; acknowledgements owed as reviewer, respecting reviewer-change history; work-item/milestone hooks land in Phase 4); overdue-first grouping with action + due labels; the S-02 page with one-click inline actions; the live sidebar badge (count cached, invalidated by the relevant Operations).
Test plan: obligation appears/disappears exactly on publish/acknowledge; a reviewer appointed today is not asked to acknowledge last month's check-ins; badge updates live.
Acceptance: *Given* a champion with one overdue check-in and a reviewer role on another goal's fresh check-in, *when* they open Review, *then* they see exactly two obligations, overdue first, each actionable inline.

### P3-T08: Discussions + reactions wiring [M]
Depends on: P3-T01, P2-T07
Goal: titled threads + broad reactions (TECHNICAL-PLAN §4.7; UIUX S-17).
Deliverables: `discussions` (space boards + goal/project-anchored; draft/publish, drafts silent); comments wired onto goals/check-ins/discussions with deep links + unread highlight; reactions across the §4.7 subject list; the "will notify X and N others" composer preview.
Acceptance: *Given* a draft announcement, *when* it is published, *then* subscribers are notified once with the correct preview, and a reaction on a check-in appears live.

### P3-T09: Goal surfaces: explorer, page, alignment [L]
Depends on: P3-T06
Goal: the primary strategy UI (S-04, S-05, S-07).
Deliverables: the explorer (scope tabs, cycle switcher, filters, virtualized tree with health/staleness chips, inline edits, quick check-in); the goal page (split + full: score ring, KR rows with sparkline+forecast, check-in history with diffs, discussion, right rail with champion/reviewer + alignment picker + linked work placeholder); the alignment diagram (pan/zoom, virtualized).
QA: §13.1 budgets spot-checked on seeded data.
Acceptance: *Given* the explorer, *when* a KR is checked in from the side panel, *then* the row's progress, RAG and health update live in both views.

### P3-T10: Work Map v1 [M]
Depends on: P3-T09
Goal: the home screen, goals-only for now (S-01).
Deliverables: the WorkMapTree over goals → sub-goals (alignment), with the uniform node contract (health incl. `outdated`, progress, champion, timeframe, next step = next check-in due); scope tabs + filters; SidePanel open; deep links; Home routing.
Acceptance: *Given* Home, *when* it renders, *then* the company's goal tree shows rolled-up health with stale goals visibly `outdated`, inside the §13.1 budget.

### P3-T11: KPIs: categories, records, grid [L]
Depends on: P3-T02
Goal: the metrics module Operately doesn't have (TECHNICAL-PLAN §4.4; UIUX S-09).
Deliverables: `kpi_categories`, `kpis` (frequency/unit/direction/thresholds/tree), `kpi_records` (unique per normalized period); period-bucket normalization per frequency; achievement % + RAG (direction-aware); the keyboard-first grid with grouping + sparklines; sharing (`kpi_shares`).
Test plan: period normalization across all five frequencies; direction-aware achievement both ways; uniqueness under concurrent record writes.
Acceptance: *Given* a monthly KPI (fail 50/pass 75, target 100), *when* 80 is recorded for July, *then* the cell shows 80% amber and re-recording updates, never duplicates.

### P3-T12: KPI formula engine [L]
Depends on: P3-T11
Goal: calculated KPIs (TECHNICAL-PLAN §6.3; PLAN §13 R3).
Deliverables: the typed expression tree + Zod schema; the safe evaluator (`kpi(id)` refs, operators, parentheses, divide-by-zero handling); cross-frequency aggregation via source `aggregate`; `kpi_dependencies` + cascade recompute with cycle detection (outbox-driven); golden masters from the P3-T00 doc.
Acceptance: *Given* monthly C = A + B, *when* A's July actual changes, *then* C's July record recomputes and any KPI depending on C follows, and a self-referencing formula is rejected.

### P3-T13: KPI detail + KR↔KPI links [M]
Depends on: P3-T12, P3-T04
Goal: S-10 + the KPI-backed key result.
Deliverables: the KPI detail (period chart with RAG bands, tree, records table) + the FormulaBuilder; `key_results.kpi_id` attach/detach UI; the scoring-engine branch reading a KPI-backed KR's progress from the KPI's latest achievement.
Acceptance: *Given* a KR linked to a KPI at 80% achievement, *when* the goal recomputes, *then* that KR contributes 80% and shows the KPI-backed badge.

### P3-T14: Scorecard + cycle archive [M]
Depends on: P3-T04, P3-T11
Goal: the per-owner rollup (S-11); points stay off.
Deliverables: `performance_snapshots` + the archive job on cycle close (per owner: result value + health-bucket counts incl. outdated); the scorecard UI + trend + export; `scorecard_settings`/`score_entries` gated **off by default** (no rows unless enabled — human-gated).
Acceptance: *Given* a closed cycle, *when* archived, *then* each owner's snapshot is correct and no score_entries exist with points disabled.

### P3-T15: Strategy notifications + reminders [M]
Depends on: P3-T06, P2-T06
Goal: the rhythm's nudges on the spine.
Deliverables: reasons + triggers: check-in due / overdue (from cadence), check-in published (subscribers), acknowledgement requested / received, goal became `outdated`, goal closed/reopened, KR trending off-track (forecast), KPI period due, cycle opening/closing; the daily assignments email hook (due/overdue/needs-review; suppressed when empty; reminders-only on non-working days); settings coverage.
Acceptance: *Given* a goal crossing its grace window overnight, *when* the sweep runs, *then* the champion gets "check-in overdue", the goal renders `outdated`, and nobody suspended/AI receives anything.

### P3-T16: CSV/XLSX importer [M]
Depends on: P3-T03, P3-T11
Goal: the generic migration path (TECHNICAL-PLAN §7).
Deliverables: `pnpm import:csv` + an admin wizard (S-23 Import): entity templates (goals, key results, KPIs, kpi-records; projects/work-items activate in Phase 4), dry-run preview using the registry's validate endpoints, per-row error report, idempotent upsert on `(workspace, csv, row-key)`, `import_runs` persisted.
Acceptance: *Given* a goals CSV with one bad row, *when* dry-run runs, *then* the preview shows N-1 creatable + 1 explained error, and the real run imports exactly N-1 idempotently.

### P3-T17: FlowyTeam connector [M]
Depends on: P3-T16
Goal: the read-only MySQL source (TECHNICAL-PLAN §7.1).
Deliverables: `pnpm import:flowyteam --source <MYSQL_URL> --company <id> [--dry-run]`; read-only session enforcement (an attempted write must fail); introspection + required-table assertions + version guess; multi-company guardrail (refuses without `--company`); empty report writer; the `(legacy_type, legacy_id) → uuid` map.
Acceptance: *Given* a FlowyTeam DB, *when* the dry run executes for company 7, *then* it prints that company's schema summary, writes an empty report, and provably cannot write to the source.

### P3-T18: FlowyTeam strategy mappers + reconciliation [L]
Depends on: P3-T17, P3-T14
Goal: the strategy import (mapping table §7.2; reference §11 FK order).
Deliverables: mappers — teams→spaces (+members/managers), cycles+settings, objectives→goals (owner/champion/reviewer resolution with report flags, two-pass alignment), key_results (+values), check-ins (narrative rows + snapshots + reviews→acknowledgements), KPI categories/KPIs/records, formula-token→expression-tree translation (unparseable dropped + logged), kpi_shares; derived values recomputed via the engines; per-domain reconciliation counts; dispatch suppressed; idempotency proven.
Test plan: seeded FlowyTeam MySQL in CI (multi-company): counts match, alignment correct, a documented calculated KPI recomputes to source value, re-run changes nothing; a second company imports alongside without collisions.
Acceptance: *Given* company N, *when* the full strategy import runs twice, *then* the report + reconciliation are clean and the second run is a no-op.

**Phase 3 exit checklist:** goals with champion/reviewer + close/reopen usable end to end; scoring + cadence + staleness live and golden-master-green; check-ins with snapshots, drafts, acknowledgements; the Review inbox driving the rhythm; discussions + reactions; explorer/goal page/alignment within budget; the Work Map is Home; KPIs + calculated formulas + KR links; scorecard archives (points off); rhythm notifications + the daily assignments email; CSV + FlowyTeam strategy imports green, idempotent, reconciled. **This is the first demoable, opinion-complete product.**

---

# Phase 4 — Execution core

Operately-class execution joined to the strategy pillar. No configuration engines (REQUIREMENTS §6). Starts with a design gate.

### P4-T00: Execution design gate [DESIGN GATE] [M]
Depends on: Phase 3 complete
Goal: `docs/design/execution-domain.md` — projects/milestones/work-items lifecycles, board ordering + concurrency, Resource Hub node semantics, the Work Map v2 merge, acceptance criteria as Given/When/Then.
Acceptance: **human approves** with "Design approved for Phase 4".

### P4-T01: Projects: lifecycle, contributors, health [L]
Depends on: P4-T00
Goal: projects as accountable containers (TECHNICAL-PLAN §4.5; UIUX S-12).
Deliverables: `projects` (state active/paused/closed with side effects: pause suspends cadence + records a comment-worthy activity, resume reschedules; close requires outcome + retrospective via P4-T03) + `project_contributors` (champion/reviewer/contributor with responsibility, unique champion/reviewer, tagged-binding lockstep, swap-downgrades-outgoing); goal link; the project page shell; audit.
Acceptance: *Given* an active project, *when* paused and later resumed, *then* no check-in became due while paused and the next due date is recomputed from resume.

### P4-T02: Project check-ins + acknowledgement [L]
Depends on: P4-T01
Goal: the same ritual for projects (S-12 check-in slice; reuses P3-T06 machinery).
Deliverables: `project_check_ins` (status/narrative/milestone-snapshot/draft/publish/acknowledge) on the shared composer + card components; cadence + staleness + Review-inbox integration; health derived by the same cascade.
Acceptance: *Given* a project check-in published as caution, *then* the project's health is caution until staleness or the next check-in, and the reviewer owes an acknowledgement.

### P4-T03: Retrospectives + close flows [M]
Depends on: P4-T01
Goal: closing as a ritual (S-08 shared with goals).
Deliverables: `project_retrospectives` (required at close; outcome achieved/missed; editable; reopen keeps it); the shared retrospective component + close dialog polish for goals and projects; feed + notification events.
Acceptance: *Given* a project close attempt without a retrospective, *then* it is refused; with one, the project reads `closed · achieved` and the retro is linked from the page and the feed.

### P4-T04: Milestones + project next step [M]
Depends on: P4-T01
Goal: rich milestones (S-13 header; TECHNICAL-PLAN §4.5).
Deliverables: `milestones` (contextual timeframe, description, status, complete/reopen incl. **comment-with-action**, position); the derived project `next_step` (earliest-due open milestone, documented tie-break) recomputed via outbox; milestone header UI.
Acceptance: *Given* a comment posted with "complete milestone", *then* the milestone closes, the project's next step advances, and both render in the feed as one event.

### P4-T05: Work items [L]
Depends on: P4-T04
Goal: the unit of work, joined to strategy (S-14).
Deliverables: `work_items` (fixed status vocabulary, contextual due, rich description) + `work_item_assignees` (**multi-assignee**, assignment grants edit + notifies) + `checklist_items` + `work_item_relations` (`blocks`, cannot-complete-while-blocked) + due-relative `reminders` (validated against due; auto-stripped on due removal) + the KR/goal/KPI links (closing a linked item nudges the KR's linked-work rollup + feeds the forecast); the detail page; Review-inbox due integration.
Test plan: blocked completion refused with the blocker named; relative reminder without a due date rejected; multi-assignee notifications exclude the actor; the KR link renders on both ends.
Acceptance: *Given* a work item blocking another, *when* the blocker closes, *then* the blocked item becomes completable and its assignees are notified once.

### P4-T06: Boards [L]
Depends on: P4-T05
Goal: kanban that survives concurrency (S-13, S-15).
Deliverables: per-milestone and per-project boards keyed on status; drag with optimistic updates + live presence; `ordering_state` (normalized against deleted/closed items, row-locked writes); inline new-item per column; mobile snap-scroll.
Test plan: two simulated users reordering concurrently converge without lost cards (race test); a deleted item vanishes from ordering on next write.
Acceptance: *Given* two members dragging simultaneously, *when* both commit, *then* the final order is consistent for everyone and no card duplicates or disappears.

### P4-T07: Resource Hub [L]
Depends on: P4-T05, P2-T12, P2-T05
Goal: docs, folders, files, links on spaces/projects/goals (S-16; TECHNICAL-PLAN §4.6).
Deliverables: `resource_hubs` + `resource_nodes` tree + `documents` (draft→publish, author-private drafts enforced in SQL, version history + visual diff), `files` (previews), `links` (typed provider + SSRF-safe enrichment worker); move/copy (transactional deep copy); per-node comments/reactions/subscriptions; breadcrumbs + drag upload.
Test plan: another member cannot read my draft even via a direct URL/id probe (not-found); deep folder copy is atomic; enrichment refuses a private-range URL.
Acceptance: *Given* a goal's hub, *when* a document is drafted then published, *then* only publish emits the activity/notification and the doc's history shows a readable diff.

### P4-T08: Global search [M]
Depends on: P4-T05, P4-T07
Goal: FTS across everything (S-19 backend).
Deliverables: `search_documents` + GIN, outbox-driven (re)indexing for goals/projects/work items/docs/discussions/comments, access-filtered queries, the search page + palette source.
Acceptance: *Given* a term in a private space's doc, *when* a non-member searches it, *then* no result appears; a member finds it highlighted.

### P4-T09: Work Map v2 — the full tree [L]
Depends on: P4-T05, P3-T10
Goal: the complete home: goals → projects → work items (S-01 final).
Deliverables: the merged hierarchy query (alignment + goal-links + milestones/work items) with the uniform node contract at every level; rollups (a project's health, its next step, its open-work count under its goal); filters incl. champion/space/status; virtualization to the 100k budget.
Acceptance: *Given* Home, *when* a linked work item closes, *then* its KR, goal progress and the map row update live, and an `outdated` project is visibly stale under its healthy-looking goal.

### P4-T10: Command palette + quick create + favorites-lite [M]
Depends on: P4-T08, P2-T11
Goal: the ⌘K layer (S-19).
Deliverables: palette (actions, entity jump by short-id/title, recents) permission-filtered; `+ New` quick-create (goal/project/work item/document/discussion from anywhere); the shortcut set registered in `?`.
Acceptance: *Given* any screen, *when* ⌘K + a work-item short-id is typed, *then* the item opens within budget.

### P4-T11: Exports [S]
Depends on: P4-T09
Goal: CSV/XLSX of any list (goals, KPIs+records, projects, work items), async via outbox for large sets, audited.
Acceptance: *Given* a filtered goal list, *when* exported, *then* the file matches the visible rows/columns and the export is audit-logged.

### P4-T12: Execution notifications wiring [M]
Depends on: P4-T05, P2-T06
Goal: the remaining reasons: assignment, mention-in-work, milestone due/completed, project paused/resumed/closed, blocked/unblocked; Review-inbox coverage for work due; settings + digest coverage.
Acceptance: *Given* a member assigned to a work item due tomorrow, *then* it appears in their Review inbox and (per settings) tomorrow's daily assignments email.

### P4-T13: FlowyTeam task import [L]
Depends on: P3-T18, P4-T05
Goal: tasks → work items with everything attached (mapping §7.2).
Deliverables: mappers — task boards/columns→status mapping (completed-slug → done), tasks→work items (+KR links deriving goal links), sub_tasks→checklist, dependencies→`blocks`, accesses→subscriptions, comments (HTML→JSON sanitized, two-phase reference rewrite), files→blobs/links, **time logs→`time_entries` (read-only display on the item)**; recurrence flags recorded in the report (engine post-v1).
Acceptance: *Given* FlowyTeam tasks linked to KRs, *when* imported, *then* they appear as work items in the right status with KR links, checklists, comments and preserved time logs, idempotently.

### P4-T14: FlowyTeam full import: dry-run, reconciliation, report [M]
Depends on: P4-T13
Goal: one end-to-end company import that is trustworthy.
Deliverables: orchestrated full pipeline in FK order; consolidated `import-report.json` + human-readable summary; per-domain reconciliation; `--only`/`--dry-run` verified; a mixed test (CSV rows + a FlowyTeam company in one workspace, no collisions).
Acceptance: *Given* a seeded company, *when* `import:flowyteam` runs end to end, *then* counts reconcile, every skip is explained, derived values are engine-computed, and a re-run is a no-op.

**Phase 4 exit checklist:** projects with lifecycle + contributors + acknowledged health check-ins + required retrospectives; rich milestones driving next-step; multi-assignee work items with checklists, blocks guard, relative reminders and live KR links; concurrency-safe boards; the Resource Hub with draft-safe docs and typed links; access-filtered search; **Work Map v2 as Home**; palette + quick create; exports; the FlowyTeam import complete and reconciled. Strategy + execution are now one product.

---

# Phase 5 — The AI layer

Task bodies live in **AI-NATIVE-PLAN.md §12** (P5-T00…P5-T14): the provider port + drivers, BYO keys + encryption + rotation, the model catalog + tiers, metering/quotas/hard caps, structured output + versioned prompts, the public contract projections (REST + OpenAPI + **CLI** + MCP tool defs with drift CI), embeddings/RAG, the copilot, the **MCP OAuth 2.1 authorization server**, the MCP transport/sessions/catalog (+ `search`/`fetch`, Resources, Prompts, stdio), **AI teammates** (agents + runs + sandbox + batch approval + cost-halt), the eval + safety harness with the AI-off leg and **live-transport authz e2e**, and the strategy + execution assists. This section is the index; the same Definition of Ready/Done applies. It opens with the P5-T00 design gate confirming AI-NATIVE §13 decisions.

**Phase 5 exit checklist:** AI-NATIVE-PLAN.md §12 (end of section).

---

# Phase 6 — Hardening

### P6-T01: Performance budgets + indexing at scale [L]
Depends on: Phase 4
Deliverables: the large seeded dataset (100k work items + 10k goals in one workspace); every §13.1 budget measured in CI (Work Map, explorer, boards, KPI grid, Review inbox, search); the N+1 query-count budget enforced on list endpoints; index/plan review with fixes.
Acceptance: every §13.1 row is green on the large dataset in CI.

### P6-T02: Load & soak testing [M]
Depends on: P6-T01
Deliverables: load scripts (hundreds of concurrent members, one workspace: check-in bursts, feed reads, board drags, MCP traffic); soak run; fixes.
Acceptance: no errors and within budget under target concurrency; realtime fan-out stays bounded.

### P6-T03: Backups + restore drills [M]
Depends on: Phase 4
Deliverables: scheduled encrypted backups (DB + blobs) with checksums; a **CI restore drill** (restore into an ephemeral DB, assert row counts + a smoke login); the restore runbook.
Acceptance: the scheduled CI drill proves a restore reproduces a workspace, continuously.

### P6-T04: Workspace export/import (portability) [L]
Depends on: P6-T03
Deliverables: the TECHNICAL-PLAN §7.3 engine: admin-triggered export to a versioned, checksummed, AES-GCM archive (policy registry excludes secrets/sessions/tokens/audit chain); import with a **dry-run diff**, deterministic remap, member de-dup by email, blob re-upload; `export_runs`/`workspace_imports` UI (S-23).
Acceptance: *Given* an exported workspace, *when* imported into a fresh instance, *then* the dry-run diff is accurate, the import reconciles, and goals/check-ins/docs render identically (spot check).

### P6-T05: Observability [M]
Depends on: Phase 4
Deliverables: OpenTelemetry traces/metrics (request, Operation, outbox lag, job, MCP/OAuth outcomes, AI usage), self-hostable dashboards (Grafana), opt-in + documented; no telemetry leaves by default.
Acceptance: an on-prem install sees its own dashboards with zero external calls.

### P6-T06: Security review + supply chain + RLS fuzz [L]
Depends on: Phase 5
Deliverables: every TECHNICAL-PLAN §8.2 control verified or ticketed; the **RLS property/fuzz suite** (random cross-tenant probes across every table → zero rows; policy-removal mutation check); headers/CSP audit; dependency audit + SBOM + signed-image verification; SSRF checks exercised; PDPA/GDPR export + erasure flows tested end to end.
Acceptance: no high findings open; the §8.2 table has ✅ or an accepted-risk note per row, signed off by the human.

### P6-T07: Accessibility audit + Web Vitals CI [M]
Depends on: Phase 4
Deliverables: axe-driven Playwright across every S-xx screen wired into CI (fails on serious/critical); keyboard-only walkthrough scripts for the P0 flows; Lighthouse budgets (LCP/INP/CLS per §13.1) on the seeded dataset; fixes; the screen-reader smoke procedure.
Acceptance: CI blocks a PR introducing a serious axe violation or busting a Web Vitals budget.

### P6-T08: Migration cutover rehearsal [M]
Depends on: P4-T14, P6-T03
Deliverables: the documented cutover runbook (freeze source → backup → dry-run → import → reconcile → go-live → rollback window) rehearsed against a production-shaped FlowyTeam copy + CSV set, using the workspace freeze overlay; a tested rollback.
Acceptance: the rehearsal runs the runbook end to end, reconciliation is clean, and rollback restores the prior state within the window.

---

# Phase 7 — Enterprise & operator pack

### P7-T01: SSO (OIDC + SAML) [L] — via Better Auth; JIT provisioning lands in the one member funnel (P2-T04). *Acceptance:* a user logs in via a configured IdP and is provisioned with default access.
### P7-T02: LDAP sync [L] — users/groups sync mapped to members/space membership; deprovision → suspend. *Acceptance:* an LDAP-removed user is suspended within one sync.
### P7-T03: SCIM provisioning [M] — create/deactivate mapped to the member lifecycle (deactivate = suspend, never delete). *Acceptance:* a SCIM deactivate suspends the member and their tokens/grants stop working.
### P7-T04: MFA policy enforcement [S] — org-mandated MFA (members without a factor are forced to enroll at next login). *Acceptance:* enabling the policy locks unenrolled members into the enrollment flow.
### P7-T05: Audit export + chain verification + air-gap guide [M] — filtered audit export; the hash-chain verification tool + an S-23 "verify" action; the documented fully-offline install (AI local/off, no external calls) validated. *Acceptance:* a tampered audit row is detected by verification; the air-gap checklist passes on an offline VM.
### P7-T06: Operator console + transparent support impersonation [L] — instance-operator role; list/inspect/suspend workspaces; instance feature flags; site messages (dismissible, targeted, expiring); **time-boxed, consent-gated impersonation that is visible to the workspace owner** (inbox notice + audit) — the designed-for SaaS surface (billing stays behind `BILLING_ENABLED`, unbuilt). *Acceptance:* an impersonation session expires on time and the owner can see who was in their workspace, when, and what they did.
### P7-T07: Enterprise feature gating [M] — the licensing check scaffold, **only if** the human chooses open-core (PLAN §14 #6); gated features degrade gracefully. *Acceptance:* per the human decision; default is nothing gated.

---

# Phase 8 — Community launch

### P8-T01: Docs site [M] — user + admin + API (generated OpenAPI reference) + importer runbook + the operating-rhythm handbook.
### P8-T02: Deploy quickstarts [S] — Compose + Helm guides polished; the wizard walkthrough; (serverless arrives post-v1).
### P8-T03: Hosted demo instance [M] — the demo builder on a public instance, reset on schedule.
### P8-T04: Contributor onboarding [S] — CONTRIBUTING, good-first-issues, the CLA bot live.
### P8-T05: Launch [S] — release, changelog, posts.
### P8-T06: Template gallery + operating-rhythm guides [M] — seeded templates: the OKR starter (a cycle with sample goals/KRs/KPIs wired to the strategy module), a company-onboarding template, a product-team space template; short guides mapping Scrum/PM²-style working (docs only, no per-methodology code) onto spaces/projects/milestones; selectable from onboarding (S-21). *Acceptance:* a fresh workspace creating from the OKR starter gets working goals with cadence and a populated Work Map.

**Phase 8 exit:** anyone deploys in under 30 minutes via a documented path; a FlowyTeam admin can follow the importer runbook end to end; the gallery + rhythm guides ship in onboarding.

---

## Appendix A: task ID index

Phase 1: P1-T01…T10 · Phase 2: P2-T01…T13 · Phase 3: P3-T00…T18 · Phase 4: P4-T00…T14 · Phase 5: P5-T00…T14 (bodies in AI-NATIVE-PLAN §12) · Phase 6: P6-T01…T08 · Phase 7: P7-T01…T07 · Phase 8: P8-T01…T06. **93 tasks.**

Design gates (human approval): P3-T00, P4-T00, P5-T00. Spikes with go/no-go: P1-T03 (RLS/pooling, PLAN §13 R1); the P3-T00 golden-master matrices (R2/R3). Human-gated options: P3-T14 points layer (off by default), P7-T07 gating.

Importer tasks (keep TECHNICAL-PLAN §7.2 current): P3-T16, P3-T17, P3-T18, P4-T13, P4-T14, P6-T08.

Spec authorities per task type: UI → UIUX-PLAN (S-xx + §4 + §9) · schema → TECHNICAL-PLAN §4 (+ §7.2 mapping) · engines → TECHNICAL-PLAN §6 · security → TECHNICAL-PLAN §8.2 · AI → AI-NATIVE-PLAN · performance → TECHNICAL-PLAN §13.

## Appendix B: post-v1 backlog (designed-for, not funded — REQUIREMENTS §6)

Serverless/zero-ops profile (drivers + dual-profile CI) · custom fields · configurable types/statuses/workflows · saved-query DSL + view builder · Gantt + the automatic scheduling engine (spike-gated) · backlogs/Scrum · time & cost UI (v1 preserves imported logs read-only) · meetings · budgets · phases/gates · GitHub/GitLab integration · Slack/Teams notification channels · incoming email · calendar feeds · billing/entitlements + hosted cloud · an OpenProject importer (demand-driven) · CRDT co-editing · native mobile. Each keeps its design-for note in TECHNICAL-PLAN; pulling any into v1 requires the human (CLAUDE.md "ask" list).
