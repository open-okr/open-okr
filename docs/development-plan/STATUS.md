# STATUS.md

The single source of truth for execution progress against IMPLEMENTATION-PLAN.md. The agent updates rows. Only a human sets `done`.

Statuses: `todo`, `in_progress`, `in_review`, `blocked`, `done`, `skipped`. Skipping requires a note and human sign-off. The rules are in EXECUTION-GUIDE.md §5.

**104 tasks.**

## Phase 1: Foundation

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P1-T01 | Monorepo scaffold | done | task/p1-t01-monorepo-scaffold, PR #1 | 2026-08-05 | Merged to main 2026-08-05. LICENSE was already present (AGPL-3.0). TypeScript pinned to 5.9.x, not 7.x |
| P1-T02 | CI pipeline + environment schema | done | task/p1-t02-ci-pipeline-env-schema, PR #2 | 2026-08-05 | Merged to main 2026-08-05. All ten checks green, including Dependency review after the Dependency graph was enabled. Turbo local cache used instead of a vendor remote cache, no credentials needed. apps/web now depends on packages/config: confirm the TECHNICAL-PLAN §1 table allows it |
| P1-T03 | Database package + tenant floor + test isolation | done | task/p1-t03-db-tenant-floor, PR #9; rework PR #11 | 2026-08-05 | Merged to main 2026-08-05. Spike decision: GO, recorded in docs/design/p1-t03-tenant-isolation-spike.md. Isolation held under PgBouncer transaction pooling; R1 fallback not invoked. No product tables shipped; the probe table is a test fixture, so the §7.2 importer mapping is unchanged. PR #11 fixed GHSA-gpj5-g38j-94v9 (drizzle-orm 0.45.2) and restored the TypeScript 5.9.x pin that dependabot PR #5 broke |
| P1-T04 | Adapter ports + drivers + the transactional outbox | done | task/p1-t04-adapter-ports-outbox, PR #12 | 2026-08-05 | Merged to main 2026-08-05. Eight ports, nine default drivers, the outbox with a leased at-least-once relay, and the boundary gate. Human approved: ws as a runtime dependency; drivers receive a pool by injection so the TECHNICAL-PLAN §1 dependency row stays true; outbox ships not-tenant-scoped and hard-delete markers per §4.13. Also fixed the licence gate, which could not parse SPDX OR expressions. SMTP mail driver deferred: the console driver is the default and nodemailer is a new dependency to approve |
| P1-T05 | Authentication: password, passkeys, one-time codes | done | task/p1-t05-authentication, PR #13 | 2026-08-06 | Session tokens hashed at rest through a wrapper around Better Auth's documented adapter seam; no internals patched, no hand-rolled sessions. Auth lives in packages/core because it needs the database and TECHNICAL-PLAN §1 does not let apps/web reach it. Human approved: @better-auth/passkey; lockout and forgot/reset in scope, single sign-on deferred to P8-T07; auth pages carry S-35 behaviour now and get the S-35 visual treatment in P2-T10. Next 16 renamed middleware to proxy. Two latent bugs found and fixed on the way: the adapter's transaction handle bypassed the hashing wrapper, and the pg-boss dedup test was timing-dependent. Human approved a per-package Dependency review exception for rou3, a transitive Better Auth dependency GitHub reports as MIT AND MS-PL from its repository while the published tarball is MIT only. The allow-licenses list is unchanged: MS-PL stays off it |
| P1-T06 | Workspaces + members bootstrap | done | task/p1-t06-workspaces-members, PR #14 | 2026-08-06 | Merged to main 2026-08-06. Human confirmed: enforce the registration policy now, computed as open while no user exists rather than stored, so system_settings waits for the P1-T09 wizard; no admin role invented, the first member's binding lands at P2-T01; active workspace is a plain cookie revalidated against memberships on every request, so nothing trusts it and no schema is invented; provisioning is one explicit transaction shaped for the P1-T07 Operation lift, with the audit and outbox rows deferred there. A second transaction-local setting, app.user_id, lets a member list their own workspaces inside row-level security instead of bypassing it. Three things found on the way and fixed here: the soft-delete gate had never seen a schema file, so it reported zero tables and checked nothing; pnpm db:migrate was broken by an extensionless import; and §3 asks for time-ordered ids, which Postgres 17 cannot generate, so packages/db now does. The migration linter gained a tenant-root marker rather than letting the workspaces table skip the floor checks as infrastructure |
| P1-T07 | Operation pipeline + action registry + audit spine | done | task/p1-t07-operation-pipeline, PR #15 | 2026-08-06 | Merged to main 2026-08-06. Design recorded in docs/design/p1-t07-operation-pipeline.md. Two readings worth review: authorisation runs inside the write transaction rather than an earlier one, which is stronger than the literal wording of §8.1; and the audit chain takes a per-workspace lock, so writes in one workspace serialise at the end. Found and fixed on the way: the audit verifier reported every chain intact while the tenant floor hid every workspace from it, the same fail-open shape as the P1-T06 soft-delete gate. Human confirmed: authorisation is one seam the pipeline owns, replaced wholesale at P2-T02; the audit chain takes a per-workspace advisory lock, accepting serialised writes for a verifiable chain, with a measurement follow-up on P7-T01; the privilege model moves into packages/db so append-only is stated once; provisioning is lifted into the first Operation and workspace.rename is the second. Carries a P1-T05 follow-up: sign-in lockout is enforced but writes no audit entry, because the audit spine does not exist yet (TECHNICAL-PLAN §8.2 asks for both). Carries a P1-T06 follow-up: workspace provisioning is already one transaction shaped for the Operation lift, and gains its audit row here. It needs no outbox row until something subscribes to workspace creation |
| P1-T08 | Proving dashboard | in_review | task/p1-t08-proving-dashboard, PR #16 | 2026-08-06 | Merged to main 2026-08-06. Awaiting a human to set done. Playwright now runs in CI as its own job. Found and fixed on the way: signing out posted straight at the authentication endpoint, which answers with JSON, so a browser without JavaScript landed on {"success":true} instead of the sign-in screen. It is a server action now. Also observed, not changed: the S-35 screens drive authentication through the client, so they need JavaScript, which is recorded on P2-T10. Human confirmed the recommendation: stand Playwright up now, minimally (Chromium only, one spec, next build and start, reusing the existing role, grant and migration machinery), because the acceptance criterion names client hydration and only a browser proves it, pnpm test:e2e is documented but absent, and P1-T09 needs the same machinery against a far harder target. The e2e harness takes a fresh database per run from the start, because the registration policy closes an instance after its first user. Three states are real on this route and the fourth is not: a signed-in member always has a workspace, so there is no empty state to build |
| P1-T09 | Docker Compose target + first-run setup wizard | done | task/p1-t09-compose-setup-wizard, PR #17; mail seam PR #18 | 2026-08-06 | Merged to main 2026-08-06 across two PRs. PR #17 merged one commit early, so the review fixes landed separately as PR #18; verified on main rather than from the PR state, which is the check that caught it. Measured against the acceptance criterion on real Compose: 17s from nothing to a healthy instance against a 30-minute budget, with an admin created and a workspace provisioned. Image is 204MB, down from 726MB once the migration runner stopped shipping the build's node_modules to run a few hundred lines of SQL; Next already traces pg into the standalone output. A deploy CI job builds the image, boots the stack and drives the wizard, and eleven checks in deploy/docker/smoke-test.sh cover the budget, migrations on boot, the wizard redirect, honest connection reporting, proxy headers, admin creation and upgrade idempotence. Two more gates that failed open, found by running the software: the migration lint announced success without saying what it read, so a renamed directory would have made it a permanent pass; and my own ./openokr up reported ready while the proxy crash-looped behind a healthy application. Both now state their coverage. The container's database check gained a third exit code for the same reason, and it immediately diagnosed a stale volume outliving regenerated secrets, which is now refused with an explanation rather than producing an instance that cannot authenticate. Deliberately partial: the wizard does not offer demo data, because demo data means objectives, key results and a cycle and those arrive in Phase 3, so a checkbox that seeded nothing would be worse than its absence; recorded on P3-T01. Human confirmed four decisions before code: Caddy for the reverse proxy, because automatic certificates are built in rather than a second process with its own renewal timer; nodemailer approved as the SMTP driver, unblocking the P1-T04 deferral and the wizard's mail test; local disk stays the only storage service, with S3-compatible storage reachable by environment variable, so a default install is three containers and Postgres remains the only required service; and the wizard tests what exists rather than faking the rest, so channel and AI report that they are not in this build instead of showing a green tick for an untested connection. Two readings recorded here: the wizard's pages live in apps/web/app/setup because a web wizard must be served by the application, while deploy/docker holds the image, compose, proxy configuration, entrypoint and lifecycle helper; and there is no S-xx screen for instance setup, S-34 being the in-app onboarding after sign-in, so this is built to the UIUX-PLAN §4 patterns and §9 gates without a numbered screen. Envelope encryption and system_settings land here rather than later, because the wizard stores SMTP credentials and there is no acceptable interim where those sit in plaintext. A post-implementation review before P1-T10 found the mail work stopped one seam short: the SMTP driver existed but nothing could construct it, the OPENOKR_MAIL_* variables did nothing, reset mail always went to the console, and the wizard probe ignored the environment. Fixed with a createMailer factory, resolveMailSettings in core, per-send mailer construction, and a probe that tests the resolved configuration live. The same review closed finishSetup to unauthenticated callers and bounded its input |
| P1-T10 | Helm chart + Phase 1 exit | in_review | task/p1-t10-helm-phase-exit, PR #19 | 2026-08-06 | Merged to main 2026-08-06; verified on main rather than from the PR state. Awaiting a human to set done. A post-merge review before Phase 2 found eleven more things and fixed six of them on branch chore/p1-hardening: see the Phase 1 hardening section below. Verified on a real kind cluster, not from templates: 12 checks covering install, both replicas ready, the migration hook running before the pods, registration through the installed instance, and an upgrade that does not rotate the encryption key. Plus 23 chart checks that need no cluster. Three real bugs found by running it, all invisible to helm lint: a pre-install hook cannot reference the chart's ServiceAccount or its Secrets, because Helm creates every pre-install hook before any normal resource, so the first install failed twice; and the generated encryption key was 32 characters rather than 32 bytes, which the key ring refused at boot exactly as designed. The Phase 1 exit checklist is recorded in docs/design/p1-exit-checklist.md with evidence per line and four caveats written down rather than ticked: the action registry is real but holds two actions, authorisation is a seam with no bindings until P2-T01, mail has never reached a real mailbox, and instance settings writes are a stated exception to the Operation pipeline. Human confirmed four decisions before code: CI installs the chart into a real kind cluster and registers a user, because a chart can lint perfectly and fail on install and this repository has been bitten four times by gates that pass while checking nothing; the chart deploys no database and requires an external one, matching PLAN §121 and avoiding a third-party subchart whose backups nobody owns; images publish to ghcr.io on a version tag and are signed with cosign keyless, so there are no signing keys to store or rotate; and the chart generates its secrets on first install, reads them back on upgrade so a helm upgrade never rotates a key underneath stored data, and accepts an existingSecret for operators with their own secret manager |

