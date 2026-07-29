# PLAN.md

Architecture and delivery plan for `OpenOKR`, an open source, opinionated operating system for running a company on goals.

Replace `OpenOKR` everywhere once the product is named. This file is the architecture authority for the repo. Product features live in REQUIREMENTS.md. Claude Code working rules live in CLAUDE.md. The competitive analysis that shaped this revision is in OPERATELY-COMPARISON.md (synthesis) and OPERATELY-GAP-REGISTER.md (all 142 itemized findings).

---

## 1. What we are building

One codebase that ships as one product. v1 runs two ways:

1. **Single server.** A small company runs one Docker Compose file on a cheap VPS or an office server, guided by a first-run web setup wizard. Target: under 30 minutes.
2. **Enterprise.** A university or large organisation deploys the same release on their own Kubernetes with their own Postgres, SSO, backups and audit controls.

A third way — **zero-ops serverless cloud** (Vercel + Supabase class) — is *designed for* from day one (adapter ports, multi-tenant schema) but ships **post-v1**. See §11 and the risk register (§13).

Same repo. Same release. Same behavior. The exact product modules are defined in REQUIREMENTS.md, not here.

## 2. Why greenfield, not a fork of Operately (decision recorded)

**Decided 2026-07-08 by the product owner.** OpenOKR's benchmark is **Operately** — a shipped, mature product that already implements much of this category (see OPERATELY-COMPARISON.md §1.2 for the full trade-off). Forking it was evaluated and rejected. The recorded hard constraints that justify building ground-up:

1. **Stack ownership.** The team builds, debugs, and maintains TypeScript/Next.js long-term. It cannot productively own an Elixir/Phoenix codebase, and hiring for it is harder. A product you cannot confidently modify is not owned.
2. **License and IP independence.** OpenOKR's model is AGPL-3.0 + CLA + its own trademark (§4). That strategy requires code authored end-to-end. Operately is Apache-2.0 — a fork is legally possible, but it defeats the copyleft posture and ties the product's identity to someone else's lineage.
3. **Architectural freedom.** The bets that define OpenOKR — a Postgres RLS tenant floor, adapter ports, deterministic workspace portability, a genuine air-gap posture, and one action contract feeding UI/REST/MCP/CLI — are foundations. They cannot be retrofitted into an existing codebase without a rewrite-in-place that costs as much as building.

**The consequence, accepted:** we must re-earn behavior Operately has already shipped and battle-tested. The mitigations are structural, not hopeful: a trimmed v1 scope (REQUIREMENTS §6 defers the whole "power floor" of configurable PM), strategy-first sequencing (§11), a risk register with kill criteria (§13), and Operately's observable behavior used as the reference spec wherever it is already validated (TECHNICAL-PLAN §15 scorecard; e.g. the goal status cascade, the check-in lifecycle, the MCP OAuth flow).

**Clean-room rule:** we study Operately's *observable behavior*, public docs, and design ideas. We do not copy its code. (Same stance as for FlowyTeam — TECHNICAL-PLAN §11.)

## 3. Non-negotiable principles

1. **Opinion first.** The default product is an operating rhythm — a check-in cadence with enforced staleness, a champion/reviewer accountability contract, a personal review inbox, and one company-wide Work Map — working out of the box with zero configuration. Configurability (custom fields, workflows, query languages) is a *power floor* added post-v1, never the lead. This is the product thesis; every design choice defers to it.
2. **One codebase, one behavior, one runtime shipped.** v1 ships the container profile only. The serverless profile is kept buildable by discipline (ports, no vendor SDKs in core), not by CI-doubling every task.
3. **Postgres is the only hard dependency.** Everything else is optional or swappable.
4. **No vendor SDK calls in core code.** All runtime-sensitive capabilities sit behind adapters.
5. **Two-layer security by construction.** Postgres RLS is the tenant *floor* (a forgotten filter cannot cross workspaces); a relationship-based access layer (contexts, bindings, groups) through a single `can()` is the *authorization model* (per-object view/comment/edit/full, champion/reviewer, derived privacy). Neither replaces the other. See TECHNICAL-PLAN §8.
6. **Every write is one transaction.** Domain mutation + access bindings + activity + audit row + outbox row commit together through the Operation pipeline. Side effects (email, realtime, search indexing, jobs) are driven from the outbox after commit — never fire-and-forget on the write path.
7. **A small team can deploy in under 30 minutes. An enterprise can pass a security review.**
8. **Design first, then code.** Claude Code writes design docs, a human approves, then it builds.
9. **AI-native, not AI-dependent.** AI is built into every module as an accelerator over a complete manual path, degrades to manual when disabled, can point at a local model for air-gapped installs, and every AI action runs under a concrete principal through the same `can()` + RLS — interactive assists as the acting user, autonomous AI teammates as their own least-privilege agent principal. Full design in AI-NATIVE-PLAN.md.
10. **The benchmark is Operately.** Every phase exit is measured against the TECHNICAL-PLAN §15 scorecard. "Same as Operately" is the parity bar; the scorecard names where we must be better.

