# CLAUDE.md

## What this project is

`OpenOKR` is an open source, **opinionated operating system for running a company on goals**, built ground-up on a modern TypeScript stack. Native strategy (OKRs, KPIs, check-ins) is joined to an Operately-class execution core (projects, milestones, work items, boards, a Resource Hub) by one thing: a built-in **operating rhythm** — a check-in cadence with enforced staleness, a champion/reviewer accountability contract, a personal review inbox, and one company-wide Work Map. AI is woven through it, including **AI teammates**: autonomous agent members that plan and execute on the same rhythm as people.

The benchmark is **Operately** (a shipped, Apache-2.0 "company operating system"). We build ground-up, not fork it — the reasons are recorded in `PLAN.md §2`. We study Operately's *observable behavior* as a reference spec; we never copy its code (`TECHNICAL-PLAN.md §11`).

v1 ships two ways: Docker Compose (single server, via a first-run web setup wizard) and Helm (enterprise Kubernetes). A serverless/cloud profile is designed-for but built post-v1. One legacy tool gets a data importer: **FlowyTeam** (MySQL, per company). A **generic CSV/XLSX importer** covers everything else. (The former OpenProject importer was cut — decision 2026-07-08.)

**Lead with opinion, not configuration.** The default product is the operating rhythm working out of the box with zero setup. Configurable engines (custom fields, configurable workflows, a query DSL, Gantt/scheduling) are a deferred "power floor" (`REQUIREMENTS.md §6`), never the lead. This is the product thesis; when a choice is unclear, the more opinionated default wins.

## The document set and authority order

All in `docs/development-plan/`:

1. `REQUIREMENTS.md` — **what** the product does (personas, the operating model §3, modules, priorities, the v1/power-floor split). Product authority.
2. `PLAN.md` — **architecture principles**, the greenfield decision (§2), deployment, delivery philosophy, the risk register (§13), open decisions (§14).
3. `TECHNICAL-PLAN.md` — the **target design**: identity + relationship access model (§4.1), full schema by module (§4), adapter ports + the transactional outbox (§5), the pure engines (§6), the importer (§7), security (§8), testing (§10), API/one-contract registry (§14), the Operately scorecard (§15). Schema authority for every module.
4. `AI-NATIVE-PLAN.md` — the **AI domain** at the same depth: providers/BYO-key/local models, governance, the MCP OAuth 2.1 server, the copilot, **AI teammates**, AI schema/security, Phase 5 tasks (§12). Peer of TECHNICAL-PLAN.md for that domain.
5. `UIUX-PLAN.md` — the **user interface**: design system, navigation, interaction patterns, screen specs, UX quality gates. If a screen or pattern is not specified there, ask; do not invent UI.
6. `IMPLEMENTATION-PLAN.md` — the **work**: eight phases, tasks with IDs, Definition of Ready. Execution authority. (Phase 5 AI task bodies live in `AI-NATIVE-PLAN.md §12`.)
7. `EXECUTION-GUIDE.md` — the **process** between you and the human.
8. `reference/flowyteam-okr-kpi-tasks-model.md` — the FlowyTeam source knowledge base (read-only facts for the importer). The `reference/legacy-*.md` (OpenProject) files are **archived background only** — nothing in this plan depends on them.
9. This file — how **you** work.

If two documents disagree, the one higher in this list wins, except: never resolve a REQUIREMENTS vs PLAN conflict yourself. Stop and ask.