### Phase 1 hardening (between P1-T10 and P2-T01)

Not a numbered task. A review of the whole of Phase 1 after P1-T10 merged, on
branch `chore/p1-hardening`, fixing what would be more expensive to fix once
Phase 2 built on it. Six fixes, each with a test that fails without it.

| # | What was wrong | Fix |
|---|---|---|
| 1 | The Operation pipeline applies `app.workspace_id` and `app.user_id` together, and Postgres combines permissive policies with OR, so every read inside every operation also returned the acting user's rows from every other workspace. A test asserted that union and called it correct | Migration 0008 scopes the two cross-workspace policies to transactions that name no workspace, and aligns their soft-delete predicates. The switcher and the provisioning membership check both use `withUser`, which sets no workspace, so both are unchanged |
| 2 | `./openokr rotate-key` had never worked. It ran a file the image did not contain, and `NODE_PATH` was exported by the entrypoint alone so nothing reached it through `docker compose exec` | The migrator layer now carries the core and config sources with the workspace links rebuilt, plus the two packages Next compiles away rather than tracing out. The smoke test rotates the key and then proves the instance still reads its own data. Image 205MB to 235MB |
| 3 | `OPENOKR_DOMAIN=... ./openokr up` wrote `BETTER_AUTH_URL=http://localhost` and kept it forever, because the helper read `OPENOKR_URL`, which nothing sets, and secrets are generated once. Passkeys bind to that origin | The origin follows `OPENOKR_DOMAIN`, and is reconciled on every `up` rather than only on the run that generated the secrets. It says when passkeys will need re-enrolment |
| 4 | The outbox rule did not cover `apps/`, and a direct mail send was already sitting there. One mention of `runOperation` exempted an entire file. Raw SQL writes and side effects reached through a call expression were both invisible | The rule covers `apps/`, exempts only writes lexically inside a pipeline call, and sees `tx.execute(sql\`update ...\`)` and `mailerFrom(s).send(...)`. It immediately found two real writes in provisioning, now marked with the operation they run inside |
| 5 | The migration linter accepted a policy on `invitations` as a policy on `invitation`, read `-- openokr:hard-delete is deliberately absent` as the marker being present, allowed `using (true)` on a workspace table, and skipped a directory it could not find | All four closed. Directories are now counted individually, so a renamed migrations directory fails instead of passing on the fixtures alone |
| 6 | SMTP error redaction covered the password and `base64(password)`, but AUTH PLAIN sends `base64(NUL user NUL pass)`. Whether the password survived depended on byte alignment, so it leaked for roughly two usernames in three | Every encoding is redacted, and any base64 left standing is decoded and checked. Proved against a server that quotes the rejected AUTH line back |

