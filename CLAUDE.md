# CLAUDE.md

## What this project is

**OpenOKR** is an open source, AI-agentic-native OKR platform. Not a tracker: a system that runs the OKR practice and coaches the organisation through it.

Two things make it different, and every design decision serves one of them.

**The method is in the product.** `docs/specification/METHOD.md` holds the OKR practice canon: the eight-phase cycle, scoring and confidence bands, twenty-six quality checks with their word lists and coaching prompts, six publish gates, the alignment health score, KPI health bands and recovery OKRs, the blocker and root-cause taxonomies, the session agendas, the closing diagnostic, and the practice settings and profiles an organisation may change. It is compiled into `packages/method`, a pure library with no database or network access. A conformance suite fails the build when the document and the code disagree.

**The product is active.** Two agent members ship with every workspace. The **OKR Coach** guards quality. The **OKR Champion** guards the rhythm. They initiate, escalate and propose, in the browser, in Slack, Microsoft Teams, WhatsApp and Telegram, by email, and through any external AI agent the user runs. Every message cites a rule key that resolves back to METHOD.md.

It runs two ways from one release: self-hosted (Docker Compose or Helm) and a managed cloud. Nothing is feature-gated.

## The document set and authority order

All in `docs/specification/` unless noted:

1. `REQUIREMENTS.md`: what the product does. Product authority.
2. `PLAN.md`: architecture principles, packages, adapters, deployment, the upgrade policy, product decisions.
3. `METHOD.md`: the OKR practice canon. Authority for every rule, threshold, band, corridor, taxonomy, gate, agenda, diagnostic and practice setting.
4. `TECHNICAL-PLAN.md`: the technical design: identity and access, the full schema by domain, adapter ports and the transactional outbox, the engines, importers, security, testing, performance, the one-contract API.
5. `AI-NATIVE-PLAN.md`: the AI and agent domain: providers, keys, governance, channels, the two agents with their trigger and escalation catalogue, the copilot, retrieval, the external agent surface.
6. `UIUX-PLAN.md`: the interface: design system, navigation, interaction patterns, screens S-01 to S-40, plus the cloud operator screens S-45 to S-49, quality gates.
7. `CI-GATES.md`: every gate that will refuse the work, the command that runs it locally, and what each one catches that reading the diff does not. Read it before your first push, not after your first red build.
8. `reference/`: the FlowyTeam data model the importer is built against. Read-only facts.
9. `docs/design/`: the detailed design of each engine and subsystem.
10. This file, at the repository root: how **you** work.

If two documents disagree, the one higher in this list wins, with one exception: never resolve a REQUIREMENTS versus PLAN conflict yourself. Stop and ask.

**Supporting documents** (context, not authority): `DATABASE.md` (the derived consolidated schema, authority is TECHNICAL-PLAN §4, update it in the same change), `OVERVIEW.md` (the end-user product overview), `README.md` (the index), `docs/mockups/` (eleven screens from UIUX-PLAN §6 drawn as HTML and rendered to PNG), `docs/scenarios/northwind-year/` (a full year of OKRs, step by step, which the demo seed builds and end-to-end specs cite by step ID).

## How you work: the change loop

You work on one change at a time, only when a human names it: an issue, a bug, or a request. Your side:

1. Restate the change: the goal, what you will deliver, how you will test it, and any open question. For anything bigger than a small fix, wait for confirmation before writing code.
2. Tests first: write the tests so they fail for the right reason.
3. Implement until green. Obey every hard rule below.
4. Quality checks: type checking, linting, the full affected suite, and every gate in "Committing and pushing". Exercise the feature in the running application when a person would see it.
5. Branch `<kind>/<slug>` from `main` (`fix/`, `feat/`, `docs/`, `chore/`). One commit, signed off, with a changeset when it changes what a running instance does.
6. Stop. Never start the next change on your own. Never merge your own work.

**One change is one working session and one commit.** If you get partway through and realise it will not fit, stop before writing more code, say so, and propose how to split it. The human decides. Splitting a change across four commits without saying so reads as progress and hides that nothing is finishable.

**A change that alters the design starts with the design.** Write or update the document in `docs/design/` first, and wait for the human to approve it with an explicit "design approved" before the code.

Blocked? Write down exactly why, and ask. Do not improvise around a blocker.

## Committing and pushing