**Supporting documents** (context, not authority): `STATUS.md` (live task tracker — read every session; you update rows, only a human sets `done`), `DATABASE.md` (derived consolidated schema; authority is `TECHNICAL-PLAN.md §4`; update in the same PR when schema changes), `OVERVIEW.md` (end-user product overview), `OPERATELY-COMPARISON.md` + `OPERATELY-GAP-REGISTER.md` (the competitive analysis this plan is built on — read them to understand *why* a requirement exists), `PROMPT.md` (the human's task-loop prompts), `README.md` (the index).

## How you work: the task loop

You execute exactly one task from `IMPLEMENTATION-PLAN.md` at a time, only when a human names it. Full protocol in `EXECUTION-GUIDE.md`. Your side:

1. Restate the task (goal, deliverables, test plan, open questions) and check the Definition of Ready. Wait for confirmation. No code yet.
2. Tests first: write the task's tests so they fail for the right reason.
3. Implement until green. Obey every hard rule below.
4. QA: the task's checklist, `pnpm typecheck`, `pnpm lint`, full suite. Exercise the feature in the running app when the checklist says so.
5. Update `STATUS.md` to `in_review`. Branch `task/<task-id>-<slug>`. One PR titled `<TASK-ID>: <title>` with the Definition of Done filled in.
6. Stop. Never start the next task on your own. Never merge your own PR.

Blocked? Set the task to `blocked` in `STATUS.md`, write exactly why, and ask. Do not improvise around a blocker. Phases have design gates: do not begin a phase's implementation tasks until the human approves that phase's design-gate output with an explicit "Design approved".

## Design docs

Detailed designs live in `docs/design/`, written by you at each phase's design gate. Scannable: tables and examples over prose. Acceptance criteria as testable Given / When / Then. When implementation deviates from a design doc, update the doc in the same PR.

## Hard rules, never break these

- TypeScript strict everywhere. No `any` without a justifying comment.
- Postgres is the only required service. Access it only through Drizzle via `DATABASE_URL`.
- Never import a vendor SDK (Supabase, Vercel, Inngest, Resend, Pusher, an LLM SDK, etc.) outside `packages/adapters`.
- Every runtime-sensitive capability goes through a port in `packages/adapters`: jobs, realtime, storage, mailer, cache, search, ai. v1 ships the container drivers; keep serverless buildable by discipline (no `RUNTIME` checks in feature code), but you are **not** required to prove serverless per task — that profile is post-v1 (`PLAN.md §3`).
- **Every write is one transaction through the Operation pipeline:** domain mutation + access bindings + activity + audit row + outbox row commit together. Authorize *before* the transaction against freshly loaded, access-scoped rows. Side effects (email, realtime, search, jobs) are enqueued **only** by inserting an `outbox` row in that transaction — never a direct driver call on the write path (`TECHNICAL-PLAN.md §5`, `§8.1`).
- Every business table gets `workspace_id` and an **RLS policy in the same migration**. The GUC is set with `SET LOCAL` per transaction. RLS is the tenant floor; it does **not** replace object authorization.
- **Object authorization is the relationship model through one `can()`** (contexts/bindings/groups, `TECHNICAL-PLAN.md §4.1`). Every read of a protected aggregate goes through the single access-aware getter (not-found on forbidden; suspended members excluded). No per-endpoint ad-hoc checks. Never rely on the UI to hide anything.
- Rich text is **ProseMirror/TipTap JSON** (jsonb + `version int`), never Markdown-as-storage. Parse/validate/render/excerpt/extract through the one shared `packages/core/rich-text` module. Rendering is a sanitizing allowlist renderer — no raw-HTML passthrough at any surface (app, email, exports). Imported HTML is untrusted.
- Reads and writes are defined **once** in the `packages/core` action/contract registry (Zod input/output + required access level); tRPC, REST, MCP tools, OpenAPI and the CLI are projections. CI diffs the generated artifacts.
- Validate all external input with Zod at the boundary.
- Auth goes through Better Auth only. Session tokens hashed at rest. Never hand-roll sessions, tokens, or password handling.
- Migrations are forward-only and ship with the feature. Data backfills go through the separate `packages/db` data-change runner (frozen-schema, idempotent), never mixed into DDL.
- Soft delete is the repo-wide default scope (`deleted_at IS NULL`); use the explicit `withDeleted()` opt-in when you need deleted rows.
- Never commit code under the "Claude" name. No `Co-Authored-By: Claude`, no "Generated with Claude Code", no Claude/Anthropic attribution in commits or PRs. Use the current GitHub account's name and email only.
- AI is native but never required. Every AI feature is an accelerator over a complete manual path and degrades when the AIProvider is `off`; CI enforces it. No LLM call on a required path. Every AI action runs under a concrete principal (the human, or an agent member with least-privilege bindings) through `can()` + RLS — never a superuser. Provider keys envelope-encrypted, never logged, decrypted server-side only.
- No new runtime dependency without asking the human first.
- Never commit secrets. Never log secrets or personal data.

## Importer rules

- Importers read sources strictly **read-only**. Never write to, lock, or migrate a source.
- Two importers: `csv` (generic XLSX/CSV per entity, with a dry-run preview + per-row error report) and `flowyteam` (read-only MySQL; `--company <id>` required — one company → one workspace; the MySQL client is the one pre-approved importer dependency). There is **no** OpenProject importer.
- Every importable business table has a row in the `TECHNICAL-PLAN.md §7.2` FlowyTeam mapping (or is marked "new, no legacy source"). Update the mapping in the same PR as the migration.
- Import runs are idempotent: keep `legacy_id` + `legacy_type` (`flowyteam`/`csv`), unique `(workspace_id, legacy_type, legacy_id)`. Imports run through the normal Operation pipeline with notification dispatch suppressed (the bulk-import flag).
- Cannot map losslessly? Do not silently drop. Record it in the import report and raise it as an open question.
- Derived values (scores, health, KPI achievements, `next_step`, rollups) are recomputed after load, never trusted from the source. Imported time logs are preserved read-only (the tracking UI is post-v1).
- Importer code lives in `packages/importer`; it may depend on `packages/db`, never on `apps/web`.

## Locked stack

Next.js App Router, React, Tailwind + shadcn/ui on **Base UI** primitives (not Radix) + **SmoothUI** on **Motion** (`motion`), TanStack Query/Table/Virtual, tRPC (internal) + REST (public) + MCP, Drizzle + PostgreSQL (+ `pgvector` extension for embeddings — no new service), Better Auth, Zod, ProseMirror/TipTap, pg-boss (container jobs), Turborepo + pnpm, Vitest + Playwright, Biome. For the AI layer: a provider-agnostic LLM client (the Vercel AI SDK, `ai`) and the MCP TypeScript SDK (`@modelcontextprotocol/sdk`), both only inside `packages/adapters`. Do not substitute any of these without human approval. Add UI components via the shadcn MCP (shadcn/Base-UI + SmoothUI registries), vendored into `packages/ui` — build-time only, no runtime dependency or network call (air-gap safe).

Approved agent-side dev tooling (never shipped, no product dependency): the **Next.js DevTools MCP** (`next-devtools-mcp`, in `.mcp.json`) bridging to the local `/_next/mcp` dev-server endpoint (Next 16+). Dormant until `apps/web` is scaffolded and `pnpm dev` runs. Vendor/pin it for an air-gapped dev machine.

## Repo layout (target)

```
apps/web            Next.js app (UI, tRPC, REST, MCP endpoint)
packages/core       Domain logic, the Operation pipeline, the action registry,
                    can() + access getter, pure engines, rich-text core. Framework-free.
packages/db         Drizzle schema, migrations, RLS, seed, data-change runner, soft-delete scope
packages/adapters   Ports + container drivers (serverless stubs) + the outbox relay
packages/importer   FlowyTeam (MySQL) + CSV/XLSX importers (CLI)
packages/ui         Shared components (shadcn on Base UI; SmoothUI/Motion)
packages/config     tsconfig, Biome, env schema
packages/test-support  Factory (builds through core) + test DB harness
deploy/docker       Dockerfile, docker-compose.yml, Caddy, setup wizard
deploy/helm         Helm chart
docs/development-plan  This plan set, STATUS.md, the FlowyTeam reference
docs/design         Design docs, written per phase
```

## Commands (keep current once scaffolded)

- `pnpm dev` — run the app locally
- `pnpm test` / `pnpm test:e2e` — unit+integration / Playwright
- `pnpm typecheck` / `pnpm lint` — strict TS / Biome
- `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:change` — migrations / demo data / data-change runner
- `pnpm import:csv` / `pnpm import:flowyteam` — the importers (dry-run by default)
- `pnpm gen:contract` — regenerate OpenAPI + MCP catalog + CLI from the action registry (CI diffs this)

## Definition of done for every task

- The task's acceptance criteria pass.
- Migration + RLS policy shipped together; every new business table has `workspace_id`.
- Writes go through the Operation pipeline (mutation + audit + activity + outbox atomic); reads go through the access getter.
- Unit tests + at least one e2e happy path for user-visible features; setup uses the `test-support` factory (through core services), not raw inserts.
- The FlowyTeam mapping table (`TECHNICAL-PLAN.md §7.2`) updated if any table changed.
- Inputs validated with Zod; rich text validated + sanitized.
- Sensitive actions emit append-only audit events.
- Loading, empty, error and permission-denied states implemented — not just the happy path.
- UI tasks pass the UX quality gates in `UIUX-PLAN.md` (screen match, dark mode, keyboard, reduced motion, axe, i18n catalogs, performance budget).
- Contract projections regenerated and drift-check green if the registry changed.
- Design doc updated if implementation deviated. `STATUS.md` row updated.

## Writing style for everything you write in this repo

- Plain English. Short sentences. No em dashes. No buzzwords.
- Explain any unavoidable technical term the first time it appears.
- Prefer tables, examples and checklists over long prose.
- Code comments explain why, not what.

## Ask the human, never decide alone

- Anything in `PLAN.md §14` (open decisions) or `AI-NATIVE-PLAN.md §13`.
- Any conflict between `REQUIREMENTS.md` and `PLAN.md`.
- Ambiguous or contradictory acceptance criteria.
- Adding any service beyond Postgres to a deployment tier, or any new runtime dependency.
- Dropping or approximating source data in an importer.
- Gating any feature behind a paid tier (including scorecard points, off by default).
- Pulling a "power floor" item (`REQUIREMENTS.md §6`) into v1 scope.
- Any autonomy policy change for an AI teammate beyond `batch_approval` default.
- License changes or copyleft-incompatible dependencies.
- Deleting or rewriting migrations, or anything touching stored user data.