Also: CodeQL scoped away from the reference HTML that accounted for all forty
open alerts and none of the product code; `engines` pinned to `>=22 <23`
because every entry point runs `--experimental-strip-types`; six commands that
CLAUDE.md documented but that do not exist moved into a table naming the task
that delivers each; the release workflow gained the sign-off, chart and compose
gates it was missing and lost an `id-token` permission a verifier should not
hold; the compose smoke test stopped pinning the migration count; and the four
placeholder package tests now say they are wiring checks rather than coverage.

Five more findings are recorded on the Phase 2 rows they belong to rather than
fixed here: realtime reconnection and the outbox dead-letter path (P2-T06),
cache eviction (P2-T09), the port lifecycle contract (P2-T13), the job queue
restart (P2-T17), and local-disk content types (P2-T05).

## Phase 2: Platform and agent spine

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P2-T01 | Access model: contexts, bindings, groups | todo |  |  | Carries a P1-T06 follow-up: the first member of a workspace holds no binding yet, because bindings do not exist. Provisioning gives them the full binding here, and no role column was invented in the meantime. Carries a P1-T07 follow-up: the Operation pipeline has the slot for writing an aggregate's context and default bindings inside its transaction, and it is empty until this task |
| P2-T02 | can() + access-aware reads | todo |  |  | Carries a P1-T08 follow-up: workspace.overview resolves the reading member with its own query, shaped like the pipeline's resolveActor, because the access-aware getter does not exist yet; this task replaces both together. Decide here too whether the switcher lists suspended and invited memberships: today listMembershipsForUser returns them, and a suspended member sees the workspace in the switcher and then not-found from the overview, which is secure but odd. Carries a P1-T07 follow-up: the pipeline resolves the acting member and compares the action's declared access level, but every active member currently resolves to full because bindings do not exist. Replacing one function in operation.ts completes it; no handler changes |
| P2-T03 | People: profiles, manager chain, lifecycle | todo |  |  | Carries a P1 hardening follow-up: 0008 aligned the two cross-workspace read policies, so a soft-deleted member no longer reads their own membership row. Removal semantics are built on top of those policies here, and this is the row to check them against |
| P2-T04 | Invitations | todo |  |  | Carries a P1 hardening follow-up: the one direct mail send in the application (password reset, apps/web/lib/mail.ts) carries an openokr:allow-side-effect marker because it has no transaction to attach an outbox row to. Invitations do have one, so they go through the outbox. The marker names this row as the reason not to copy that line |
| P2-T05 | Files and blobs | todo |  |  | Carries a P1 hardening follow-up: LocalDiskStorage keeps content types in a process-local Map that nothing reads, is lost on restart and is unshared across replicas. It reads like a content-type source and is not one |
| P2-T06 | Subscriptions + notification spine | todo |  |  | Carries two P1 hardening follow-ups, both found by review rather than by failure. PostgresRealtime never clears a rejected connect promise, so one failed connect poisons publish and subscribe for the life of the process, and a dropped LISTEN connection ends delivery silently with no reconnect. And the outbox relay has no attempt ceiling and no dead-letter state, so a poisoned row retries every 300s forever and is surfaced nowhere. Both matter first here, because this is the task that puts user-visible traffic on them |
| P2-T07 | Typed activity feed engine | todo |  |  | Carries a P1-T07 follow-up: the activities table ships written by the Operation pipeline, with kind as a free string and context_id nullable. The typed catalogue, per-kind payload validation and the fail-closed context resolver land here |
| P2-T08 | Workspace settings + module registry | todo |  |  |  |
| P2-T09 | Security baseline | todo |  |  | Carries a P1 hardening follow-up: InProcessCache drops an expired key only when that exact key is read again, and rateLimit mints a key per subject, so counters for subjects that never return accumulate for the life of the process. Rate limiting auth and invitation endpoints by IP is exactly the unbounded-keyspace case |
| P2-T10 | App shell + design system | todo |  |  | Carries a P1-T08 follow-up: the S-35 authentication screens need JavaScript, because they drive sign-in through the client. Progressive enhancement there is a decision for this task, not an accident to inherit. The proving dashboard's loading, error and not-found states also ship unstyled. Carries a P1-T05 follow-up: the authentication screens (S-35) ship with behaviour and semantics but no design system, and are restyled here along with the UIUX-PLAN §9 gates that need tokens and string catalogues. Carries a P1-T06 follow-up: the workspace switcher ships as behaviour only and belongs at the top of the sidebar (UIUX-PLAN §5), which is built here. It has no S-xx screen of its own, so this row is its specification |
| P2-T11 | Rich text editor | todo |  |  |  |
| P2-T12 | Data-change runner | todo |  |  |  |
| P2-T13 | AIProvider port + drivers | todo |  |  | Carries a P1 hardening follow-up: the port set has no agreed lifecycle. JobQueue and Realtime declare stop(); Mailer, Cache, Search, Channel and FileStorage declare nothing, and SmtpMailer.close() exists but is not on the port, so Adapters.close() leaks its connection pool. Settle the contract before a ninth driver with long-lived HTTP clients joins |
| P2-T14 | AI configuration, keys, encryption and rotation | todo |  |  |  |
| P2-T15 | Model catalogue, tier routing, structured output and prompts | todo |  |  |  |
| P2-T16 | Usage metering, quotas and hard caps | todo |  |  |  |
| P2-T17 | Agent runtime: agents, runs, sandbox, proposals | todo |  |  | Carries a P1 hardening follow-up: PgBossJobQueue.stop() clears #running but not #started, so a start() after a stop() skips createQueue for every queue it has already seen and then sends into queues pg-boss no longer knows about. This is the first component likely to cycle the queue inside one process |