**Commit on your own. Never push on your own.** Committing is how the work becomes reviewable and you do it without being asked, one commit per change. Pushing is what starts continuous integration and puts the work in front of other people, and it happens only when a human says to push.

**A push must leave continuous integration green. Every job, no exception.** Not "green except the one that was already failing", and not "green except the gate this machine cannot run". A red build on a shared branch blocks everybody else's work and the next person cannot tell your failure from theirs.

So before you say the work is ready to push, run the whole set in the order `docs/specification/CI-GATES.md` gives, and read the output rather than the exit code:

```
pnpm typecheck
pnpm lint             # read the last three lines, not the last one
pnpm dead-code
pnpm db:lint
pnpm check:boundaries
pnpm check:air-gap
pnpm check:docs
pnpm check:licences
pnpm check:contract
pnpm method:check
pnpm test             # needs a database. One suite at a time
pnpm build && pnpm test:e2e
pnpm check:signoff origin/main HEAD
pnpm check:changeset origin/main HEAD
```

**A gate you did not run is not a gate that passed.** When this machine cannot run one, say which, why, and what would run it, in the summary you give the human and in the pull request. Never write "all gates pass" when you ran nine of eleven.

The deployment scripts run wherever Docker, helm, kind and kubectl are installed:

```
OPENOKR_IMAGE=openokr:test sh deploy/docker/smoke-test.sh
sh deploy/helm/check.sh
kind create cluster --name openokr
kind load docker-image openokr:test --name openokr
OPENOKR_IMAGE_TAG=test sh deploy/helm/cluster-test.sh
```

**On Windows**, Git Bash rewrites an argument shaped like an absolute path before handing it to a native program, which is why `deploy/docker/openokr` exports `MSYS_NO_PATHCONV`; a `docker exec` you add elsewhere needs the same. Kubernetes 1.32 and later refuse a host on cgroup v1, so a WSL virtual machine running kind needs the unified hierarchy.

**`pnpm check:signoff` runs in CI on pull requests only**, so a branch can look green for days and fail the moment one opens. Run it yourself, and commit with `-s`.

**Two jobs are not in the list above and still have to be green:** CodeQL and Dependency review. Neither is runnable locally. A new dependency is what usually turns them red, which is a second reason not to add one without asking.

### Watch the run. A push is not finished until CI says so

**After every push, find the run for your own commit and watch it to its conclusion.** Then report what it said. Not "the gates passed locally", not "it should be green": the run's own verdict, per job.

```
gh run list --branch <branch> --limit 10 \
  --json databaseId,headSha,name,event,conclusion,createdAt
gh run view <id> --json jobs          # which job, which step
gh run view <id> --log-failed         # why
```

**A push with no run is not a pass.** `ci.yml` triggers on `push` to `main` and on `pull_request`, so a push to a branch with no open pull request gets no verdict at all. Say that plainly and ask whether to open one. Never let silence read as green.

Local gates cannot see a rendered Helm manifest, a security query, a transitive licence, or a spec that encoded the old behaviour. That is the whole argument for watching the run.

**A change to a spec's expectations is part of the change.** When you serve something a spec asserted was missing, the spec is now wrong and updating it is yours, not the next person's.

## Design docs

Detailed designs live in `docs/design/`, one per engine or subsystem. Keep them scannable: tables and examples over prose. Write acceptance criteria as testable Given / When / Then. When implementation deviates from a design document, update the document in the same change.

**Reference mockups.** Eleven screens are drawn in `docs/mockups/` and indexed in UIUX-PLAN.md §10. Look at the mockup before you change a screen it shows: it shows the density, the chips, the states and the composition the specification describes in words. They are reference, not authority. When a mockup and a specification disagree, the specification wins and the mockup gets fixed. Never cite a mockup as the reason for a behaviour.

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
- **Object authorisation is the relationship model plus the workspace role matrix, through one `can()`.** Every read of a protected aggregate goes through the single access-aware getter, which returns not-found on forbidden and excludes suspended members. A role grants a level per domain and composes with bindings by taking the maximum, so it raises access and never lowers it; there is no deny rule. No per-endpoint ad-hoc checks. Never rely on the interface to hide anything.
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
- Importer code lives in `packages/importer`, **except the spreadsheet engine**, which lives in `packages/core/src/imports` because the wizard on S-36 needs the same readers, templates, mapping and runner the command uses and `apps/web` may not depend on `packages/importer` (TECHNICAL-PLAN §1). Either way it may depend on `packages/db` and `packages/core`, never on `apps/web`.

