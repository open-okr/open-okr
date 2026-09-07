# IMPLEMENTATION-PLAN.md

The work, as ordered tasks. Each task has an identifier, dependencies, deliverables, a test plan and acceptance criteria. Claude Code executes one task at a time under the protocol in EXECUTION-GUIDE.md. A human reviews and merges every task.

Authority: this is the execution authority. It implements TECHNICAL-PLAN.md, AI-NATIVE-PLAN.md, UIUX-PLAN.md and METHOD.md. If a task conflicts with one of those, the design document wins and the task is corrected first.

| Phase | Theme | Tasks |
|---|---|---|
| 1 | Foundation | P1-T01 to P1-T10 |
| 2 | Platform and agent spine | P2-T01 to P2-T17 |
| 3 | The OKR core | P3-T00 to P3-T17 |
| 4 | The coaching layer | P4-T00 to P4-T15, several split into lettered parts |
| 5 | Reach: channels, agents, work | P5-T00 to P5-T13 |
| 6 | Data: import, export, portability | P6-T01 to P6-T07 |
| 7 | Hardening | P7-T01 to P7-T09 |
| 8 | Cloud, enterprise and launch | P8-T01 to P8-T14 |

**105 tasks**, some split into lettered parts. **Sizing: one task is one working session and one commit.** S is a short session, M is a full one. There is no L: a task that will not fit one session is split into lettered parts before anybody starts it, and the letters are the tasks. A bare id in a `Depends on:` line means every lettered part of it, so `P4-T02` reads as `P4-T02a` through `P4-T02c`. Phase 4 is cut this way; the earlier phases carry their original sizes because they are done. Guidance, not promises. With the PLAN.md §11 throughput assumption of three to five merged tasks a week where large tasks count double, Phases 1 to 7 are a realistic seven to ten months. If actuals diverge by more than half over a month, re-baseline rather than slipping quietly.

## How to read a task

```
### <ID>: <title> [size]
Depends on: <IDs or a dash>
Goal: one sentence.
Deliverables: what exists when it is done.
Test plan: the tests to write first, red before green.
Acceptance: Given / When / Then that a human verifies.
```

Every task inherits the **Definition of Done** in CLAUDE.md: writes through the Operation pipeline, reads through the access getter, a migration with its row-level security policy in the same change, validation at the boundary, audit events on sensitive actions, tests built through the factory, loading, empty, error and permission-denied states, and the status row updated. Tasks below only call out extras.

**Definition of Ready.** Before code, all of these must hold:

1. Every dependency is done.
2. Specification sources exist: UI tasks cite a screen (S-xx) and the UIUX-PLAN.md §4 patterns; schema tasks cite TECHNICAL-PLAN.md §4 and keep the §7.2 mapping current; rule, band, corridor and ritual tasks cite METHOD.md by section.
3. Acceptance criteria are unambiguous. If not, ask before coding.
4. No open decision in PLAN.md §13 or AI-NATIVE-PLAN.md §12 blocks the task.

UI tasks additionally run the UIUX-PLAN.md §9 quality gates. List-rendering tasks meet the TECHNICAL-PLAN.md §13.1 budgets. Tasks marked **[SPIKE]** end in a written go or no-go against their risk-register row.

---

# Phase 1: Foundation

Goal: authentication, one workspace, the write and read spine, deployed to Compose and Helm, with continuous integration green. No product features. Exit only when both targets serve the skeleton and the tenant-isolation spike has a decision.

### P1-T01: Monorepo scaffold [M]
Depends on: -
Goal: a Turborepo and pnpm workspace with the package skeleton from TECHNICAL-PLAN.md §1.
Deliverables: `apps/web` and `packages/{method,core,db,adapters,agents,importer,ui,config,test-support}`, root package manifest, pipeline configuration, a strict TypeScript base, lint configuration, `LICENSE`, `CONTRIBUTING.md` and `GOVERNANCE.md`.
Test plan: a trivial test per package importing its entry point. Type checking and linting clean.
Acceptance: Given a clean checkout, when install, type check, lint and test run, then all succeed with the package graph resolved.

### P1-T02: CI pipeline + environment schema [M]
Depends on: P1-T01
Goal: continuous integration that stays fast and honest at scale, plus a validated environment schema.
Deliverables: workflows using the affected graph with a remote cache; test sharding scaffolds; cancel-in-progress; a flaky-test policy with retry, trace on retry, a merged report surfacing passed-on-retry, and automatic quarantine; a dead-code gate; a dependency licence gate; a commit sign-off check; dependency and code scanning; an environment schema in `packages/config` validated at boot that fails fast naming the bad variable.
Test plan: the schema rejects a missing database URL and accepts a valid environment. A deliberately flaky sample test appears in the flakiness report rather than passing silently.
Acceptance: Given an invalid environment, when the application boots, then it exits with a clear error naming the variable; and given a documentation-only change, then unaffected packages are skipped.

### P1-T03: Database package + tenant floor + test isolation [SPIKE] [L]
Depends on: P1-T01
Goal: Drizzle and Postgres with the tenant floor proven safe under pooling, and the test harness every later task uses.
Deliverables: `packages/db` with forward-only migration tooling; the request-scoped wrapper that opens a transaction and applies the workspace setting with `SET LOCAL`, never at session level; an application role that cannot bypass row-level security and does not own the tables; a migration linter failing any business table created without a policy in the same file; the repository-wide soft-delete scope with an explicit opt-in and a lint; the test harness with a migrated template database cloned per worker for unit and integration tests, truncation between tests for end to end, and the workspace setting applied per test. The spike runs the isolation suite through a transaction-pooling proxy and records the result.
Test plan: two workspaces with rows in each, where workspace A cannot see B even through raw queries; a connection with no workspace setting reads zero rows; the pooling suite passes or the PLAN.md §12 R1 fallback is invoked and recorded; the soft-delete scope hides deleted rows and the opt-in reveals them.
Acceptance: Given the spike suite under pooling, when it runs, then isolation holds and the decision is recorded in a design document.

### P1-T04: Adapter ports + drivers + the transactional outbox [L]
Depends on: P1-T03
Goal: the eight ports with working drivers, and the outbox as the only enqueue path.
Deliverables: interfaces for jobs, realtime, storage, mail, cache, search, AI and channels; drivers for pg-boss, a WebSocket server with listen and notify carrying compact typed events with an 8 KB guard and self-echo suppression, local disk storage, SMTP to console, in-process and Postgres cache, Postgres full-text search, AI off, and channel none; the outbox table with an insert helper and a relay worker draining committed rows at least once; a CI check failing any direct driver call on a write path and any vendor SDK import outside the adapters package.
Test plan: contract tests per driver; a rolled-back transaction delivers nothing while a committed one delivers exactly once per idempotency key across relay retries; a notify payload over the guard raises.
Acceptance: Given a write that inserts an outbox row and then rolls back, when the relay runs, then nothing is delivered; committed, it is delivered once.

### P1-T05: Authentication: password, passkeys, one-time codes [M]
Depends on: P1-T03
Goal: real authentication with modern factors from day one (TECHNICAL-PLAN.md §8.2, screen S-35).
Deliverables: Better Auth mounted with the database adapter; sign up, sign in, sign out; passkey enrolment and login; one-time password enrolment, challenge and backup codes; session middleware exposing the current user; session tokens hashed at rest; protected routes refusing unauthenticated requests.
Test plan: register, log in, bad password, log out; passkey and one-time password happy paths; a raw read of the session table yields only hashes.
Acceptance: Given a user with a second factor enrolled, when they sign in, then they are challenged and a hashed session is established.

### P1-T06: Workspaces + members bootstrap [M]
Depends on: P1-T05
Goal: the two-level identity: a global user and a per-workspace member.
Deliverables: the workspace and member tables per TECHNICAL-PLAN.md §4.1; a bootstrap flow where the first registration provisions a workspace with the user as its first member and applies the TECHNICAL-PLAN.md §4.14 provisioning defaults for the modules present, in the same transaction; the workspace switcher; the workspace setting wired from the member's active workspace.
Test plan: a fresh database, register, then a workspace and member exist with every existing setting resolved to its default and no null required setting; isolation verified across two workspaces; the same user joins a second workspace as a distinct member.
Acceptance: Given a first-run instance, when the first user registers, then a workspace exists with them as an active member, every setting resolves to its documented default without anyone choosing one, and every query is scoped to it.

### P1-T07: Operation pipeline + action registry + audit spine [L]
Depends on: P1-T04, P1-T06
Goal: the write path and the single contract everything projects from (TECHNICAL-PLAN.md §8.1 layer 3, §14).
Deliverables: the Operation abstraction in `packages/core` (authorise against freshly loaded rows, then one transaction covering the change, bindings, an activity stub, an audit row and the outbox); the append-only audit table with no update or delete grants and a per-workspace hash chain; the action contract registry with a name, input and output schemas, the required access level and a safety class, plus its internal typed projection wired into the application; a lint requiring every mutating procedure to resolve to a registry action.
Test plan: a sample operation where a rolled-back mutation leaves no audit and no outbox row while a committed one leaves exactly one of each; the hash chain verifies; an update on the audit table is denied by the database; a mutating procedure outside the registry fails the lint.
Acceptance: Given any committed mutation, when the audit chain is verified, then it is intact, and a mutation without its audit row is impossible by construction.

### P1-T08: Proving dashboard [S]
Depends on: P1-T07
Goal: an authenticated page proving the whole stack end to end.
Deliverables: a home route showing the workspace and member through a registry query and the access getter, with loading, empty and error states, plus one end-to-end test from registration to dashboard on the P1-T03 harness.
Acceptance: Given a signed-in member, when they open the home route, then they see their workspace and name, server-rendered with client hydration per TECHNICAL-PLAN.md §13.3.

### P1-T09: Docker Compose target + first-run setup wizard [L]
Depends on: P1-T08
Goal: a working instance in under 30 minutes with no file editing.
Deliverables: `deploy/docker` with a multi-stage image, a compose file covering the application, Postgres, a reverse proxy with automatic certificates and optional object storage, volumes, health checks and migrations on boot with readiness polling; the first-run web wizard that detects an unconfigured instance, generates and stores every secret, refuses placeholder secrets thereafter, tests the database, mail, channel and AI connections live, creates the admin and workspace, and offers demo data; a lifecycle helper for upgrade, status, logs and key rotation with a documented rollback; an example environment file for the override path.
Test plan: a CI job builds the image, boots compose, drives the wizard headlessly and asserts sign-in works; the upgrade helper re-runs migrations idempotently.
Acceptance: Given a clean server, when compose and the wizard run, then a secured instance with an admin exists inside the 30-minute budget.

### P1-T10: Helm chart + Phase 1 exit [L]
Depends on: P1-T09
Goal: the same skeleton on Kubernetes.
Deliverables: `deploy/helm` with deployment, service, ingress, secrets, a migration hook and external-database values; a signed image published on tag; the Phase 1 exit checklist run and recorded.
Test plan: the chart lints and templates; a cluster job installs it and passes readiness and registration.
Acceptance: Given a cluster and a database, when the chart installs, then the skeleton serves and a user can register.

**Phase 1 exit:** the skeleton runs on Compose and Helm; CI is green with the P1-T02 machinery; tenant isolation is proven including the pooling decision; outbox semantics are proven; the Operation pipeline and hash-chained audit are live; the action registry drives the internal API; passkeys and one-time passwords work; the wizard provisions an instance inside budget; no vendor SDK sits outside the adapters package.

---

# Phase 2: Platform and agent spine

Goal: the shared machinery every module needs, including the AI and agent foundation, so the coach can ship with the OKR core rather than after it. Still no product modules.

### P2-T01: Access model: contexts, bindings, groups [L]
Depends on: P1-T07
Goal: the relationship authorisation model (TECHNICAL-PLAN.md §4.1).
Deliverables: access contexts, groups (member, workspace standard, space standard, anonymous), group memberships and bindings with graded levels and role tags for champion, reviewer, sponsor, facilitator and coordinator; wiring so every protected aggregate is born with its context and default bindings inside its Operation; derived privacy computed from binding tiers; the permission catalogue constants including `manage_ai` and `manage_coaching`.
Test plan: creating a sample aggregate produces the context and bindings atomically; the privacy label derives correctly for each combination; deleting a binding downgrades access immediately.
Acceptance: Given an aggregate created with "the workspace can view, the space can edit", when privacy is computed, then it reads workspace and a non-space member gets view only.

### P2-T02: can() + access-aware reads [L]
Depends on: P2-T01
Goal: one enforcement point for every surface.
Deliverables: `can(member, level, resource)` in core; the access-aware getter joining member to groups to bindings to context, taking the maximum level, excluding suspended members and returning not-found on forbidden, plus composable list filters; the subject-to-context resolver with an exhaustive, fail-closed list; a lint failing raw selects on protected tables outside the helper; documented and tested composition rules.
Test plan: a permission matrix across member, guest, suspended, agent and anonymous against every level with overlapping grants, asserting maximum wins; a suspended member loses every read and write; forbidden reads return not-found so there is no existence oracle; an unknown subject type raises.
Acceptance: Given a member holding view through the workspace group and full through a champion binding, when access is computed, then it is full; and given their suspension, then every read returns not-found.

### P2-T03: People: profiles, manager chain, lifecycle [L]
Depends on: P2-T02
Goal: members as real people with an org structure and a safe lifecycle (screen S-33).
Deliverables: profiles with title, timezone, avatar and bio with self-versus-others editable field sets; a cycle-safe manager chain with a possible-managers query; the directory and org chart; suspend and restore; the guest kind with a convert action that strips prior bindings; erasure as anonymisation with a placeholder identity, authorship intact, an audit event and a machine-readable export, plus last-owner invariants.
Test plan: a manager cycle is rejected; suspend removes all access and restore returns it; converting to guest leaves no stale binding; erasure keeps comments readable with an anonymised author; removing the last owner is refused.
Acceptance: Given a suspended member, when any request arrives under their identity, then access is denied; and given erasure, then their content survives anonymised and an export is produced.

### P2-T04: Invitations [M]
Depends on: P2-T03
Goal: every joining path through one provisioning funnel.
Deliverables: invitation by email through the mailer and the outbox; reusable workspace links with a hashed token, use count, maximum uses, expiry, revoke and allowed domains; single-use personal links; trusted-domain automatic joining; all paths landing in one member-provisioning operation with consistent defaults and audit.
Test plan: invite, accept, member exists; a link past its limit, expiry or revocation refuses; a domain-restricted link rejects other domains; trusted-domain joining works; only members with sufficient access may invite.
Acceptance: Given a reusable link limited to one domain, when someone outside it tries, then joining is refused and audited.

### P2-T05: Files and blobs [M]
Depends on: P1-T04, P2-T02
Goal: upload and download that later modules build on.
Deliverables: the blob table with a prepare, upload and claim flow using signed URLs; type and size validation with images re-encoded; per-workspace byte accounting with a quota and a single warning at ninety percent; a preview and thumbnail worker; an optional scan hook driving the status; an orphan cleanup job.
Test plan: upload, claim and download on the disk driver; oversized and blocked types are rejected; crossing the quota fires exactly one warning; orphans are reaped.
Acceptance: Given an upload finishing above the warning threshold, when accounting runs, then one warning is emitted and the file still saves, with a hard stop only at the quota.

### P2-T06: Subscriptions + notification spine [L]
Depends on: P2-T02, P1-T04
Goal: the delivery machinery every module wires into (TECHNICAL-PLAN.md §4.11, screen S-03).
Deliverables: subscription lists and subscriptions with reasons, authors auto-joined, mentions auto-subscribed and re-diffed on edit, and suspended, placeholder and agent members excluded; notifications with access gating at send time; per-member settings for per-reason routing, batching window, daily summary time and quiet hours in their own timezone; batches found or created under a row lock with an idempotent send worker; per-reason mail templates in HTML and plain text with a digest variant and a development preview page; a bulk-suppression flag; the in-app inbox with a live badge, mute and snooze.
Test plan: a mention delivers immediately when opted; three rapid events produce one batch with no duplicates under concurrency; a recipient who lost access after enqueue receives nothing; un-mentioning on edit stops their notification but keeps watchers; the daily summary fires at the member's local time across a daylight-saving boundary; the suppression flag silences a bulk insert.
Acceptance: Given a member with a ten-minute window, when four notifications arrive inside it, then they receive one digest listing four items, each deep-linked.

### P2-T07: Typed activity feed engine [L]
Depends on: P2-T06
Goal: the human-readable event log (screen S-31), distinct from audit.
Deliverables: the typed event catalogue as a discriminated union with payloads that snapshot human labels; the activity table with an access-scope context set by the fail-closed resolver; feed queries at workspace, space, goal and profile scope, access-filtered, hiding soft-deleted subjects and paginated by key; aggregation of consecutive same-actor edits that never collapses narrative events; per-kind renderers behind a registry; live inserts; notification fan-out driven from activities.
Test plan: an event kind outside the catalogue cannot be persisted; a private-space activity never appears in a non-member's workspace feed; aggregation collapses five field edits into one row but never a check-in; feeds paginate stably under concurrent inserts.
Acceptance: Given a member without access to a space, when they read the workspace feed, then no activity from it appears, while a member of that space sees typed, readable entries.

### P2-T08: Workspace settings + module registry [M]
Depends on: P2-T02
Goal: the settings shell and module registration (screen S-36 skeleton).
Deliverables: a settings service implementing the TECHNICAL-PLAN.md §4.14 settings map with validated storage where environment overrides win, every key carrying a declared default so an unset key always resolves, and a reset-to-default action per setting and per card; the two-level admin shell; a typed module registry driving the sidebar and admin menus by access.
Test plan: every setting in the map resolves to its documented default on a workspace where nothing has been configured, proven by a test that enumerates the registry rather than a fixed list, so a setting added later without a default fails; resetting a card restores the defaults exactly.
Acceptance: Given a module registering a navigation item that requires an access level, when a member lacks it, then the item is hidden and the route is denied; and given a freshly provisioned workspace, when every setting is read, then each returns its documented default and none is unset.

### P2-T09: Security baseline [M]
Depends on: P1-T05, P2-T02
Goal: the platform controls from TECHNICAL-PLAN.md §8.2.
Deliverables: rate limiting through the cache port per address and per member on authentication, the API, channels and exports; account lockout with backoff and audit; a strict content security policy with per-response nonces plus transport, frame and referrer headers; a secure cookie audit; the sessions interface listing devices with revoke; the workspace freeze overlay with an admin recovery list; verified refusal of placeholder secrets in production.
Test plan: repeated failed sign-ins trigger lockout with audit and a retry hint; a revoked session's next request is rejected; a frozen workspace refuses every write except the recovery list; the policy nonce varies per response.
Acceptance: Given a workspace set to read-only, when any member saves anything, then it is refused with a clear message while admins can still manage members and settings.

### P2-T10: App shell + design system [L]
Depends on: P1-T08, P2-T08
Goal: the global interface everything plugs into (UIUX-PLAN.md §2, §3, §5).
Deliverables: components on the Base UI registry with the animation library vendored into `packages/ui`; design tokens for type scale, spacing, semantic colours and density; dark mode with light, dark and system; the shell with the sidebar, topbar, cycle strip placeholder and workspace switcher; responsive behaviour including the mobile tab bar; core components with preview pages; the keyboard registry and shortcut overlay; the message-catalogue pipeline with a pseudo-locale check; the persisted client cache keyed by build identifier with the stale-deployment reload.
Test plan: keyboard and focus component tests; theme and density persistence end to end; a mobile viewport smoke test; the pseudo-locale build catches a hardcoded string; a simulated version mismatch triggers exactly one reload.
Acceptance: Given a deployment bumping the application version, when a stale tab makes its next request, then it shows an update message and reloads once, with caches invalidated.

### P2-T11: Rich text editor [L]
Depends on: P2-T10, P2-T05
Goal: the one editor everywhere, done once (screen S-30).
Deliverables: a design document; the editor over the canonical schema with the node and mark allow-list enforced by the shared validator; slash commands, mentions, entity autolink by short identifier, tables and code blocks; inline attachments with optimistic placeholders, progress, submit gating while uploading and deletion on failure; local draft autosave per entity and member, fingerprinted against base content with an expiry; the sanitising renderer and the excerpt utility shared by server and client; the decode-safe mention and attachment extraction interface.
Test plan: schema round-trip golden tests; a malicious pasted payload renders inert; a draft against changed base content does not resurrect; extraction on malformed content returns an empty list.
Acceptance: Given a comment with an upload in flight, when the user submits, then submission waits for the upload or fails loudly, never dropping the attachment silently.

### P2-T12: Data-change runner [S]
Depends on: P1-T03
Goal: production backfills decoupled from schema changes.
Deliverables: a versioned, idempotent, batched, resumable change runner whose scripts freeze their own column expectations, with a completion ledger, a conventions document and one sample change with tests.
Acceptance: Given a change script run twice across a deployment boundary, when it re-runs, then it does nothing and the ledger shows one completion.

### P2-T13: AIProvider port + drivers [L]
Depends on: P1-T04
Goal: the provider abstraction and its drivers (AI-NATIVE-PLAN.md §3.1, §3.2).
Deliverables: the full port surface for chat, streaming, tool calling, embedding, structured extraction and capability reporting; drivers for Anthropic, OpenAI, Google, OpenRouter, Ollama, any OpenAI-compatible endpoint and off; contract tests per driver against recorded fixtures; a deterministic mock driver for the test suite; a documented driver contract so a new vendor is added without touching feature code.
Test plan: every driver satisfies the contract; the off driver reports every capability unavailable without raising; a model without tool support degrades rather than failing.
Acceptance: Given the provider set to off, when any capability is requested, then it reports unavailable and the caller's manual path is unaffected.

### P2-T14: AI configuration, keys, encryption and rotation [M]
Depends on: P2-T13
Goal: bring your own key at three levels, safely (AI-NATIVE-PLAN.md §3.3).
Deliverables: the provider and credential tables; envelope encryption with per-secret data keys wrapped by a master key ring; the precedence resolver of user, then workspace, then deployment, then off; a masked hint and a live connection test; a one-command rotation that re-wraps data keys only.
Test plan: a stored key never appears in any response or log; rotation leaves every credential usable with no downtime; a user key overrides the workspace key for that user's calls only.
Acceptance: Given a workspace key and a personal key, when the member runs an assist, then their own key is used, and an admin cannot read it.

### P2-T15: Model catalogue, tier routing, structured output and prompts [M]
Depends on: P2-T14
Goal: features request a tier, never a model (AI-NATIVE-PLAN.md §3.4).
Deliverables: the seeded and refreshable model catalogue with admin add and edit for custom models carrying their own context window and cost figures; a seeded default tier map per driver so supplying a key is the only step; per-workspace tier policies with sampling; the optional per-feature tier override; the context-window guard; structured extraction with schema validation and one repair attempt then a clean failure; the versioned prompt registry with a default, an editor and restore.
Test plan: an oversized request is blocked before the call; malformed model output repairs once then fails cleanly; a prompt version change is recorded and reversible; a custom catalogue entry meters cost from its own figures; a feature with a tier override routes to that tier while every other feature is unaffected; a workspace that has supplied only a key resolves every tier through the driver's seeded map.
Acceptance: Given an air-gapped workspace mapping every tier to a local model, when any AI feature runs, then no external request is made.

### P2-T16: Usage metering, quotas and hard caps [M]
Depends on: P2-T14
Goal: cost visible and bounded (AI-NATIVE-PLAN.md §4, "Budgets and limits", screen S-37).
Deliverables: usage events per call with tokens, cost from the catalogue, latency, source and status; quotas per user, per agent and per workspace; a hard cap that disables features and halts running agents; the AI console (screen S-37) assembling the provider, models, features, budgets, prompts, privacy and usage cards from P2-T13 to P2-T16; anomaly flagging.
Test plan: a call records tokens and cost accurately against the catalogue; crossing a quota disables the feature with a clear message; crossing a hard cap halts a running agent mid-flight with a log line.
Acceptance: Given a workspace at its hard cap, when an agent run is in progress, then it halts with an explanatory log entry and every manual path still works.

