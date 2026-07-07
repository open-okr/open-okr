# CLAUDE.md

## What this project is

`OpenOKR` is an open source **OKR and work management platform**, built ground-up on a modern TypeScript stack. Native strategy modules (OKR, KPI, check-ins) sit beside full work management (work packages, boards, gantt, wiki, meetings). One codebase deploys three ways: Vercel + Supabase for small teams, Docker Compose for single servers, Helm for enterprise Kubernetes. Same release, same behavior everywhere.

A hard product constraint: teams coming from either legacy tool must be able to migrate. Lossless data importers from two sources — a legacy project tool (PostgreSQL) and FlowyTeam (MySQL) — are first-class features, not afterthoughts. Schema decisions are checked against both source data models (see `reference/`) from day one.

## The document set and authority order

All in `docs/development-plan/`:

1. `REQUIREMENTS.md` defines **what** the product does. Product authority.
2. `PLAN.md` defines the **architecture principles** and delivery philosophy.
3. `TECHNICAL-PLAN.md` defines the **target design**: domain model and full schema, including the **strategy domain** (OKR/KPI/check-ins/tasks) at §4.12, the pure scoring engine at §6.2, the importer architecture (two sources, §7; source 1 mapping §7.4, source 2 mapping §7.6), security controls (§8), and performance budgets (§13). This is the schema authority for every module, strategy included.
4. `AI-NATIVE-PLAN.md` defines the **AI domain** in the same depth: the AI-native stance, the capability catalog, the provider / bring-your-own-key architecture, the admin surface, the MCP server, the agentic copilot + tool registry, AI schema/security, and the Phase 5 tasks (§12). Peer of TECHNICAL-PLAN.md for that domain.
5. `UIUX-PLAN.md` defines the **user interface**: design system, navigation, interaction patterns, screen specs (S-01…S-25), UX quality gates. If a screen or pattern is not specified there, ask; do not invent UI.
6. `IMPLEMENTATION-PLAN.md` defines the **work**: eight sequential phases and tasks with IDs, plus the Definition of Ready. This is your execution authority. You build what a task says, in task order. (Phase 5 AI task detail lives in AI-NATIVE-PLAN.md §12.)
7. `EXECUTION-GUIDE.md` defines the **process** between you and the human.
8. `reference/` holds the source-system knowledge bases: `legacy-data-model.md` + `legacy-feature-inventory.md` (source 1, the Rails project tool, PostgreSQL) and `flowyteam-okr-kpi-tasks-model.md` (source 2, FlowyTeam, MySQL). You do not have access to either repository; these files are your only source about them. Treat them as read-only facts.
9. This file defines how **you** work.

If two documents disagree, the one higher in this list wins, except: never resolve a REQUIREMENTS vs PLAN conflict yourself. Stop and ask the human.

**Supporting documents** (not authority, but read them when relevant):

- `docs/development-plan/STATUS.md` — live execution tracker: one row per task, the single source of truth for progress. You update rows; only a human sets `done`. Read it every session to know what is next.
- `docs/development-plan/DATABASE.md` — the full consolidated schema in one place (every table, key columns, foreign keys, enums, relationship diagram). A **derived** reference view; the authority is still `TECHNICAL-PLAN.md §4` (strategy: §4.12). When those change, update `DATABASE.md` in the same PR.
- `docs/development-plan/OVERVIEW.md` — the end-user product overview (what every module does and why). Useful for product context; not part of the build-authority chain.
- `docs/development-plan/PROMPT.md` — the human's copy-paste prompts for driving the task loop. Background on how a session is started; the protocol itself is in `EXECUTION-GUIDE.md`.
- `README.md` (repo root) — the index to this whole document set.

## How you work: the task loop

You execute exactly one task from IMPLEMENTATION-PLAN.md at a time, only when a human names it. The full protocol is in EXECUTION-GUIDE.md. Your side of it:

1. Restate the task (goal, deliverables, test plan, open questions) and check the Definition of Ready in IMPLEMENTATION-PLAN.md (dependencies done, spec sections exist, acceptance criteria unambiguous). Wait for confirmation. No code yet.
2. Tests first: write the task's tests so they fail for the right reason.
3. Implement until green. Obey every hard rule below.
4. QA: run the task's QA checklist, `pnpm typecheck`, `pnpm lint`, full suite under both runtime profiles. Exercise the feature in the running app when the checklist says so.
5. Update `docs/development-plan/STATUS.md` to `in_review`. Branch `task/<task-id>-<slug>`. One PR titled `<TASK-ID>: <title>` with the Definition of Done checklist filled in.
6. Stop. Never start the next task on your own. Never merge your own PR.

If you are blocked, set the task to `blocked` in STATUS.md, write down exactly why, and ask. Do not improvise around a blocker.

Phases have gates. Do not begin a phase's implementation tasks until the human has approved that phase's design-gate task output with an explicit "Design approved" message.

## Design docs

Detailed designs live in `docs/design/`, written by you as design-gate tasks inside each phase (see IMPLEMENTATION-PLAN.md). Keep each doc scannable: tables and examples over prose. Write acceptance criteria as testable Given / When / Then. When implementation deviates from a design doc, update the doc in the same PR.

## Hard rules, never break these

- TypeScript strict mode everywhere. No `any` without a comment justifying it.
- Postgres is the only required service. Access it only through Drizzle using `DATABASE_URL`.
- Never import a vendor SDK (Supabase, Vercel, Inngest, Resend, Pusher, etc.) outside `packages/adapters`. Core and UI code must not know which driver is running.
- Every runtime-sensitive capability goes through a port in `packages/adapters`: jobs, realtime, storage, mailer, cache, search, ai.
- Every feature must work under both `RUNTIME=container` and `RUNTIME=serverless`. If a feature cannot, stop and ask before building it.
- Every business table gets `workspace_id` and an RLS policy in the same migration. No exceptions, no "add security later".
- Validate all external input with Zod at the boundary (API routes, webhooks, env vars, file uploads, importer inputs).
- Auth goes through Better Auth only. Never hand-roll sessions, tokens or password handling.
- Migrations are forward-only and ship in the same PR as the feature.
- Never commit code under the "Claude" name. Do not add `Co-Authored-By: Claude` trailers, `Generated with Claude Code` lines, or any Claude/Anthropic attribution to commits or PRs. Every commit uses the current GitHub account's name and email only.
- AI is native but never required (AI-NATIVE-PLAN.md). Every AI feature is an accelerator over a complete manual path and degrades gracefully when the AIProvider is `off`; CI enforces this. No LLM call may sit on a required path. Every AI action, in-app or over MCP, runs through `can(user, permission, ctx)` + RLS as the acting user: the agent is never a superuser. Provider keys are encrypted at rest, never logged, decrypted server-side only.
- No new runtime dependency without asking the human first.
- Never commit secrets. Never log secrets or personal data.

## Importer rules

- The importers read the legacy databases strictly read-only. Never write to, lock, or migrate a source.
- Two sources, selected with `--from`: `openproject` (PostgreSQL, one instance → one workspace) and `flowyteam` (MySQL, one database holds many companies — `--company <id>` is required, one company → one workspace). The MySQL client is the one pre-approved importer dependency.
- Every business table you create must have a row in the relevant mapping table — TECHNICAL-PLAN.md §7.4 (source 1) or §7.6 (source 2) — or be marked "new, no legacy source". Update the mapping in the same PR as the migration.
- Import runs are idempotent: re-running an import must not duplicate data. Keep legacy IDs in `legacy_id` columns plus `legacy_type` (`openproject` / `flowyteam`, and per-table values where one new table merges several legacy ones), unique on `(workspace_id, legacy_type, legacy_id)`. Both sources may load into one workspace without collisions.
- When a legacy structure cannot map losslessly, do not silently drop data. Record it in the import report and raise it as an open question to the human.
- Derived values (OKR scores, KPI achievements, rollups, trees) are recomputed after load, never trusted from the source.
- Importer code lives in its own package and may depend on `packages/db`, never on `apps/web`.

## Locked stack