## 4. License and governance

**Recommendation: AGPL-3.0 for the application code, plus a lightweight Contributor License Agreement (CLA).**

Why AGPL-3.0:

- It stops a third party from taking the code and selling a closed hosted version. Anyone who modifies it and offers it over a network must publish their changes.
- It is the proven license for this category: Cal.com, Plane, Chatwoot and Grafana all ship under AGPL and still built strong communities and businesses.
- It is safe for the target buyers. A university or company that self-hosts for its own staff takes on no obligations.

Why a CLA on top: the business model stays open (§14). A CLA keeps the right to dual-license, add a commercial `ee/` directory later, or run a paid cloud. Use the CLA Assistant GitHub bot; signing is one click. This is a one-way door: AGPL + CLA can later relax to Apache-2.0; the reverse is impossible for released code.

Also do early: register the product name as a trademark; ship `LICENSE` (AGPL-3.0), `CONTRIBUTING.md`, and a `GOVERNANCE.md` stating the project owner has final say while the project is young. CI enforces a license-compatibility gate on dependencies (no AGPL-incompatible transitive deps) and DCO sign-off (§10).

## 5. Architecture in one page

A **Next.js (App Router) modular monolith** inside a Turborepo workspace.

```
apps/
  web/                 Next.js app: UI, internal tRPC, public REST, MCP endpoint
packages/
  core/                Domain logic, the Operation pipeline, the action/contract
                       registry, permission layer, pure engines. Framework-free.
  db/                  Drizzle schema, migrations, RLS policies, data-change runner
  adapters/            Ports and drivers (see table below)
  importer/            FlowyTeam (MySQL) + CSV/XLSX importers (CLI)
  ui/                  Shared shadcn/ui components (Base UI primitives; SmoothUI/Motion)
  config/              Shared tsconfig, lint, env schema
deploy/
  docker/              Dockerfile, docker-compose.yml, Caddy config, setup wizard notes
  helm/                Helm chart for Kubernetes
docs/
  development-plan/    This plan set
  design/              Generated by Claude Code from REQUIREMENTS.md at design gates
```

### Runtime profile

v1 ships `RUNTIME=container`. The env var and the adapter loader exist from day one so a serverless profile can be added post-v1 without touching feature code; serverless drivers are interface stubs until that phase is funded. Feature code never checks `RUNTIME`. Only the adapter loader does.

### Adapter ports and drivers

| Port | v1 driver (container) | Post-v1 driver (serverless, designed) |
|---|---|---|
| JobQueue | pg-boss (in Postgres) | Inngest / Trigger.dev / QStash |
| Realtime | WebSocket server + Postgres LISTEN/NOTIFY (compact id+version events, 8 KB payload guard, self-echo suppression) | Supabase Realtime / Pusher / Ably |
| FileStorage | Local disk or MinIO (S3 API) | S3 / R2 / Supabase Storage |
| Mailer | SMTP (DB-stored, encrypted, admin-editable settings; env as bootstrap) | Resend / SMTP |
| Cache and rate limit | In-process + Postgres | Upstash Redis |
| Search | Postgres full-text search | Postgres full-text search |
| AIProvider | Anthropic / OpenAI / OpenRouter / Ollama / OpenAI-compatible / off | Same |

Rules that make this real:

- Vendor SDKs are imported only inside `packages/adapters`. Nowhere else.
- Feature code calls `jobs.enqueue(...)`, `realtime.publish(...)`, `storage.put(...)`. It never knows which driver is running.
- **Transactional enqueue is the only enqueue.** `enqueue` writes an **outbox row inside the caller's transaction**; a relay drains committed rows to the driver after commit, at-least-once, with idempotency keys. A direct network call on the write path is a build failure. This is what keeps write/audit/notify atomic on *any* future driver, including serverless ones that cannot join a Postgres transaction.
- The AIProvider driver is selected by **stored config** (deployment / workspace / per-user key), not the `RUNTIME` var. A deployment with no key behaves as AI-off. Air-gapped installs point it at Ollama or any OpenAI-compatible endpoint, or disable it. No core flow may require an LLM.

### Multi-tenancy

- Top-level unit is a **workspace** (an organisation). Every business table carries `workspace_id`.
- **Postgres RLS enforces workspace isolation** on every business table, in the same migration that creates the table. The `app.workspace_id` GUC is set with `SET LOCAL` inside each transaction by the request-scoped DB wrapper — never session-level, never from client input. The app role has no `BYPASSRLS` and does not own the tables. A CI test proves a connection with no GUC set reads zero rows from every business table.
- **Identity is two-level:** a global `users` row (credentials, owned by Better Auth) and a per-workspace `workspace_members` row (display name, title, manager, avatar, suspension, kind `human`/`guest`/`ai`/`placeholder`). The same login is a different member in each workspace. The app shell has a workspace switcher.
- One deployment can host one workspace or thousands. Same schema either way (the designed-for cloud path, §14).

## 6. Deployment tiers

| Tier | Who | Stack | Setup effort | Realistic monthly cost |
|---|---|---|---|---|
| Single server (v1) | SMB, budget-minded, privacy-minded | Docker Compose: app + Postgres + Caddy (+ MinIO optional). First-run **web setup wizard** generates all secrets, tests DB/mail/AI connections, seeds the admin and optional demo | ~30 min on any VPS | $10–20 VPS |
| Enterprise (v1) | University, large org | Helm chart on their Kubernetes, external Postgres, SSO, backups | Their platform team, hours not weeks | Their infrastructure |
| Zero-ops cloud (post-v1) | Solo founder, small team | Vercel + Supabase/Neon once the serverless drivers ship | Deploy button + env vars | ~$45 small business |

All tiers run the same tagged release. Publish signed Docker images to GHCR on every release. An `operately`-style lifecycle helper (`openokr upgrade|status|logs|rotate-keys`) ships with the single-server tarball: upgrade = pull image + run migrations (with DB-readiness polling) + restart, with a documented rollback.

## 7. Security model

Summary; the authority is TECHNICAL-PLAN §8.

- **Authentication:** Better Auth. Email + password, **passkeys and TOTP from Phase 1** (not deferred to the enterprise pack). SSO via OIDC and SAML ships in the open core (institutions will not adopt without it). SCIM/LDAP in the enterprise phase, mapped onto the member suspend/restore lifecycle. Session tokens are **hashed at rest**.
- **Authorization:** relationship-based — `access_contexts` + `access_bindings` (graded levels: view/comment/edit/full, with champion/reviewer tags) + `access_groups` (per-person, workspace-standard, space-standard, anonymous). Effective access = max over all reachable bindings; suspended members yield no access at read time. One `can(member, level, resource)` in `packages/core` is the single enforcement point for UI, REST, MCP, CLI and realtime. Every read goes through one access-aware getter that returns not-found on forbidden. RLS is the tenant backstop beneath all of it. Privacy labels (public / workspace / space / invite-only) are *derived* from bindings, never stored booleans.
- **Audit:** an append-only `audit_events` table from day one (DB grants forbid UPDATE/DELETE), written **inside the mutating transaction** by the Operation pipeline, with a per-workspace hash chain for tamper evidence. The social activity feed is a separate, typed system (TECHNICAL-PLAN §4.8).
- **Workspace freeze:** a workspace `state` (active / read_only / frozen) with a core permission overlay and an admin recovery whitelist — used for cutover windows, incident lockdown, and the future billing tier.
- **Input:** every external boundary validated with Zod. Rich text is validated structurally (node/mark allowlist) and rendered through a sanitizing allowlist renderer — no raw-HTML passthrough anywhere (app, email, exports).
- **Supply chain:** Dependabot, CodeQL, pinned lockfile, signed images (cosign), SBOM per release, license gate, DCO.
- **Secrets:** env + encrypted DB settings (envelope encryption, per-secret data keys wrapped by a master key ring; rotation re-wraps data keys only — cheap, zero-downtime). Startup refuses placeholder secrets in production. Never logged.
- **Headers:** strict nonce-based CSP, HSTS, secure cookies, rate limiting through the Cache adapter, account lockout with backoff.

