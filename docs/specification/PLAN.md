# PLAN.md

The architecture of OpenOKR, an open source, AI-agentic-native OKR platform.

This file is the architecture authority. Product scope lives in REQUIREMENTS.md. OKR practice lives in METHOD.md. Agent working rules live in CLAUDE.md.

---

## 1. What we are building

One codebase that ships as one product and runs two ways from day one:

1. **Self-hosted.** A single Docker Compose file on a modest server, guided by a first-run web setup wizard. Target: under 30 minutes. Or the Helm chart on the customer's own Kubernetes, with their Postgres, their single sign-on and their backups.
2. **Managed cloud.** The same release, operated by us, with a tenant lifecycle surface on top: signup, provisioning, plans and seats behind a flag, an operator console and support access that the customer can see.

Same repository, same tagged release, same behaviour. The cloud is a way of operating the product, not a second product.

## 2. Non-negotiable principles

1. **The method is the product.** METHOD.md is encoded as rules, gates, corridors, rituals and diagnostics. Not as help text. When a design choice is unclear, the one that enforces good practice wins.
2. **Active, not passive.** The system initiates. Every phase, every due date, every threshold and every aging clock has an owner, a channel and an escalation path. Nothing waits to be discovered.
3. **Agent-native to the core.** Every read and every write is defined once in one contract. The browser, the public API, the command line, the MCP server and the built-in agents are projections of it. There is no capability a human has that an agent cannot be granted, and no path an agent takes that skips a permission check.
4. **AI-native, never AI-dependent.** Every AI feature accelerates a complete manual path. The Draft Coach's rules, the alignment score, the health corridors and the diagnostics are deterministic and work with AI switched off. AI adds rewriting, semantic judgement and natural language. Continuous integration proves the product is whole with the provider set to off.
5. **Postgres is the only hard dependency.** Everything else is optional or swappable.
6. **No vendor SDK outside the adapter package.** Jobs, realtime, storage, mail, cache, search, AI and channels all sit behind ports.
7. **Two layers of security by construction.** Row-level security in Postgres is the tenant floor: a forgotten filter cannot cross workspaces. A relationship-based access model behind a single `can()` is the authorisation model. Neither replaces the other.
8. **Every write is one transaction.** Domain change, access bindings, activity, audit row and outbox row commit together. Side effects run from the outbox after commit, never as fire-and-forget calls on the write path.
9. **Opinion first, configuration later.** The rhythm, the roles, the gates and the map work with zero setup. Every setting has a working default, so registering is the whole of setup and configuration is how an organisation adapts the product later, never how it starts. Custom fields, custom workflows and query builders are deferred (REQUIREMENTS.md §9) and are never the lead.
10. **Design first, then code.** The agent writes design documents, a human approves, then it builds.

## 3. Architecture in one page

A Next.js modular monolith in a Turborepo workspace.

```
apps/
  web/                 Next.js app: UI, internal API, public REST, MCP endpoint,
                       channel webhooks
packages/
  core/                Domain logic, the Operation pipeline, the action contract
                       registry, the permission layer, the method engines.
                       Framework-free.
  method/              The METHOD.md canon as data and pure functions: the quality
                       rule catalogue, bands, corridors, taxonomies, gates,
                       session definitions, diagnostics
  db/                  Drizzle schema, migrations, row-level security policies,
                       seed, data-change runner
  adapters/            Ports and drivers (jobs, realtime, storage, mail, cache,
                       search, ai, channels) and the outbox relay
  agents/              The Coach and Champion runtimes, the trigger scheduler,
                       run state machines, proposal envelopes
  importer/            CSV/XLSX and FlowyTeam importers (command line)
  ui/                  Shared components
  config/              Shared TypeScript, lint and environment schema
  test-support/        Factory that builds through core services, test harness
deploy/
  docker/              Dockerfile, compose, reverse proxy, setup wizard
  helm/                Helm chart
  cloud/               Vendor-operated overlay: provisioning, operator console,
                       tenant limits
docs/
  specification/       This specification set
  design/              Detailed designs, one per engine or subsystem
  mockups/             Reference mockups of eleven screens
```