## Phase 3: The OKR core

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P3-T00 | OKR core design gate | todo |  |  | Needs an explicit design approval. Golden-master matrices reviewed line by line |
| P3-T01 | Spaces | todo |  |  | Carries a P1-T09 follow-up: the first-run wizard is specified to offer demo data and does not, because demo data means objectives, key results and a cycle, and none of those exist before Phase 3. Add the offer here, with a pnpm db:seed that has something to seed |
| P3-T02 | Annual frame, cycles and rhythm settings | todo |  |  |  |
| P3-T03 | The guided cycle workflow | todo |  |  |  |
| P3-T04 | Goals + key results | todo |  |  |  |
| P3-T05 | Scoring and health engine | todo |  |  |  |
| P3-T06 | Cadence engine + staleness | todo |  |  |  |
| P3-T07 | Check-ins: snapshots, publication, acknowledgement, voting | todo |  |  |  |
| P3-T08 | Review inbox | todo |  |  |  |
| P3-T09 | Alignment: parents, dependencies, the alignment engine | todo |  |  |  |
| P3-T10 | Goal surfaces: explorer, detail, alignment studio | todo |  |  |  |
| P3-T11 | Work Map | todo |  |  | Carries a P1-T08 follow-up: the proving dashboard at / is scaffolding, deliberately thin and unstyled. S-01 is the real home and replaces this route entirely here |
| P3-T12 | KPIs: categories, records, grid | todo |  |  |  |
| P3-T13 | KPI formula engine | todo |  |  |  |
| P3-T14 | KPI trees, corridors, recovery OKRs | todo |  |  |  |
| P3-T15 | Scorecard, cycle archive and feed-forward | todo |  |  | Scorecard points layer stays off unless the human funds it |
| P3-T16 | Comments, reactions and discussion wiring | todo |  |  |  |
| P3-T17 | Demo workspace builder + seed | todo |  |  |  |