## 8. Realtime: live now, co-edit ready

Ship now: presence (who is viewing), live lists and feeds (a record changes, every open screen updates), live notification badge, live agent-run and copilot streams.

All through the Realtime port with channel semantics (`workspace:{id}:goal:{id}`), publishing **compact typed events** (entity id + version + event kind — never full rows) defined in a shared Zod event registry so payloads are type-checked end to end. Clients refetch through the normal read path, which keeps RLS and `can()` in the loop.

Design rules that make CRDT co-editing a bolt-on later, not a rewrite:

1. Document-like content is stored as **structured ProseMirror JSON with a `version` column** — never Markdown, never opaque blobs (this also preserves the stable node IDs that mentions, attachments and the importers depend on).
2. All writes go through the Operation pipeline. A future Yjs sync server becomes an alternative write path into the same layer.
3. Optimistic UI with conflict handling: a stale write returns 409 and the client refetches. No silent last-write-wins on rich content.
4. Presence exists from day one.

## 9. Data and AI

- Drizzle migrations, forward-only, committed with the feature that needs them. A separate **data-change runner** (versioned, idempotent, batched, frozen-schema backfill scripts) handles data reshaping after launch — DDL and backfills never mix.
- Soft delete is a repo-wide default scope (`deleted_at IS NULL` injected by the query helper, explicit `withDeleted()` opt-in, CI-linted) — not a per-table convention.
- A seed script and an in-product, env-gated **demo workspace builder** create realistic data (goals, check-ins, projects, docs) in one transaction with notifications suppressed. This powers the public demo, onboarding ("explore with demo data"), and local dev.
- Rich text: ProseMirror JSON canonical; one shared core module for parse / render / sanitize / excerpt / mention-and-attachment extraction, used identically by app, email, exports and the importer's reference-rewrite pass. Markdown is a derived, lossy view for import/export and AI authoring, with round-trip golden tests.
- AI is a first-class domain, specified in AI-NATIVE-PLAN.md: multi-provider with bring-your-own-key and local models, tier routing, per-token cost metering with hard caps, versioned prompts, a permission-checked action registry feeding copilot + MCP + REST + CLI, pgvector embeddings (no new service), and **AI teammates** — agent members that plan and execute on the operating cadence under a least-privilege principal.

## 10. Quality, CI and releases