`packages/method` is deliberately separate from `packages/core`. It has no database access and no framework. It is a pure library of the OKR canon, which means every rule is unit-testable in isolation, the agents and the browser share one implementation, and a change to practice is a change to one package.

### Runtime profile

One runtime: the container profile. It runs on a customer's server, on their Kubernetes, and on our managed infrastructure. The adapter ports and the environment-driven driver loader exist from day one so a serverless profile can be added later without touching feature code. Feature code never checks the runtime. Only the driver loader does.

### Adapter ports and drivers

| Port | Driver |
|---|---|
| JobQueue | pg-boss, inside Postgres |
| Realtime | WebSocket server with Postgres listen and notify. Compact typed events carrying an id and a version, an 8 KB payload guard, self-echo suppression |
| FileStorage | Local disk, MinIO or any S3-compatible service |
| Mailer | SMTP, with settings stored encrypted in the database and editable by an admin |
| Cache and rate limit | In-process plus Postgres |
| Search | Postgres full-text search, with pgvector for semantic search |
| AIProvider | Anthropic, OpenAI, Google, OpenRouter, Ollama, any OpenAI-compatible endpoint, or off |
| Channel | Slack, Microsoft Teams, WhatsApp Business, Telegram, email, or none |

Rules that make this real:

- Vendor SDKs are imported only inside `packages/adapters`.
- Feature code calls `jobs.enqueue(...)`, `channels.send(...)`, `realtime.publish(...)`. It never knows which driver is running.
- **Transactional enqueue is the only enqueue.** `enqueue` writes an outbox row inside the caller's transaction. A relay drains committed rows to the driver after commit, at least once, with idempotency keys. A direct network call on a write path fails the build.
- The AI provider and every channel are selected by stored configuration, not by the runtime variable. No configuration means that capability reports unavailable and the product degrades cleanly.

### Multi-tenancy

- The top-level unit is a **workspace**. Every business table carries `workspace_id`.
- **Row-level security enforces isolation** on every business table, in the migration that creates the table. The workspace identifier is set with `SET LOCAL` inside each transaction by the request-scoped database wrapper. Never at session level, never from client input. The application role cannot bypass row-level security and does not own the tables. A test proves that a connection with no workspace set reads zero rows from every business table.
- **Identity is two-level.** A global user row holds credentials. A per-workspace member row holds the display name, title, manager, avatar, timezone, channel identities, suspension state and kind (human, guest, agent or placeholder). The same login is a different member in each workspace.
- One deployment hosts one workspace or many thousands. The cloud uses the same schema as a single-team self-hosted instance.

## 4. License and governance

**AGPL-3.0 for the application code, plus a lightweight contributor licence agreement.**

Why AGPL-3.0:

- It stops a third party from taking the code and selling a closed hosted version. Anyone who modifies it and offers it over a network must publish their changes.
- It is the proven licence for this category. Several open source companies ship under it and still built strong communities.
- It is safe for the buyers we want. An organisation that self-hosts for its own staff takes on no obligations.

Why a contributor licence agreement: it keeps the right to dual-license or run a paid cloud later. Signing is one click through a bot. This is a one-way door. AGPL plus an agreement can later relax to a permissive licence; the reverse is impossible for released code.

Nothing is feature-gated. The managed cloud sells operation, not features. Self-host gets every capability, with no seat limit.

Also ship early: the product name as a trademark, `LICENSE`, `CONTRIBUTING.md` and `GOVERNANCE.md` stating that the project owner has the final say while the project is young. Continuous integration enforces a licence-compatibility gate on dependencies and a sign-off check on commits.

## 5. Deployment tiers

| Tier | Who | Stack | Setup effort |
|---|---|---|---|
| Single server | Small and medium organisations, privacy-minded teams | Compose: app, Postgres, reverse proxy with automatic certificates, optional object storage. A first-run web wizard generates every secret, tests the database, mail, channel and AI connections, seeds the admin and offers demo data | About 30 minutes on any small server |
| Enterprise | Universities, large organisations | Helm chart on their Kubernetes, external Postgres, single sign-on, their backups | Their platform team, hours not weeks |
| Managed cloud | Teams that want no operations | The same image under vendor operation, plus the tenant lifecycle overlay | Sign up and start |