## Locked stack

Next.js App Router, React, Tailwind with shadcn/ui on **Base UI** primitives (not Radix) plus **SmoothUI** on **Motion**, TanStack Query, Table and Virtual, Drizzle with PostgreSQL and the `pgvector` extension, Better Auth, Zod, TipTap over ProseMirror, pg-boss, Turborepo with pnpm, Vitest and Playwright, Biome. For the AI layer: a provider-agnostic LLM client and the agent protocol SDK, both only inside `packages/adapters`. Do not substitute any of these without human approval.

Add interface components through the component registries into `packages/ui` at build time only. No runtime dependency, no network call, safe for an air-gapped install.

## Repo layout

```
apps/web            Next.js app: interface, internal API, public REST, agent
                    endpoint, channel webhooks
packages/method     The METHOD.md canon as data and pure functions. No I/O
packages/formats    The format rules the browser and the server share: email,
                    domain, date, colour, timezone. Pure, imports nothing
packages/core       Domain logic, the Operation pipeline, the action registry,
                    can() and the access getter, the engines, rich text, the
                    spreadsheet import engine, the demo seeds
packages/db         Drizzle schema, migrations, row-level security, seed,
                    data-change runner, soft-delete scope
packages/adapters   Ports and drivers (the only place vendor SDKs live) plus
                    the outbox relay
packages/agents     Run state machines, the schedule the runs are registered
                    under, structured extraction, and the AI capabilities the
                    runs call. The Coach's and the Champion's own seeding and
                    scope are in packages/core/src/agents/ instead, because
                    both are created inside the workspace-provisioning
                    transaction and so need packages/db, which this package
                    sits above rather than beside
packages/importer   The import command line, and the FlowyTeam connector
packages/cli        The `okr` command line. Reads contract/cli.json and calls
                    the REST surface. No runtime dependency on anything
packages/ui         Shared components
packages/config     Shared TypeScript, lint and environment schema
packages/test-support  Factory building through core services, test harness
deploy/docker       Dockerfile, compose, reverse proxy, setup wizard
deploy/helm         Helm chart
deploy/cloud        Vendor-operated overlay: provisioning, operator console
deploy/demo         The public demonstration instance
deploy/staging      A staging instance with test personas
docs/specification  The specification set and the FlowyTeam reference
docs/design         Design documents, one per engine or subsystem
docs/mockups        The reference mockups the interface specification cites
docs/scenarios      The Northwind year, step by step
```

## Commands

Keep this list current. A command that is written down and absent, or present and not written down, misleads the next person.

- `pnpm dev`: run the application locally
- `pnpm test` and `pnpm test:e2e`: unit and integration, then end to end. The end-to-end suite needs a Postgres, a one-off `pnpm test:e2e:install` for Chromium, and a `pnpm build` first, because it runs the standalone server the Docker image runs rather than the development server. It builds two databases on every run: one instance already set up for the dashboard specs, and one that never has been for the wizard specs. **Docker is not required.** `pnpm db:up` is the easy way to get the Postgres, and `TEST_DB_PORT` points the suite at one you already run, exactly as it does for the unit suites: `TEST_DB_PORT=5432 pnpm build && TEST_DB_PORT=5432 pnpm test:e2e`

  **On Windows, warm the traced symlinks after a build, or the first run times out.** `start-server.sh` rewrites about eighty traced pnpm links as junctions before the server binds, inside Playwright's readiness window, and it does it for both servers. After a fresh `pnpm build` that first start can exceed the 240-second timeout, which reads as flakiness and is not. Running the repair once first moves the work out of the window and costs a quarter of a second when there is nothing to do:

  ```
  TEST_DB_PORT=5432 pnpm build
  node --experimental-strip-types --no-warnings e2e/repair-standalone-links.ts apps/web/.next/standalone/node_modules
  TEST_DB_PORT=5432 pnpm test:e2e
  ```