- Vitest for unit and integration tests. Playwright for end-to-end. A `packages/test-support` **factory that builds through core domain services** (never raw inserts), so every test's setup exercises RLS and `can()` wiring.
- E2E database isolation is designed, not hoped: template-database reset per worker (transaction rollback cannot reach Playwright's separate connection), with the workspace GUC set per test. This is a Phase 1 deliverable.
- Biome for lint and format. `tsc --noEmit` strict.
- CI: Turborepo **affected-graph** runs with a remote cache; Playwright/Vitest **sharding**; `concurrency: cancel-in-progress`; a **flaky-test policy** (retry + trace, merged report, passed-on-retry surfaced as a tracked metric, auto-quarantine after N flakes); knip dead-code gate; license-compatibility gate; DCO/CLA check. One runtime profile (§3.2) keeps this affordable.
- Contract drift checks: the generated OpenAPI document, the MCP tool catalog, and the generated CLI are re-derived in CI and diffed against committed artifacts — the single-source action registry (TECHNICAL-PLAN §14) cannot silently drift.
- Releases via Changesets: version, changelog, tagged signed Docker image, GitHub release. Enterprises pin versions; never force silent upgrades.
- Observability: OpenTelemetry with self-hostable backends (Grafana stack, self-hosted Sentry). Telemetry is opt-in and documented.

## 11. Delivery phases

Eight phases; each gates on the one before it. The strategy pillar — the product's namesake and differentiator — ships **before** the execution pillar, so the core value proposition exists early and is validated early.

**Phase 1 — Walking skeleton.** Monorepo, CI with the §10 machinery, DB package + RLS floor + the GUC/pooling spike + test-isolation harness, adapter ports with container drivers + the transactional outbox, Better Auth (passkeys + TOTP included), workspaces + members, the Operation pipeline + audit spine, a hello dashboard, the Compose target with the web setup wizard, the Helm target.

**Phase 2 — Core platform.** The relationship access model + `can()` + access-aware reads, people (profiles, manager chain, suspend/restore, directory), invitations (email + reusable links + trusted domains), files (quotas, previews, scan hook), subscriptions + the notification spine (buffered batching, per-user-local-time daily summary), the typed activity feed engine, settings + module registry, security baseline (rate limits, lockout, CSP, sessions UI, freeze overlay), the demo builder, the app shell + design system + rich text editor, the data-change runner + soft-delete scope.

**Phase 3 — Strategy core.** Spaces; goals + key results with champion/reviewer, flexible timeframes and an explicit close lifecycle; the pure scoring engine (precedence cascade); the cadence engine + `outdated`; check-ins as snapshot narrative objects with acknowledgement; the review inbox; discussions; the OKR surfaces + Work Map v1; KPIs with per-period records and the calculated-formula engine; the scorecard; the CSV/XLSX importer; the FlowyTeam strategy importer.

**Phase 4 — Execution core.** Projects with lifecycle, contributors and health check-ins; retrospectives; rich milestones; work items (multi-assignee, checklists, KR links); kanban boards; the Resource Hub (documents, folders, files, links); global search; Work Map v2 as the home screen; command palette + favorites; exports; the FlowyTeam task importer + full reconciliation.

**Phase 5 — The AI layer.** Provider abstraction + BYO keys + local models, catalog/tier routing, metering + caps, structured output + versioned prompts, the single action/contract registry (tRPC/REST/MCP/CLI/OpenAPI + drift CI), embeddings/RAG, the copilot, the **MCP server with a full OAuth 2.1 authorization server**, **AI teammates** (agent members, plan/execute runs, sandbox, batch approval), evals + the AI-off CI leg + live-transport MCP e2e, and the per-module assists.

**Phase 6 — Hardening.** Performance budgets at scale, load/soak, scheduled encrypted backups + CI restore drills, the workspace export/import portability engine, observability, security review + the RLS fuzz suite, accessibility audit + Web Vitals budgets, the migration cutover rehearsal.

**Phase 7 — Enterprise & operator pack.** SSO, LDAP, SCIM, MFA policy enforcement, audit export + tamper-evidence verification + air-gap guide, the operator console with transparent support impersonation, enterprise feature gating (human decision).

**Phase 8 — Community launch.** Docs site, deploy quickstarts, hosted demo, contributor onboarding + CLA bot, launch, the OKR-first template gallery + operating-rhythm guides.

**Post-v1 backlog (designed-for, not funded):** the serverless/zero-ops profile; custom fields; configurable types/statuses/workflows; the saved-query DSL and view builder; Gantt + the automatic scheduling engine (spike-gated); backlogs/Scrum; the time & cost tracking UI; meetings; budgets; project phases/gates; GitHub/GitLab integration; Slack/Teams notification channels; billing/entitlements + the hosted cloud; an OpenProject importer; CRDT co-editing; native mobile. Each keeps a design-for note in TECHNICAL-PLAN so nothing built in v1 blocks it.

## 12. Working with Claude Code

The loop this repo is built for:

1. Human fills REQUIREMENTS.md.
2. Claude Code reads CLAUDE.md (automatic), PLAN.md and REQUIREMENTS.md, then generates `docs/design/` at each phase's design gate.
3. Human reviews and approves the design docs.
4. Claude Code scaffolds Phase 1, then builds features slice by slice.
5. Every feature meets the Definition of Done in CLAUDE.md before it merges.

Throughput is planned, not assumed: one human reviewer + the agent, an assumed sustained rate of **3–5 merged tasks per week** (heavy tasks count double), with parallel worktrees allowed for independent slices (EXECUTION-GUIDE §6). At 93 tasks that is a realistic **6–9 months to the end of Phase 6**, not weeks. If reality diverges by more than ±50% over a month, re-baseline the plan rather than silently slipping.

## 13. Risk register (the top bets, each with a kill/simplify criterion)

| # | Bet | De-risk | Kill / simplify criterion |
|---|---|---|---|
| R1 | RLS GUC discipline under connection pooling | Phase 1 spike (P1-T03): prove `SET LOCAL` isolation under pgbouncer-style pooling with tests; zero-row-without-GUC CI test | If unprovable: fall back to wrapper-injected `WHERE workspace_id` at the query layer, keep RLS on audit/security-critical tables only |
| R2 | Scoring engine correctness (status cascade, weighted rollup, cascade) | Golden-master matrix written and human-reviewed at the P3-T00 design gate, using Operately's shipped cascade as the reference spec | If cases dispute: cut weighted child-objective rollup from v1; keep KR→goal only |
| R3 | KPI formula engine (a small spreadsheet recalc engine) | Own task, typed expression tree, no `eval`, golden masters from FlowyTeam data | If it balloons: v1 ships sum/avg rollup KPIs only; free formulas post-v1 |
| R4 | MCP OAuth 2.1 server complexity | Port Operately's shipped, spec-complete flow as the reference design (AI-NATIVE-PLAN §5); e2e against the real transport | Never ship a PAT-only MCP: if OAuth slips, the MCP server slips with it |
| R5 | Autonomous AI teammates safety | Least-privilege agent principal, sandbox mode, batch-approval inbox, hard cost caps, injection-untrusted retrieval | If safety review fails: v1 agents run sandbox/batch-approval only, no direct writes |
| R6 | Single-reviewer throughput | The §12 throughput assumption; parallel worktrees; monthly re-baseline | Two consecutive months >50% under plan: cut Phase 4 scope (boards or Resource Hub polish) before cutting Phase 3 |
| R7 | Greenfield vs a shipped competitor | Trimmed v1 (REQUIREMENTS §6), strategy-first sequencing, Operately behavior as reference spec | If Phase 3 exit misses its quality bar: pause and re-open the §2 decision honestly |

## 14. Open decisions register

Decided (recorded above and in REQUIREMENTS/TECHNICAL-PLAN): **greenfield over fork** (§2, 2026-07-08); **v1 execution scope = Operately-class core, configurable-PM engines deferred** (REQUIREMENTS §6); **single runtime v1, serverless post-v1** (§3); **importers = CSV/XLSX + FlowyTeam full strategy+tasks; OpenProject importer cut** (TECHNICAL-PLAN §7); **hosted SaaS designed-for now, built post-launch** (billing behind a flag; operator console in Phase 7).

Still open:

| # | Decision | Options | Current lean | Decide by |
|---|---|---|---|---|
| 1 | Product name | TBD | TBD (working name `OpenOKR` undersells the operating-system positioning) | Before repo goes public |
| 2 | Business model | Pure OSS / open core `ee/` / OSS + paid cloud | Open; CLA keeps all doors open | Before v1.0 |
| 3 | SSO placement | Open core vs paid tier | Open core; institutions need it to adopt | Before Phase 7 |
| 4 | License final sign-off | AGPL-3.0 + CLA / Apache-2.0 | AGPL-3.0 + CLA | Before first public commit |
| 5 | Serverless job/realtime drivers | Inngest / Trigger.dev / QStash; Supabase / Ably | Inngest + Supabase | At the post-v1 serverless phase |
| 6 | Enterprise feature gating set | Which features (if any) are paid | None gated in v1; revisit with #2 | Before Phase 7 exit |
| 7 | AI default posture | Off / on where a provider is configured | On where configured (AI-NATIVE-PLAN §13) | Before Phase 5 |
| 8 | AI open core vs paid | Fully open / gate copilot + MCP + teammates | Fully open; revisit with #2 | Before Phase 7 |

More AI-specific open decisions (drivers shipped, per-user keys, eval bar, outbound MCP, embedding dimension, teammate autonomy defaults) are in AI-NATIVE-PLAN.md §13; they are confirmed at the Phase 5 design gate (P5-T00).