All tiers run the same tagged release. Signed images are published on every release. A lifecycle helper ships with the self-hosted tarball for upgrade, status, logs and key rotation, with a documented rollback.

### 5.1 Upgrade policy

Every instance upgrades itself. There is no auto-update and no version check that leaves the instance. An administrator chooses when, and the product never chooses for them.

- **Versioning is semantic.** A major release carries a change an administrator must act on, and the release notes name the action. A minor release carries features and migrations that need nothing from them. A patch carries fixes.
- **Supported range.** Any release upgrades directly to any later release in the same major, with no stops. Crossing a major means stopping at the last release of the current major first. Downgrading is not supported once migrations have applied. The direct jump within a major is what lets old migrations retire at a major boundary; without it, every migration ever written stays runnable forever.
- **Rollback means restore.** Migrations are forward-only, so once one has applied, the previous image may not run against the new schema. Rolling back is: stop, restore the backup taken before the upgrade, start the previous image. The lifecycle helper takes that backup itself and refuses to upgrade without one, with an opt-out for deployments whose external database has its own backups. "Run the previous tag" alone is not a rollback and is never presented as one.
- **Rolling upgrades constrain migrations.** On Kubernetes, pods of release N and N+1 serve traffic together against the N+1 schema for the length of the rollout. Removing or renaming anything therefore spans two releases: the first adds the replacement and writes both, the second removes the old. No release both stops writing a column and drops it. This binds every migration, not just deployment.
- **Backfills never block a boot.** Schema migrations run on start. Data changes run separately through the data-change runner, on the administrator's schedule, and `status` reports what is pending. An upgrade is never held open by a long backfill.

How a release is produced is §9: changesets for the version, changelog and release notes, a signed image and a software bill of materials per release, and customers pin versions.

## 6. Security model

The authority is TECHNICAL-PLAN.md §8. The summary:

- **Authentication.** Better Auth. Email and password, passkeys and time-based one-time passwords from the first phase. Single sign-on through OIDC and SAML in the open core, because institutions will not adopt without it. Directory sync and provisioning in the enterprise phase. Session tokens are hashed at rest.
- **Authorisation.** Relationship-based: access contexts, graded bindings (view, comment, edit, full, with champion and reviewer tags) and access groups (per person, workspace standard, space standard, anonymous). Effective access is the maximum over every reachable binding. Suspended members yield no access. One `can(member, level, resource)` in `packages/core` is the single enforcement point for the browser, REST, MCP, the command line, the channels and the agents. Every read of a protected aggregate goes through one access-aware getter that returns not-found on forbidden.
- **Audit.** An append-only audit table from day one, with database grants that forbid update and delete, written inside the mutating transaction, with a per-workspace hash chain for tamper evidence. The social activity feed is a separate, typed system.
- **Agent safety.** Built-in agents run under their own member principal with least-privilege bindings scoped to named spaces and goals. Never a workspace-wide grant. Sandbox mode produces a full dry run. The default write policy is proposal plus human approval. Hard cost caps halt a run mid-flight. Retrieved content is data, never instruction.
- **Channel safety.** Every inbound message is verified against the provider's signature, resolved to a member, rate-limited, and run through `can()`. An unrecognised sender gets nothing, not an error that confirms the workspace exists.
- **Workspace freeze.** A workspace state of active, read-only or frozen with a permission overlay and an admin recovery list. Used for migration cutovers, incident lockdown and the cloud's suspension path.
- **Input.** Every external boundary validated with Zod. Rich text validated structurally against an allowed node and mark list, and rendered through a sanitising renderer. No raw HTML passthrough anywhere, including email and exports.
- **Supply chain.** Dependency scanning, code scanning, a pinned lockfile, signed images, a software bill of materials per release, a licence gate and commit sign-off.
- **Secrets.** Environment plus encrypted database settings, using envelope encryption with a key ring so rotation re-wraps data keys only. Startup refuses placeholder secrets in production. Never logged.
- **Headers.** Strict content security policy with per-response nonces, transport security, secure cookies, rate limiting and account lockout with backoff.