- `pnpm test:ci`: the whole repository as one suite, with retries and the flakiness report. Takes `--shard=i/n`
- **The accessibility and web-vitals gates are part of `pnpm test:e2e`**, not separate commands. `e2e/s43-accessibility.spec.ts` scans every screen with axe and fails on a `serious` or `critical` finding; **its screen list is derived by walking `apps/web/app`**, so a screen added tomorrow is scanned tomorrow and nobody has to remember. `e2e/s43b-accessibility-keyboard.spec.ts` drives the primary flows with the keyboard alone, which is the half a scan cannot answer, and `e2e/s44-web-vitals.spec.ts` measures the three §13.1 rows `pnpm perf:budgets` hands to a browser. The screen-reader procedure is a person's job and is written out in `docs/design/accessibility.md`
- **`pnpm test` and `pnpm build` at the root honour `TEST_DB_PORT`, `TEST_PGBOUNCER_PORT`, `TEST_MYSQL_PORT`, `TEST_MYSQL_HOST`, `TEST_MYSQL_USER`, `TEST_MYSQL_PASSWORD`, `TEST_DB_HOST` and `DATABASE_URL`** through `passThroughEnv` in `turbo.json`. The same two port variables also drive the compose stack itself, so the database and the suite move together, and continuous integration gives each job its own pair. Without that entry Turbo filters them out and the harness looks for the Docker stack on port 55432, which fails with `ECONNREFUSED`. Add any new variable a test needs to that list, or the root command will quietly not see it
- `pnpm typecheck` and `pnpm lint`: strict types, then lint. `pnpm lint:fix` writes the fixes. **The typecheck is TypeScript 7, the native compiler, single-threaded and four packages at a time.** Every workspace package exports its source, so each check re-reads the packages it imports; four single-threaded processes is what measured fastest, because each multi-threaded one already takes every core. TypeScript 7 has no compiler API, so the two web tests and the script that walk a syntax tree import `typescript5`, which is 5.9 under another name. Next.js type-checks through the `tsc` command, so the build runs on 7 too
- **Clear the build caches when you are done with a stretch of builds or end-to-end runs.** Turborepo keeps every task's output forever and nothing prunes it, so a long run of builds turns into tens of gigabytes in `.turbo/cache` alone. All of it is in `.gitignore`, so nothing tracked is lost and the next build repopulates what it needs.

  ```
  rm -rf .turbo/cache apps/web/.next test-results .playwright-mcp
  rm -rf packages/*/.turbo apps/*/.turbo
  ```