Next.js App Router, React, Tailwind CSS + shadcn/ui on **Base UI** primitives (not Radix) + **SmoothUI** animated components on **Motion** (`motion`, approved), TanStack Query and Table, tRPC internal + REST public, Drizzle + PostgreSQL, Better Auth, Zod, pg-boss (container jobs), Turborepo + pnpm, Vitest + Playwright, Biome. Do not substitute any of these without human approval. Add UI components via the shadcn MCP (shadcn/Base-UI + SmoothUI registries), vendored into `packages/ui`; the MCP and registries are build-time only (no runtime dependency or network call — air-gap safe). For the AI layer (AI-NATIVE-PLAN.md), also locked: a provider-agnostic LLM client (the Vercel AI SDK, `ai`) and the MCP TypeScript SDK (`@modelcontextprotocol/sdk`), both used only inside `packages/adapters`, plus `pgvector` (a Postgres extension — no new service) for embeddings. The same no-substitution rule applies.

Approved agent-side dev tooling (never shipped, no product/runtime dependency, does not affect the deployed app's air-gap guarantee): the **Next.js DevTools MCP** (`next-devtools-mcp`, in `.mcp.json`) — the official Vercel package from the Next.js MCP guide. It bridges to the built-in `/_next/mcp` endpoint of a **local Next.js 16+ dev server** (Next 16+ is required for that endpoint) and gives the agent live build/runtime/type errors, routes, page metadata, and Server Action lookups. It is dormant until `apps/web` is scaffolded and `pnpm dev` is running (P1-T01 onward). Fetched from npm at dev time like any dev tool; vendor/pin it for an air-gapped dev machine.

## Repo layout (target)

```
apps/web            Next.js app
packages/core       Domain logic, framework-free (incl. scheduling + OKR scoring engines)
packages/db         Drizzle schema, migrations, RLS
packages/adapters   Ports + container and serverless drivers
packages/importer   Legacy data importers (CLI; PostgreSQL + MySQL sources)
packages/ui         Shared components (shadcn/ui on Base UI; SmoothUI/Motion for animation)
packages/config     tsconfig, Biome, env schema
deploy/docker       Dockerfile, docker-compose.yml
deploy/helm         Helm chart
deploy/vercel       Deploy notes, env template
docs/development-plan Plan set, STATUS.md, the source-system references
docs/design         Design docs, written per phase
```

## Commands (once scaffolded, keep this list current)

- `pnpm dev` : run the app locally
- `pnpm test` : unit and integration tests
- `pnpm test:e2e` : Playwright
- `pnpm typecheck` : strict TS check
- `pnpm lint` : Biome
- `pnpm db:migrate` : apply migrations
- `pnpm db:seed` : demo workspace data
- `pnpm import:legacy` : run a legacy importer (`--from openproject|flowyteam`; dry-run by default)

## Definition of done for every task

- The task's acceptance criteria pass.
- Works in both runtime profiles, CI matrix green.
- Unit tests plus at least one e2e happy path for user-visible features.
- Migration and RLS policy shipped together.
- The relevant schema mapping table (TECHNICAL-PLAN.md §7.4 or §7.6) updated if any table changed.
- Inputs validated with Zod.
- Sensitive actions emit audit events.
- Loading, empty and error states implemented, not just the happy path.
- UI tasks pass the UX quality gates in UIUX-PLAN.md §9 (screen spec match, dark mode, keyboard, reduced motion, axe, i18n catalogs, performance budget).
- Design doc updated if implementation deviated from it.
- STATUS.md row updated.

## Writing style for everything you write in this repo

- Plain English. Short sentences. No em dashes. No buzzwords.
- Explain any unavoidable technical term the first time it appears.
- Prefer tables, examples and checklists over long prose.
- Code comments explain why, not what.

## Ask the human, never decide alone

- Anything listed in PLAN.md section 12 (open decisions).
- Any conflict between REQUIREMENTS.md and PLAN.md.
- Ambiguous or contradictory acceptance criteria in a task.
- Adding any service beyond Postgres to a deployment tier.
- Dropping or approximating legacy data in the importers.
- Gating any feature behind a paid tier (including scorecard points, which ship off by default).
- License changes or adding dependencies with copyleft-incompatible licenses.
- Deleting or rewriting migrations, or anything touching stored user data.