### P2-T17: Agent runtime: agents, runs, sandbox, proposals [L]
Depends on: P2-T16, P1-T07
Goal: the runtime the Coach and the Champion will use (AI-NATIVE-PLAN.md §6.5).
Deliverables: the agent table owning a member with the agent kind; least-privilege binding wiring scoped to named resources; the run state machine with a task list, a bounded tool loop, an append-only readable log, self-rescheduling through the job queue and resumption across restarts; the three write policies of sandbox, propose and scoped direct; the proposal envelope table and the bulk apply and dismiss action; the run history interface (screen S-38).
Test plan: a sandbox run commits nothing; a proposal run commits nothing until applied and applying goes through the normal Operation pipeline with audit; a run resumes after a restart; a run cannot touch a resource outside its bindings.
Acceptance: Given an agent scoped to one space in proposal mode, when it runs against a goal in another space, then the tool call is denied by the permission layer and the denial is logged.

**Phase 2 exit:** relationship access enforced through one entry point with its lint; the people lifecycle safe; invitations and links; files with quotas and previews; subscriptions and access-gated notifications with batching and the daily summary; the typed feed live and leak-tested; settings and the module registry; the security baseline; the shell, tokens, editor and languages; the data-change runner; the provider port with every driver; keys encrypted with rotation; tier routing, structured output and versioned prompts; metering with quotas and hard caps; the agent runtime with sandbox and proposals.

---

# Phase 3: The OKR core

The namesake. Starts with a design gate.

### P3-T00: OKR core design gate [DESIGN GATE] [L]
Depends on: Phase 2 complete
Goal: the design documents and the correctness artifacts for the highest-risk engines.
Deliverables: design documents covering the OKR domain (cycles, the guided workflow, goals, key results, check-ins, lifecycles as Given / When / Then); the scoring engine with its full golden-master matrix (weighted rollups, reduce-direction key results, KPI-backed key results, aligned cascades with cycles, the health precedence cascade including staleness override, equal-endpoint cases and the trend-forecast model); the cadence engine (anchor-day arithmetic, tolerance, timezone and daylight-saving cases); the KPI engine (corridors, period normalisation, formula grammar, aggregation, cascade, recovery drafting); and the alignment engine (penalty arithmetic and finding generation).
Acceptance: the human approves with an explicit statement before any Phase 3 implementation task starts, and the golden-master matrices receive a line-by-line review.

### P3-T01: Spaces [M]
Depends on: P3-T00
Goal: team homes (TECHNICAL-PLAN.md §4.2).
Deliverables: spaces and space members with member, manager and coordinator roles; a creation Operation wiring the context, the standard group and manager bindings; the default space per TECHNICAL-PLAN.md §4.14, provisioned for new workspaces and backfilled for existing ones through the data-change runner; the space home shell; join and leave; audit.
Acceptance: Given a space manager, when they add a member, then that member gains space-standard access to the space's aggregates immediately.

### P3-T02: Annual frame, cycles and rhythm settings [L]
Depends on: P3-T01
Goal: the time boxes and every tunable threshold (TECHNICAL-PLAN.md §4.3, METHOD.md §2.1).
Deliverables: the annual frame with mission, vision, mid-term strategy, horizon, agreement state and the not-doing list, plus annual strategies; cycles with mode, cadence, dates, status, phase, sponsor, facilitator, session dates, publication deadline, levels and contributing units, generated forward from the cadence and honouring the workspace timezone; rhythm settings holding the METHOD.md §11 registry overrides plus terminology labels; the admin surface; audit on create and archive.
Test plan: cycle generation across quarter, half and year boundaries and across timezones; label overrides render throughout the interface; a threshold change takes effect without a restart.
Acceptance: Given quarterly cadence on a date inside Q3, then the active cycle is Q3 with correct bounds, created automatically if absent.