- **Never run two Vitest suites at once against the same Postgres.** The harness creates and drops a per-worker database, so a second run tears the first one's out from under it, and hundreds of failures that read as a regression are not one. Worse, it can leave the server in recovery ("FATAL 57P03: the database system is not yet accepting connections") and the next run dies before it starts. Wait for a background suite to finish.
- **The same goes for two end-to-end runs, and the failures it produces look like product defects.** `e2e/prepare-database.ts` drops and recreates `openokr_e2e` with force, so a second run pulls the database out from under the first: a SCIM POST answers 200 instead of 201 because the other run already created the person, a goal a spec just wrote is not on the page, sign-ins pass their ten-second wait. **A stopped Playwright leaves its two standalone servers listening**, and `reuseExistingServer: false` then refuses every later run with "already used", so check ports 3210 and 3211 before blaming anything else
- `pnpm dead-code`: the dead-code gate
- `pnpm changeset` and `pnpm check:changeset`: write the version bump a change carries, then the gate that refuses a branch changing what a running instance does and naming no bump. The version, the changelog and the release notes come from one place, so they cannot disagree. **Silence is not a claim**: a change with no changeset might be invisible from outside or might be a breaking migration somebody forgot, and the two look identical in a diff, so the gate refuses both and `pnpm changeset --empty` is how you say a customer cannot observe it. Docs, tests, workflows and the specification are exempt by path. Runs in CI on pull requests only, like sign-off
- `pnpm check:licences` and `pnpm check:signoff`: the dependency licence gate, then the commit sign-off gate. Sign-off runs in CI on pull requests only, so a branch can look green for days and fail the moment one opens. `docs/specification/CI-GATES.md` lists every gate and the order to run them in
- `pnpm okr`: the command line, generated from the registry. `pnpm okr help` lists the domains, `pnpm okr <domain> <verb> --help` one command's flags. It reads `contract/cli.json` and nothing else, so it has no database and no domain code in it. `okr login --url <instance>` runs the device login: it prints a link, somebody approves it at `/account/device`, and the granted token lands in the profile. `--token` stores one you already have instead, from `/account/api-tokens`. `--scopes` narrows what is asked for; the default is read and write, never destructive. Exit 2 is a usage error decided before anything is sent, exit 1 is the instance refusing
- `pnpm gen:contract` and `pnpm check:contract`: regenerate `contract/openapi.json` and `contract/cli.json` from the action registry, then the drift gate that compares fresh artifacts against the committed ones and fails naming the actions and commands that moved. One script in two modes, so a generator and a checker cannot disagree about what the artifact should be. The document is also served live at `/api/v1/openapi.json`, built by the same function, so it describes the running instance
- `pnpm check:air-gap`: the air-gap checklist. Reads the checklist table in `docs/runbooks/air-gap.md` and checks each row against the source, in both directions: a row with no check fails, and a check with no row fails too. The checks cover fonts, external hosts, what the image's runtime stage installs, whether AI is off until somebody enables it, whether every outbound request goes through the port, and whether the component registries stay build-time. The two claims that are about a machine rather than about source, watching for egress and proving it is not cached, are written out in the guide for whoever commissions the instance
- `pnpm gen:docs`: regenerates `docs/api/reference.md` from `contract/openapi.json`, which is itself generated from the action registry. One script in two modes, like `gen:contract`: `--check` is what `check:docs` runs, so a generator and a checker cannot disagree about what the page should hold
- `pnpm check:docs`: the documentation gate. Every relative link under `docs/` resolves, every page in `docs/install`, `docs/admin` and `docs/runbooks` is reachable from `docs/README.md`, and every `pnpm <script>` a page tells somebody to run exists in `package.json`. It also checks every threshold `docs/handbook/numbers.md` quotes against the method registry, and `docs/api/reference.md` against the contract. The specification, the designs and the mockups are linked from the index by folder rather than page by page
- `pnpm check:boundaries`: the architecture boundary gate (vendor SDKs stay in `packages/adapters`, application code consumes ports, write paths cause side effects only through the outbox, and domain writes go through the Operation pipeline)
- `pnpm audit:verify`: verify the append-only audit hash chain. Every workspace with a maintenance role, or named workspaces with any role
- `pnpm cadence:sweep`: flip health to `outdated` for every goal past its staleness grace. Every workspace, or named ones. Idempotent, and runs through the Operation pipeline so the change is audited. **The scheduler host runs this on its own** as part of the Champion's daily cadence; the command stays for an operator who wants it now, and for an instance running with `OPENOKR_SCHEDULER=off`
- `pnpm flaky merge <reports>` and `pnpm flaky quarantine`: merge shard flakiness reports, then quarantine what is newly flaky. **The end-to-end suite writes one too**: `e2e/flaky-reporter.ts` produces `.flaky/report-e2e.json` in the same shape and with the same identifiers as the Vitest shards, so one merge and one quarantine list cover the whole repository. It is written locally as well, because a report that exists only in continuous integration is one nobody can read before pushing
- `pnpm db:up` and `pnpm db:down`: start and stop the test database stack (Postgres, PgBouncer and MySQL, all in Docker). `TEST_DB_PORT`, `TEST_PGBOUNCER_PORT` and `TEST_MYSQL_PORT` choose the host ports; set any of them to `0` and Docker picks a free one, which `pnpm db:ports` then reads back as the three lines the harness needs. Continuous integration does exactly that. **MySQL is the FlowyTeam source the importer's connector reads, and it is test-only**: the product needs Postgres and nothing else. Point the suite at a MySQL you already run with `TEST_MYSQL_PORT`, and say so when its root account has no password: `TEST_MYSQL_PASSWORD=` set to empty means empty, unlike every other variable here. Without a MySQL the connector's three suites skip themselves and say why
- `pnpm db:seed`: fills the first workspace with the Northwind year as of today (`docs/design/northwind-year-seed.md`), and refuses a workspace that already holds company objectives. The scenario in `docs/scenarios/northwind-year` is placed on the real calendar, the scenario's 2027 on the year that holds today, with every event dated on or before today written in date order and nothing after it; each date keeps its distance from its quarter's first Monday, so a Monday check-in stays a Monday. Takes a minute or two. **`--quarter` builds the smaller one-quarter demo instead.** The year's tests place it on the latest real year whose dates they read have passed (`packages/core/test/year-placement.ts`), so every quarter is checked whatever day the suite runs
- `pnpm demo:prepare`: turns a seeded workspace into one a visitor can sign into. `pnpm db:seed` writes the story and leaves the cast as members with nobody behind them, which is wrong for a public instance where the visitor is nobody: the only way to see the product as Priya sees it is to be Priya. So this gives each of the invented people an account at `@northwind.example`, the seven of the one-quarter demo and the five the Northwind year adds (Ben, who leaves in May, is suspended and gets none) (RFC 2606 reserves the domain, so it can never be registered and can never receive mail), attaches it to the member row the builder already wrote, runs the Coach and the Champion once so the nudges on screen are ones the product produced, and then puts both agents in `sandbox`, which commits nothing from then on. **It refuses a workspace the demo builder did not build**, by the builder's own test, because giving a real organisation's members invented accounts with a published password is the one mistake it could make that matters, and it never touches a member who already has somebody behind them. The password is `explore-openokr` and is published on purpose; `--password` sets another. Accounts go through Better Auth rather than beside it, under a `demo` provisioning authority that skips the join and the provisioning the sign-up hook would otherwise do, because a persona is attached to a member that already exists rather than being a person who has just arrived
- `pnpm uat:personas --inbox <address>`: gives a fresh workspace the seven Northwind people as members who can sign in, for testing by hand. Each joins through a workspace invitation the founder issues, which is revoked at the end, so the member rows are what an invited person leaves; titles, managers, spaces and goals stay empty because the tester builds them through the screens. Addresses are plus-addresses on the one inbox given. **Refuses a workspace with anybody in it besides its founder and these seven**, and a second run changes nothing. The password defaults to `northwind-uat-2026`, `--password` sets another. `sh deploy/staging/seed.sh` runs it against a Compose stack started with `deploy/staging/compose.staging.yaml`, and `docs/install/staging.md` is the whole procedure. `sh deploy/staging/deploy-staging.sh [--ref <ref>] [--inbox <address>]` is that procedure as one command: it checks the host, builds the image from the same checkout, starts the stack with the overlay and seeds once the wizard has run; `deploy-staging.sh run <openokr command>` runs `./openokr` with the overlay kept
- `pnpm db:seed:large`: the performance dataset. `--workspace <slug>` names an **empty** workspace and is required; the command refuses one that already holds goals, because a second run would double the dataset and every budget measured against it would be measuring something else. `--scale <n>` multiplies every count, so `--scale 0.001` is a hundred goals for a smoke test. Full size is TECHNICAL-PLAN §13.1's own figures, 100,000 goals, 100,000 key results and 1,000,000 tasks, and it takes about 90 seconds and 408 MB. Every goal gets its access context and four bindings, because a dataset without them is invisible to every access-scoped read and would make each list budget green while measuring an empty result. **The goals are aligned into a tree** of fanout five inside each cycle, so the alignment score, the cascade and the recompute are measured over a real graph. **Refused when `NODE_ENV` is `production`**, in the builder rather than only in the command, and there is deliberately no override flag. Run `ANALYZE` before measuring anything
- `pnpm perf:budgets`: measures TECHNICAL-PLAN §13.1 against a workspace. `--workspace <slug>` is required, `--runs <n>` sets the sample size. Build the dataset with `pnpm db:seed:large` and run `ANALYZE` first, or the planner has no statistics and the plan is not the one production uses. All fifteen §13.1 rows are printed: nine are measured here, and the six that need a browser or a channel name where they are measured instead rather than being silently absent. Exits 1 if a measured row is over budget, so a continuous integration job is the seed, an analyze and this
- `pnpm perf:load`: the load and soak run. `--workspace <slug>` is required; `--members <n>` is how many virtual members act at once (default 200), `--seconds <n>` how long, `--think <ms>` the pause between one member's actions, `--pool <n>` the connections the run may hold (default 20), `--soak` a long hold judged on drift rather than the number. Seven weighted scenarios through `callAction`: work map, feed, board, review inbox, alignment, a drag to the top of a column and a reorder into a slot, each judged against its own §13.1 ceiling. It is **not** an HTTP load test and does not exercise realtime fan-out, chat inbound or channel delivery; those need a running server or a provider. Exits 1 on any error, a p95 over budget, or drift past 1.5x
- `pnpm audit:chain`: gives every recorded audit row its position in the chain. The write path records the event and leaves `seq`, `prev_hash` and `row_hash` null, so this is what makes the trail verifiable; the scheduler runs it every minute and this command is for an operator who wants it now, for `OPENOKR_SCHEDULER=off`, and for a backlog after an upgrade. Names workspaces as arguments, or chains every one, which needs a role that can see past the tenant floor. **Append-only holds**: the content is immutable by any route including an owner connection, and migration 0080's row-level trigger permits exactly one update, an unchained row gaining its three chain columns
- `pnpm cloud:usage`: refreshes the per-tenant usage snapshot the operator console reads. **The console reads a snapshot rather than counting live, and that is not an optimisation.** `force row level security` applies to the table owner too, and migrations run as the owner rather than as a superuser, so no view and no security-definer function can count a table the floor protects. Each workspace is instead opened properly through its own tenant setting and counted the way a member of it would count, so no policy is loosened and no role is privileged. The row carries `measured_at` beside the numbers, because a figure with no timestamp invites somebody to read a stale one as live
- `pnpm cloud:operator --email <address> --granted-by <address>`: grants the cloud operator role, and `--revoke --by <address>` takes it away. **The first operator is granted by the deployment, never by a screen**, because a screen that creates the first operator can be reached by whoever gets there first; running this needs `DATABASE_URL`, which is the deployment. Both people must have signed up. Nobody grants it to themselves, which the table's own check constraint also refuses, and once one operator exists only an operator may grant another. Every grant and revocation is written to the instance audit chain. Exit 2 is a usage error, exit 1 a refusal
- `pnpm cloud:sweep`: lists the closed workspaces whose retention window has passed. **It deletes nothing**, and it is not a dry run of something that does: erasure is a data-change script that deliberately does not exist yet, and `cloud.closureRetentionDays` is zero until an operator sets it. The command says whether retention is on, what number it is running, and which workspaces a future erasure would name
- `pnpm db:migrate`: migrations
- `pnpm import:csv`: the spreadsheet importer. `--entity`, `--file`, `--workspace <slug>` and `--as <email>` are required; `--map <mapping.json>` names the columns when the headers are not recognisable, and `--write` is what makes it real. **A dry run unless `--write` is given**, and the dry run reports exactly what the real run writes, because the two share every line up to the call. `--as` is the member every write is authorised as: there is no ambient importer identity, and the audit rows name whoever ran it. Exit 2 is a usage error, exit 1 means some rows were skipped, and the report names each one by its line in the file
- `pnpm import:flowyteam`: the FlowyTeam importer. `--source <mysql://user:password@host:3306/database>`, `--workspace <slug>` and `--as <email>` are required, and `--company <id>` names the one company this run reads. **It reads the source and never writes to it**: the session is opened with `SET SESSION TRANSACTION READ ONLY` and every statement is checked against an allow list of reads before it is sent, so neither a write nor a `LOCK TABLES` leaves the process. Run it without `--company` and it lists what the source holds; a real instance can hold thousands, which is why the flag has no default. **A workspace holds one company for good**, and a second one is refused by name. **A dry run unless `--write` is given**, and the dry run resolves every source id against the target, so what it reports is what a real run would write. It imports people, spaces, space membership, cycles, objectives, key results, key result history, check-ins, KPI categories, KPIs and their records, initiatives, tasks, checklists, task comments and watchers. **`--files-root <path>` points at the FlowyTeam server's storage directory**: `task_files` names a file on that server's own disk rather than in MySQL, so without it every local file is reported by name instead of copied. An image sitting inline in comment markup needs no directory, because those bytes are in MySQL. **`--only <domains>`** is a comma-separated list of `organisation`, `objectives`, `checkins`, `kpis`, `work`, `collaboration`, `files`, and the default is all of them. A domain brings whatever it depends on and the report says which it added: `--only objectives` runs the organisation first, because an objective names a champion, a reviewer, a cycle and a space. An unknown domain is a usage error, not a smaller import. Exit 2 is a usage error, exit 1 is the source or the instance refusing
- `pnpm db:change`: the data-change runner. Batched, resumable, idempotent-by-ledger backfills, kept out of schema migrations. Scripts declare the columns and types they depend on and the runner checks every one before each run, so a later migration cannot silently change what an old script does
- `pnpm keys:rotate`: re-wrap every stored instance secret onto the current root key. Reads `OPENOKR_ENCRYPTION_KEY` and `OPENOKR_PREVIOUS_ENCRYPTION_KEYS`
- `deploy/docker/openokr`: the self-hosted lifecycle helper. `up` generates every secret on first run, `upgrade` backs up, pulls and re-runs migrations, `rotate-key` rotates the root key, `backup`, `verify-backup`, `restore`, `status`, `logs`, `down`, `destroy`
- `sh deploy/docker/smoke-test.sh`: boot the compose target from nothing and prove a clean server reaches a secured instance with an admin. Takes `OPENOKR_IMAGE`
- `sh deploy/demo/reset.sh`: rebuilds the public demonstration instance from nothing. Destroys the `openokr-demo` compose project including its volumes, regenerates the secrets, starts it with `deploy/demo/compose.demo.yaml` overlaid on the ordinary Compose target, claims it over HTTP, then runs `pnpm db:seed` and `pnpm demo:prepare` from the checkout. **The project name is fixed in the script rather than read from the environment**, so it cannot be pointed at another stack, and it refuses a checkout holding a `.env` because `--env-file-if-exists` would overwrite the `DATABASE_URL` it just resolved. Needs Docker. `docs/install/demo.md` is the operator's half
- `sh deploy/helm/check.sh`: the Helm chart's behaviour checks, no cluster needed. What the chart refuses, where migrations run, and that no credential lands in a pod spec
- `sh deploy/helm/cluster-test.sh`: install the chart into a kind cluster, register a user and upgrade. Needs `kind create cluster` and the image loaded. Takes `OPENOKR_IMAGE_TAG`
- `pnpm db:lint`: the migration linter (tenant floor, soft delete, characters a non-UTF8 database cannot store) and the soft-delete usage lint
- `pnpm method:check`: the conformance suite. It reads METHOD.md itself rather than a transcription, and compares the rule families, the §11 threshold registry, the §12 practice settings and profiles, and **twenty-five of the document's own enumerations** against `packages/method`: the eight phases, the eight root causes, the seven blocker types, the three rituals, the four weekly steps, the five monthly review items, the eleven review stages, the close decisions, the process-health statements, the retro questions, the §8.6 diagnostic, the §7.6 calibration rule, §9's facilitator guidance and §10's coach lines with the rule each cites. Every comparison runs in both directions and every parse is floored on its length, so a regex that finds nothing fails rather than quietly agreeing with everything
- `pnpm method:verdicts`: twenty real OKR drafts through the quality canon, with every verdict and the rule that produced it. **For a person to read, not a gate.** The conformance suite proves the package agrees with the document; it cannot prove the document is right. Each draft is printed at two moments, as first typed and with what its own sentence plainly states filled in, and the gap between the two counts is the false-positive picture