## Phase 4: The coaching layer

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P4-T00 | Coaching design gate | todo |  |  | Needs an explicit design approval. Rule corpus and trigger catalogue reviewed line by line |
| P4-T01 | The method package | todo |  |  |  |
| P4-T02 | The quality engine and Draft Coach surfaces | todo |  |  |  |
| P4-T03 | Publish gates | todo |  |  |  |
| P4-T04 | The nudge engine, triggers and escalation | todo |  |  |  |
| P4-T05 | The OKR Champion agent | todo |  |  |  |
| P4-T06 | The OKR Coach agent | todo |  |  |  |
| P4-T07 | Weekly session: confidence round, voting, blockers | todo |  |  |  |
| P4-T08 | Weekly session: commitments, digest, streaks | todo |  |  |  |
| P4-T09 | Monthly review and decision log | todo |  |  |  |
| P4-T10 | Quarterly review: session shell, scoring, narratives | todo |  |  |  |
| P4-T11 | Quarterly review: retro, diagnostic, reset | todo |  |  |  |
| P4-T12 | Minutes, exports and review feed-forward | todo |  |  |  |
| P4-T13 | Embeddings and retrieval | todo |  |  |  |
| P4-T14 | Copilot | todo |  |  |  |
| P4-T15 | Coaching and rhythm assists | todo |  |  |  |

