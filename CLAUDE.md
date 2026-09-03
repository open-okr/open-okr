# CLAUDE.md

## What this project is

**OpenOKR** is an open source, AI-agentic-native OKR platform. Not a tracker: a system that runs the OKR practice and coaches the organisation through it.

Two things make it different, and every design decision serves one of them.

**The method is in the product.** `docs/development-plan/METHOD.md` holds the OKR practice canon: the eight-phase cycle, scoring and confidence bands, twenty-six quality checks with their word lists and coaching prompts, six publish gates, the alignment health score, KPI health corridors and recovery objectives, the blocker and root-cause taxonomies, both session agendas, and the closing diagnostic. It is compiled into `packages/method`, a pure library with no database or network access. A conformance suite fails the build when the document and the code disagree.

**The product is active.** Two agent members ship with every workspace. The **OKR Coach** guards quality. The **OKR Champion** guards the rhythm. They initiate, escalate and propose, in the browser, in Slack, Microsoft Teams, WhatsApp and Telegram, by email, and through any external AI agent the user runs. Every message cites a rule key that resolves back to METHOD.md.

It runs two ways from one release: self-hosted (Docker Compose or Helm) and a managed cloud. Nothing is feature-gated.

## The document set and authority order

All in `docs/development-plan/` unless noted:

1. `REQUIREMENTS.md`: what the product does. Product authority.
2. `PLAN.md`: architecture principles, packages, adapters, deployment, phases, risks, open decisions.
3. `METHOD.md`: the OKR practice canon. Authority for every rule, threshold, band, corridor, taxonomy, gate, agenda and diagnostic.
4. `TECHNICAL-PLAN.md`: the target design: identity and access, the full schema by domain, adapter ports and the transactional outbox, the engines, importers, security, testing, performance, the one-contract API.
5. `AI-NATIVE-PLAN.md`: the AI and agent domain: providers, keys, governance, channels, the two agents with their trigger and escalation catalogue, the copilot, retrieval, the external agent surface.
6. `UIUX-PLAN.md`: the interface: design system, navigation, interaction patterns, screens S-01 to S-40, quality gates.
7. `IMPLEMENTATION-PLAN.md`: the work: eight phases, 105 tasks, the Definition of Ready. Execution authority.
8. `EXECUTION-GUIDE.md`: the process between you and the human.
9. `CI-GATES.md`: every gate that will refuse the work, the command that runs it locally, and what each one catches that reading the diff does not. Read it before your first push, not after your first red build.
10. `reference/`: source-system knowledge bases for the importers. Read-only facts.
11. This file, at the repository root: how **you** work.

If two documents disagree, the one higher in this list wins, with one exception: never resolve a REQUIREMENTS versus PLAN conflict yourself. Stop and ask.