## 7. Realtime

Ship now: presence, live lists and feeds, a live notification and review badge, live session state (everyone in a weekly session sees the same stage and the same votes revealing), live agent run streams.

Everything goes through the Realtime port with channel semantics such as `workspace:{id}:goal:{id}`, publishing compact typed events defined in a shared event registry so payloads are type-checked end to end. Clients refetch through the normal read path, which keeps row-level security and `can()` in the loop.

Design rules that keep collaborative editing a later addition rather than a rewrite:

1. Document-like content is stored as structured editor JSON with a version column. Never Markdown, never opaque blobs.
2. All writes go through the Operation pipeline, so a future sync server becomes an alternative write path into the same layer.
3. Optimistic updates with real conflict handling: a stale write returns a conflict and the client refetches. No silent last-write-wins on rich content.
4. Presence exists from day one.

## 8. Data

- Forward-only migrations, committed with the feature that needs them. A separate data-change runner handles reshaping after launch, so schema changes and backfills never mix.
- Soft delete is a repository-wide default scope, injected by the query helper with an explicit opt-in to see deleted rows.
- A seed script and an in-product demo workspace builder create a realistic organisation in one transaction with notifications suppressed. This powers the public demo, onboarding and local development.
- Rich text is editor JSON. One shared core module owns parsing, validation, sanitised rendering, excerpting and mention extraction, used identically by the app, email, exports, search indexing and the importers.
- Derived values (progress, health, next check-in, alignment score, KPI achievement, streaks, next step) are recomputed by jobs driven from the outbox and stored in columns. Never computed per row at render.

## 9. Quality, CI and releases

- Vitest for unit and integration tests. Playwright for end-to-end. A test-support factory that builds through core domain services rather than raw inserts, so every test's setup exercises row-level security and the access layer.
- End-to-end database isolation is designed, not hoped: a migrated template database cloned per worker, with the workspace identifier set per test.
- Continuous integration runs the affected graph with a remote cache, shards the test suites, cancels superseded runs, tracks flaky tests with automatic quarantine, gates dead code and dependency licences, and checks commit sign-off.
- **Contract drift checks.** The generated OpenAPI document, the MCP tool catalogue and the generated command line are re-derived in CI and compared against committed artifacts. The single contract registry cannot silently drift.
- **Method conformance checks.** `packages/method` carries a golden-master suite for every rule, band, corridor and diagnostic in METHOD.md, and CI fails when the implementation and the document disagree.
- **AI-off leg.** CI boots with the provider set to off and asserts every P0 flow passes and every AI affordance is hidden or disabled.
- Releases through changesets: version, changelog, signed image, release notes. Customers pin versions. Nothing is force-upgraded. The contract an upgrading administrator relies on is §5.1.
- Observability through OpenTelemetry with self-hostable backends. Telemetry is opt-in and documented.

## 10. Product decisions

Decisions that shape the product as a whole. Changing any of them is a maintainer decision (GOVERNANCE.md), not something a pull request settles on its own.

| # | Decision | Options | Position |
|---|---|---|---|
| 1 | Cloud pricing model | Per seat, per workspace, usage-based, free tier shape | Per seat with a free tier; no feature gating |
| 2 | Whether any feature is ever gated | Nothing gated / an enterprise layer | Nothing gated |
| 3 | Default agent autonomy | Propose and approve / scoped direct writes | Propose and approve; direct writes are opt-in per agent |
| 4 | Coach strictness default | Advisory / warn / strict | Only structural defects block publishing by default, and every quality check and publish gate has its own level, block, warn or off (METHOD.md §4, §4.5, §12) |
| 5 | Embedding model and vector dimension | Provider-hosted / local | Open. The column is kept swappable |
| 6 | Formal external accessibility audit | Yes / internal only | Internal automated plus a manual pass; external audit if a customer requires it |
| 7 | Scorecard points layer | Build / drop | Off by default; build only on real demand |