## Phase 5: Reach: channels, agents, work

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P5-T00 | Reach design gate | todo |  |  | Needs an explicit design approval |
| P5-T01 | Channel port, email driver and routing | todo |  |  |  |
| P5-T02 | Slack driver | todo |  |  |  |
| P5-T03 | Microsoft Teams driver | todo |  |  |  |
| P5-T04 | WhatsApp driver | todo |  |  |  |
| P5-T05 | Telegram driver | todo |  |  |  |
| P5-T06 | The chat command surface | todo |  |  |  |
| P5-T07 | Public contract projections: REST, OpenAPI and the command line | todo |  |  |  |
| P5-T08 | MCP authorisation server | todo |  |  |  |
| P5-T09 | MCP transport, sessions and tool catalogue | todo |  |  |  |
| P5-T10 | Initiatives | todo |  |  |  |
| P5-T11 | Tasks and the OKR board | todo |  |  |  |
| P5-T12 | Documents and attachments | todo |  |  |  |
| P5-T13 | Search, palette and exports | todo |  |  |  |

## Phase 6: Data: import, export, portability

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P6-T01 | CSV and XLSX importer with the AI mapper | todo |  |  |  |
| P6-T02 | FlowyTeam connector | todo |  |  |  |
| P6-T03 | FlowyTeam strategy mappers | todo |  |  |  |
| P6-T04 | FlowyTeam work and collaboration mappers | todo |  |  |  |
| P6-T05 | Workspace export and import | todo |  |  |  |
| P6-T06 | Backups and restore drills | todo |  |  |  |
| P6-T07 | Migration cutover rehearsal | todo |  |  |  |

## Phase 7: Hardening

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P7-T01 | Performance budgets and indexing at scale | todo |  |  | Carries a P1-T07 follow-up: the audit chain takes a per-workspace advisory lock, so concurrent writes in one workspace serialise at the end of their transaction. Measure it. The fallback, if it binds, is a sequence column with retry, which keeps verifiability |
| P7-T02 | Load and soak testing | todo |  |  |  |
| P7-T03 | Security review, supply chain and tenant fuzzing | todo |  |  |  |
| P7-T04 | Agent, nudge and channel safety hardening | todo |  |  |  |
| P7-T05 | Accessibility audit and web vitals | todo |  |  |  |
| P7-T06 | Observability | todo |  |  |  |
| P7-T07 | Method conformance audit | todo |  |  |  |
| P7-T08 | Privacy: export, erasure and retention | todo |  |  |  |

## Phase 8: Cloud, enterprise and launch

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P8-T01 | Cloud design gate | todo |  |  | Needs an explicit design approval |
| P8-T02 | Tenant provisioning, signup and onboarding | todo |  |  |  |
| P8-T03 | Operator console | todo |  |  | Carries a P1-T09 follow-up: instance settings writes sit outside the Operation pipeline behind an openokr:allow-mutation marker, because the pipeline needs a workspace and an acting member for its activity and audit rows and audit_events.workspace_id is not null, so an instance write has no chain to join. Decide here whether instance-level audit gets its own chain |
| P8-T04 | Transparent support access | todo |  |  |  |
| P8-T05 | Plans, seats and limits | todo |  |  | Plans and seats stay behind a flag that is off for self-host |
| P8-T06 | Cloud operations | todo |  |  |  |
| P8-T07 | Single sign-on | todo |  |  |  |
| P8-T08 | Directory sync and provisioning | todo |  |  |  |
| P8-T09 | Multi-factor policy | todo |  |  |  |
| P8-T10 | Audit export, chain verification and the air-gap guide | todo |  |  |  |
| P8-T11 | Documentation site | todo |  |  |  |
| P8-T12 | Template gallery and rhythm guides | todo |  |  |  |
| P8-T13 | Hosted demo instance | todo |  |  |  |
| P8-T14 | Launch | todo |  |  |  |