## Definition of done for every change

- The change's acceptance criteria pass.
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
- Interface changes pass the UIUX-PLAN.md §9 quality gates.
- Any reference mockup showing a rule, band, corridor, penalty, taxonomy or trigger key you changed is updated in the same change, or recorded as a follow-up. The conformance suite cannot see those files.
- Contract projections regenerated and the drift check green if the registry changed.
- Every AI affordance is hidden or disabled when the provider is off, and the deterministic path is unchanged.
- The specification and the design document are updated if implementation deviated.
- A changeset is written when a running instance behaves differently.
- Every gate in "Committing and pushing" ran and is green, or the summary names the ones this machine could not run and why. The commit is made; the push waits for the human.
- After a push, the run for that commit was watched to its conclusion and reported per job. No run means no verdict, and the summary says so rather than implying green.

## Writing style for everything you write in this repo

- Plain English. Short sentences. No em dashes. No buzzwords.
- Explain any unavoidable technical term the first time it appears.
- Prefer tables, examples and checklists over long prose.
- Code comments explain why, not what.
- Coaching messages are direct, specific and never condescending. They name the problem, ask the question that exposes it, and cite the rule.

## Ask the human, never decide alone

- Anything in `PLAN.md` §10 (product decisions) or `AI-NATIVE-PLAN.md` §11 (decisions).
- Any change to a rule, threshold, band, corridor, taxonomy, gate, practice setting or coaching message in `METHOD.md`.
- Any conflict between `REQUIREMENTS.md` and `PLAN.md`.
- Ambiguous or contradictory acceptance criteria.
- Adding any service beyond Postgres to a deployment tier, or any new runtime dependency.
- Dropping or approximating source data in an importer.
- Gating any feature behind a paid tier, including the scorecard points layer, which is off by default.
- Pulling a deferred item from `REQUIREMENTS.md` §9 into scope.
- Raising an agent's autonomy beyond the propose-and-approve default, or adding a new proactive message kind.
- Licence changes or dependencies with incompatible licences.
- Deleting or rewriting a migration, or anything touching stored user data.