### P3-T03: The guided cycle workflow [L]
Depends on: P3-T02
Goal: the eight phases as a computed workflow, not a checklist (METHOD.md §2, screens S-04 to S-12).
Reference mockup: [02-cycle-workspace](../stakeholder/mockups/png/02-cycle-workspace.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the input pack with per-item state and distribution tracking; prior-cycle scoring rows; baseline health; ranked strategic issues with impact and source; priorities with success statements and promotion into objectives; the quarterly revalidation record with focus key results; capacity notes; the gate state table recomputed on every relevant write; phase completion computed from METHOD.md §2.3; the mid-cycle calibration record; the cycle workspace interface with the phase rail, facilitator guidance and the deadline countdown; the cycle strip in the shell.
Test plan: each phase's completion conditions flip exactly on their inputs; promoting a priority creates an objective linked back to it; the countdown honours the workspace timezone; a calibration beyond the first is refused.
Acceptance: Given a quarterly cycle whose input pack has two items missing, when the facilitator opens Phase 4, then drafting is blocked with the two missing items named and a link to gather them.

### P3-T04: Goals + key results [L]
Depends on: P3-T03
Goal: the core objects with accountability and an explicit lifecycle (TECHNICAL-PLAN.md §4.4, screens S-13, S-14, S-17).
Deliverables: goals with a required champion and reviewer, owner scope, level, cycle or contextual timeframe, weight, contribution statement, alignment pointers with cycle prevention, and a close lifecycle where closing requires an outcome and creates a retrospective and reopening restores; key results with direction, indicator type, unit, baseline, target, current, owner, due date, weight and the align-and-commit capacity verdict, plus the KPI link slot; the value history table; create and edit interfaces with inline patterns; champion and reviewer reassignment rebinding tagged bindings atomically; moving between cycles.
Test plan: the single-parent invariant and cycle rejection; closing requires an outcome and creates the retrospective; reopening clears the outcome but keeps the retrospective; reassigning a reviewer rebinds and reassigns pending obligations; weight clamping.
Acceptance: Given goal-edit access in an active cycle, when a goal with a champion, a reviewer and two weighted key results is created, then it persists at zero percent and pending, and closing it requires and produces a retrospective.

### P3-T05: Scoring and health engine [L]
Depends on: P3-T04
Goal: TECHNICAL-PLAN.md §6.2 as pure functions against the approved golden masters.
Deliverables: direction-aware clamped key result progress including the maintain and move directions; weighted goal progress including aligned children; the upward cascade with cycle detection; RAG from thresholds; the health precedence cascade; the trend forecast with its trending flag; the portfolio verdict; a single recompute entry point; the outbox-driven invalidation job writing derived columns.
Test plan: the P3-T00 golden-master suite passes verbatim; a cascade over a thousand-goal chain finishes within budget; the forecast flags a decaying key result before its status changes; a reduce-direction key result scores correctly at both ends.
Acceptance: Given key results weighted two and one at one hundred percent and forty percent, then the goal scores eighty percent; and given a stale goal whose last check-in said on track, then its health reads outdated.

### P3-T06: Cadence engine + staleness [M]
Depends on: P3-T05
Goal: TECHNICAL-PLAN.md §6.3, the rhythm that makes health honest.
Deliverables: pure next-due arithmetic from frequency, anchor day, tolerance and the workspace timezone; the next due date maintained on publication, creation and frequency change; the staleness sweep job flipping health past the grace window; scheduling hooks the nudge engine will consume.
Test plan: golden masters including daylight saving and month ends; publishing early or late inside the tolerance advances exactly one period.
Acceptance: Given a weekly goal anchored to a chosen day and checked in the day before, when the cadence advances, then the next due date is the following anchor day, and once a missed check-in ages past the grace window the goal renders outdated everywhere.

### P3-T07: Check-ins: snapshots, publication, acknowledgement, voting [L]
Depends on: P3-T06, P2-T06
Goal: the narrative ritual (TECHNICAL-PLAN.md §4.4, screen S-15).
Deliverables: check-ins with the status vocabulary, confidence, a required narrative, the immutable snapshot of every key result value with its previous value and confidence, draft and publish with full side-effect suppression on draft, an edit window with re-snapshot, and deletion that rolls goal pointers back; the acknowledgement action restricted to the reviewer; private team confidence votes with a synchronised reveal and a team average; the composer and the sequence walker; the check-in card with value differences; reactions, comments and subscriptions wired.
Test plan: a draft produces no activity, notification or cadence movement; publication snapshots values, advances the cadence, notifies subscribers and creates the reviewer obligation; editing after the window is refused; deleting the latest check-in restores prior pointers; acknowledgement by a non-reviewer is denied; votes stay hidden until the reveal and the reveal is atomic for every connected client.
Acceptance: Given a published check-in moving a key result from forty to fifty-five with a caution status, then the goal's health reads caution, the snapshot shows the movement, and the reviewer sees the obligation until they acknowledge.

### P3-T08: Review inbox [M]
Depends on: P3-T07
Goal: what I owe right now (screen S-02).
Reference mockup: [10-review-inbox](../stakeholder/mockups/png/10-review-inbox.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the computed obligations query covering check-ins due as champion, acknowledgements owed as reviewer respecting reviewer-change history, and placeholders for the blocker, commitment, session and proposal sources that later phases fill; overdue-first grouping with action and due labels; the page with inline one-click actions; the live sidebar badge with cache invalidation from the relevant Operations.
Test plan: an obligation appears and disappears exactly on publication and acknowledgement; a reviewer appointed today is not asked to acknowledge last month; the badge updates live.
Acceptance: Given a champion with one overdue check-in and a reviewer role on another goal's fresh check-in, when they open Review, then they see exactly two obligations, overdue first, each actionable inline.

### P3-T09: Alignment: parents, dependencies, the alignment engine [L]
Depends on: P3-T04
Goal: the cascade and the cross-team links with a computed health score (METHOD.md §5).
Reference mockup: [05-alignment-studio](../stakeholder/mockups/png/05-alignment-studio.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: horizontal goal dependencies; the key result dependency register with confirmation and a named risk owner; the alignment engine producing the score and one structural finding per penalty, each linked to the goal that caused it; the finding table shared with the Coach's later semantic findings; recomputation driven from the outbox on structural change.
Test plan: each penalty fires exactly on its condition and the arithmetic matches METHOD.md §5.2; a department whose subtree gains one dependency clears the silo finding; a dependency that is confirmed clears its finding, and one with a risk owner but no confirmation clears the gate but keeps the finding.
Acceptance: Given a tree with one orphan goal and one siloed department, when the score is computed, then it reads eighty and lists exactly two findings, each opening the goal responsible.

### P3-T10: Goal surfaces: explorer, detail, alignment studio [L]
Depends on: P3-T07, P3-T09
Goal: the primary interface (screens S-13, S-14, S-16).
Reference mockup: [05-alignment-studio](../stakeholder/mockups/png/05-alignment-studio.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the explorer with scope tabs, cycle switcher, filters and a virtualised tree with health, staleness and confidence chips, inline editing and a quick check-in; the goal page with the score ring, key result rows with sparkline and forecast, check-in history with differences, discussion and the right rail; the alignment studio canvas with vertical connectors, dashed dependency connectors, pan, zoom, keyboard traverse, virtualisation, the link mode and the three-tab panel of details, health and review.
Test plan: budgets spot-checked on seeded data; the canvas stays interactive at a thousand nodes; keyboard traverse reaches every node.
Acceptance: Given the explorer, when a key result is checked in from the side panel, then progress, RAG and health update live in both the list and the canvas.

### P3-T11: Work Map [M]
Depends on: P3-T10
Goal: the home screen (screen S-01).
Reference mockup: [01-work-map](../stakeholder/mockups/png/01-work-map.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the virtualised tree over goals, sub-goals and key results with the uniform node contract of health including staleness, progress, confidence, champion, timeframe and next step; scope tabs and filters; side-panel opening; deep links; home routing. Initiative and task rows are added in Phase 5.
Acceptance: Given the home screen, when it renders, then the company's goal tree shows rolled-up health with stale goals visibly outdated, inside the budget.

### P3-T12: KPIs: categories, records, grid [L]
Depends on: P3-T02
Goal: the metrics module (TECHNICAL-PLAN.md §4.6, screen S-20).
Deliverables: categories and KPIs with frequency, unit, direction, indicator type, tier, thresholds and the parent pointer; records unique per normalised period; period normalisation for every frequency; direction-aware achievement and the corridor state; the keyboard-first grid with grouping and sparklines; sharing.
Test plan: period normalisation across all five frequencies; direction-aware achievement in both directions; uniqueness under concurrent writes.
Acceptance: Given a monthly KPI with a target and default corridors, when a value at eighty percent of target is recorded, then the cell shows the watch state and re-recording updates rather than duplicating.

### P3-T13: KPI formula engine [L]
Depends on: P3-T12
Goal: calculated KPIs (TECHNICAL-PLAN.md §6.4).
Deliverables: the typed expression tree with its schema; the safe evaluator with references, operators, parentheses and explicit divide-by-zero handling; cross-frequency aggregation using each source's aggregate function; the dependency table with cascade recomputation and cycle detection driven from the outbox; golden masters from the design gate.
Acceptance: Given a monthly KPI defined as the sum of two others, when one source's value changes, then the dependent recomputes for that period, anything depending on it follows, and a self-referencing formula is rejected.

### P3-T14: KPI trees, corridors, recovery OKRs [L]
Depends on: P3-T13, P3-T05
Goal: the driver tree and the recovery loop (METHOD.md §6, screens S-18, S-19, S-21).
Reference mockup: [06-kpi-recovery](../stakeholder/mockups/png/06-kpi-recovery.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: named KPI trees with the canvas, corridor gauges and per-node metadata; the recovery drafter creating the recovery goal from the leading drivers at the edge of the unhealthy branch per METHOD.md §6.5, with the objective and up to four key results, storing the starting achievement and flipping the state to recovering; effective health while recovering; the proposal to close when achievement re-enters the corridor; the recovery board across every tree; the KPI detail with the period chart, corridor bands, records table and formula builder; the key result to KPI link with the scoring branch reading the KPI's achievement.
Test plan: launching a recovery OKR on an unhealthy KPI with three leading children produces three key results with correct baselines and targets; a KPI whose children are all lagging drafts from their nearest leading descendants; a KPI whose whole subtree holds no leading KPI gets the placeholder key result; effective health rises with recovery progress while real achievement lags; re-entering the corridor proposes closure exactly once.
Acceptance: Given an unhealthy KPI, when the owner launches recovery, then a goal exists whose key results are its leading drivers, the KPI reads recovering, and the recovery board shows it with its progress.

### P3-T15: Scorecard, cycle archive and feed-forward [M]
Depends on: P3-T05, P3-T12
Goal: closing a cycle and opening the next one (METHOD.md §8.9).
Deliverables: performance snapshots written by the archive job with the result, bucket counts and the portfolio verdict; the scorecard interface with the band table, trends across cycles and export; the feed-forward operation that opens the next cycle carrying prior scores into its scoring list, carry-forward key results into its issue list at impact four, learnings into its input pack and the annual frame forward with focus flags cleared; points configuration present but off with no rows unless enabled.
Test plan: archiving a closed cycle produces correct snapshots and verdicts; feed-forward populates the next cycle exactly per the mapping and is idempotent; nothing exists in the points tables while disabled.
Acceptance: Given a closed cycle with two carry-forward key results, when the next cycle opens, then its issue list contains those two at impact four and its scoring list contains every prior key result with its score.

### P3-T16: Comments, reactions and discussion wiring [M]
Depends on: P3-T01, P2-T07
Goal: conversation across the OKR objects (TECHNICAL-PLAN.md §4.10).
Deliverables: comments on goals, key results, check-ins, cycles and documents with deep links and unread highlighting; reactions across every major subject; the compose-time preview of who will be notified.
Acceptance: Given a comment mentioning two members, when it is posted, then both are subscribed and notified once, and the preview shown before posting matched the outcome.

### P3-T17: Demo workspace builder + seed [M]
Depends on: P3-T15
Goal: the demo as a product feature (screen S-34).
Deliverables: a development seed command; an in-product, flag-gated action building a believable organisation in one transaction with notifications suppressed: spaces, members, an annual frame, a completed prior cycle with scores, an active cycle in Phase 6, goals with check-in history where some are deliberately outdated, KPI trees with one unhealthy KPI and an active recovery OKR, blockers at different ages, commitments, a streak, and documents; idempotent.
Acceptance: Given a fresh workspace, when the demo builds, then the Work Map, review inbox, recovery board and feeds are populated and believable, and nobody received a message.

**Phase 3 exit:** the guided cycle runs from Phase 0 to Phase 7 with computed completion; goals with champion and reviewer, close and reopen; scoring, cadence and staleness live and golden-master green; check-ins with snapshots, voting and acknowledgement; the review inbox; alignment with dependencies and a computed health score; KPI trees with formulas, corridors and working recovery OKRs; the scorecard, archive and feed-forward; the Work Map as home; the demo builder. **This is the first demonstrable, opinion-complete product.**

---

# Phase 4: The coaching layer

The active product. Starts with a design gate.
### P4-T00: Coaching design gate [DESIGN GATE] [M]
Depends on: Phase 3 complete
Goal: the design documents for the canon package, the agents and the sessions.
Deliverables: design documents covering the method package (every rule with its exact condition, status, prompt, reason and example, plus the corpus of real objectives and key results with expected verdicts); the agents (trigger catalogue, escalation ladders, deduplication, quiet hours, the deterministic behaviour with AI off, and the prompt design per phase); and the sessions (both rituals stage by stage with their state machines, live synchronisation and completion conditions).
Acceptance: the human approves with an explicit statement, and the rule corpus and the trigger catalogue receive a line-by-line review.

### P4-T01a: The quality catalogue: objective checks [M]
Depends on: P4-T00
Goal: METHOD.md §4.1 as data and one pure evaluator (TECHNICAL-PLAN.md §6.1).
Deliverables: `packages/method/src/quality.ts` with the §4.1 word lists, OBJ-1 to OBJ-5 as condition tables carrying their coaching prompt verbatim, the pure `evaluateObjective`, and the §4 strength score with `todo` counting in the denominator.
Test plan: corpus entries 1 to 3 from the design document produce their approved verdicts exactly; every condition row carries a prompt.
Acceptance: Given "Launch the new mobile app by end of Q3", when the package evaluates it, then OBJ-1 fails with its prompt and the rest pass.

### P4-T01b: Key result checks and strictness [M]
Depends on: P4-T01a
Goal: METHOD.md §4.2 and §4's strictness rule.
Deliverables: the §4.2 activity-noun and impact word lists; KR-1 to KR-7 with prompts; `evaluateKeyResults` splitting set-level checks from per-key-result ones and naming which key results tripped a rolled-up verdict; KR-6 delegating to §3.2's draft verdict on the set average; `applyStrictness` promoting every warn to a fail.
Test plan: corpus entry 4 produces its approved verdicts; strict mode moves the strength score and leaves every prompt unchanged.
Acceptance: Given three activity-shaped key results, when the package evaluates them, then KR-5 fails naming all three, and strict mode turns KR-4's warn into a fail.

### P4-T01c: Alignment checks [S]
Depends on: P4-T01b, P3-T09
Goal: METHOD.md §4.3 as verdicts, read from the alignment engine rather than decided twice.
Deliverables: AL-1 to AL-6 with prompts; `evaluateAlignment` mapping the alignment engine's findings to verdicts; AL-2 recorded as settled by the schema; AL-5 reading `todo` until the dependency register answers.
Test plan: corpus entry 5's findings produce their approved verdicts; an unanswered AL-5 is `todo` and never a pass.
Acceptance: Given a graph with no company anchor, when the catalogue reads the engine's findings, then AL-4 fails with its prompt and every rule with no finding passes.

### P4-T01d: Cycle checks [S]
Depends on: P4-T01c, P3-T02
Goal: METHOD.md §4.4, completing the twenty-six.
Deliverables: CY-1 to CY-8 with prompts, none of them feeding the strength score; `evaluateCycle` delegating CY-6 to publish gate 5 and CY-7 to gate 4, and reading every number from the §11 registry.
Test plan: corpus entry 6 produces its approved verdicts; all twenty-six checks are present with unique ids; only the cycle checks are excluded from the score.
Acceptance: Given a cycle with an incomplete input pack, when the catalogue evaluates it, then CY-1 fails and the strength score is unaffected.

### P4-T01e: Example pairs and the nudge trigger catalogue [M]
Depends on: P4-T01d
Goal: the last of the catalogue, and every rule key a proactive message can cite (METHOD.md §4.6, AI-NATIVE-PLAN.md §6.4).
Deliverables: the §4.6 weak and strong example pairs attached to the check each weak version trips, with the reason; the AI-NATIVE-PLAN.md §6.4 trigger catalogue as data with its rule keys, subjects, escalation positions and default channels, so every proactive message resolves inside the package.
Test plan: every example pair names a check the catalogue defines; every trigger's rule key resolves; a trigger with an unknown rule key fails the test.
Acceptance: Given a failing OBJ-1, when the rule card is asked for its example, then it returns the weak and strong pair from §4.6 with the reason.

### P4-T01f: Session stages, process health and the rhythm diagnostic [M]
Depends on: P4-T01e
Goal: the ritual data METHOD.md §7 and §8 define.
Deliverables: the weekly and quarterly session stage definitions with their durations; the §8.5 process-health statements; the §8.7 management-retro questions; the §8.6 rhythm diagnostic as a pure function over the cycle score and the rhythm score, returning its verdict and narrative; the §9 facilitator guidance.
Test plan: the diagnostic verdict matches §8.6 across all three cases; the stage durations sum to each session's stated length.
Acceptance: Given a cycle score below the threshold and a rhythm score above it, when the diagnostic runs, then it reads as a strategy or quality problem with the specific figures.

### P4-T01g: The conformance suite, `pnpm method:check` [M]
Depends on: P4-T01f
Goal: a build that fails when METHOD.md and the package disagree.
Deliverables: `pnpm method:check` doing three things: every rule key referenced in METHOD.md §10 and §6.4 resolves to a package entry; the §11 defaults in `thresholds.ts` match the values in METHOD.md §11; the design document's corpus entries produce exactly their expected verdicts. Wired into CI.
Test plan: changing a threshold in the document without changing the package fails; adding a rule key to the document without adding it to the package fails.
Acceptance: Given a threshold edited in METHOD.md §11 and not in the package, when the suite runs, then it fails naming the key and both values.

### P4-T02a: Server-side quality evaluation and stored flags [M]
Depends on: P4-T01d, P3-T04
Goal: every goal and key result write carries its verdicts (REQUIREMENTS.md §3.2).
Deliverables: evaluation from `packages/method` on every goal and key result write inside the same Operation; the strength score and the flags stored on the goal; per-workspace strictness read from the §11 registry and applied server-side.
Test plan: the flags stored on the goal match the last evaluation exactly; strict mode changes the stored score for the same input; evaluation adds no extra transaction.
Acceptance: Given an objective edited to start with an output verb, when it is saved, then the stored flags carry OBJ-1's failure and the strength score drops.

### P4-T02b: The rule verdict component and the strength meter [M]
Depends on: P4-T02a
Goal: quality at the point of writing (screen S-09).
Reference mockup: [03-draft-coach](../stakeholder/mockups/png/03-draft-coach.png), [03b-rule-card](../stakeholder/mockups/png/03b-rule-card.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: client-side evaluation as the user types, from the same package; the rule verdict component with a status dot, a short label, and on demand the coaching prompt, the reason and the example pair; a link from every verdict to the rule itself; the strength meter in the composer header.
Test plan: evaluation completes inside the sixteen-millisecond budget for a five-key-result objective, measured over a thousand runs; server and client verdicts are identical for the same input.
Acceptance: Given an objective beginning with an output verb, when the champion types it, then the rule fails inline with its coaching prompt and example within one keystroke's latency.

### P4-T02c: The quality panel across a set [M]
Depends on: P4-T02b
Goal: every open issue in one place, grouped by objective.
Deliverables: the quality panel listing every open issue across a set grouped by objective, each linking to the field that fixes it; the per-workspace strictness control in workspace admin behind `manage_coaching`; the empty, loading and permission-denied states.
Test plan: the panel's issue count matches the sum of the stored flags; the browser's verdicts and the stored flags are the same set; raising strictness moves every warn to a fail. **Corrected on 2026-08-18:** this line said "in the panel without a reload". Strictness lives on the server and reaches the panel as a prop, so an admin changing it is seen on the next navigation. A live client-side strictness would be a second copy of a setting the server enforces, which is the divergence P4-T02a exists to prevent.
Acceptance: Given a set with three warnings across two objectives, when the panel opens, then all three are listed under their objective with a link to each field.

### P4-T03: Publish gates [M]
Depends on: P4-T02c, P3-T03
Goal: the six gates as hard server-side enforcement (METHOD.md §4.5, screen S-10).
Reference mockup: [04-gates-capacity](../stakeholder/mockups/png/04-gates-capacity.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: gate evaluation from the method package over the cycle's whole set, recomputed on every relevant write; the gate checklist interface where each unmet gate links to what would fix it; the publish action refusing with the specific gate and reason; an override path that requires elevated access, a written reason and an audit event.
Test plan: each gate flips exactly on its condition; publishing with any gate red is refused server-side even when the interface is bypassed; an override records its reason and actor.
Acceptance: Given a set with one unconfirmed and unowned dependency, when the facilitator publishes, then it is refused naming gate four and linking to the dependency register.

### P4-T04a: The nudge table and the due engine [M]
Depends on: P4-T01e, P3-T08
Goal: the machinery that decides what is due now (AI-NATIVE-PLAN.md §6.3).
Deliverables: the nudge table with its row-level security policy; the rule registry reading the P4-T01e trigger catalogue; the engine computing what is due per member; delivery to the in-app inbox and email through the existing ports.
Test plan: a trigger fires exactly on its condition; every nudge row carries a rule key, a channel and an escalation position.
Acceptance: Given a check-in due today, when the engine runs, then one nudge row exists for the champion with the rule key that caused it.

### P4-T04b: Deduplication, quiet hours and suppression [M]
Depends on: P4-T04a
Goal: an active product that is not a noisy one.
Deliverables: deduplication to one per subject per member per day unless the escalation step increases; quiet hours in the member's timezone; workspace quiet mode; per-rule enable and channel override; the suppression record carrying its reason.
Test plan: a burst of triggers on one subject produces one nudge; an urgent escalation is delivered inside quiet hours; a suppressed nudge records why.
Acceptance: Given five triggers on one goal in one day, when the engine runs, then one nudge is delivered and four suppression rows name the reason.

### P4-T04c: Escalation ladders, provenance and the volume dashboard [M]
Depends on: P4-T04b
Goal: escalation that a champion can see happening to them.
Reference mockup: [10-review-inbox](../stakeholder/mockups/png/10-review-inbox.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the escalation ladders for check-ins, acknowledgements and blockers; the nudge provenance component offering snooze, a channel change and a link to the rule; the volume dashboard with the noisiest rules in workspace admin (screen S-36) behind `manage_coaching`; a snooze that never hides a review-inbox obligation.
Test plan: an escalation advances exactly one step; a snooze silences the nudge and leaves the obligation; a simulated month over the demo workspace stays under the volume ceiling per member.
Acceptance: Given a champion who misses their check-in, when the engine runs over a fortnight, then the reviewer is brought in at the grace boundary, the coordinator at seven days and the sponsor at fourteen, each step visible to the champion.

### P4-T05a: The Champion agent and its nudge run [M]
Depends on: P4-T04c, P2-T17
Goal: the rhythm agent, seeded and running (AI-NATIVE-PLAN.md §6.2).
Deliverables: the seeded Champion agent member with its persona, staged instructions, schedule and least-privilege scope on named spaces only; the hourly nudge run; the readable run log; the cost cap halting a run.
Test plan: the agent holds no workspace-wide grant; with AI off the run still fires every trigger and drafts nothing; the run halts on the cost cap.
Acceptance: Given the agent enabled with AI off, when the hourly run executes, then every due nudge is delivered and the run log shows what fired.

### P4-T05b: The daily sweep and the cycle countdown [M]
Depends on: P4-T05a
Goal: the rhythm the agent guards day to day.
Deliverables: the daily sweep covering staleness, blocker aging, KPI corridors and the morning summary; the weekly session lifecycle; the per-cycle countdown and review preparation.
Test plan: a goal past its staleness grace is flipped to outdated exactly once; a blocker aging past its clock escalates; the countdown fires on its own schedule and not on the sweep's.
Acceptance: Given a goal three days past its staleness grace, when the daily sweep runs, then that goal reads outdated, a second run changes nothing, and the hourly queue is what nudges its champion.
Correction, made at P4-T05b: this card asked for the daily sweep to nudge the champion. AI-NATIVE-PLAN.md §6.2 puts the check-in nudge in the **hourly** queue and gives the daily run the staleness sweep, which flips health rather than sending a message. §6.2 outranks this document, so the criterion above is the one that was built. A daily run that also chased check-ins would mean two cadences reading the same rows and a run log that could not say which clock spoke.

### P4-T05c-a: The proposal path, and the recovery proposal [M]
Depends on: P4-T05b
Goal: a proposal a human applies in one action, with nothing AI about it yet.
Deliverables: the shared draft helper extracted so one implementation opens a check-in draft; a publish action that opens the draft and publishes it in one Operation, because an agent holds `view` and cannot open one itself; `proposed_changes.ai_generated` and the `nudges` link to the proposal it carries; the recovery OKR proposal raised from the daily sweep, deterministic, from METHOD.md §6.5's template; the nudge that carries it.
Test plan: a KPI unhealthy for the §11 delay produces exactly one pending proposal with the AI provider off; nothing commits until a human applies it; applying it launches the recovery through the normal Operation with its audit row; the nudge names the proposal.
Acceptance: Given a KPI unhealthy for two consecutive periods and no AI provider, when the daily run executes, then its owner is nudged once with a pending recovery proposal attached, the KPI is unchanged, and applying that proposal creates the recovery objective as the applying member.

### P4-T05c-b: AI drafting inside the proposal [M]
Depends on: P4-T05c-a
Goal: drafting that stays a proposal (AI-NATIVE-PLAN.md §6.2).
Deliverables: the check-in drafter in `packages/agents`, producing status, confidence, narrative and values through structured extraction with the §1.8 repair attempt; the AI-refined recovery objective title, defaulting to the template when absent; the run cost cap applied around every provider call; every drafted proposal marked AI-generated.
Test plan: with AI off no language is generated and every trigger still fires; with a provider configured a check-in three days overdue produces a drafted proposal; a run that reaches its cost cap halts before spending; model output that fails its schema twice fails cleanly rather than proposing nonsense.
Acceptance: Given a check-in three days overdue and a provider configured, when the agent runs, then the champion receives a nudge containing a drafted check-in they can review and publish in one action.

**Why P4-T05c was cut in two.** The original card asked for the proposal
machinery and the AI drafting together. The machinery is a shared draft helper,
a new publish action, two columns and a deterministic recovery proposal, and it
is verifiable with no provider at all; the drafting is a `packages/agents`
module that cannot be verified without a key. Splitting on the provider
boundary is also what let the first half land while the second waited on a
credential.

### P4-T06a: The Coach agent and write-triggered evaluation [M]
Depends on: P4-T05c-a
Dependency corrected at P4-T06a: this card read P4-T05c, and after that split it read P4-T05c-b. Nothing here touches the check-in drafter or any provider, so the real dependency is the proposal path in P4-T05c-a. The old line was chain order rather than data, and it would have stalled the whole agents lane behind one credential.
Goal: the quality agent at the moment of writing (AI-NATIVE-PLAN.md §6.1).
Deliverables: the seeded Coach agent with its persona, instructions, schedule and scope; write-triggered evaluation feeding the goal's quality flags; the AI-NATIVE-PLAN.md §6.4 quality triggers; every message citing its rule key.
Test plan: a message citing a rule key the method package does not define fails the build; with AI off the quality triggers still fire.
Acceptance: Given a goal saved with a failing rule, when the Coach runs, then a nudge cites that rule key and links to the rule.

### P4-T06b-a: Divergence findings, and the shared reconciler [M]
Depends on: P4-T06a
Goal: the finding a reading of one goal's own data produces, with no provider.
Deliverables: divergence detection between reported health and the goal's own data, as findings in the shared table with severity and one specific sentence; the reconciler extracted so the Coach's findings and the engine's obey one implementation of "a dismissal survives" and "a cleared condition disappears"; the `quality.divergence` nudge.
Test plan: a dismissed finding stays dismissed on the next sweep and stops nudging; a cleared condition soft-deletes and a returning one gets a fresh open row; a sweep of one kind leaves the other kinds' rows alone; with no provider the semantic kinds are absent rather than guessed.
Acceptance: Given a goal reported on track whose progress is in the red band, when the Coach runs, then one open divergence finding exists on that goal carrying `quality.divergence` and its champion is nudged once; dismissing it survives the next sweep and silences the nudge.

### P4-T06b-b: The nightly semantic sweep [M]
Depends on: P4-T06b-a
Goal: the findings only a reading of the whole workspace produces (METHOD.md §5.3).
Deliverables: the nightly sweep producing METHOD.md §5.3's relink, dependency, conflict and gap findings through the provider, each with a severity and one specific sentence; a one-click apply where §5.3 says the fix is mechanical, re-parenting through the normal Operation with audit; the run cost cap around every provider call.
Test plan: applying a relink re-parents the goal through the normal Operation with audit; with the provider off none of the four semantic kinds is written; a dismissed semantic finding stays dismissed.
Acceptance: Given two goals in different spaces double-counting one metric and a provider configured, when the nightly sweep runs, then a conflict finding appears for both champions, and dismissing it on one side dismisses it everywhere.

**Why P4-T06b was cut in two.** METHOD.md §5.3 is the *semantic* review: all four of its types are judgements the Coach makes by reading content, so all four need a provider, and so does the original acceptance criterion. Divergence is not one of them: it is arithmetic over a stored status and stored numbers, and AI-NATIVE-PLAN.md §6.1's own matrix marks it deterministic. The same provider boundary that split P4-T05c splits this, and it let the deterministic half land while the credential was still outstanding.

**One of §6.1's three divergence cases is deliberately not built.** "A forecast that misses while the champion says caution" is ambiguous as written (a pessimistic forecast beside a cautious champion is agreement, not divergence) and rests on the §3.6 forecast, whose behaviour on sparse data is an open practice decision in PHASE-4-SPLIT.md. It waits for that decision rather than being built on a number that may change.

### P4-T06c: The rewrite assist and the coach surfaces [M]
Depends on: P4-T06b-b
Goal: the coach where the writer already is.
Reference mockup: [05-alignment-studio](../stakeholder/mockups/png/05-alignment-studio.png), [03-draft-coach](../stakeholder/mockups/png/03-draft-coach.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the rewrite assist per failing rule, previewing before applying; the coach strip on the goal page; the review tab in the alignment studio; every surface hidden or disabled with the provider off.
Test plan: the assist commits nothing until applied; with AI off the surfaces explain rather than disappear silently.
Acceptance: Given a key result failing the measurability rule, when the champion uses the rewrite assist, then a corrected version is proposed naming the rule it now satisfies.

### P4-T07a: The session record and live stage sync [M]
Depends on: P4-T04c, P3-T07
Goal: one screen every participant shares (METHOD.md §7.2, screen S-22).
Reference mockup: [07-weekly-session](../stakeholder/mockups/png/07-weekly-session.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the session record with kind, schedule, facilitator, stage state and elapsed time, with its row-level security policy; live stage synchronisation through the realtime port; the participant list.
Test plan: a stage change reaches every connected client inside the budget; a reconnecting client lands on the current stage.
Acceptance: Given two participants in one session, when the facilitator advances a stage, then both see the new stage without a reload.

### P4-T07b: The confidence round [M]
Depends on: P4-T07a
Goal: step one of the ritual (METHOD.md §7.2).
Deliverables: the key result list with the focus panel; the draggable dial with band shortcuts; the synchronised vote reveal with a team average; the what-changed note; the confirm that advances.
Test plan: the reveal is atomic across clients; the step cannot complete while any key result is unscored.
Acceptance: Given one unscored key result, when the coordinator tries to continue, then it is refused naming that key result.

### P4-T07c: Blockers, the board and aging [M]
Depends on: P4-T07b
Goal: step two, and what happens to a blocker afterwards (METHOD.md §7.3).
Deliverables: the blocker step with the five-type picker showing each type's definition, the owner, the next action, the twenty-four hour clock and the escalation notice at the critical threshold; the blocker table, board and aging.
Test plan: a low score cannot pass without a type, an owner and an action; a blocker's due time is its opening plus the workspace clock; a confidence at or below the critical threshold escalates immediately.
Acceptance: Given a key result scoring below the threshold, when the coordinator continues, then it is refused until that key result has a blocker type, a named owner and a next action, and the clock starts on save.

### P4-T08: Weekly session: commitments, digest, streaks [M]
Depends on: P4-T07c
Goal: steps three and four (METHOD.md §7.2).
Deliverables: the commitment table with the previous week closed as delivered or not and the new week set with owner and linked key result; the digest engine assembling the headline with its change on last week, on track, at risk, blockers and commitments; the coordinator note; publishing to the in-app feed and email now and to chat in Phase 5; the streak engine with break-on-skip and the streak ribbon; the twelve-week confidence trend; the space home before the session.
Test plan: closing a session rolls this week's commitments into next week's list to close; a skipped week breaks the streak and a held one extends it; the digest content matches the session record exactly.
Acceptance: Given a completed session, when it closes, then the digest is generated with correct figures, the streak advances, last week's commitments are closed and this week's are open.

### P4-T09: Monthly review and decision log [M]
Depends on: P4-T08
Goal: the monthly ritual (METHOD.md §7.5, screen S-23).
Deliverables: the objective trend record; the dependency and risk log view; the decision table where every decision names the key result or goal it affects, with the log surfaced on the goal page and in the cycle workspace.
Test plan: a decision naming neither a key result nor a goal is refused; a trend recorded twice corrects the first rather than storing two; the trend is never pre-filled from the §3.7 signal. (Added at P4-T09: the card shipped without a test plan line, which is a Definition of Ready gap, and the next reader should meet the corrected card rather than the original omission.)
Acceptance: Given a monthly review recording a decision against a key result, when the goal page is opened, then the decision appears in its history with its date and author.

### P4-T10a-a: Quarterly review: the eleven-stage shell [M]
Depends on: P4-T09
Goal: the rail and the pacing (METHOD.md §8.1, screen S-24).
Reference mockup: [08-quarterly-review](../stakeholder/mockups/png/08-quarterly-review.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: quarterly stage keys in `packages/method` beside the weekly ones; the eleven-stage state machine with its per-stage completion gate; the session shell with the rail grouped by act; the lap bar segmented by duration; the stage timer with pacing cues and an add-a-minute control; private facilitator notes per stage; live stage synchronisation.
Test plan: stage changes reach every connected client inside the budget; facilitator notes are never visible to a participant.
Acceptance: Given a running review, when the facilitator advances a stage, then every participant's rail moves and the timer restarts.

### P4-T10a-b: Quarterly review: the room pulse [S]
Depends on: P4-T10a-a
Goal: stage one's own content (METHOD.md §8.2, screen S-24).
Deliverables: the `session_participants` table with its row-level security policy; `roomPulseRead` in `packages/method` with the §8.2 bands and reads under the conformance suite; the pulse picker with one word per participant; the average read shown to the facilitator only.
Test plan: the read comes from `sessions.roomPulseBands` and not from a literal; a participant sees their own pulse and never the room's read.
Acceptance: Given every participant has given a pulse, when the facilitator opens the read, then the average and the §8.2 sentence for its band are shown.

**Why P4-T10a was split.** It carried the shell, the pacing, a new table, a new
method function with its conformance, and stage one's whole content in one [M].
The shell alone satisfies the acceptance criterion and both test-plan lines; the
room pulse is separable work with its own criterion. Split at P4-T10a on
21 August 2026, before code was written.

### P4-T10b-a: Quarterly review: scoring the key results [M]
Depends on: P4-T10a-a
Goal: the grading half of the scoring stage (METHOD.md §8.3).
Deliverables: the `review_scores` table with its row-level security policy; the objective score and the cycle score in `packages/method` under the conformance suite; the slider, the baseline/target/actual evidence and the one-line reason per key result; scores written back to the key results when the session closes.
Test plan: a score is refused outside 0.0 to 1.0 and refused without a reason; scores written here land on the key results on close, and not before.
Acceptance: Given a review at the scoring stage, when every key result of an objective has a score and a reason, then the stage may be completed and the scores are on the key results once the session closes.

### P4-T10b-b: Quarterly review: the reveal [M]
Depends on: P4-T10b-a
Goal: the reveal (METHOD.md §8.3).
Deliverables: the objective score hidden until the room reveals it; the reveal as one write every connected client reads the same answer from; the animated reveal that is instant under reduced motion; the running cycle score with its §3.4 verdict.
Test plan: the reveal is deterministic and instant under reduced motion; no caller can read an objective's score before it is revealed.
Acceptance: Given a review at the scoring stage, when the facilitator reveals an objective's score, then every participant sees the same number at the same time and the cycle score updates.

**Why P4-T10b was split.** It carried a new table, two new method functions with
their conformance, four actions, a write-back on close, and a screen with
sliders, evidence, a hidden score and an animation, in one [M]. Grading and
revealing are separable: the grading half has its own criterion and its own
test-plan line, and the reveal is what the original acceptance criterion is
about. Split on 21 August 2026, before code was written.

**A practice gap found while sizing it.** METHOD.md defines the score bands
(§3.3) and the portfolio average (§3.4) but never says how an objective's own
score is computed from its key results. §3.2 makes a goal's *progress* a
weighted average through `key_results.weight`. Agung decided on 21 August 2026
that the objective score follows §3.2 and is weighted, while the cycle score
stays the plain average §3.4 states. **METHOD.md §8.3 carries that sentence as of
24 August 2026**, written at Agung's direction and open to his review in the pull
request: the canon and the package now say the same thing, which is what lets the
conformance suite hold it.

### P4-T10c: Quarterly review: narratives and recognition [S]
Depends on: P4-T10b-a
Goal: the two stages that are about people rather than numbers (METHOD.md §8).
Deliverables: the narratives stage with the pass-the-mic control; the recognition stage.
Test plan: the mic passes to exactly one participant at a time and every client agrees who holds it.
Acceptance: Given a narratives stage, when the facilitator passes the mic, then every participant sees who is speaking.

### P4-T11a: Quarterly review: the retros [M]
Depends on: P4-T10c
Goal: the second act's first half (METHOD.md §8.4, §8.7).
Reference mockup: [08-quarterly-review](../stakeholder/mockups/png/08-quarterly-review.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the team retro with prompt chips, two columns, sticky notes and dot voting; the management retro with its four §8.7 questions.
Test plan: a dot vote cannot be spent twice by one member; the two retros are visible to different audiences.
Acceptance: Given a team retro with three notes, when members vote, then the top-voted note is identifiable and each member's votes are capped.

### P4-T11b: Root cause and the process-health survey [M]
Depends on: P4-T11a
Goal: why it went the way it did (METHOD.md §8.4, §8.5).
Deliverables: the root-cause stage listing every key result below the threshold with the eight-cause picker and a detail field; the anonymous process-health survey with live averages and response counts, using the §8.5 statements.
Test plan: a process-health response cannot be attributed to a member and cannot be submitted twice; every key result below the threshold appears in the root-cause list.
Acceptance: Given a survey with four responses, when the averages render, then no response can be traced to a member and the count reads four.

### P4-T11c-a: The diagnostic and the reset decisions [M]
Depends on: P4-T11b
Goal: §8.6's verdict and §8.8's close decisions (METHOD.md §8.6, §8.8).
Deliverables: the rhythm diagnostic rendered from P4-T01f with its verdict and prescription, stored with the numbers it was read against; keep, modify and abandon per objective with the §8.8 meaning of the chosen decision and a required why.
Test plan: the diagnostic verdict matches METHOD.md §8.6 across the three cases; one decision per objective with a why that cannot be empty.
Acceptance: Given a cycle score below the threshold and a rhythm score above it, when the diagnostic renders, then it reads as a strategy or quality problem with the specific figures, and the prescription says to fix the key results before pushing the team.

### P4-T11c-b: Learnings, next-cycle drafts, decisions and actions [M]
Depends on: P4-T11c-a
Goal: the rest of the third act (METHOD.md §8.9).
Deliverables: learnings with promotion from top-voted retro themes and carry-forward flags; next-cycle drafts; decisions and actions with owner and due date.
Test plan: a top-voted retro theme promotes into a learning; an action with no owner or no date is refused. **The lowest process-health statement becoming an issue in the next cycle moved to P4-T12**, which is titled "Minutes, exports and review feed-forward" and owns §8.9's mapping into `cycle_issues`; this row builds the tables that mapping reads.
Acceptance: Given a closed review with a carried learning, when the next cycle opens, then that learning is in its input pack and the carried item is a strategic issue at impact 4.

**Why P4-T11c was split.** It carried five tables (`review_diagnostics`,
`review_decisions`, `learnings`, `next_cycle_drafts`, `review_actions`), four of
§8.1's eleven stages, roughly ten actions and four panels in one [M]. P4-T11a
was already at the size limit with three tables and two panels, and this was
half again as large. Split on 26 August 2026, before code was written, at the
line §8 itself draws: §8.6 and §8.8 are the verdict and the close, §8.9 is the
feed-forward into the next cycle.

**One test-plan line moved and one is unmet.** "A keep, modify or abandon
decision writes back to the goal on close" is not met by P4-T11c-a and the row
says so: `goals_close_is_complete` (migration 0022) holds that a close carries
`closed_at`, `success_status` and `close_decision` together or none of them, so
writing the decision alone is refused by the schema. Closing the objective from
the review would mean deriving a success status and inventing a retrospective
body, because `closeGoalInTx` requires both and stage nine collects neither.
The decision lives in `review_decisions`; whether `goals.close` should read it,
or the review should close objectives outright, is an open question on the
P4-T11c-a row.

### P4-T12-a: The minutes and their exports [M]
Depends on: P4-T11c-b
Goal: the artifact (METHOD.md §8.10, screen S-25).
Deliverables: the minutes document with the executive summary and every stage's record; Markdown and PDF export; a link from the review to its minutes.
Test plan: the minutes carry every stage that recorded something; the facilitator's private notes are absent; the management retro is absent for a reader outside its audience; both exports answer with the right content type.
Acceptance: Given a review that recorded every stage, when a member opens the minutes, then the executive summary reads §8.10's seven figures and both exports download.

### P4-T12-b: Review feed-forward into the next cycle [M]
Depends on: P4-T12-a, P3-T15
Goal: the handover (METHOD.md §8.9).
Deliverables: the two §8.9 rows `cycles.feedForward` reports as waiting, filled: learnings and the retrospective into the next cycle's input pack, and the lowest process-health statement as an issue; carried learnings joining carried key results as issues at impact 4.
Test plan: a carried learning becomes an issue at impact 4; the lowest process-health statement becomes an issue with source `process_health`; the feed-forward is idempotent, so running it twice does not double the issues.
Acceptance: Given a closed review with a carried learning, when the next cycle is fed forward, then that learning is a strategic issue at impact 4, the lowest process-health statement is an issue with source `process_health`, the learnings are in §2.6's item two, and the `waiting` list is empty.

**Why P4-T12 was split.** The minutes are a read across twelve tables, a screen
and two export routes; the feed-forward is a change to `cycles.feedForward`,
which P3-T15 already built with a `waiting` list naming the two rows it could
not fill. Two separable pieces with separate acceptance criteria, split on
26 August 2026 before code was written.

**The feed-forward is pulled, not pushed, and §8.10 is why.** "Hold the review
before drafting the next cycle's OKRs, never in the same session" means the next
cycle usually does not exist when the review closes, so a push on close would be
a no-op in the normal order. `cycles.feedForward` already takes a `fromCycleId`
and a `toCycleId` and runs when the next cycle is created, which is the only
shape that works. The original acceptance criterion said "when the facilitator
closes it... the next cycle's Phase 2 already holds the scores", and that is
corrected above.

### P4-T13a: The embedding table and the outbox worker [M]
Depends on: P2-T15
Goal: workspace content, embedded and kept current (AI-NATIVE-PLAN.md §9).
Deliverables: the pgvector extension and the embedding table with an appropriate index and its row-level security policy; the outbox-driven worker chunking and embedding goals, key results, check-ins, blockers, sessions, documents, comments and cycle artifacts, keyed by content hash; local embedding support.
Test plan: re-embedding is skipped when the content hash is unchanged; the worker is driven only by outbox rows; the chunker terminates on every input including one shorter than the overlap.
Acceptance: Given a goal edited twice with the same text, when the worker runs, then it embeds once.

### P4-T13b: Access-filtered retrieval [M]
Depends on: P4-T13a
Goal: retrieval that cannot leak (AI-NATIVE-PLAN.md §9).
Deliverables: hybrid retrieval combining vectors and full text, filtered through the access getter; degradation to full text where vectors are unavailable.
Test plan: retrieval never returns a chunk the requester cannot read; with the extension absent the product still answers using full text.
Acceptance: Given a private space's check-in, when a non-member asks a question that would match it, then no chunk from it is retrieved or cited.

### P4-T14a-a: Copilot threads and grounded answers [M]
Depends on: P4-T13b
Goal: the assistant, answering (screen S-39), with no interface yet.
Deliverables: threads and messages anchored to the workspace or an entity; grounded answers over access-filtered retrieval with citations only to what the viewer may see; the AI-off answer, which is the passages and no prose.
Test plan: a citation never points at something the viewer cannot read, proved both by construction and at read time; a question with the provider off is recorded and answered with what retrieval found.
Acceptance: Given a member asking about their goals, when the copilot answers, then every citation resolves to something they can open, and a source deleted afterwards stops being shown without the answer changing.

### P4-T14a-b: The copilot panel [M]
Depends on: P4-T14a-a, P1-T07
Goal: the assistant, on screen (screen S-39).
Deliverables: the side panel; the answer streaming token by token; a stop control that ends the stream and leaves the thread readable; the empty, AI off and capped states; the thread list and the entry point the panel opens from.
Test plan: the stop control ends the stream and leaves the thread readable; the panel offers no box to type in when no provider is configured, and says why.
Acceptance: Given a member stopping an answer halfway, when they reopen the thread, then what had arrived is there, marked as stopped, and the conversation can continue.

**Why P4-T14a was cut in two.** One [M] carried the schema, the retrieval
grounding, the citation guarantee, a streaming side panel, a stop control and
three screen states. The two halves also need different things: the answering
half is a contract and a guarantee, and the panel half is streaming, which no
single transactional write can do. Cut on 26 August 2026, and the shape of the
cut is what made the transaction boundary visible: see `actions/copilot.ts`.

### P4-T14b-a: Copilot proposals [M]
Depends on: P4-T14a-b
Goal: the assistant, writing, and always as a proposal.
Deliverables: a curated catalogue of actions the copilot may propose, with the model authoring fields only and never an identifier; proposals rendered as a preview with apply, dismiss and an AI provenance chip; applying through the normal Operation as the member; an undo for every action that has a reverse.
Test plan: a proposal the user lacks permission to apply is refused by the permission layer, not hidden by the interface; a model naming an action off the catalogue, indexing past a list it was shown, or writing a field the schema refuses produces no proposal at all.
Acceptance: Given a member asking the copilot to create a goal, when they approve the proposal, then the goal is created through the normal Operation with audit, an AI provenance chip and a working undo.

### P4-T14b-b: Copilot background runs [M]
Depends on: P4-T14b-a, and on a host that consumes the outbox
Goal: work the copilot cannot finish inside one request.
Deliverables: long tool runs executing as background jobs and streaming back over realtime; a run that survives a page reload and reattaches.
Test plan: a background run survives a page reload; a run whose budget is spent halts and says so.
Acceptance: Given a member asking for something that takes a minute, when they reload the page, then the run is still going and they rejoin it.
**Blocked, and the reason is not in this row.** Nothing in the application constructs `OutboxRelay` or a jobs adapter, so a job this row enqueues would never be picked up. See PLAN.md §12's risk entry. Do not start this row before a host exists.

**Why P4-T14b was cut in two.** One [M] held a proposal catalogue, a preview, an apply path, an undo, *and* background job execution over realtime. The two halves also differ in whether they can be built at all: the proposal half is code, and the background half needs a worker host the product does not have. Cut on 26 August 2026, and the second half is marked blocked rather than left to be discovered mid-session.

**`goals.delete` arrived with the first half.** The acceptance criterion asks for a working undo after a proposal creates an objective, and the registry had no reverse for `goals.create`: `goals.close` is the end of a cycle, with an outcome and a retrospective, and using it as an undo would file a false report about a quarter. Agung approved adding a soft delete at `full` on 26 August 2026.

### P4-T15a: Planning and drafting assists [M]
Depends on: P4-T14b-a, P4-T06c
Goal: AI-NATIVE-PLAN.md §2.1's write capabilities on the Phase 3 drafting surfaces.
Deliverables: draft an objective and its key results from a plain-language ambition; suggest metrics, units, baselines and targets for a key result; suggest the alignment parent by meaning. Each behind a feature switch, with provenance recorded and a preview before applying.
Test plan: every assist is absent with the provider off and the deterministic path is unchanged; a suggestion is a proposal and never a write; the suggested alignment parent is one the member may read.
Acceptance: Given the provider off, when a member opens the create form, then no assist is offered and the Draft Coach behaves exactly as it does today.

### P4-T15b-a: The digest and the trend [M]
Depends on: P4-T15a
Goal: AI-NATIVE-PLAN.md §2.2's two narrations, over deterministic paths that exist.
Deliverables: METHOD.md §7.2 step 4's weekly digest as a deterministic template in `packages/method` and the read that assembles it; the assist that narrates it; the KPI trend narration with its anomalies. Both behind their own feature switch, both refused when the prose states a number the product did not compute.
Test plan: the deterministic digest template is what appears with the provider off; a narrated trend never states a number the chart does not hold; a narration that invents a figure is dropped and the template stands.
Acceptance: Given a weekly session with a digest, when the assist drafts it, then the draft is a proposal over the deterministic template and the template is still what a provider-off workspace gets.

### P4-T15b-b: The blocker summary and the KPI suggestion [M]
Depends on: P4-T15b-a
Goal: AI-NATIVE-PLAN.md §2.2's other two capabilities.
Deliverables: a space-wide read of open blockers and risks ranked by age and impact, which does not exist yet, and the assist that summarises it; KPIs, thresholds and formulas suggested from plain language, with the formula validated by the §6 expression parser before it is offered.
Test plan: the ranking is the product's and not the model's, so the summary cannot reorder it; a suggested formula that does not parse is refused rather than offered.
Acceptance: Given a space with four open blockers of different ages, when the assist summarises them, then the order is the deterministic ranking and every blocker in the summary is one of the four.

**Why P4-T15b was cut in two.** Four assists, and two of them had no deterministic path to sit on top of: the weekly digest was stored as five numbers with nothing rendering them, and there was no space-wide blocker read at all. So half this row was building the thing the assist assists with. Cut on 26 August 2026 along that line: the two narrations whose deterministic paths could be finished in one session, then the two that need new reads first.

### P4-T15c: Review assists [M]
Depends on: P4-T15b-a, P4-T12-a
Goal: AI-NATIVE-PLAN.md §2.3's capabilities on the quarterly review.
Deliverables: cluster retro notes into themes before dot voting; draft the review minutes from the session record; narrate the rhythm diagnostic with specifics from this cycle; draft the goal retrospective from check-in history; propose next-cycle objectives from the learnings marked to carry forward.
Test plan: the diagnostic's verdict sentence is unchanged with the provider off and the narrative is additive; clustering never merges notes from two reviews; a proposed objective cites the learning it came from.
Acceptance: Given a closed review, when the diagnostic narrative is drafted, then the §8.6 verdict and prescription are identical to the provider-off answer and the narrative sits beside them.

### P4-T15d: The list filter assist [S]
Depends on: P4-T15a
Goal: AI-NATIVE-PLAN.md §2.4's filter capability.
Deliverables: the goals explorer's filter grammar extended with §3.2's health band and a whose-are-they filter, both working with no provider; a sentence turned into a validated filter over that grammar, refused with the reason rather than approximated when it does not fit.
Test plan: a sentence that cannot be expressed in the filter grammar is refused with the reason, not silently narrowed; the manual filters are unchanged with the provider off.
Acceptance: Given a member typing "my off-track goals this quarter", when the assist runs, then the explorer's own filter state is set and visible as filters they can edit.

**Why P4-T15 was cut into four.** Its single [M] listed thirteen distinct
assists across all four groups of AI-NATIVE-PLAN.md §2, each needing a feature
switch, provenance and a preview. That is a lane, not a session. Cut on
26 August 2026 along §2's own group boundaries rather than an invented grouping,
so each row maps onto one section of the capability catalogue.

**Two of the thirteen had already landed, and the list restated them.** "Rewrite
a failing objective or key result to satisfy its rule" is `goals.rewriteKeyResult`
from P4-T06c. "Draft the overdue check-in from real activity" is
`goals.publishDraftedCheckIn` from P4-T05c-b. Both are dropped from the rows
above rather than left in to be built twice.

**Three more of the thirteen belong to other phases** and are not in these rows:
decomposing a key result into initiatives and tasks is Phase 5's work,
grounded question answering with citations is P4-T14a-a, and mapping spreadsheet
columns to import fields is P6-T01.
Test plan: every assist degrades to its manual path with AI off; every write assist renders a preview and commits nothing until applied; provenance is recorded on the resulting value.
Acceptance: Given a key result failing the measurability rule, when the champion uses the rewrite assist, then a corrected version is proposed with the rule it now satisfies, and applying it clears the verdict.

**Phase 4 exit:** the method package is the single source of every rule with a passing conformance suite; the Draft Coach evaluates live inside budget and the publish gates are enforced server-side; the nudge engine fires, deduplicates, escalates and stays under its volume ceiling; both agents run on schedule and are fully functional in their deterministic form with AI off; both sessions run end to end with live synchronisation; the diagnostic, the minutes and the feed-forward work; the copilot and the assists are live behind switches with previews and provenance.

---

# Phase 5: Reach: channels, agents, work

Getting the coach to where people are, opening the product to external agents, and adding the work layer. Starts with a design gate.

### P5-T00: Reach design gate [DESIGN GATE] [M]
Depends on: Phase 4 complete
Goal: the design documents for channels, the external agent surface and the work layer.
Deliverables: design documents covering the channel port and per-provider capability matrix, the conversational check-in and blocker flows per provider, identity linking and inbound security; the authorisation server and tool catalogue; and the work layer (initiatives, tasks, board ordering and the key result linkage semantics).
Acceptance: the human approves with an explicit statement.

### P5-T01a: The outbox relay host [M]
Depends on: P5-T00
Goal: something actually delivers what every write enqueues.

**Why this is a separate row.** P5-T01 was cut as one task on the assumption that a relay host existed. None does: `OutboxRelay` has been in `packages/adapters` since P1-T07 and nothing has ever constructed one, so every outbox row written since Phase 2 is still sitting in the table. No invitation email has been sent, no session event has reached a second browser, nothing has been indexed. Routing a nudge to a channel through a queue nobody drains would have shipped a second layer of undelivered work on top of the first, and the channel task is [L] before it absorbs any of this.

Deliverables: a dispatch table in `packages/core` mapping every enqueued topic to a handler, with dependencies taken as plain functions so it stays out of `packages/adapters`; handlers for embedding, invitation email and the three session realtime events; a permanent-failure error that dead-letters a row on its first attempt rather than retrying what cannot work; the host itself, started at boot from the web process, with `OPENOKR_RELAY=off` for an operator who wants one dedicated drainer.
Test plan: a topic with no handler dead-letters at once while an ordinary failure still retries; a handler whose dependency is absent skips rather than fails, so an instance with no SMTP collects no dead letters; an invitation written by the real action produces the email a member would receive; a build worker does not start a relay; a test proves every `topic:` literal in the action sources has a handler.
Acceptance: Given a fresh instance with mail configured, when an owner invites an address, then the invitation email is sent without anybody running a command, and PLAN.md §12 R10 is closed.

### P5-T01b-a: Channel connections, the email driver and the message log [M]
Depends on: P5-T01a, P4-T04c
Goal: a workspace can hold a channel connection and a member can hold an identity, and one driver actually sends.

**Why P5-T01b was cut in two.** The row carried a port, a driver, three tables with their policies, envelope-encrypted credentials, per-member primary channel and quiet hours, routing with fallback, a message log and a degrading message builder. That is two sessions of work, and the acceptance criterion belongs entirely to the second half. Split at the seam the design already draws: what a channel *is* (tables, driver, log) before what the product *decides* (routing, quiet hours, degradation).

Deliverables: migration for `channel_connections`, `channel_identities` and `channel_messages` with forced row-level security and both unique constraints on identities; envelope-encrypted credentials in the shape `ai_credentials` already uses; the email driver against the existing `Channel` port, with one-click action links standing in for buttons; the message log with `(workspace_id, idempotency_key)` unique, which is what makes a relay retry safe; registry actions to read and manage a connection and to link and unlink an identity; a channel outbox topic delivered by P5-T01a's dispatch table.
Test plan: the same message delivered twice writes one row and sends once; a connection's credentials never appear in a read action's output; an identity is unique both ways, so a second member cannot claim an external id and a member cannot hold two identities on one provider; the email driver renders buttons as links; every table refuses a cross-workspace read.
Acceptance: Given a workspace with mail configured, when a message is sent to a member through the channel port twice with the same idempotency key, then the member receives it once and `channel_messages` holds exactly one row.

### P5-T01b-b: Routing, quiet hours and the message builder [M]
Depends on: P5-T01b-a
Goal: every nudge, digest and escalation reaches the member's chosen channel.
Deliverables: `resolveDelivery` with AI-NATIVE-PLAN.md §5.4's five-step order; per-member primary channel and quiet hours with working defaults; the in-app notification written whatever the channel decides; the message builder degrading to text plus appended links where a capability is missing; the one-time reconnect notice as a nudge with its own rule key.
Test plan: a nudge routes to the member's primary channel and falls back to email when it fails; an unlinked member falls back to email and in-app; the log records every send with its outcome; a member inside quiet hours has the message queued to the next open window, and an urgent escalation is sent anyway.
Acceptance: Given a member whose primary channel is unreachable, when a nudge is delivered, then it arrives by email, the failure is logged, and the member is told once that their channel needs reconnecting.

### P5-T01c: The session entry point [S]
Depends on: P4-T10b
Goal: a member can reach a session without typing a URL.

**Why this is a row at all.** S-22 to S-25 were built across P4-T07 to P4-T10 and nothing in the navigation links to any of them. `/session/<id>` is reachable only by typing it, so every session feature this product has is invisible to the people it was built for. Raised twice during Phase 4 and answered on 27 August 2026.

Deliverables: a session list showing scheduled, running and closed sessions for the spaces the member can read; an entry point from the space page and from the dashboard; the running-session state visible from the list so a facilitator can rejoin; loading, empty, error and permission-denied states.
Test plan: a member sees only sessions in spaces they can read; a running session is distinguishable from a scheduled one in the list; a member with no sessions sees an empty state that says how one is created.
Acceptance: Given a member with a session scheduled in their space, when they open the product, then they can reach that session in two clicks without knowing its identifier.

### P5-T02a: The Slack driver and its inbound door [M]
Depends on: P5-T01b-b
Reference mockup: [09-channels](../stakeholder/mockups/png/09-channels.png). Reference, not authority: UIUX-PLAN.md §10.
Goal: Slack can be connected, a member can prove their account, and messages travel both ways.

**Why P5-T02 was cut in two, and the ordering defect it exposed.** P5-T02's acceptance criterion is a check-in completed in a Slack modal. That needs the command router, and the router is P5-T06's own deliverable ("one router, generated from the action registry", `docs/design/p5-t00-channel-design.md` §7), which this plan schedules *after* P5-T02. So P5-T02 as written could not be finished without building P5-T06 inside it, and a Slack-only router is the wrong shape for four providers. The driver half needs none of it.

Deliverables: the Slack driver against the existing `Channel` port, with Block Kit rendering, direct messages and space channel posts; self-serve installation through OAuth with the bot token stored as an envelope-encrypted connection; identity linking by a short code that is hashed, single-use and expiring; the inbound endpoint with AI-NATIVE-PLAN.md §6's first six steps, signature over the raw bytes before anything is parsed, the replay window, delivery-id deduplication, verified-identity resolution, the suspended-member check and the per-member rate limit; the connection health card.
Test plan: a tampered signature is refused before parsing and nothing is written; a payload outside the replay window is refused; a repeated delivery id is ignored as a duplicate; an unlinked sender receives nothing at all; a suspended member receives nothing; the driver's `capabilities()` matches the core matrix; buttons render as Block Kit actions.
Acceptance: Given a workspace with Slack connected and a member who has linked their account, when a nudge is delivered to them, then it arrives as a Slack message with its action buttons, and `channel_messages` holds one row naming Slack.

### P5-T02b: Slack buttons and the modal check-in [S]
Depends on: P5-T02a, P5-T06a, P5-T06b
Goal: a champion can complete a check-in without leaving Slack, in one form rather than four messages.

**Smaller than [M] now, because most of what this row listed has already shipped.** P5-T06a delivered the slash command rendered from the router, §6's steps seven and eight, the refusal being the browser's own sentence, the unknown-command reply, and the audit entry naming the channel. P5-T06b delivered a check-in completed across turns, which already works on Slack. What is left is the two things only a provider with a modal can do.

Deliverables: nudge buttons that are Slack actions rather than links, so pressing "Check in" on a nudge starts the flow in the conversation it arrived in; the modal, opened on a slash command where the provider offers one, with status, confidence and narrative in one form; the submission handled as one registry action.
Test plan: a check-in submitted from a modal produces the same record as one from the conversational path and from the browser, with the channel on its audit row; a payload with no trigger falls back to the conversation rather than failing; a submission whose fields are missing is refused without writing anything.
Acceptance: Given a champion with a due check-in, when they receive the nudge in Slack and complete the modal, then the check-in is published, the cadence advances and the reviewer's obligation is created, identically to the browser path.

### P5-T02c: The channel settings surface [M]
Depends on: P5-T02a
Reference mockup: [09-channels](../stakeholder/mockups/png/09-channels.png). Reference, not authority: UIUX-PLAN.md §10.
Goal: an administrator can connect a provider, and a member can link their account, without an engineer.

**Why this is a row rather than part of P5-T02a.** That task shipped the driver, the inbound door, the linking mechanism and the routing wiring, and left the surface out. Two reasons, both recorded there: the self-serve OAuth half cannot be exercised at all without a Slack app, and it would have stood between an administrator and a screen that did not exist either. The mechanism is real and nobody can reach it, which is not shipped. This row is the reaching.

Deliverables: the notifications-and-channels card in workspace admin (UIUX-PLAN.md §6 S-36) listing each provider with its state, when it last verified, and the provider's own last complaint; connect and disconnect, with the credential written once and never read back; a test send that proves the connection without waiting for a nudge; the member's own channel card with a primary-channel choice, quiet hours, and the short-code linking flow; the recent message log with its outcomes; loading, empty, error and permission-denied states on both.
Test plan: a member without workspace administration sees the permission-denied state and not the card; a connected provider shows its state and never its credential; a test send writes one log row; a member issues a code, and the code is shown once and not stored; disconnecting removes the provider from the list and frees its installation.
Acceptance: Given a workspace administrator with a Slack bot token, when they connect Slack and a member links their account from their own settings, then a nudge for that member arrives in Slack, and neither screen has ever displayed the token.

### P5-T03a: The Teams driver and its inbound door [M]
Depends on: P5-T01b-b
Goal: Teams reachable, in and out, on the same router every other provider uses.
Reference mockup: [09-channels](../stakeholder/mockups/png/09-channels.png). Reference, not authority: UIUX-PLAN.md §10.

**Cut in two along the same seam Slack was.** P5-T02a built a driver and an
inbound door, and P5-T02b built what only a provider with a rich surface can do.
Teams divides the same way: getting a message in and out of Teams at all is one
session, and adaptive cards with actions on them is another. The acceptance
criterion belongs to the second, because a card with a blocker's age and a
reassign action is a card.

Deliverables: the `TeamsChannel` driver with no vendor SDK, sending through the Bot Framework with a client-credentials token; the tenant's service URL learned from inbound and held on the connection, because Teams gives no way to open a conversation without one; inbound verification of Microsoft's signed token against its own published keys, including the audience, the issuer and the service URL the token binds; the installation row so an inbound activity can find its workspace before a tenant is known; identity linking through the existing code flow; the application manifest and the runbook for installing it; the connection form on the channel settings screen.
Test plan: a token signed by the wrong key, for the wrong audience, from the wrong issuer, past its expiry, or naming a different service URL is refused, and each for its own reason; a message from an unlinked sender is answered with silence; the same command typed in Teams reaches the same registry action as in Slack.
Acceptance: Given a workspace with Teams connected and a member linked, when they type a command in Teams, then it is refused or acted on exactly as the same command in Slack, and the attempt is audited with the channel named.

### P5-T03b: Adaptive cards and card actions [M]
Depends on: P5-T03a, P5-T06a
Goal: a nudge that can be acted on where it arrives.
Deliverables: the adaptive card rendering for a nudge, with the card's actions carrying the same command scheme the Slack buttons and the Telegram keyboard already use; the blocker escalation card with the blocker, its age and the actions to reassign or resolve; card action payloads handled through the one inbound door; posting to a channel as well as to a person.
Test plan: a card action reaches the same registry action a typed command does; a card whose action does not fit the scheme is sent as a link rather than a broken button.
Acceptance: Given a Teams-connected workspace, when a blocker escalates, then the coordinator receives an adaptive card in Teams with the blocker, its age and an action to reassign or resolve.

### P5-T04a: The WhatsApp driver and its inbound door [M]
Depends on: P5-T01b-b
Goal: WhatsApp reachable, in and out, on the same router every other provider uses.
Reference mockup: [09-channels](../stakeholder/mockups/png/09-channels.png). Reference, not authority: UIUX-PLAN.md §10.

**Cut in two, the same way Slack and Teams were, and along a line this provider
draws itself.** Sending and receiving a WhatsApp message is one session. The
conversation window is a different problem: it decides *what may be sent at all*
rather than how it looks, it needs the last inbound moment recorded per member,
and it needs a registry of approved templates whose home is an open question
(design C3). Building the door first means the window is not held up by it, and
the acceptance criterion belongs to the window because a template is what it is
about.

Deliverables: the `WhatsAppChannel` driver over the Cloud API with no vendor SDK; inbound verification of Meta's HMAC signature over the raw body; the webhook verification handshake, which is a GET and therefore the one inbound path that is not a message; the installation row keyed on the phone number id, so an inbound message finds its workspace before a tenant is known; identity linking through the existing code flow; the connection form and the setup runbook.
Test plan: a body whose signature does not match is refused before it is parsed; the verification handshake answers only for the right token; a message from an unlinked sender is answered with silence; a command typed in WhatsApp reaches the same registry action as in Slack.
Acceptance: Given a workspace with WhatsApp connected and a member linked, when they type a command, then it is refused or acted on exactly as the same command in Slack, and the attempt is audited with the channel named.

### P5-T04b-a: Syncing Meta's approved templates [M]
Depends on: P5-T04a
Goal: the product knows which templates this workspace actually has.

**Design C3 is corrected here, and the correction came from the human on 29
August 2026.** C3 put a per-nudge-kind template registry in `packages/method`,
"because a template is a coaching message and §11 already owns those". Two
things are wrong with that. §11 is the *threshold* registry, which holds numbers
rather than words. And a template is not canon at all: it is registered and
approved inside one customer's own Meta Business account, so two workspaces
cannot share one and no document could name them for everybody. Templates are
therefore synchronised *from* Meta rather than declared, which is what this row
builds.

Deliverables: the WhatsApp Business Account id, learned from an inbound webhook the way the Teams service URL is, because the body already carries it; the `whatsapp_templates` table with its row-level security; the driver's list call; the sync, run from the settings screen so the vendor call stays in the one place that may hold both a driver and the domain; the template list on the channel settings screen, showing each template's status and the variables it expects.
Test plan: a sync records every approved template and marks the rest by their status; a sync with no business account known yet says so rather than failing; a template that Meta has removed stops being offered; the variables a template expects are read from its body rather than guessed.
Acceptance: Given a workspace whose WhatsApp bot has received a message, when an administrator syncs, then the workspace's approved templates are listed with the variables each one expects.

### P5-T04b-b: The mapping, the variables and the window [M]
Depends on: P5-T04b-a, P5-T06b
Goal: the product may speak first, in words Meta approved, filled from its own data.
Deliverables: the per-rule-key mapping from a nudge to a chosen template; a binding per template variable, from a named source in the product's own data, so `{{1}}` becomes the member's name and `{{2}}` the goal's title; the last inbound moment recorded per identity, which is what the window is measured from; the builder told which side of the window it is on rather than assuming; template sending with its parameters; the conversational check-in reached from a template reply.
Test plan: an outbound message outside the window uses the mapped template with its variables filled; inside it, free form is used; a message outside the window with no mapping is not sent and says so; a mapping whose variable count does not match the template is refused when it is saved rather than when it is sent; a conversational check-in collects status, confidence, narrative and values across turns and can be abandoned safely.
Acceptance: Given a member whose primary channel is WhatsApp, when their check-in is due, then they receive the approved template, and replying walks them through the check-in conversationally to a published result.

### P5-T05: Telegram driver [M]
Depends on: P5-T01b-b
Goal: the lightweight provider.
Reference mockup: [09-channels](../stakeholder/mockups/png/09-channels.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: bot connection, identity linking with a verification code, outbound messages with inline keyboards, and inbound command and callback handling.
Acceptance: Given a Telegram-linked member, when they send the status command with a goal identifier, then they receive that goal's health, progress, confidence and next check-in date, subject to their permissions.

### P5-T06a: The command router and the one-line commands [M]
Depends on: P5-T02a
Goal: one command surface generated from the action registry (AI-NATIVE-PLAN.md §5.3).

**The dependency line on P5-T06 was backwards, and it is corrected here.** It read "depends on P5-T02, P5-T03, P5-T04, P5-T05", all four drivers, while P5-T02's own acceptance criterion needed the router. The design says the opposite of that line, "one definition, four renderings", so the router is what a driver consumes. It needs exactly one driver to be provable and P5-T02a is that driver. Each later driver inherits the surface rather than extending it, and the "identical across all four providers" test line grows as each one lands.

**Cut in two along a real seam: a command that is one line against a command that is a conversation.** Status, ask, acknowledge and snooze carry everything they need in the text somebody typed. Check in, blocker and commit collect fields, which on Slack and Teams is a modal and on WhatsApp and Telegram is §8's state machine across turns. Those are a different problem and they are P5-T06b.

Deliverables: the command catalogue as data, each command naming exactly one registry action and the access it needs; the parser turning one line into a command and its arguments, or a refusal that names what is available; resolution through `callAction`, so `can()` decides and the refusal is the sentence the browser shows; the channel named on the audit row of every inbound action, added once in the Operation pipeline rather than per action; the help reply, rendered from the catalogue so it cannot drift; the rate-limit reply for a linked member; the Slack endpoint wired to all of it.
Test plan: every command in the catalogue names an action the registry defines; a member without the access level gets the browser's own refusal and the attempt is audited with the channel on it; an unknown command names what is available rather than failing silently; the audit row carries the channel for an inbound action and does not for a browser one.
Acceptance: Given a member without edit access on a goal, when they attempt an action from chat, then it is refused with the same message the browser would show, and the attempt is audited with the channel named.

### P5-T06b: The conversational check-in [M]
Depends on: P5-T06a
Goal: a check-in can be completed from chat, across turns.

**Narrowed from "the three commands" to one, and the reason is in the actions.** `sessions.createBlocker` needs a session, a key result, a type, an owner and a next action; `sessions.setCommitments` needs a session and a list. Both are bound to a *running session*, and nothing in the design says how a chat message finds one: the sender names a key result, not a session, and resolving one from the other is a lookup the design never specifies. A check-in needs a goal and three answers, all of which a member can give from a phone. The other two are P5-T06c.

Deliverables: §8.1's state machine as a `channel_conversations` row, so a process restart does not lose somebody's half-finished check-in; the expiry as a §4.14 setting with a working default; §8.2's question order, status then confidence then narrative then each key result's value; abandoning on anything that is not an answer; resuming on the next message; nothing written until every required field is in, and then one registry action in one transaction.
Test plan: a conversation resumed after the row is re-read still holds its collected fields; an expired conversation starts again rather than completing with half its answers; a partial conversation leaves no check-in and the goal is still due; the completed check-in is the same record the browser produces.
Acceptance: Given a champion with a due check-in, when they complete it from chat, then the check-in is published, the cadence advances and the reviewer's obligation is created, identically to the browser path.

### P5-T06c: The session-bound chat commands [S]
Depends on: P5-T06b
Goal: a blocker and a commitment can be raised from chat.
Deliverables: resolving the running session for what the sender named, which is the piece the design leaves open; the blocker and commit commands over P5-T06b's state machine; the refusal when no session is running, which says so rather than failing.
Test plan: a blocker raised from chat is the same row the session screen writes; a member who names a key result with no running session in its space is told that rather than refused silently.
Acceptance: Given a running weekly session, when a participant raises a blocker from chat, then it appears on the session's own board with the channel on its audit row.

### P5-T07a: The REST surface and its tokens [M]
Depends on: P1-T07, Phase 4 complete
Goal: the registry reachable from outside the browser, on credentials of its own (TECHNICAL-PLAN.md §14).

**Cut in three along what each part can be used without.** This row listed five things: a REST surface, scoped tokens, a generated OpenAPI document, a generated command line, and a drift check. The seam is which of them a person can use on their own. A REST surface with tokens is usable the day it lands, with curl and nothing else. A generated document and a drift check need a surface to describe, and are worth their own row because the drift check is this task's acceptance criterion and a generator is only proved by one. A command line needs both and adds a device login, which is a flow rather than a projection.

Deliverables: the `api_tokens` table with tokens hashed at rest, audiences separated so a REST token is refused at the agent endpoint and the reverse, scopes, expiry, revocation and a last-used stamp; the pre-tenant lookup policy, because a token names its workspace and nothing else can before it resolves; minting, listing and revoking as registry actions, with the raw token shown exactly once; the personal token screen; the versioned route projecting every registry action, with the method derived from the safety class; the typed error enumeration; cursor pagination and the filter grammar declared on a read action rather than faked in the transport, so an action that has not declared them refuses the parameter instead of paging in memory.
Test plan: a token without write scope is refused on every write action; a token of the wrong audience is refused; a revoked or expired token is refused; a forbidden resource returns not-found; the raw token appears in no row; a paging parameter on an action that has not declared paging is refused by name.
Acceptance: Given a token minted with read scope only, when it is presented to any write action on the versioned surface, then the call is refused for scope before the action runs, and the refusal names the scope it needed.

### P5-T07b: The generated OpenAPI document and the drift check [M]
Depends on: P5-T07a
Goal: the surface described by something that cannot disagree with it.
Deliverables: the OpenAPI document generated from the registry's own schemas; `pnpm gen:contract`; the committed artifacts; the drift check comparing a regeneration against what is committed and naming the action that moved.
Test plan: the drift check fails when a registry action changes without regeneration, and the failure names the action.
Acceptance: Given a change to a registry action's schema, when continuous integration runs without regenerating, then the drift check fails naming the action.

### P5-T07c-a: The generated command line [M]
Depends on: P5-T07b
Goal: the same registry as a terminal tool.

**Cut in two, because the login is a protocol and the rest is a tool.** This row
listed a generated command line and a browser device login. The command line is
a generated artifact, a flag parser and an HTTP client, and it is usable the day
it lands with a token pasted from the account screen. A device login is a device
code table with its own row-level security, two endpoints, an approval screen and
a polling loop, which is a second session's work and reads as a protocol rather
than as a tool. Splitting them means the command line is not held back by it.

Deliverables: `contract/cli.json` generated from the registry beside the OpenAPI
document, in the same run and the same drift check; the `okr` command reading
that artifact and nothing else, so it needs no database and no domain code;
typed flags derived from each action's input schema, refused by name and by type
before any request is made; file inputs; named profiles holding a URL and a
token, with the token file readable only by its owner; the server's own typed
error carried through, so a revoked token says it was revoked.
Test plan: a flag whose type or enum the schema refuses fails before any request and names the flag; a profile with a revoked token reports that rather than a generic authentication error; a read is sent as a GET with query parameters and a write as a POST with a JSON body; the drift check fails when a registry action changes without regeneration, naming the command.
Acceptance: Given a token minted in the browser and stored in a profile, when a person runs a read command in a terminal, then it is sent as that member and the answer is printed, and a mistyped flag is refused before anything is sent.

### P5-T07c-b: The browser device login [M]
Depends on: P5-T07c-a
Goal: a terminal that has never held a token can get one without a copy and paste.
Deliverables: the device code table with its row-level security; the start and poll endpoints; the approval screen naming the scopes being asked for; the polling loop with its expiry and its refusal to grant more than was asked; `okr login` writing the granted token into the profile.
Test plan: the device login mints a token with the scopes it asked for and no more; an expired device code is refused; a code approved twice grants once.
Acceptance: Given a signed-out terminal, when a person runs the device login and completes it in the browser, then the profile holds a scoped token and the next command runs as them.

### P5-T08a: The grant, the codes and the token endpoint [M]
Depends on: P5-T07, P2-T09
Goal: the half of AI-NATIVE-PLAN.md §8.2 a client can hold a token from.

**Cut in three, along what a client can complete without.** The original row was one [L] task holding four separable things: the token machinery, the documents that let a client find it, the screen a person approves it on, and a client registry. Nothing in the second or third can be built before the first, and the first is provable on its own against a hand-registered client, which is exactly what the static allow-list is for. The parts are named here so the cut is visible rather than inferred from four commits.

Deliverables: the tables for clients, grants, codes and refresh tokens, every secret stored as a hash with a type prefix; the authorise endpoint's server half, issuing a single-use code against a PKCE challenge; the token endpoint with the authorisation-code and refresh-token grants; codes consumed in a transaction; short-lived access tokens; refresh rotation with reuse detection that revokes the whole lineage; resource binding validated at issue and on every use, so an API token is not an MCP token and the reverse; membership and suspension revalidated per use, with loss of membership revoking the grant; a static client allow-list, enough to complete the flow before registration exists.
Test plan: a replayed authorisation code is refused; a reused refresh token revokes the lineage; a code redeemed with the wrong verifier is refused; an API token presented at the agent endpoint is refused, and an MCP token at the REST endpoint is refused; losing membership invalidates the grant on the next call.
Acceptance: Given an external client holding a grant, when it presents a rotated-away refresh token, then the entire lineage is revoked and every token in it stops working.

### P5-T08b: Discovery, registration and the outbound-request rules [M]
Depends on: P5-T08a
Goal: a client that has been told nothing but the instance URL can find the server and register itself.

**The outbound-request rules land here, and they are not only this task's.** TECHNICAL-PLAN.md §11 requires every outbound fetch to validate the literal host and the resolved address, block private and metadata ranges, follow no redirects, and cap size and time. Nothing has needed one until now: the channel drivers call fixed provider hosts. A client metadata document is the first fetch of a URL somebody else chose, so the helper is built here and the AI base URL and webhook paths adopt it.

Deliverables: the outbound-request helper in `packages/adapters`, with its own tests; protected-resource metadata, authorisation-server metadata and OpenID configuration, each with the transport-suffixed variants and cross-origin preflight; the challenge on unauthorised responses pointing at the resource metadata; client metadata documents fetched through the helper; dynamic client registration; native-application redirect rules, with custom schemes allowed only to the callback path, dangerous schemes denied, and transport security required outside development.
Test plan: a metadata fetch of a private address is refused and named; a redirect is not followed; a registration with a dangerous redirect scheme is refused; an unauthorised call carries a challenge naming the resource metadata; each discovery document is served at its transport-suffixed path and answers preflight.
Acceptance: Given a client that knows only the instance URL, when it reads the discovery documents and registers itself, then it can complete the authorisation flow without an administrator having entered anything.

### P5-T08c: The consent screen and the connections list [M]
Depends on: P5-T08a
Goal: screen S-40, and the place a person sees and ends what they granted.

Deliverables: the consent screen, showing the client's identity, a workspace picker, the scopes in plain language, and approve or deny; the granted-connections list, with each client, its workspace, its scopes and its last use; a revoke control that ends the lineage; audit events for granting and revoking; the notice a person sees when a grant was revoked by reuse detection rather than by them.
Test plan: denying issues no code; a member of two workspaces picks one and the grant names the one they picked; revoking stops the next call; a lineage revoked by reuse detection appears in the list as revoked, and says why.
Acceptance: Given a user whose refresh token was replayed by a client, when they open their connections list, then the grant is shown as revoked, the reason is named, and no token in the lineage works.

### P5-T09a: The tool catalogue, resources and prompts [M]
Depends on: P5-T08a
Goal: everything an external agent can be offered, projected from the action registry.

**Cut in three, and the first part needs no protocol library at all.** The original row was one [L] task holding the transports, the session lifecycle, the catalogue, and two tools that are their own feature. The catalogue is a projection of the action registry exactly as `contract/openapi.json` and `contract/cli.json` are, so it is buildable, testable and pinnable before any transport exists, and the transport that follows has something real to serve. Agung approved `@modelcontextprotocol/sdk` as the agent protocol SDK on 30 August 2026, so P5-T09b is unblocked; the cut is about order, not permission.

Deliverables: the tool catalogue generated from the registry, one tool per action, carrying the JSON Schema of its input, its safety class as a read-only or destructive hint, the scope it needs, a summary and an example; read-only resource handles for a goal, a cycle, a scorecard, a KPI tree and a slice of the Work Map; the server-side prompt templates from AI-NATIVE-PLAN.md §8.3; the catalogue committed as an artifact with a drift gate, the same shape `check:contract` already uses; a catalogue invariant test that fails when a tool loses its safety classification.
Test plan: every tool names an action the registry defines and no action is missing without a stated reason; a destructive action carries the destructive hint and the destructive scope; the committed artifact matches a freshly generated one; removing a safety class fails the invariant test.
Acceptance: Given the action registry, when the catalogue is generated, then every tool carries its safety hint, its scope and its input schema, and the drift gate refuses a change that leaves them out of step.

### P5-T09b: The transport and the session [L]
Depends on: P5-T09a
Goal: an external agent can connect, negotiate and call (AI-NATIVE-PLAN.md §8.3).

Deliverables: `@modelcontextprotocol/sdk` in `packages/adapters` behind a port, the only place it may live; the streaming HTTP transport at the resource the discovery documents already name; the local standard-input transport for a desktop or air-gapped agent; `mcp_sessions` bound to the grant, with protocol version negotiation, header discipline and origin validation against rebinding; the access token resolved per request through P5-T08a's resolver, with the challenge header on every unauthorised answer; errors sanitised so a refusal says nothing about the schema behind it.
Test plan: a session is bound to one grant and dies with it; an origin the instance does not serve is refused; a version it cannot speak is refused with the versions it can; an unauthorised call carries the challenge naming the resource metadata; a revoked grant stops the next call on the same session.
Acceptance: Given an external agent holding read scope, when it calls a write tool, then the call is denied by the permission layer, the denial is audited, and the agent receives a clear error rather than a partial result.

### P5-T09c: Search and fetch [M]
Depends on: P5-T09b
Goal: the two tools that make a research connector work.

Deliverables: the global `search` tool, permission-filtered through the same access layer as every read, so a result a member cannot see never appears; the `fetch` tool turning a canonical OpenOKR URL into structured content with a citation; both in the catalogue with the rest.
Test plan: a live end-to-end run over the real transport asserting that an under-privileged call is denied and no cross-tenant data appears in any result; a search by a member who cannot see a goal never returns it; a fetch of a URL in another workspace answers not-found.
Acceptance: Given two workspaces with similar goals, when an agent in one searches for the other's wording, then nothing from the other workspace appears in any result.

**Corrected while doing the work.** Two lines above turned out to describe things that were not there. The design named `search` as "P5-T13's own read with a tool wrapper", and P5-T13 is later in this plan and its index table is written by nothing, so the read did not exist; the tool stands on P4-T13's retrieval instead, and the P5-T13 row now says so. The test plan asked one live run to carry both claims, and the end-to-end harness registers one instance account, so the cross-tenant claim is proved against a real database in `packages/core/test/mcp-research.test.ts` and the transport claims stay in `e2e/s41-mcp-transport.spec.ts`. Agung chose both on 2 September 2026. A task whose test plan names a place its harness cannot reach is a Definition of Ready gap, and the next reader should meet the corrected row.

### P5-T10a: Initiatives: the data, the link and gate five [M]
Depends on: P5-T00, P3-T04
Goal: the work that moves a key result, as rows and rules (METHOD.md §5.5).

**Cut out of P5-T10 before any code.** The original row held a schema with its access model, eight registry actions, a change to a publish gate in `packages/method`, and two screens. That is two working sessions, and the seam is obvious: everything below the interface can be finished and proved on its own, and the screens then have something real to draw. The acceptance criterion belongs to this half, because it is about a gate rather than a surface.

Deliverables: `initiatives` and `initiative_key_results` with their row-level security policies and the §7.2 mapping rows; the access context an initiative owns, with the owner rebound rather than the column rewritten; the eight registry actions (list, read, create, update, delete, link, unlink, capacity); `InitiativeSnapshot` and gate five in `packages/method` reading an initiative's verdict beside the per-key-result ones from P3-T04, unevaluable without the register; the loader supplying it, and the stored gate rows recomputed inside the transaction of any write that could move them.
Test plan: an initiative marked `done` moves no key result's measured value or progress; the same link recorded twice is one link and a removed one revives rather than duplicates; an initiative serving no key result in the cycle is not in its gate; unlinking and deleting both take it back out; the owner holds `full` on that one context and nowhere else.
Acceptance: Given an initiative linked to two key results and marked as exceeding capacity, when the cycle's gates are evaluated, then gate five is red and links to that initiative.

### P5-T10b: Initiatives: the list and the detail panel [M]
Depends on: P5-T10a
Goal: screen S-26, and the capacity view the align-and-commit session reads.
Reference: UIUX-PLAN.md §6 S-26.
Deliverables: the initiative list per space and per key result with title, owner, dates, status, confidence, capacity verdict and linked key results, filterable the way `initiatives.list` already answers; inline editing; the detail panel with description, linked key results, and the places tasks and documents will attach at P5-T11 and P5-T12; the capacity view on the cycle's align-and-commit phase, showing every key result's verdict beside the initiatives behind it and linking a red gate five to what made it red.
Test plan: the loading, empty, error and permission-denied states are all reachable; a member who cannot see an initiative never sees its row; the UIUX-PLAN §9 quality gates pass.
Acceptance: Given a cycle whose gate five is red because of an initiative, when a facilitator opens the capacity view, then the initiative is named and one click reaches it.

### P5-T11: Tasks and the OKR board [L]
Depends on: P5-T10a
Goal: the board keyed to key results (screens S-27, S-28).
Deliverables: tasks with status, due date, description and checklist; multiple assignees where assignment grants edit access and notifies; the key result and initiative links; the board across a space, an initiative or a key result with drag, optimistic updates, live presence and concurrency-safe ordering normalised against deleted and completed items; the objective and key result rail with progress derived from linked completed tasks shown as a separate signal beside measured progress; the task detail page; review-inbox coverage for tasks due.
Test plan: two simultaneous reorders converge with no lost or duplicated cards; the derived linked-work signal never overwrites the measured key result value; assignment notifies everyone except the actor.
Acceptance: Given a key result whose linked tasks are all complete but whose measured value has not moved, when the Coach's divergence check runs, then it reports exactly that, naming both figures.

**Kept as one task at Agung's decision, and half the acceptance criterion is deferred with it (3 September 2026).** The row holds a schema, an access model, thirteen registry actions, concurrency-safe ordering, two screens, a live stream and a review-inbox source. That is more than the one working session CLAUDE.md cuts a task to, and the concern was put to Agung before any code: they chose to keep it as one row and one commit. The deferral is separate and is the reason the acceptance reads "when the divergence is computed" in the tests rather than "when the Coach's divergence check runs": the rule reports it and the rail shows it, but `alignment_findings` carries `subject_goal_id` and a fixed `kind`, so a key-result-scoped finding needs the finding identity widened across four other sweeps. That widening is P5-T14, below.

### P5-T14: The linked-work finding [S]
Depends on: P5-T11
Goal: the divergence P5-T11 computes reaches the Coach's finding inbox (TECHNICAL-PLAN.md §4.9).

**Cut out of P5-T11 because it is a change to a shared surface, not to tasks.** `alignment_findings` has `subject_goal_id` and `target_goal_id` and a fixed `kind` enum, and `reconcileFindingsInTx` keys on (scope, source, kind), which is why the divergence sweep deliberately writes one finding per goal. A key result's own finding needs a subject column and a wider identity, and four existing sweeps share both.

Deliverables: a `subject_key_result_id` column with its migration; the finding identity widened so one goal may carry a finding per key result without the rows colliding; `linkedWorkDivergence` wired into the Coach's sweep beside the two §6.1 cases; the four existing sweeps unchanged in behaviour.
Test plan: a goal with two key results, both diverging, produces two findings and dismissing one leaves the other; the existing per-goal findings still reconcile to one row each.
Acceptance: Given a key result whose linked tasks are all complete but whose measured value has not moved, when the Coach's divergence check runs, then it reports exactly that in the finding inbox, naming both figures.

**The engine's unique index is not widened, and that was the surprise (3 September 2026).** `alignment_findings_identity_idx` is scoped `where source = 'engine'`, so it never covered the Coach's rows at all: the collision this task exists to fix was in `reconcileFindingsInTx`'s identity string, not in the database. The column is added, the index is left alone, and the reason is written into the migration so nobody widens it later thinking it was an oversight.

### P5-T12: Documents and attachments [M]
Depends on: P5-T11, P2-T11
Goal: rich documents attached where they belong (screen S-29).
Deliverables: documents on a space, goal, key result, initiative, cycle or session with draft and publish where drafts are author-private and enforced in the query, version history with a visual difference, comments, reactions and subscriptions; attachments on any subject.
Test plan: another member cannot read a draft even through a direct identifier probe, receiving not-found; publishing emits the activity and the notification while drafting does not.
Acceptance: Given a document drafted on a goal and then published, when a space member opens the goal, then they see it with a readable history of changes, and before publication they saw nothing.

### P5-T13: Search, palette and exports [M]
Depends on: P5-T12, P4-T13b
Goal: finding and extracting (screens S-32, S-01).
Deliverables: the search document table with full-text indexing driven from the outbox across goals, key results, KPIs, initiatives, tasks, documents, comments, check-ins and sessions, with semantic results blended when available; access-filtered queries; the search page and the command palette with entity jump, actions and recents; Work Map rows for initiatives and tasks; CSV and XLSX export of any list, run asynchronously for large sets and audited.

**The read this task widens already exists (added at P5-T09c).** `search_documents` is written by nothing today, and P5-T09c needed a search before this row was built, so the agent tool stands on P4-T13's access-filtered retrieval over `embeddings`. This task extends that one read to the types retrieval does not reach, rather than building a second one: the palette and the `search` tool answer from the same function, filtered by the same `getAccessScoped` call. A second query path here would be a second answer about who can see what.
Test plan: a term inside a private space's document returns nothing for a non-member and a highlighted result for a member; an export matches the visible rows and columns exactly.
Acceptance: Given any screen, when the palette is opened and a short identifier typed, then the entity opens inside the budget.

**Two lines of this row were corrected while doing the work (3 September 2026).** XLSX is not here: Agung approved `exceljs`, and this repository's own licence gate refused its tree (`buffers@0.1.1` has an unknown licence, and AGPL-3.0 cannot distribute what nobody can name). They chose to ship CSV and make the spreadsheet its own row, which is P5-T15 below. And the entity jump reaches a KPI and nothing else, because `kpis.short_id` is the only short identifier this product has: goals, initiatives and tasks carry none, and inventing an allocation scheme for three tables is a decision this row does not own. The palette falls back to the phrase search, which is what somebody typing a goal's name wanted.

### P5-T15: The spreadsheet export [M]
Depends on: P5-T13
Goal: a list as a workbook, and the large-export path that delivers one.

**Cut out of P5-T13 because it is a dependency question, not an export question.** `exceljs` was approved on 3 September 2026 and refused the same day by `pnpm check:licences`: its tree pulls `unzipper`, which pulls `buffers@0.1.1` (licence unknown), `chainsaw@0.1.0` and `traverse@0.3.9` (`MIT/X11`, an old spelling not on the allow list). AGPL-3.0 cannot distribute a package nobody can name a licence for, and the gate's own message says to ask before widening the list. Agung chose CSV first.

Deliverables: an XLSX writer whose dependency tree passes `pnpm check:licences` unchanged, or a decision to widen the allow list with the reasoning written down; the `export.requested` outbox handler, which acknowledges today, building a file and delivering it; the file offered through the storage port rather than held in a response.
Test plan: a workbook opens in a spreadsheet with the same rows and columns as the CSV; the licence gate passes with no entry added to its list, or the entry added is justified in the change; an export above the inline limit arrives without the request waiting for it.
Acceptance: Given a list larger than the inline limit, when a member exports it, then they are told it is being prepared and the file reaches them without the request having waited.

**Cut as [S] and it is an [M], corrected while doing the work (3 September 2026).** The size was put to Agung before the second half was written and they chose to keep it as one row, as they did for P5-T11. The row is marked [M] here so the next reader meets the real size: a workbook writer, a table with its migration, the outbox worker, the first `FileStorage` instance this product has ever constructed, a read action, an authorised download route and a screen section.

**The writer is `write-excel-file` (MIT) over `fflate` (MIT), and the licence gate passes unchanged.** Chosen from three options on 3 September 2026: this, `fflate` alone with the OOXML written by hand, or deferring the format again.

**Three decisions worth carrying forward.** The file is collected from a "Your exports" list rather than emailed, because an instance with no mail configured would otherwise never deliver it. The download route authorises rather than redeeming a signed URL, because an export holds one member's access-filtered rows and a URL anybody holding it could redeem would be wider than the file. And the inline limit moved into the §4.14 settings map as `exportInlineRowLimit`, default 5000, because §4.9 asks for the behaviour and names no figure.

### P5-T16: Read-action input validation, and the two specs that flake [S]
Depends on: P5-T07a, P5-T11
Goal: a read refuses the input its own schema refuses, on every surface, and the two unstable specs stop racing the application.

**Found at P5-T11 and left open, because it is general rather than local.** `defineWriteAction` parses its declared input before the operation opens a transaction, which is what "validate at the boundary" means as code. `defineReadAction` hands the raw value straight to its handler and `callAction` parses nothing, so every read in the product trusts the shape its caller passed. Those callers are not the internal client alone: the public REST surface builds the value out of query strings (`inputFrom`), the agent transport out of a tool call, the chat router out of a message. Roughly two hundred reads therefore publish a contract in `contract/openapi.json` that nothing enforces, and a wrong type is discovered inside SQL, or not discovered at all.

Deliverables: `defineReadAction` parses its declared input before the handler runs, symmetric with the write builder and in the same place; a refusal that reaches the caller as 422 `invalid_input` naming the field, through the `ZodError` mapping `api/errors.ts` already has; a correction for any declared read schema that turns out to be narrower than the handler it describes, because nothing has ever tested one; `e2e/s22-weekly-digest.spec.ts` and `e2e/s27-board.spec.ts` navigating through the retrying helper rather than racing the application's own redirect.
Test plan: a read built with a refusing schema never reaches its handler; keys the schema does not declare never reach a handler; a registry read called with a wrong-shaped identifier is refused before any query runs; the full unit suite proves no read's declared schema was narrower than its handler; both specs pass across repeated end-to-end runs.
Acceptance: Given a read action declared with an input schema, when any surface calls it with input that schema refuses, then the call is refused before the handler runs and the caller is told which field is wrong.

**Phase 5 exit:** all four chat providers deliver and accept commands with one generated command surface; the coach reaches members where they are and respects quiet hours; the public REST surface, OpenAPI and the command line are generated with drift checked; the external agent surface works end to end over the real transport with authorisation proven by machine; initiatives, tasks and the board are joined to key results; documents, search, the palette and exports are live.

---

# Phase 6: Data: import, export, portability

### P6-T01a: The spreadsheet importer and its command [L]
Depends on: Phase 5 complete
Goal: the generic migration path as a mechanism (TECHNICAL-PLAN.md §7), driven from a file and a mapping rather than a screen.

**Cut in two before any code, and Agung chose the seam.** The row held a reader for two formats, templates for six entities, a mapping supplied by hand, a mapping proposed by a model, a dry run with a per-row report, an idempotent upsert, a run record with its migration, a wizard on S-36 and a command. That is more than one working session, and the two halves fail differently: the mechanism is a spreadsheet turning into rows through the Operation pipeline, and the second half is a person being helped to describe their own columns. `import_runs` is in §4.13 and does not exist yet, so it arrives here.

Deliverables: CSV and XLSX readers in `packages/importer`, with `read-excel-file` (MIT) as the reader Agung approved on 3 September 2026; entity templates for goals, key results, KPIs, KPI records, initiatives and tasks, each naming its columns, which are required, how a value is coerced and which registry action writes it; a mapping supplied as `--map <mapping.json>`; a dry run that reports exactly what a real run would write, without writing; a per-row error report naming the row number and the field; idempotent upsert on `(workspace_id, legacy_type, legacy_id)`; the `import_runs` table with its row-level security policy in the same migration, one row per run including a failure; `pnpm import:csv`, dry-run by default.
Test plan: a file with one bad row previews as creatable minus one with the error explained, and a real run writes exactly that; running the same file twice writes nothing the second time and leaves one completed run per attempt; a value the template cannot coerce is a row error rather than a refused file; notification dispatch is suppressed for every write the import makes.
Acceptance: Given a spreadsheet and a mapping, when the command runs with `--dry-run`, then the report names every row it would write and every row it would skip with the reason, and the real run matches that report exactly.

### P6-T01b-a: One engine, and the AI mapper over it [M]
Depends on: P6-T01a
Goal: the wizard and the command share one engine, and a person with unfamiliar headers gets a proposed mapping.

**Cut in two before the screen was written, and Agung chose the seam (3 September 2026).** The row held a move, an assist and a four-step screen, which is two working sessions. The two halves fail differently: this one is a proposal that has to be checked field by field before a human ever sees it, and the next is a screen.

**The move is the first deliverable and it settles a dependency question.** `apps/web` may not depend on `packages/importer`, so the spreadsheet engine (the readers, the six entity templates, the mapping and the runner) moves to `packages/core/src/imports` and `packages/importer` keeps the command line and, at P6-T02, the FlowyTeam connector. Agung chose this over widening the dependency table, which would have put P6-T02's MySQL client in the web application's dependency graph. TECHNICAL-PLAN §1 and CLAUDE.md are corrected in the same change.

Deliverables: the engine in `packages/core/src/imports`, with the command line calling it and no behaviour changed; a `readBuffer` beside `readTable`, so a request with bytes and a terminal with a path read the same way; the AI mapper as one registry action proposing a header-to-field mapping over the templates, with every proposed field checked against the template before it is returned and a duplicate claim dropped rather than resolved; a feature key, so an administrator can turn it off; null when the provider is off, which is what leaves the alias matching as the whole of the manual path.
Test plan: the moved engine's tests pass unchanged in their new home; a proposal naming a field the template does not have comes back without it rather than refused whole; two headers claiming one field keep the first; the action returns null with the provider off and the alias matching still maps a familiar file; the command still runs end to end.
Acceptance: Given a goals spreadsheet with unfamiliar headers and a provider configured, when the mapper runs, then every header it claims is mapped to a field the goals template has, and with the provider off the same file still maps by alias with no proposal offered.

### P6-T01b-b: The import wizard [M]
Depends on: P6-T01b-a
Goal: a screen that carries a file from upload to an import somebody confirmed.

Deliverables: the import wizard on S-36 with its four steps, upload, mapping confirmation, the dry-run preview and the per-row error report; two registry actions taking a table rather than a path, so the browser parses nothing; a §4.14 setting bounding how many rows one run may carry, with a default a fresh workspace resolves; every AI affordance hidden with the provider off and the manual mapping path complete without it.
Test plan: the preview the screen shows is the report the command produces for the same file and mapping; a file above the row bound is refused with the number rather than truncated; loading, empty, error and permission-denied states; the UIUX-PLAN §9 gates; one end-to-end path from upload to a confirmed import.
Acceptance: Given a goals spreadsheet with unfamiliar headers, when the wizard runs, then a mapping is proposed, the human confirms or corrects it, the dry run reports accurately and the real run matches it.

### P6-T02: FlowyTeam connector [M]
Depends on: P6-T01
Goal: the read-only source (TECHNICAL-PLAN.md §7.1).
Deliverables: the import command with a required company selector; a read-only session where an attempted write must fail; introspection, required-table assertions and version inference; the multi-company guard; the report writer; the legacy identifier map.
Acceptance: Given a source database, when the dry run executes for one company, then it prints that company's schema summary, writes an empty report, and provably cannot write to the source.

### P6-T03: FlowyTeam strategy mappers
Depends on: P6-T02, P3-T15
Goal: the OKR and KPI import (TECHNICAL-PLAN.md §7.2).

**Cut into four before any code, on 4 September 2026, the same way P6-T01 was and for the same reason.** The row held nine mapper groups, a formula parser, a reconciliation report and an idempotency proof. That is four working sessions, and the four fail differently: the first is identity resolution, the second is a graph, the third is history, the fourth is a parser. The seam follows the source's own dependency order (`reference/flowyteam-okr-kpi-tasks-model.md` §11), so each part imports on top of what the one before it resolved rather than stubbing it.

The acceptance criterion for the whole is unchanged and belongs to the last part: given one company, when the full strategy import runs twice, the report and reconciliation are clean and the second run is a no-op. Each part proves that for its own domain.

### P6-T03a: The organisation and the rhythm [M]
Depends on: P6-T02, P3-T15
Goal: the rows every later mapper resolves against, and the reconciliation the report is built on.

**Nothing else can be imported until a source id resolves to a member, a space and a cycle.** Objectives name a champion and a reviewer, key results hang off a cycle, and tasks name assignees. This part builds that resolution once, out of the legacy keys the rows carry, so no later mapper invents a second way to answer the same question.

Deliverables: teams to spaces with their members and managers, the tree flattened to siblings with the depth recorded; employees to workspace members, with placeholder members for email addresses nobody has claimed; performance cycles and settings; a `legacy` input on `spaces.create`, `cycles.create` and whatever creates a member, since only the five actions P6-T01a touched can write a legacy key today; a resolver that turns a source id into a target id through those keys, cached per run; the per-domain reconciliation shape the report carries from here on; dispatch suppressed.
Test plan: against a seeded source, the space tree flattens and the depth is in the report; an unclaimed email becomes a placeholder member rather than an invitation; a re-run writes nothing and the reconciliation is clean; a second company in the same source is untouched.
Acceptance: Given one company, when the organisation import runs twice, then the members, spaces and cycles match the source, the second run is a no-op, and every later mapper can resolve a source id.

### P6-T03b: Objectives and key results [L]
Depends on: P6-T03a
Goal: the OKR graph, with its alignment and its measures.

**The owner comes from `model_type`, never from `objective_type`.** The reference records that the enum was never widened and that services write a value MySQL stores as the empty string, so the level has to be derived from the polymorphic owner. Alignment is two passes because a parent can appear after its child in id order.

Deliverables: objectives to goals with owner, champion and reviewer resolution and a report row wherever a reviewer is unmapped; the level derived from `model_type`; two-pass alignment over `objective_parent_id` and `key_result_parent_id`; key results with their values, direction inferred, indicator type defaulted to lagging and flagged for review; `key_result_records` into `key_result_values`; progress, health and alignment recomputed through the engines rather than carried; the precision loss from the 2023 `bigint` change recorded.
Test plan: counts match; a child imported before its parent still aligns; a stored `result_percentage` that disagrees with the recomputed one is recomputed and the difference is reported; a re-run changes nothing.
Acceptance: Given one company, when the OKR import runs twice, then the alignment matches the source, every derived value is the engine's own, and the second run is a no-op.

### P6-T03c: Check-ins [M]
Depends on: P6-T03b
Goal: the history behind the numbers.

Deliverables: `objective_checkins` and `key_result_checkins` into one narrative check-in per objective per period, with the snapshot rebuilt from the key-result rows that came with it; `checkins` and `checkin_reviews` into acknowledgements wherever a reviewer is known; votes deliberately not imported, because a private vote with a synchronised reveal is an OpenOKR concept with no source; the report naming every check-in whose period could not be resolved.
Test plan: one snapshot per imported check-in, stamped from its own values; a review with no resolvable reviewer is a report row rather than a dropped check-in; a re-run changes nothing.
Acceptance: Given one company, when the check-in import runs twice, then each objective's history matches the source period for period and the second run is a no-op.

### P6-T03d: KPIs and their formulas [L]
Depends on: P6-T03b
Goal: the indicator domain, including the one part of the source that is a language.

**`indicator_calculates` holds a token string the source evaluates with `eval()`.** It is translated into this product's expression tree, and anything that will not parse is dropped and logged rather than guessed at.

Deliverables: `indicator_types` to KPI categories, `indicators` to KPIs with parents before children, `indicator_records` to KPI records with the period key normalised and unique per period; occurrence mapped to frequency; tier and indicator type defaulted and flagged; formula token translation into the expression tree with unparseable formulas dropped and logged; `indicator_accesses` to bindings or shares; `kpi_trees` deliberately left null, because guessing a tree from the parent chain would name something nobody chose; achievement recomputed.
Test plan: a documented calculated KPI recomputes to the source value; an unparseable formula is dropped with a report row and its KPI still imports; `direction=down` is recomputed correctly and rows whose value changes are flagged; a re-run changes nothing.
Acceptance: Given one company, when the KPI import runs twice, then a calculated KPI recomputes to the source value, every dropped formula is in the report, and the second run is a no-op.

### P6-T04: FlowyTeam work and collaboration mappers
Depends on: P6-T03, P5-T11
Goal: the remaining domains.

**Cut into three before any code, on 4 September 2026, the same way P6-T03 was, and into four the same day once the converter was measured.** The row held four mappers, an HTML converter with a two-phase reference rewrite, a blob path, the consolidated report, the selective flag and a mixed spreadsheet-plus-company test. That is four working sessions and they fail differently: a graph, a content converter, a byte path, an orchestration. The second cut is recorded in P6-T04b: converting HTML and copying files share a source table and nothing else.

The whole row's acceptance criterion is unchanged and belongs to the last part: given a seeded company, when the full import runs end to end, counts reconcile, every skip is explained, derived values are engine-computed and a re-run is a no-op.

**One correction the source made necessary before any of it.** §7.2 maps `initiatives` from Projects, and `projects` is a real FlowyTeam table with its own name, summary, admin, dates and status. The importer's legacy map had `task_boards` there, which is a different thing: a board is a column layout, and on the instance this reads **17724 tasks carry a project and 3668 carry a board**. Corrected in P6-T04a.

### P6-T04a: Initiatives and tasks [L]
Depends on: P6-T03d
Goal: the work graph, which is what the OKRs point at.

Deliverables: `projects` to initiatives with their status, owner and dates, `capacity` left null because METHOD.md §5.5's verdict is a judgement a room makes; `tasks` to tasks with the status taken from the board column and `tasks.status` as the fallback; `keyresult_indicator` and `tasks.key_results_id` as the links from work to measures; `sub_tasks` to checklist items; `position` renumbered on load rather than carried; `progress_pct` recomputed from the imported tasks; a two-pass write for `dependent_task_id` and `recurring_task_id`, recorded in the report rather than modelled.
Test plan: a task in a board column named in another language still gets a status; a task whose project did not import is a skip by name; the initiative's progress is the engine's and not the source's `completion_percent`; a re-run changes nothing.
Acceptance: Given one company, when the work import runs twice, then every task sits in the right initiative with the right status, and the second run is a no-op.

### P6-T04b: Task comments and watchers [M]
Depends on: P6-T04a
Goal: what people wrote on the work, and who was following it.

**Cut in two on 4 September 2026, after the converter was built and measured.** The row held a content converter and a blob path, and they turned out to be different jobs with different failure modes. The converter is `packages/core/src/rich-text/from-html.ts`: 700 lines and 25 tests, because the answer to "convert HTML" against 7223 real comments is thirteen distinct nesting repairs and an allow-list, not a `replace`. The blob path is a dependency on the storage port and a second source of bytes that is not in MySQL at all. Files are now P6-T04c and the pipeline is P6-T04d.

**Imported content is untrusted and the rich-text rule says so.** A task comment is HTML written by somebody in another system, and it goes through the one shared parser and its sanitising allow-list before it is stored as editor JSON. The second pass rewrites references once every row exists, because a comment can mention a task the first pass had not written yet.

Deliverables: `task_comments` to comments with HTML converted through `packages/core`'s rich-text module and a two-phase reference rewrite; `tasks_accesses` to subscriptions; a reply chain preserved through `parent_id`; every unmapped construct in the report, inline images among them, because the bytes have nowhere to go until P6-T04c.
Test plan: a comment carrying a script tag imports with the script gone and the text kept; a reply keeps its parent; a watcher who is a placeholder is reported and not subscribed; a re-run writes no second copy.
Acceptance: Given one company, when the comment import runs twice, then every comment renders as its author wrote it and the second run is a no-op.

### P6-T04c: Files [M]
Depends on: P6-T04b
Goal: what people attached to the work.

**The bytes are not in the database.** `task_files` names a file on the FlowyTeam application server's own disk, and the importer holds a read-only MySQL connection and nothing else. On the instance this reads, all 1535 rows are local files and none is a Google Drive, Dropbox or external address, so the path the mapping described is the one path the live data never takes. Copying bytes therefore needs a second input the command does not have yet, and inventing one is this row's first decision rather than an aside in another.

Deliverables: `task_files` to blobs and attachments through the storage port, with Google Drive, Dropbox and other external addresses becoming links in the body rather than copied bytes; a `--files-root` naming the source's storage directory, without which every local file is reported by name rather than half-written; the inline base64 images P6-T04b flagged decoded into blobs and the comment bodies holding them rewritten, which is what the second phase of the reference rewrite is for; a file whose bytes cannot be found reported by name and never as a broken attachment.
Test plan: an external file link becomes a link and not a failed download; a local file with `--files-root` given arrives as a blob whose digest matches; the same file without it is a named report line; a comment that held a base64 image gains an attachment and loses the data URI; a re-run writes no second copy.
Acceptance: Given one company and its storage directory, when the file import runs twice, then every attachment resolves, every file that could not be found is named, and the second run is a no-op.

### P6-T04d: The whole pipeline [M]
Depends on: P6-T04c
Goal: one command that runs the lot, and one report a person can act on.

Deliverables: `--only` selecting domains, with the dependency order enforced rather than assumed; the consolidated report and a human-readable summary; every unmapped construct across every domain gathered in one place; the mixed test importing a spreadsheet and a company into one workspace and proving the two legacy types coexist; the full orchestrated run proven twice over.
Test plan: `--only objectives` refuses without the organisation, or runs it first and says so; a spreadsheet import and a company import into one workspace leave both sets of rows intact and distinguishable by `legacy_type`; the summary names every skip and every flag.
Acceptance: Given a seeded company, when the full import runs end to end, then counts reconcile, every skip is explained, derived values are engine-computed and a re-run is a no-op.

### P6-T05: Workspace export and import [L]
Depends on: P6-T04
Goal: portability (TECHNICAL-PLAN.md §7.3).

**Cut into three before any code, on 4 September 2026, the same way P6-T03 and P6-T04 were.** The row held an archive format, an import that remaps every key in it, and the admin cards that drive both. Three working sessions, and they fail differently: a policy list over **129 tables** where the failure is a secret that should not be in the file, an identity remap where the failure is two rows merged that were not the same person, and a screen. §7.3's own sentence separates them: "exports a versioned, checksummed, encrypted archive" is one job, and "runs a dry-run difference first, then a deterministic key remap, member de-duplication by email address and blob re-upload" is another.

The whole row's acceptance criterion is unchanged and belongs to the last part: given an exported workspace, when it is imported into a fresh instance, the dry-run difference is accurate, the import reconciles, and goals, check-ins, sessions and documents render identically.

**Two things this row inherits rather than decides.** `export_runs.kind` already carries `archive` beside `list` (P5-T15), so an archive joins a lifecycle that exists rather than needing a second table. And the key ring in `packages/core/src/secrets/key-ring.ts` already seals and rotates instance secrets, so the archive's encryption is that machinery applied to a file rather than a new scheme.

### P6-T05a: The archive [M]
Depends on: P6-T04d
Goal: a file that holds a workspace and nothing it should not.

**The policy list is the deliverable, not a detail of it.** There are 129 tables. A row that names what goes in has to name what stays out, and every exclusion in §7.3 is there for a reason: a session or a token in the file is a credential somebody can carry to another instance, a channel credential is somebody else's account, and the audit chain is hash-chained per workspace so replaying it elsewhere would assert events that never happened there. The list is declared as data with a reason per line, and a test fails when a table exists in the schema and appears in neither column, so a new table cannot be quietly left out of both.

Deliverables: the table policy list covering every table, in dependency order, each either exported or excluded with its reason; the manifest naming the instance, the schema version, the row counts and the archive format version; a checksum over the whole archive; encryption through the existing key ring; blobs written into the archive alongside the rows; `export_runs` with `kind: "archive"` driving the lifecycle; the registry action that starts one.
Test plan: an archive of a seeded workspace holds every table the policy list exports and no row from any it excludes; the checksum verifies and a changed byte fails it; a table added to the schema and to neither column fails the policy test by name; the manifest's row counts match the archive's contents.
Acceptance: Given a seeded workspace, when an admin exports it, then the archive verifies, its manifest reconciles against its contents, and nothing on the exclusion list appears anywhere in it.

### P6-T05b: The import [M]
Depends on: P6-T05a
Goal: that archive, into another instance, without merging two people into one.

**A deterministic remap, and de-duplication only by email address.** Every identifier in the archive is a uuid that means nothing in the receiving instance, so the import assigns new ones and rewrites every reference to them, including the ones inside rich text. Members are the exception: a person with the same email address is the same person, and anybody else is new. Nothing is merged on a name, because two people can share one.

Deliverables: reading and verifying an archive, refusing one whose checksum or format version does not match; the dry-run difference naming what would be created and what would merge, before anything is written; the deterministic key remap covering references inside rich text as well as columns; member de-duplication by email address, with a placeholder claimed rather than duplicated; blob re-upload through the storage port; `workspace_imports` with its manifest, checksum, status and progress.
Test plan: an archive imported into a fresh instance reconciles row for row against its manifest; the dry-run difference predicts exactly what the real import does; a member who already exists by email address is merged and one who does not is created; an archive with one byte changed is refused; a re-import of the same archive is a no-op.
Acceptance: Given an exported workspace, when it is imported into a fresh instance, then the dry-run difference is accurate, the import reconciles, and goals, check-ins, sessions and documents render identically.

### P6-T05c: The admin cards [S]
Depends on: P6-T05b
Goal: the two things an admin does with this, on the screen UIUX-PLAN §6 already puts them on.

Deliverables: the workspace export card on S-36 with its progress and its collect-once download; the workspace import card with the archive upload, the dry-run difference shown before anything is written, and a confirmation naming what will merge; loading, empty, error and permission-denied states; the UIUX-PLAN §9 gates.
Test plan: an export started from the screen produces the same archive the action does; the difference the screen shows is the difference the import performs; a non-admin sees neither card; one end-to-end path from export to a confirmed import.
Acceptance: Given an admin on S-36, when they export and then import that archive, then the screen shows the same difference the command does and refuses to write until they confirm it.

### P6-T06: Backups and restore drills [M]
Depends on: P6-T05
Goal: recoverability that is proven, not assumed.
Deliverables: scheduled encrypted backups of the database and blobs with checksums; a restore drill in continuous integration restoring into an ephemeral database and asserting row counts and a smoke sign-in; the restore runbook.
Acceptance: the scheduled drill proves a restore reproduces a workspace, continuously.

### P6-T07: Migration cutover rehearsal [M]
Depends on: P6-T06
Goal: a trustworthy switch-over.
Deliverables: the documented runbook of freeze the source, back up, dry run, import, reconcile, go live and keep a rollback window, rehearsed against a production-shaped copy using the workspace freeze overlay, with a tested rollback.
Acceptance: the rehearsal runs the runbook end to end, reconciliation is clean, and the rollback restores the prior state inside the window.

---

# Gap closure: between Phase 6 and Phase 7

Not a phase. Thirty-five tasks closing `GAP-AUDIT.md`, which audited all 47
routes and all 10 packages against the scope whose task was already `done` or
`in_review` on 7 September 2026. Every row below cites the audit finding it
closes, so the evidence for why the task exists is one file away.

**Why these are numbered tasks rather than one sweep.** The audit found six
specified screens with no route at all and a scheduler that nothing starts.
That is not a tidy-up. Cutting each into a row the size of one working session
is what makes it reviewable, and it is what makes a mis-cut row visible before
the code is written rather than after four commits.

**Ordering.** G01 to G05 come first because they change what every other row
means: without the scheduler nothing in the coaching layer has ever run in the
shape a user meets it. G06 to G13 are the missing screens. G14 to G19 finish
the cycle and the session. G20 onwards is configuration and polish.

**P6-G01 was cut in three before any code, and the audit is why.** The row asked
for a host, four Champion cadences, the notification batch drain, the daily
summary, the staleness sweep and the orphan-blob reap. Two of those turned out
to be unbuilt engines rather than jobs to register: `renderDigest` has never had
a caller outside the barrel, so nothing sends a batch, and
`findOrphanedBlobs`/`discardOrphanedBlob` are scaffolding whose own comments say
the job that would call them was never built and that it needs a storage delete
the action context does not carry. The other two, the staleness sweep and the
daily summary, are already inside the Champion's daily cadence and need no job
of their own. So the host is one session and each engine is another.

### P6-G01a: The scheduler host and the agent cadences [M]
Depends on: P5-T01a, P4-T05b, P4-T06a
Goal: the product acts on a clock, not only on a write (GAP-AUDIT B-01).
Deliverables: a job-queue host in `apps/web` beside the outbox relay, constructing the pg-boss driver from `DATABASE_URL`, subscribing a worker to every declared job and calling `registerAgentSchedules` once at boot; an `OPENOKR_SCHEDULER` toggle with the same shape `OPENOKR_RELAY` already has; the Coach's nightly semantic sweep added to the schedule, which is AI-NATIVE-PLAN §6.1's only cadence and has never had one, fired at each workspace's own local hour rather than the host's; a run that enumerates every workspace and acts as `system`, tolerating a workspace whose agent is turned off; a single boot log line naming what was registered; the four comments across the repository claiming no scheduler host exists corrected.
Test plan: a host with the toggle off registers nothing and a misspelt toggle is a boot error; every declared schedule has exactly one worker, asserted from the declaration rather than a fixed list; registering twice leaves one schedule; a nightly run fires only for workspaces whose local hour matches, proven across three timezones; one workspace raising stops nothing and is counted.
Acceptance: Given a fresh instance with no AI provider, when a check-in passes its due date and an hour elapses, then the Champion has run, a nudge row exists with its rule key, and no human pressed anything.

### P6-G01b: The notification batch drain and the daily summary [M]
Depends on: P6-G01a, P2-T06
Goal: a batched notification is actually delivered (GAP-AUDIT B-01).
Deliverables: the worker that finds batches whose `send_at` has arrived, renders them through `renderDigest`, which has had no caller since P2-T06, sends through the mail port and marks them sent; the member's daily summary at their own local time; idempotence under two hosts; the recurring job registered beside the agent cadences.
Test plan: four notifications inside one window deliver as one digest listing four items, each deep-linked; a recipient who lost access after enqueue receives nothing; two hosts draining together send once; the summary fires at the member's local time across a daylight-saving boundary.
Acceptance: Given a member with a ten-minute window, when four notifications arrive inside it, then they receive one digest listing four items and the batch is marked sent exactly once.

### P6-G01c: The orphan-blob reap [S]
Depends on: P6-G01a, P2-T05
Goal: an abandoned upload does not stay forever (GAP-AUDIT B-01).
Deliverables: the recurring job wiring `findOrphanedBlobs` and `discardOrphanedBlob`, which have been scaffolding since P2-T05, through an Operation so the removal gets its own activity and audit row; `delete` added to the action context's storage seam beside the `get` P6-T05a put there, so the bytes go with the row; the age threshold as a §4.14 setting with a default.
Test plan: a pending blob older than the threshold is soft-deleted and its object removed; a claimed blob is never touched; a second run changes nothing; a storage delete that fails leaves the row alone rather than orphaning the bytes silently.
Acceptance: Given a prepare that was never claimed, when the reap runs after the threshold, then the row is soft-deleted, the object is gone, and the audit names the removal.

### P6-G02: The review inbox's four remaining sources [L]
Depends on: P3-T08, P4-T05, P4-T07, P4-T08
Goal: S-02 tells a member everything they owe (GAP-AUDIT B-02).
Deliverables: the blocker, commitment, session and proposal obligations computed and merged into the existing overdue-first grouping; `PENDING_SOURCES` emptied, and the mechanism kept so a future source still declares itself rather than being silently absent; each row's one-click action; the live sidebar badge counting all six sources; cache invalidation from the Operations that change any of them.
Test plan: a member owning an open blocker sees it grouped by its age; a commitment due this week appears and closing it removes it; a session a member must run appears once and not per participant; an agent proposal appears for the member whose decision it needs and for nobody else; the badge count equals the row count across all six sources.
Acceptance: Given a member who champions an overdue goal, owns a blocker, has a commitment due, must run a session and has one proposal waiting, when they open `/review`, then five obligations are listed in the right groups and the badge reads five.

### P6-G03: Reachability and stale copy [S]
Depends on: none
Goal: nothing on screen lies about the state of the product (GAP-AUDIT B-12 and the seven stale strings).
Deliverables: `/account/connections` linked from the avatar menu, closing the same defect P5-T08 already fixed twice; `notFound()` on `kpis/[id]`, so an unknown or forbidden id is a 404 rather than the root error boundary; the seven stale on-screen strings removed or corrected where the task they name has landed; the four unused `shell.mobile.*` catalogue keys removed; the e2e specs whose `sNN` prefix names the wrong screen renamed; CLAUDE.md's repo layout reconciled with the Coach and the Champion living in `packages/core/src/agents/`.
Test plan: a test asserts every account page in the module registry is in the avatar menu, so the next page added cannot repeat this; an unknown KPI id renders not-found; a gate refuses a new user-facing string naming a task id.
Acceptance: Given a signed-in member, when they open the avatar menu, then every account page they may reach is listed; and given a KPI id that does not exist, then the page is a 404.

### P6-G04: Storage: the chart's defaults corrected [S]
Depends on: P1-T10
Goal: a default Helm install does not lose uploads (GAP-AUDIT B-11).
Deliverables: `replicaCount` defaulted to 1 with `persistence.enabled` defaulted to true, so the shipped values are a combination that keeps files; the validation message's third remedy corrected, since it currently points at an S3 driver that does not exist; a refusal when several replicas are asked for with no shared storage, rather than an `emptyDir` that silently diverges; NOTES.txt saying where files land and what to change to scale out.
Test plan: the chart's own behaviour checks cover the new default combination, a multi-replica install with no shared storage refused by name, and a multi-replica install with `ReadWriteMany` accepted.
Acceptance: Given the chart installed with no values overridden, when a file is uploaded and the pod restarts, then the file is still there.

### P6-G05: Storage: the S3-compatible driver [M]
Depends on: P6-G04
Goal: the storage claim in PLAN.md becomes true (GAP-AUDIT B-11).
Deliverables: an S3-compatible `FileStorage` driver in `packages/adapters`, using the two AWS SDK entries already on the boundary allow-list, with signed put and get URLs, a configurable endpoint so MinIO and every compatible service work, and `stop()` releasing its HTTP client; environment variables in the `packages/config` schema with local disk staying the default when none is set; the driver selected by a factory in `apps/web/lib/storage.ts` the way the mailer already is; the first-run wizard reporting which storage is in use; the chart offering it and dropping the persistence requirement when it is set.
Test plan: prepare, upload, claim and download against a local MinIO, skipped with a stated reason when none is reachable, the way the MySQL connector suites already skip; an unset endpoint falls back to local disk; a signed URL expires; the boundary gate still refuses the SDK outside `packages/adapters`.
Acceptance: Given two replicas with the S3 driver configured, when one uploads a file, then the other serves it.

**P6-G06 was cut in two, at the seam between issuing and redeeming.** Issuing is
a workspace-scoped screen and needs one new read. Redeeming is not scoped to a
workspace at all: the visitor holds an opaque token and no membership, so
resolving it means reading `invite_links` across tenants, and that table's
row-level security is keyed on `workspace_id`. It needs the second-key policy
`api_tokens` got at P5-T07a, which is a migration, plus a route, plus the
closed-instance registration path. That is its own session.

### P6-G06a: Issuing invitations [M]
Depends on: P2-T04
Goal: an administrator can invite somebody and see what they have issued (GAP-AUDIT B-07).
Deliverables: an invitation card in workspace admin: a single-use personal invitation by address, a reusable workspace link with its use count, maximum uses, expiry and allowed domains, revoke, and the list of what has been issued with what each one is doing; `invitations.list`, which P2-T04 never built, so an administrator could issue a link and then had no way to see or revoke it; the token shown once, never in the list.
Test plan: the list carries no token on any path; a revoked link stays in the list and says so; a personal link reports its address, its single use and its expiry; a member below `full` is refused the list as well as the create.
Acceptance: Given an administrator on the invitation card, when they issue a personal invitation, then the token is shown once, the list records it, and revoking it changes its state without removing it.

### P6-G06b: Accepting an invitation [M]
Depends on: P6-G06a
Goal: the link an administrator hands out goes somewhere (GAP-AUDIT B-07).
Deliverables: a migration giving `invite_links` the second-key row-level security policy `api_tokens` has, so a token digest admits exactly its own row without a tenant being known; a cross-tenant `previewInvite` in `packages/core` answering what a token is for without consuming it; the `/join` route, for a signed-in visitor and a signed-out one; registration allowed on a closed instance when, and only when, a valid token says so; trusted-domain joining offered where the workspace allows it; the address rendered on the issuing card, which shows only the token until this lands.
Test plan: a valid token names its workspace without incrementing its use count; an invalid, revoked, expired or used-up token refuses identically; a closed instance refuses registration without a token and allows it with one; a personal token refuses an address it was not issued to; two visitors racing one single-use token produce one member.
Acceptance: Given a closed instance and a personal invitation, when the invitee follows the address, then they create an account, land in the workspace with the provisioning defaults, and the audit names who invited them.

### P6-G07: The in-app inbox, S-03 [L]
Depends on: P2-T06
Goal: the notification spine gets its screen (GAP-AUDIT B-06).
Deliverables: the inbox route with the live badge UIUX-PLAN §3 puts beside Home and Review, an Inbox entry in the module registry's primary block, grouped and deep-linked rows, mark-read, mute and snooze, and the subscription toggle on every subject that has one; loading, empty, error and permission-denied states.
Test plan: a notification a member may not see never appears; snoozing hides the row and never hides a review-inbox obligation; the badge is live and clears on read; muting a subject stops new rows without deleting old ones.
Acceptance: Given a member mentioned in a comment, when they open the inbox, then the notification is listed, deep-links to the comment, and the badge clears.

### P6-G08: Member notification settings [M]
Depends on: P6-G07
Goal: the member half of the settings map is reachable (GAP-AUDIT B-06).
Deliverables: per-reason routing, the batching window, the daily summary time and the language, theme and density preferences on the member's own settings surface beside the primary channel and quiet hours already there; every field defaulted so the screen never blocks.
Test plan: every setting in the member scope resolves to its documented default on a member who has never opened the screen, enumerated from the registry rather than a fixed list; changing the summary time moves when it fires; a per-reason routing change takes effect on the next notification.
Acceptance: Given a member who changes their batch window to ten minutes, when four notifications arrive inside it, then they receive one digest listing four items.

### P6-G09: The people directory and org chart, S-33 [L]
Depends on: P2-T03
Goal: members are visible as people (GAP-AUDIT B-08).
Deliverables: the directory with search and filters, the profile screen with the self-versus-others editable field sets, and the org chart from the manager chain; loading, empty, error and permission-denied states.
Test plan: a suspended member is excluded from the directory for everybody but an administrator; a manager cycle cannot be created from the profile editor; a guest sees the directory at their own level; the chart renders a chain several levels deep without a cycle.
Acceptance: Given a workspace with a manager chain, when a member opens the directory, then every member they may see is listed and the chart draws the chain.

### P6-G10: The people lifecycle controls [M]
Depends on: P6-G09
Goal: a leaver can be handled without the command line (GAP-AUDIT B-08).
Deliverables: suspend, restore, convert-to-guest and erasure on the profile screen behind their access level, each with a confirmation naming exactly what will happen and what will survive; the last-owner invariant surfaced as a refusal with its reason; the erasure export offered as a download.
Test plan: suspending removes every access and restoring returns it; converting to guest leaves no stale binding; erasure keeps authorship readable under the placeholder identity and produces the export; removing the last owner is refused by name.
Acceptance: Given an administrator erasing a member, when it completes, then that member's comments still read with an anonymised author, an export is produced, and the audit names who ran it.

### P6-G11: The activity feed, S-31 [M]
Depends on: P2-T07
Goal: the typed event log gets its screen (GAP-AUDIT G-01).
Deliverables: the per-kind renderer registry rendered at workspace, space, goal and profile scope; the feed on each of those surfaces; live inserts; key-based pagination; the aggregation rules already in the engine respected on screen.
Test plan: a private-space activity never appears in a non-member's workspace feed; five consecutive field edits collapse into one row and a check-in never does; a soft-deleted subject drops out; a live insert appears without a reload.
Acceptance: Given a member without access to a space, when they read the workspace feed, then no activity from it appears, while a member of that space sees typed, readable entries.

### P6-G12a: The AI console: provider, keys and models [L]
Depends on: P2-T13, P2-T14
Goal: AI can be turned on from the product (GAP-AUDIT B-05).
Deliverables: screen S-37's first cards: the provider and its state, the workspace and personal credential flows with the key written once and never read back, rotation, and the model catalogue with add and edit for custom models carrying their own context window and cost; the tier routing card; every affordance hidden or disabled with the provider off.
Test plan: a key is stored envelope-encrypted and never returned; rotation re-wraps without losing access; a custom model meters cost from its own figures; a workspace that has supplied only a key resolves every tier through the driver's seeded map; the screen is refused below `manage_ai`.
Acceptance: Given an administrator with no AI configured, when they paste a provider key, then AI features become available in the same session and no key is ever rendered back.

### P6-G12b: The AI console: features, prompts, budgets and usage [L]
Depends on: P6-G12a, P2-T16
Goal: cost and behaviour are visible and bounded from the product (GAP-AUDIT B-05).
Deliverables: the feature switches, the versioned prompt editor with restore, the budget and hard-cap cards per user, per agent and per workspace, the usage summary with its anomaly flags, and the privacy and egress card.
Test plan: crossing a quota disables the feature with a clear message and every manual path still works; a prompt version change is recorded and reversible; a hard cap halts a running agent with the reason in its log; the usage figures match the metered events.
Acceptance: Given a workspace at its hard cap, when an agent run is in progress, then the console shows it halted with the reason, and every deterministic path is unaffected.

### P6-G13: Agent configuration and the proposal review queue [L]
Depends on: P2-T17, P4-T05a, P4-T06a
Goal: the propose-and-approve default has a surface (GAP-AUDIT G-05).
Deliverables: agent detail on S-38 gaining enable and disable, the write policy of sandbox, propose or scoped direct, and least-privilege binding on named spaces, goals and KPI trees; run cancellation; the proposal review queue with the envelope rendered as what would change, bulk apply and bulk dismiss, and the same queue reachable from the review inbox.
Test plan: an agent in propose mode commits nothing until a proposal is applied, and applying goes through the Operation pipeline with audit; a binding cannot be widened to the workspace; cancelling a run stops it and says so in its log; a dismissed proposal cannot be applied afterwards.
Acceptance: Given an agent proposal, when a member applies it from the queue, then the change lands through the pipeline, the audit names both the agent and the member, and the proposal cannot be applied twice.

### P6-G14: Cycle phase 0, the annual frame, S-05 [M]
Depends on: P3-T03, P4-T02
Goal: the annual strategy has a surface (GAP-AUDIT B-03).
Deliverables: the frame editor for mission, vision, mid-term strategy, year and horizon; the two to five annual strategies with what each means in practice; the annual OKRs with their serving strategy; the year's not-doing list; sending an annual objective forward into drafting; the Coach's flag on a frame with unresolved disagreement.
Test plan: a quarterly cycle marks the phase not-applicable rather than to-do; the strategy count is bounded at both ends with the reason stated; an annual objective sent forward appears in drafting; the frame reads back exactly as written.
Acceptance: Given an annual cycle with no frame, when a facilitator opens phase 0 and writes one, then the phase mark computes as complete and the drafting surface offers the annual objectives.

### P6-G15: Cycle phase 6, run the cadence, S-11 [M]
Depends on: P3-T07, P4-T04, P4-T08
Goal: the running cycle has a surface (GAP-AUDIT B-03).
Deliverables: sessions held and upcoming, the streak, confidence per key result with its trend, open blockers by age, the decision log and the mid-cycle calibration record, all read-only aggregations of tables that already exist.
Test plan: the phase shows only what the reader may see, scoped by the same access filter the space list uses; a cycle with no sessions renders an empty state rather than zeroes; the calibration record appears once run.
Acceptance: Given a running cycle with two sessions held, when a member opens phase 6, then both are listed with the streak and every open blocker with its age.

### P6-G16: Cycle phase 7, review and learn, S-12 [M]
Depends on: P3-T15, P4-T12
Goal: the close has a surface (GAP-AUDIT B-03).
Deliverables: scoring every key result with the band table highlighted at the portfolio average, carry-forward flags, the retrospective split into business and process questions, and the feed-forward action opening the next cycle with scores and carry-forward items already placed.
Test plan: the highlighted band matches the computed portfolio average; carry-forward arrives unticked, per METHOD.md §8.9; the feed-forward action is idempotent; the arithmetic matches `packages/method` exactly.
Acceptance: Given a cycle at its close, when a facilitator scores every key result and runs feed-forward, then the next cycle opens carrying the scores and the flagged items, and running it twice changes nothing.

### P6-G17: The dependency register on phase 5, S-10 [M]
Depends on: P3-T09, P4-T03
Goal: publish gate 4 can be satisfied from the browser (GAP-AUDIT B-04).
Deliverables: the dependency register block on phase 5 with key result, providing team, confirmed and risk owner per row; confirm, remove and name-a-risk-owner controls; the alignment mapping block S-10 also asks for, or a link to S-16 where it already lives, decided in the design note; gate 4's remediation link pointed at the register rather than at the page it is already on.
Test plan: a cycle carrying an unconfirmed dependency fails gate 4 and passes once confirmed; a dependency logged with a named risk owner also passes; removing a dependency updates the gate without a reload; a reader below edit sees the register and no controls.
Acceptance: Given a cycle with one unconfirmed dependency, when a facilitator confirms it from phase 5, then gate 4 turns green and the publish control becomes available.

**P6-G18 was cut in two.** The six writes P3-T01 shipped need surfaces and
nothing else: they exist, they are tested, and wiring them is one session. The
settings surface is not that. `spaces.settings` is a `jsonb` column nothing
writes and the settings registry has no space-scope entry at all, so team
voting, the strictness override and the space defaults have to be declared in
the §4.14 map with defaults before a screen can show them.

### P6-G18a: Spaces: create, rename, archive and membership [M]
Depends on: P3-T01
Goal: a workspace is not stuck with the one space provisioning made (GAP-AUDIT B-09).
Deliverables: space creation with an optional first manager; rename and rewrite the mission; archive, with what survives it stated on the control; membership management with all three §4.2 roles, add and remove, beside the join and leave already there; each control drawn at the level its action declares, and refusing independently.
Test plan: archiving a space hides it without deleting its goals; a space manager may manage membership and a plain member may not; the last manager cannot be removed; a refusal renders as its sentence rather than an error boundary.
Acceptance: Given an administrator, when they create a space and name a manager, then that manager can manage its membership and nobody else can.

### P6-G18b: The space settings surface [M]
Depends on: P6-G18a, P2-T08
Goal: TECHNICAL-PLAN §4.14's space scope exists (GAP-AUDIT B-09).
Deliverables: the three settings §4.14 names for a space declared in the settings registry with defaults a space resolves without configuration: team voting opt-in, the strictness override, and the space defaults; the action that writes them; the surface on the space page behind the space manager's level; the §4.14 map updated in the same change if any of the three turns out to need a different shape.
Test plan: every space setting resolves to its documented default on a space where nothing was configured, enumerated from the registry rather than a fixed list; a strictness override changes what the Coach refuses in that space and nowhere else; resetting restores the defaults exactly.
Acceptance: Given a space that has configured nothing, when every space setting is read, then each returns its documented default, and a space that turns team voting off stops offering it.

### P6-G19: The weekly session's trend, blockers, streak and commitments [L]
Depends on: P4-T07b, P4-T07c, P4-T08
Goal: S-22 shows the data its tables already hold (GAP-AUDIT B-10).
Deliverables: the twelve-week confidence trend, the streak ribbon, the open blockers with ages and last week's scores on the space home; the commitment stage with the previous week closed as delivered or not and the new week set with owner and linked key result; the commitment rollover at session open that P4-T08 deferred; the coordinator note rendered in the digest; the blocker controls of raise, resolve and reassign; the placeholder card removed.
Test plan: closing a session rolls this week's commitments into next week's list to close; a skipped week breaks the streak and a held one extends it; the digest content matches the session record exactly; the stage gate refusing fewer than two commitments is reachable and its message is readable.
Acceptance: Given a completed session, when it closes, then the digest is generated with correct figures, the streak advances, last week's commitments are closed, this week's are open, and the space home shows all of it.

### P6-G20: Rhythm and threshold cards [M]
Depends on: P2-T08, P4-T01
Goal: the METHOD §11 registry is configurable (GAP-AUDIT G-03).
Deliverables: the rhythm and thresholds cards covering the §11 registry rather than three of its rows: frequency, anchor day, grace, clocks, ladders, bands, corridors, caps, boundaries and timings, plus the terminology labels `packages/method` already implements; per-card reset to default; every value read from the registry so no threshold is restated here.
Test plan: a card enumerates the registry rather than a fixed list, so a threshold added later appears without a code change here; resetting a card restores the canon defaults exactly; an out-of-range value is refused with the bound stated; a renamed term propagates to every surface that shows it.
Acceptance: Given a workspace that changes its check-in grace, when a goal passes the new grace, then it flips to outdated on the new boundary and no other threshold moved.

### P6-G21: Nudge rule cards [M]
Depends on: P4-T04c, P5-T02c
Goal: a workspace can turn a rule down (GAP-AUDIT G-04).
Deliverables: per-rule enable, channel override, ladder override and quiet-mode exemption; workspace quiet mode; strictness with per-space overrides; each row linking to the rule in METHOD.md and showing its recent volume from the card already there.
Test plan: a disabled rule stops producing nudge rows and produces a suppression reason instead of silence; a channel override routes the next nudge; a quiet-mode exemption still respects the escalation ladder; every rule resolves to its provisioning default on a workspace that configured nothing.
Acceptance: Given an administrator who disables the noisiest rule, when its trigger next fires, then no nudge is sent, a suppressed row records why, and every other rule is unaffected.

### P6-G22: The string catalogue and the locale [L]
Depends on: P2-T10
Goal: UIUX-PLAN §9's catalogue line is true (GAP-AUDIT G-08).
Deliverables: every user-facing string in the 47 routes moved into the catalogue, with the Bahasa Melayu keys stubbed; the locale wired from the member and workspace language settings rather than pinned to `en` in the root layout; the pseudo-locale check extended from the shell components to every route, so a hardcoded string fails the build.
Test plan: the pseudo-locale check runs over every route and fails on a deliberately hardcoded string; a member whose language is `ms` sees the stubbed catalogue; a key missing from `ms` falls back to `en` rather than rendering the key.
Acceptance: Given a member who sets their language, when they reload any screen, then it renders in that language, and a new hardcoded string anywhere fails the build.

### P6-G23: Theme and density control [S]
Depends on: P2-T10
Goal: the two states every UI task must verify are reachable (GAP-AUDIT G-09).
Deliverables: a theme and density control on the member's settings surface and in the avatar menu, calling the `setTheme` and `setDensity` the provider has always exposed and nothing has ever called; the preference persisted per member rather than only in the browser, so it follows them; the pre-hydration script reading what the control writes.
Test plan: switching theme survives a reload and a second device; compact density changes row heights on a virtualised table; reduced motion is still honoured in both themes.
Acceptance: Given a member who chooses dark and compact, when they sign in on another browser, then the product renders dark and compact with no flash of the other.

### P6-G24: Loading and error boundaries [M]
Depends on: none
Goal: a slow read and a failed read both look like themselves (GAP-AUDIT G-06, G-07).
Deliverables: a loading state on every route whose reads are not instant, through `loading.tsx` or a Suspense boundary around the slow region rather than the whole page; section-level error boundaries so a failure in one card does not replace the shell; a `global-error.tsx`; a not-found path on every dynamic route.
Test plan: a deliberately slow read renders the loading state and then the content; a thrown read inside one card leaves the sidebar standing; every dynamic route returns not-found for an id that does not exist; the permission-denied state is distinct from not-found only where an existence oracle is acceptable.
Acceptance: Given a route whose read takes two seconds, when a member navigates to it, then they see a loading state immediately and the content when it arrives.

### P6-G25: Workspace state and the freeze overlay [M]
Depends on: P2-T09
Goal: the control P6-T07's rehearsal depends on exists (GAP-AUDIT, the admin table).
Deliverables: the workspace state of active, suspended and frozen on the general card; the freeze overlay every screen shows when the workspace is frozen, with the admin recovery list still reachable; `workspace.setState` bound to it with its audit event.
Test plan: a frozen workspace refuses every write with a readable reason and still serves reads; an administrator reaches the recovery list from inside the overlay; unfreezing restores writes; the state change is audited with the acting principal.
Acceptance: Given a frozen workspace, when a member tries to write, then the overlay explains why and the administrator can lift it.

### P6-G26: Onboarding, S-34 [L]
Depends on: P3-T17
Goal: a first sign-in as owner leads somewhere (GAP-AUDIT G-02).
Deliverables: the four-step onboarding after the first sign-in, every step skippable over the TECHNICAL-PLAN §4.14 defaults; the demo-data choice P3-T17 built the action for and the wizard never offered; the citation in this document corrected so S-34 has one owner rather than two.
Test plan: skipping every step leaves a working workspace practising the full method; choosing demo data seeds it idempotently; onboarding does not reappear once finished; a second owner does not see it.
Acceptance: Given a first sign-in as owner, when they skip every step, then they land on a working workspace with every setting at its documented default.

### P6-G27: Detail-page write paths [M]
Depends on: none
Goal: the registered actions with no browser caller either get one or get a reason (GAP-AUDIT §5).
Deliverables: delete on goals, initiatives, tasks and documents with the soft-delete semantics stated on the confirmation; checklist item removal; `goals.moveToCycle`, `goals.reviewDecision` and `goals.unlinkKpi` on goal detail; `reactions.remove`, so a reaction can be taken back; `cycles.create`, `update` and `archive`, so a workspace reaches next quarter; the attachment flow on documents and initiatives, wiring the four `blobs.*` and three `attachments.*` actions that have no caller; `workspace.rename` and `workspace.overview` on the general card; a note in the audit for any action deliberately left without a browser path.
Test plan: a soft-deleted goal leaves its history readable and drops out of every default-scoped read; a removed reaction is gone for everybody; a cycle created from the browser gets the §4.14 defaults; an attachment survives a page reload and respects the workspace byte quota.
Acceptance: Given a member with edit access on a goal, when they move it to the next cycle, then the move is audited and both cycles read correctly.

### P6-G28: The initiative's tasks and documents, S-26 [S]
Depends on: P5-T11, P5-T12
Goal: the two panels the initiative page still says are coming (GAP-AUDIT, the initiatives row).
Deliverables: the tasks panel driven by `tasks.linkedWork`, so initiative progress reads as the share of its own tasks that are done rather than zero for everybody; the documents and attachments panel; the "What is not here yet" card removed.
Test plan: an initiative with three tasks, one done, reads 33 per cent; an initiative with no tasks renders an empty state rather than a zero bar; a document attached to the initiative appears and survives a reload.
Acceptance: Given an initiative with tasks, when a member opens it, then the tasks are listed and the progress figure matches them.

### P6-G29: The missing end-to-end paths [M]
Depends on: every row above that adds a screen
Goal: the Definition of Done's one-happy-path-per-screen line is true (GAP-AUDIT G-10).
Deliverables: an end-to-end path for each of the 16 routes that has none, plus one for every screen G06 to G26 adds; the spec naming convention fixed so a file's prefix names the screen it covers.
Test plan: the suite is the test plan. Each spec drives the screen's happy path through the real standalone server against a seeded database.
Acceptance: every route in the module registry has at least one end-to-end path, asserted by a test that enumerates the registry rather than a fixed list.

### P6-G30: The KPI grid's sparklines, subtotals and filters [M]
Depends on: P3-T12, P3-T13
Goal: finish S-20 (GAP-AUDIT, the `/kpis` row).
Deliverables: the row sparkline and the category subtotal, both computed with the aggregate rules already in `packages/method`; filters by frequency, owner, category and state following the goals explorer's pattern; the formula chip on a calculated cell; the "Not here yet" card removed.
Test plan: a subtotal matches the method function exactly rather than being summed here; a sparkline on a KPI with one record renders without a line and says so; a filter combination survives a reload through the URL; a calculated cell shows its formula and stays read-only.
Acceptance: Given a category with three KPIs, when a member opens the grid, then the subtotal matches `packages/method` and each row draws its own twelve-period sparkline.

### P6-G31: A read action's declared access level is enforced [M]
Depends on: P2-T02, P5-T07a
Goal: `access` on a read means something (found at P6-G06a).
Deliverables: an audit of every `defineReadAction` whose declared level is above `view`, sorting each into one whose rows are already access-scoped by the getter and one whose are not; enforcement inside every read in the second group, or in the builder if the shape allows it; a test per enforced read that an ordinary member is refused; a note on `defineReadAction` saying which of the two a new read must be.
Test plan: a member below the declared level is refused each affected read over `callAction` and over REST with an ordinary token; a member at the level still reads; a read whose rows are access-scoped is unaffected and still returns the caller's own subset.
Acceptance: Given an ordinary member's REST token, when they call a read declaring `full`, then the instance refuses, and a test enumerating the registry fails if a future read declares a level nothing checks.

**Why this is a row at all.** `defineReadAction` records `access` and nothing
reads it back: not the builder, not `callAction`, not the REST, agent or chat
transports, which take it only as the scope name. In the browser the admin
layout refuses below `full` before the page renders, so the screens are safe.
Over REST they are not. `invitations.list` was written at P6-G06a, found to
have exactly this hole, and enforces its own level in the handler with the
reason written above it; `imports.listRuns` and the nudge volume read are the
two others already visible, and the sweep is what finds the rest.

**Gap closure exit:** the scheduler running, S-02 complete, six screens built, the cycle whole across all eight phases, publish gate 4 satisfiable, spaces manageable, the session showing its own data, storage safe by default, the catalogue real, and an end-to-end path per screen.

---

# Phase 7: Hardening

### P7-T01: Performance budgets and indexing at scale [L]
Depends on: Phase 6 complete
Deliverables: the large seeded dataset of 100,000 goals and key results and 1,000,000 tasks in one workspace; every TECHNICAL-PLAN.md §13.1 budget measured in continuous integration; the query-count budget enforced on list endpoints; an index and plan review with fixes.
Acceptance: every budget row is green on the large dataset in continuous integration.

### P7-T02: Load and soak testing [M]
Depends on: P7-T01
Deliverables: load scripts covering hundreds of concurrent members in one workspace with check-in bursts, a live session with twenty participants, feed reads, board drags, chat inbound and external agent traffic; a soak run; fixes.
Acceptance: no errors and within budget at the target concurrency, with realtime fan-out bounded and nudge delivery inside its budget.

### P7-T03: Security review, supply chain and tenant fuzzing [L]
Depends on: Phase 6 complete
Deliverables: every TECHNICAL-PLAN.md §8.2 control verified or ticketed; the tenant property and fuzz suite firing random cross-tenant probes at every table and requiring zero rows, plus a policy-removal mutation check; a header and policy audit; a dependency audit, bill of materials and signed-image verification; the outbound-request rules exercised.
Acceptance: no high findings remain open, and every control row carries either a verified mark or an accepted-risk note signed off by the human.

### P7-T04: Agent, nudge and channel safety hardening [M]
Depends on: P7-T03
Deliverables: the agent safety suite (sandbox commits nothing, proposals commit nothing until applied, a cost cap halts a run mid-flight, an injected instruction in retrieved content cannot exceed the agent's bindings); the nudge suite (deduplication under bursts, quiet hours deferral, one escalation step at a time, snooze never hiding an obligation, a simulated month under the volume ceiling); the channel suite (signature verification rejects tampering, an unlinked sender receives nothing, a chat write appears in audit with its channel, rate limits behave).
Acceptance: every suite passes, and a deliberately injected instruction inside a retrieved document fails to make the Coach exceed its scope.

### P7-T05: Accessibility audit and web vitals [M]
Depends on: P7-T01
Deliverables: automated accessibility checks across every screen wired into continuous integration and failing on serious findings; keyboard-only walkthrough scripts for the primary flows including both sessions; performance budgets on the seeded dataset; fixes; the screen-reader smoke procedure.
Acceptance: continuous integration blocks a change that introduces a serious accessibility finding or breaks a web vitals budget.

### P7-T06: Observability [M]
Depends on: Phase 6 complete
Deliverables: traces and metrics for requests, Operations, outbox lag, jobs, nudge delivery, channel delivery, session synchronisation, agent runs, authorisation outcomes and AI usage; self-hostable dashboards; opt-in and documented, with no telemetry leaving by default.
Acceptance: a self-hosted installation sees its own dashboards with zero external calls.

### P7-T07: Method conformance audit [M]
Depends on: P4-T01g
Deliverables: a full pass comparing every rule, threshold, band, corridor, taxonomy, gate, agenda and diagnostic in METHOD.md against `packages/method` and against the behaviour observed in the running product; the coaching-prompt corpus reviewed for tone and accuracy against the tuned false-positive rate; any drift corrected in the document or the code, whichever is wrong.
Acceptance: the conformance suite is complete, and a human confirms that a sample of twenty real OKR drafts receive verdicts they agree with.

### P7-T08: Privacy: export, erasure and retention [M]
Depends on: P7-T03
Deliverables: personal data export and erasure as anonymisation tested end to end; retention settings for message logs, nudge records and agent run logs; a review that no personal data reaches logs, prompts or telemetry.
Acceptance: Given an erasure request, when it completes, then the member's content survives anonymised, an export is produced, and no personal data of theirs remains in message logs, prompts or telemetry.

### P7-T09: Release engineering and the upgrade contract [L]
Depends on: P7-T03
Goal: a release is produced by a pipeline, and an instance any supported distance behind reaches it without losing data, per PLAN.md §5.1.
Deliverables: changesets wired into the repository, producing the version, changelog and release notes on tag, and failing the build for a release with no changeset; a software bill of materials produced per release and attached to it; image signing moved from P1-T10's tag step into the same pipeline, so one job owns the whole artifact set; the upgrade matrix in continuous integration, which builds the upgrade baseline (a pinned commit until the first public release exists, the oldest supported release after it), boots it on Compose, seeds a workspace through the factory, upgrades to the current commit and asserts the workspace is intact and a member signs in, with the same run against the Helm chart in kind; a pre-upgrade database dump taken by the lifecycle helper into a named volume, keeping the last three and refusing to upgrade when it cannot dump, with an opt-out for external databases; the helper's rollback guidance corrected from "run the previous tag" to the restore procedure; the PLAN.md §5.1 expand-then-contract rule added to the migration linter, so a migration that drops or renames a column names the earlier release that added its replacement.
Test plan: the upgrade matrix fails first against a deliberately destructive migration dropping a column the baseline still reads; the helper refuses to upgrade when the dump path is unwritable; a dump is taken, the upgrade applies, and restoring the dump with the previous image returns the instance to its prior state; the linter rejects a same-release drop and accepts a two-release one; a release with no changeset fails the build.
Acceptance: Given an instance on the upgrade baseline with real data, when the lifecycle helper upgrades it to the current release, then a backup exists, the migrations apply, the data is intact, and restoring the backup with the previous image returns the instance to where it started.

---

# Phase 8: Cloud, enterprise and launch

### P8-T01: Cloud design gate [DESIGN GATE] [M]
Depends on: Phase 7 complete
Goal: the design documents for vendor operation.
Deliverables: design documents covering tenant provisioning and lifecycle, per-tenant limits and noisy-neighbour protection, the operator console's surface and its boundaries, the support-access contract, and the plan and seat model behind its flag.
Acceptance: the human approves with an explicit statement.

### P8-T02: Tenant provisioning, signup and onboarding [L]
Depends on: P8-T01
Deliverables: the tenant table and provisioning Operation; cloud signup with email verification and workspace creation; the onboarding flow (screen S-34) shared with self-host, every step skippable over the TECHNICAL-PLAN.md §4.14 defaults; the workspace lifecycle of active, suspended and closed with data retention on closure; region recorded per tenant.
Acceptance: Given a new cloud signup, when the member dismisses onboarding entirely, then they land in a working workspace running the default rhythm with the coach and gates active, and the tenant record carries its plan and region.

### P8-T03: Operator console [L]
Depends on: P8-T02
Deliverables: the instance-operator role separate from every workspace role; list, inspect and suspend workspaces; instance feature flags; site messages that are dismissible, targeted and expiring; per-tenant health and usage. Every action audited. Absent entirely on self-hosted instances.
Acceptance: Given an operator suspending a workspace, when a member of it signs in, then they see a clear message, the workspace is read-only, and the suspension is recorded with its actor and reason.

### P8-T04: Transparent support access [M]
Depends on: P8-T03
Deliverables: time-boxed, reason-recorded operator access to a workspace, requiring an explicit grant, visible to the workspace owner in their inbox and in the audit log, with every action attributed to the operator and an automatic expiry.
Acceptance: Given a support session, when it expires, then access ends automatically and the owner can see who was in their workspace, when, and what they did.

### P8-T05: Plans, seats and limits [M]
Depends on: P8-T04
Deliverables: plan definitions, seat counting and workspace limits behind a flag that is off for self-host; enforcement at the member-provisioning funnel; upgrade and downgrade paths; no feature gating anywhere.
Acceptance: Given the flag off, when any limit is evaluated, then it is unlimited and no billing surface appears; and given it on, then seat limits apply at invitation while every feature stays available.

### P8-T06: Cloud operations [M]
Depends on: P8-T05
Deliverables: per-tenant rate and resource limits; a public status surface; per-tenant backup verification; the incident runbook; capacity dashboards.
Acceptance: Given one tenant generating heavy load, when limits engage, then other tenants stay inside their performance budgets.

### P8-T07: Single sign-on [L]
Depends on: Phase 7 complete
Deliverables: OIDC and SAML through the authentication layer, with just-in-time provisioning landing in the one member funnel; per-workspace configuration; enforcement options.
Acceptance: Given a configured identity provider, when a user signs in through it, then they are provisioned with default access and their session behaves identically to a password session.

### P8-T08: Directory sync and provisioning [L]
Depends on: P8-T07
Deliverables: directory synchronisation of users and groups mapped to members and space membership, plus the provisioning protocol where deactivation maps to suspension and never to deletion.
Acceptance: Given a user removed from the directory, when the next synchronisation runs, then the member is suspended and every token and grant of theirs stops working.

### P8-T09: Multi-factor policy [S]
Depends on: P8-T07
Deliverables: an organisation-mandated second factor where members without one are held in the enrolment flow at their next sign-in.
Acceptance: Given the policy enabled, when an unenrolled member signs in, then they are locked into enrolment before reaching any other screen.

### P8-T10: Audit export, chain verification and the air-gap guide [M]
Depends on: Phase 7 complete
Deliverables: filtered audit export; the hash-chain verification tool with an admin action; the documented fully offline installation validated on an isolated machine with AI local or off and no external calls.
Acceptance: Given a tampered audit row, when verification runs, then it is detected and located; and the air-gap checklist passes on an offline machine.

### P8-T11: Documentation site [M]
Depends on: Phase 7 complete
Deliverables: user, administrator and API documentation with the generated reference; the importer runbook; the deployment quickstarts for Compose, Helm and cloud; and the OKR handbook derived from METHOD.md, written for practitioners rather than builders.
Acceptance: a new administrator follows the quickstart to a working instance without reading the repository.

### P8-T12: Template gallery and rhythm guides [M]
Depends on: P8-T11
Deliverables: seeded templates: an OKR starter cycle with sample goals, key results and a KPI tree wired to the module; a company onboarding template; a product team space template; each selectable from onboarding. Plus short guides mapping common ways of working onto spaces, cycles and initiatives, as documentation only.
Acceptance: Given a fresh workspace created from the starter template, when it opens, then goals with a cadence exist, the Work Map is populated, and the first weekly session is scheduled.

### P8-T13: Hosted demo instance [M]
Depends on: P8-T12
Deliverables: the demo builder on a public instance, reset on a schedule, with sign-in as a sample persona and the agents running visibly in sandbox mode.
Acceptance: a visitor can explore a realistic workspace, see a coach nudge and a diagnostic, and the instance resets cleanly.

### P8-T14: Launch [S]
Depends on: P8-T13
Deliverables: the release, changelog, announcement, contributor onboarding with good first issues and the agreement bot live.
Acceptance: the tagged release installs from the documented path on a clean machine, in both self-hosted forms and in the cloud, and an instance on the previous release upgrades to it through the lifecycle helper with its data intact.

### P8-T15: The two unstable end-to-end specs [S]
Depends on: -
Goal: two specs that fail about one run in four stop failing, or say why they cannot.

**Recorded with its evidence on 3 September 2026, when the suite was run eleven times in one day for the first time.** Both were invisible until then, and neither is caused by the work that found them. `s36-channels`'s quiet-hours field fails a `toHaveValue`, which reads as the form settling after the assertion. `sessions`'s last stage fails a click on a 4-second timeout, which is the shortest timeout in the suite and the only one that is not the harness default. Continuous integration retries twice, so neither holds the pipeline today; that is what makes this a Phase 8 row rather than a Phase 6 one, and also what will hide it until somebody looks.

Deliverables: a root cause for each, named; a fix, or a quarantine entry with the sentence that says when it comes out again (CI-GATES.md's rule for `knip.json` applies here too).
Test plan: ten consecutive end-to-end runs with neither spec failing. The flakiness report is the record.
Acceptance: Given the end-to-end suite run ten times, when the reports are merged, then neither spec appears in the flakiness report.

---

## Appendix A: index

Phase 1: P1-T01 to T10 (10). Phase 2: P2-T01 to T17 (17). Phase 3: P3-T00 to T17 (18). Phase 4: P4-T00 to T15 (16). Phase 5: P5-T00 to T16 (35: P5-T01 cut into T01a, T01b-a and T01b-b, plus T01c for the session entry point; P5-T02 cut into a and b, plus T02c for the settings surface; P5-T03 cut into a and b; P5-T04 cut into a and b, and T04b again into b-a and b-b; P5-T06 cut into a, b and c; P5-T07 cut into a, b and c, and T07c again into c-a and c-b; P5-T08 cut into a, b and c; P5-T09 cut into a, b and c; P5-T10 cut into a and b; P5-T14 cut out of P5-T11; P5-T15 cut out of P5-T13, and re-sized from [S] to [M] while doing it; P5-T16 cut after the phase was otherwise complete, for a gap in the read builder that every later phase would widen. The count here read 35 while the phase held 34 rows, and the total read 126 while the plan held 125; P5-T16 is the row that makes both numbers true, not a correction of them). Phase 6: P6-T01 to T07 (17: P6-T01 cut into a and b before any code, because the mechanism and the screen that helps somebody describe their own columns fail differently, and P6-T01b cut again into b-a and b-b once the engine move showed the screen was a session of its own; P6-T03 cut into a, b, c and d before any code on 4 September 2026, because nine mapper groups, a formula parser and a reconciliation report are four sessions and they fail differently: identity resolution, a graph, history, a parser; P6-T04 cut into a, b and c before any code on the same day, for the same reason: four mappers, an HTML converter with a two-phase reference rewrite, a blob path, the consolidated report and a selective flag are more than one session; cut again into a, b, c and d later the same day, once the converter was built and measured and the blob path turned out to need the storage port and a source of bytes MySQL does not hold, so they fail as a graph, a content converter, a byte path and an orchestration; P6-T05 cut into a, b and c before any code on the same day, because a policy list over 129 tables, an identity remap and an admin card fail differently: a secret in the file, two people merged into one, and a screen). Phase 7: P7-T01 to T09 (9). Phase 8: P8-T01 to T15 (15: P8-T15 added on 3 September 2026 for two specs that turned out to be flaky when the end-to-end suite was run eleven times in a day). **137 tasks.**

Design gates requiring human approval: P3-T00, P4-T00, P5-T00, P8-T01. Spikes with a recorded decision: P1-T03, plus the golden-master matrices at P3-T00 and the rule corpus at P4-T00.

Specification authority per task type: user interface to UIUX-PLAN.md, schema to TECHNICAL-PLAN.md §4 with the §7.2 mapping, engines to TECHNICAL-PLAN.md §6, rules and rituals to METHOD.md, AI and agents to AI-NATIVE-PLAN.md, security to TECHNICAL-PLAN.md §8.2, performance to TECHNICAL-PLAN.md §13.

Importer tasks that must keep the §7.2 mapping current: P6-T01 through P6-T04, and P6-T07.

## Appendix B: designed for, not built

Serverless runtime profile, custom fields, configurable statuses and workflows, a saved-query language and view builder, Gantt with dependency scheduling, sprints and backlogs, time and cost tracking, meetings beyond the OKR sessions, calendar two-way sync, additional chat providers, incoming email, source-control work links, collaborative document editing, native mobile applications, and importers beyond FlowyTeam and spreadsheets. Each keeps a design-for note in TECHNICAL-PLAN.md §16. Pulling any of them into v1 requires the human.