**Supporting documents** (context, not authority): `STATUS.md` (the live task tracker, read it every session, you update rows and only a human sets `done`), `DATABASE.md` (the derived consolidated schema, authority is TECHNICAL-PLAN §4, update it in the same change), `OVERVIEW.md` (the end-user product overview), `PROMPT.md` (the human's prompts), `README.md` (the index), `docs/stakeholder/mockups/` (eleven screens from UIUX-PLAN §6 drawn as HTML and rendered to PNG).

## How you work: the task loop

You execute exactly one task from `IMPLEMENTATION-PLAN.md` at a time, only when a human names it. The full protocol is in `EXECUTION-GUIDE.md`. Your side:

1. Restate the task (goal, deliverables, test plan, open questions) and confirm the Definition of Ready. Wait for confirmation. No code yet.
2. Tests first: write the task's tests so they fail for the right reason.
3. Implement until green. Obey every hard rule below.
4. Quality checks: the task's checklist, type checking, linting, the full affected suite. Exercise the feature in the running application when the task says so.
5. Update `STATUS.md` to `in_review`. Branch `task/<task-id>-<slug>`. One change titled `<TASK-ID>: <title>` with the Definition of Done filled in.
6. Stop. Never start the next task on your own. Never merge your own work.

**One task is one working session and one commit.** That is the size a task is cut to, not a target to squeeze into. If you get partway through and realise it will not fit, stop before writing more code, say so, and propose the split as lettered parts (`P4-T02a`, `P4-T02b`). The human decides. Splitting a task across four commits without saying so is what this rule exists to prevent: it reads as progress and hides that nothing is finishable.

A task that has to be split is a task that was cut wrong. Fix `IMPLEMENTATION-PLAN.md` in the same change, so the next person meets the corrected size rather than the original guess.

Blocked? Set the task to `blocked` in `STATUS.md`, write down exactly why, and ask. Do not improvise around a blocker.

Phases have design gates at P3-T00, P4-T00, P5-T00 and P8-T01. Do not begin a phase's implementation tasks until the human approves that gate's output with an explicit "design approved".

## Design docs

Detailed designs live in `docs/design/`, written by you at each design gate. Keep them scannable: tables and examples over prose. Write acceptance criteria as testable Given / When / Then. When implementation deviates from a design document, update the document in the same change.

**Reference mockups.** Eleven screens are drawn in `docs/stakeholder/mockups/` and indexed in UIUX-PLAN.md §10. Look at the mockup before you start a UI task that cites one: it shows the density, the chips, the states and the composition the specification describes in words. They are reference, not authority. When a mockup and a specification disagree, the specification wins and the mockup gets fixed. Never cite a mockup as the reason for a behaviour.

## Hard rules, never break these

### The method

- **METHOD.md is the only source of OKR practice.** Every rule, threshold, band, corridor, taxonomy, gate, session agenda and diagnostic lives there and is implemented in `packages/method`. Never hardcode a threshold, a word list or a coaching message anywhere else.
- **`packages/method` is pure.** No database, no network, no framework, no AI. It runs identically in the browser as the user types, on the server before a write, inside the agents, and in the importer.
- **Every coaching message and every proactive message carries a rule key** that resolves to a rule in the package. A message citing a rule the package does not define fails the build.
- **Never change practice on your own.** If a rule, threshold or message seems wrong, stop and ask. METHOD.md changes are a human decision.

### The agents

- **Deterministic first.** Every nudge, escalation, gate, score, corridor and diagnostic works with the AI provider off. AI adds drafting, rewriting, semantic judgement and language, never the decision itself. Continuous integration proves the product is whole with AI disabled.
- **Propose by default.** Agents produce proposals into the review queue. Direct writes require an explicit per-agent opt-in. Sandbox mode commits nothing at all.
- **Least privilege.** An agent gets bindings on named spaces, goals and KPI trees only. Never a workspace-wide grant. There is no service account with ambient authority.
- **Every proactive message is a recorded nudge row** with a rule key, a channel, an escalation step and a suppression reason when suppressed. Deduplicate to one per subject per member per day unless the escalation step increases. Respect quiet hours. A snooze never hides a review-inbox obligation.

### The platform

- TypeScript strict everywhere. No loose types without a comment justifying it.
- Postgres is the only required service. Access it only through Drizzle using `DATABASE_URL`.
- Never import a vendor SDK (a cloud provider, a queue, a mail service, a chat provider, an LLM client) outside `packages/adapters`.
- Every runtime-sensitive capability goes through a port in `packages/adapters`: jobs, realtime, storage, mail, cache, search, ai, channels.
- **Every write is one transaction through the Operation pipeline:** the domain change, access bindings, the activity row, the audit row and the outbox row commit together. Authorise *before* the transaction against freshly loaded, access-scoped rows. Side effects are enqueued **only** by inserting an outbox row in that transaction. A direct driver call on a write path is a build failure.
- **Every setting has a working default and nothing must be configured before the product works.** New settings are declared in the TECHNICAL-PLAN.md §4.14 map with a default, and thresholds belong to the METHOD.md §11 registry. Never hardcode a value that belongs in either. Never ship a screen that blocks until a setting is chosen.
- Every business table gets `workspace_id` and a **row-level security policy in the same migration**. The tenant setting is applied with `SET LOCAL` per transaction. Row-level security is the tenant floor; it does not replace object authorisation.
- **Object authorisation is the relationship model through one `can()`.** Every read of a protected aggregate goes through the single access-aware getter, which returns not-found on forbidden and excludes suspended members. No per-endpoint ad-hoc checks. Never rely on the interface to hide anything.
- Rich text is editor JSON in `jsonb` with a version column, never Markdown as storage. Parse, validate, render, excerpt and extract through the one shared `packages/core` module. Rendering is a sanitising allow-list at every surface, including email and exports. Imported content is untrusted.
- Reads and writes are defined **once** in the `packages/core` action contract registry with schemas and a required access level. The internal client, REST, OpenAPI, the command line, the agent tool catalogue and the chat commands are projections. Continuous integration compares the generated artifacts against the committed ones.
- Validate all external input at the boundary. Verify every inbound channel payload's signature before anything else.
- Authentication goes through Better Auth only. Session tokens hashed at rest. Never hand-roll sessions, tokens or password handling.
- Migrations are forward-only and ship with the feature. Data backfills go through the separate data-change runner, never mixed into schema changes. Removing or renaming anything spans two releases: the first adds the replacement and writes both, the second removes the old (PLAN.md §5.1). A migration that drops what the previous release still reads breaks every rolling upgrade.
- Soft delete is the repository-wide default scope. Use the explicit opt-in when you need deleted rows.
- Never commit code under the "Claude" name. No co-author trailers, no generated-with lines, no Claude or Anthropic attribution in commits or change descriptions. Use the current account's name and email only.
- Provider keys and channel credentials are envelope-encrypted, never logged, decrypted server-side only.
- No new runtime dependency without asking the human first.
- Never commit secrets. Never log secrets or personal data.

## Importer rules

- Importers read sources strictly **read-only**. Never write to, lock or migrate a source.
- Two importers: `csv` (spreadsheets per entity, with an AI-proposed column mapping that a human confirms, a dry-run preview and a per-row error report) and `flowyteam` (read-only MySQL, one company per run). The MySQL client is the one pre-approved importer dependency.
- Every importable table has a row in the TECHNICAL-PLAN.md §7.2 mapping, or is marked as having no legacy source. Update the mapping in the same change as the migration.
- Import runs are idempotent: keep `legacy_id` and `legacy_type`, unique on `(workspace_id, legacy_type, legacy_id)`. Imports run through the normal Operation pipeline with notification dispatch suppressed.
- Cannot map cleanly? Do not silently drop it. Record it in the import report and raise it as an open question.
- Derived values (progress, health, achievement, alignment score, next check-in, streaks) are recomputed after load, never trusted from the source.
- Importer code lives in `packages/importer`. It may depend on `packages/db` and `packages/core`, never on `apps/web`.

## Locked stack

Next.js App Router, React, Tailwind with shadcn/ui on **Base UI** primitives (not Radix) plus **SmoothUI** on **Motion**, TanStack Query, Table and Virtual, Drizzle with PostgreSQL and the `pgvector` extension, Better Auth, Zod, TipTap over ProseMirror, pg-boss, Turborepo with pnpm, Vitest and Playwright, Biome. For the AI layer: a provider-agnostic LLM client and the agent protocol SDK, both only inside `packages/adapters`. Do not substitute any of these without human approval.

Add interface components through the component registries into `packages/ui` at build time only. No runtime dependency, no network call, safe for an air-gapped install.

## Repo layout

```
apps/web            Next.js app: interface, internal API, public REST, agent
                    endpoint, channel webhooks
packages/method     The METHOD.md canon as data and pure functions. No I/O
packages/core       Domain logic, the Operation pipeline, the action registry,
                    can() and the access getter, the engines, rich text
packages/db         Drizzle schema, migrations, row-level security, seed,
                    data-change runner, soft-delete scope
packages/adapters   Ports and drivers (the only place vendor SDKs live) plus
                    the outbox relay
packages/agents     The Coach and Champion runtimes, the trigger catalogue and
                    scheduler, run state machines, proposal envelopes
packages/importer   Spreadsheet and FlowyTeam importers (command line)
packages/cli        The `okr` command line. Reads contract/cli.json and calls
                    the REST surface. No runtime dependency on anything
packages/ui         Shared components
packages/config     Shared TypeScript, lint and environment schema
packages/test-support  Factory building through core services, test harness
deploy/docker       Dockerfile, compose, reverse proxy, setup wizard
deploy/helm         Helm chart
deploy/cloud        Vendor-operated overlay: provisioning, operator console
docs/development-plan  This plan set, STATUS.md, the reference knowledge base
docs/design         Design documents, written per phase
docs/stakeholder    Stakeholder pack, and the reference mockups the UI tasks cite
```

## Commands

Keep this list current once scaffolded.

- `pnpm dev`: run the application locally
- `pnpm test` and `pnpm test:e2e`: unit and integration, then end to end. The end-to-end suite needs a Postgres, a one-off `pnpm test:e2e:install` for Chromium, and a `pnpm build` first, because it runs the standalone server the Docker image runs rather than the development server. It builds two databases on every run: one instance already set up for the dashboard specs, and one that never has been for the wizard specs. **Docker is not required.** `pnpm db:up` is the easy way to get the Postgres, and `TEST_DB_PORT` points the suite at one you already run, exactly as it does for the unit suites: `TEST_DB_PORT=5432 pnpm build && TEST_DB_PORT=5432 pnpm test:e2e`. This line said `pnpm db:up` outright for eight tasks, and four end-to-end defects reached continuous integration behind the belief that the suite could not be run locally
- `pnpm test:ci`: the whole repository as one suite, with retries and the flakiness report. Takes `--shard=i/n`
- **`pnpm test` and `pnpm build` at the root honour `TEST_DB_PORT`, `TEST_PGBOUNCER_PORT`, `TEST_DB_HOST` and `DATABASE_URL`** through `passThroughEnv` in `turbo.json`. The same two port variables now also drive the compose stack itself, so the database and the suite move together, and continuous integration gives each job its own pair. Without that entry Turbo filters them out and the harness looks for the Docker stack on port 55432, which fails with `ECONNREFUSED` after running two of its ten tasks. Add any new variable a test needs to that list, or the root command will quietly not see it
- `pnpm typecheck` and `pnpm lint`: strict types, then lint. `pnpm lint:fix` writes the fixes
- **Clear the build caches when you are done with a stretch of builds or end-to-end runs.** Turborepo keeps every task's output forever and nothing prunes it, so a long task loop turns into tens of gigabytes: measured on 3 September 2026 at **112 GB in `.turbo/cache` alone**, with the whole checkout at 118 GB and 977 MB after clearing. All of it is in `.gitignore`, so nothing tracked is lost and the next build repopulates what it needs.

  ```
  rm -rf .turbo/cache apps/web/.next test-results .playwright-mcp
  rm -rf packages/*/.turbo apps/*/.turbo
  ```

- **Never run two Vitest suites at once against the same Postgres.** The harness creates and drops a per-worker database, so a second run tears the first one's out from under it: 604 of 1987 tests failed that way on 3 September 2026, which reads as a regression and is not one. Worse, it can leave the server in recovery ("FATAL 57P03: the database system is not yet accepting connections") and the next run dies before it starts. Wait for a background suite to finish.

- `pnpm dead-code`: the dead-code gate
- `pnpm check:licences` and `pnpm check:signoff`: the dependency licence gate, then the commit sign-off gate. Sign-off runs in CI on pull requests only, so a branch can look green for days and fail the moment one opens. `docs/development-plan/CI-GATES.md` lists every gate and the order to run them in
- `pnpm okr`: the command line, generated from the registry. `pnpm okr help` lists the domains, `pnpm okr <domain> <verb> --help` one command's flags. It reads `contract/cli.json` and nothing else, so it has no database and no domain code in it. `okr login --url <instance>` runs the device login: it prints a link, somebody approves it at `/account/device`, and the granted token lands in the profile. `--token` stores one you already have instead, from `/account/api-tokens`. `--scopes` narrows what is asked for; the default is read and write, never destructive. Exit 2 is a usage error decided before anything is sent, exit 1 is the instance refusing
- `pnpm gen:contract` and `pnpm check:contract`: regenerate `contract/openapi.json` and `contract/cli.json` from the action registry, then the drift gate that compares fresh artifacts against the committed ones and fails naming the actions and commands that moved. One script in two modes, so a generator and a checker cannot disagree about what the artifact should be. The document is also served live at `/api/v1/openapi.json`, built by the same function, so it describes the running instance
- `pnpm check:boundaries`: the architecture boundary gate (vendor SDKs stay in `packages/adapters`, application code consumes ports, write paths cause side effects only through the outbox, and domain writes go through the Operation pipeline)
- `pnpm audit:verify`: verify the append-only audit hash chain. Every workspace with a maintenance role, or named workspaces with any role
- `pnpm cadence:sweep`: flip health to `outdated` for every goal past its staleness grace. Every workspace, or named ones. Idempotent, and runs through the Operation pipeline so the change is audited. Cron or by hand until a scheduler host exists
- `pnpm flaky merge <reports>` and `pnpm flaky quarantine`: merge shard flakiness reports, then quarantine what is newly flaky
- `pnpm db:up` and `pnpm db:down`: start and stop the test database stack (Postgres plus PgBouncer, Docker). `TEST_DB_PORT` and `TEST_PGBOUNCER_PORT` choose the host ports; set either to `0` and Docker picks a free one, which `pnpm db:ports` then reads back as the two lines the harness needs. Continuous integration does exactly that, because choosing numbers by hand collided twice
- `pnpm db:migrate`: migrations
- `pnpm import:csv`: the spreadsheet importer (P6-T01a). `--entity`, `--file`, `--workspace <slug>` and `--as <email>` are required; `--map <mapping.json>` names the columns when the headers are not recognisable, and `--write` is what makes it real. **A dry run unless `--write` is given**, and the dry run reports exactly what the real run writes, because the two share every line up to the call. `--as` is the member every write is authorised as: there is no ambient importer identity, and the audit rows name whoever ran it. Exit 2 is a usage error, exit 1 means some rows were skipped, and the report names each one by its line in the file
- `pnpm db:change`: the data-change runner. Batched, resumable, idempotent-by-ledger backfills, kept out of schema migrations. Scripts declare the columns and types they depend on and the runner checks every one before each run, so a later migration cannot silently change what an old script does
- `pnpm keys:rotate`: re-wrap every stored instance secret onto the current root key. Reads `OPENOKR_ENCRYPTION_KEY` and `OPENOKR_PREVIOUS_ENCRYPTION_KEYS`
- `deploy/docker/openokr`: the self-hosted lifecycle helper. `up` generates every secret on first run, `upgrade` pulls and re-runs migrations, `rotate-key` rotates the root key, `status`, `logs`, `down`, `destroy`
- `sh deploy/docker/smoke-test.sh`: boot the compose target from nothing and prove a clean server reaches a secured instance with an admin. Takes `OPENOKR_IMAGE`
- `sh deploy/helm/check.sh`: the Helm chart's behaviour checks, no cluster needed. What the chart refuses, where migrations run, and that no credential lands in a pod spec
- `sh deploy/helm/cluster-test.sh`: install the chart into a kind cluster, register a user and upgrade. Needs `kind create cluster` and the image loaded. Takes `OPENOKR_IMAGE_TAG`
- `pnpm db:lint`: the migration linter (tenant floor, soft delete) and the soft-delete usage lint

### Commands that do not exist yet

Each arrives with the task named beside it. Listed here so the intended name is
settled, and so nobody documents a command as though it already runs. A command
that is written down but absent has already cost this repository once: `pnpm
test:e2e` was in this list for four tasks before P1-T08 built it.

| Command | Arrives at | What it will do |
|---|---|---|
| `pnpm db:seed` | P3-T17 | Demo data. Needs objectives, key results and a cycle to seed |
| `pnpm method:check` | P4-T01 | The conformance suite comparing `packages/method` against METHOD.md |
| `pnpm import:flowyteam` | P6-T02 | The FlowyTeam importer, dry-run by default |

## Definition of done for every task

- The task's acceptance criteria pass.
- The migration and its row-level security policy ship together. Every new business table carries `workspace_id`.
- Writes go through the Operation pipeline with the change, audit and outbox atomic. Reads go through the access getter.
- Any rule, threshold, band, corridor or taxonomy touched comes from `packages/method`, and the conformance suite passes.
- Any setting added is in the TECHNICAL-PLAN.md §4.14 map with a default that a fresh workspace resolves without configuration.
- Any proactive message added has a rule key, a nudge row, deduplication, an escalation position and a snooze path.
- Unit tests plus at least one end-to-end happy path for anything user-visible. Setup uses the test-support factory, never raw inserts.
- The importer mapping is updated if any table changed, or the table is marked as having no legacy source.
- Inputs validated at the boundary. Rich text validated and sanitised. Inbound channel payloads signature-verified.
- Sensitive actions emit append-only audit events with the acting principal and, where relevant, the channel.
- Loading, empty, error and permission-denied states implemented, not just the happy path.
- Interface tasks pass the UIUX-PLAN.md §9 quality gates.
- Any reference mockup showing a rule, band, corridor, penalty, taxonomy or trigger key you changed is updated in the same change, or recorded as a follow-up. The conformance suite cannot see those files.
- Contract projections regenerated and the drift check green if the registry changed.
- Every AI affordance is hidden or disabled when the provider is off, and the deterministic path is unchanged.
- The design document is updated if implementation deviated. The `STATUS.md` row is updated.

## Writing style for everything you write in this repo

- Plain English. Short sentences. No em dashes. No buzzwords.
- Explain any unavoidable technical term the first time it appears.
- Prefer tables, examples and checklists over long prose.
- Code comments explain why, not what.
- Coaching messages are direct, specific and never condescending. They name the problem, ask the question that exposes it, and cite the rule.

## Ask the human, never decide alone

- Anything in `PLAN.md` §13 (open decisions) or `AI-NATIVE-PLAN.md` §12.
- Any change to a rule, threshold, band, corridor, taxonomy, gate or coaching message in `METHOD.md`.
- Any conflict between `REQUIREMENTS.md` and `PLAN.md`.
- Ambiguous or contradictory acceptance criteria.
- Adding any service beyond Postgres to a deployment tier, or any new runtime dependency.
- Dropping or approximating source data in an importer.
- Gating any feature behind a paid tier, including the scorecard points layer, which is off by default.
- Pulling a deferred item from `REQUIREMENTS.md` §9 into v1 scope.
- Raising an agent's autonomy beyond the propose-and-approve default, or adding a new proactive message kind.
- Licence changes or dependencies with incompatible licences.
- Deleting or rewriting a migration, or anything touching stored user data.
