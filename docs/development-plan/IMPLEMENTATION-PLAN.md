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
Acceptance: Given a closed review with a carried learning, when the next cycle is fed forward, then that learning is a strategic issue at impact 4 and the `waiting` list is empty.

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

### P4-T14a: Copilot threads and grounded answers [M]
Depends on: P4-T13b, P1-T07
Goal: the assistant, reading (screen S-39).
Deliverables: threads and messages anchored to the workspace or an entity; the side panel with streaming and a stop control; grounded answers with citations only to what the viewer may see; the empty, AI off and capped states.
Test plan: a citation never points at something the viewer cannot read; the stop control ends the stream and leaves the thread readable.
Acceptance: Given a member asking about their goals, when the copilot answers, then every citation resolves to something they can open.

### P4-T14b: Copilot proposals and background runs [M]
Depends on: P4-T14a
Goal: the assistant, writing, and always as a proposal.
Deliverables: action proposals rendered as a preview or difference with apply and dismiss, committing through the normal Operation; long tool runs executing as background jobs and streaming back over realtime.
Test plan: a proposal the user lacks permission to apply is refused by the permission layer, not hidden by the interface; a background run survives a page reload.
Acceptance: Given a member asking the copilot to create a goal, when they approve the proposal, then the goal is created through the normal Operation with audit, an AI provenance chip and a working undo.

### P4-T15: Coaching and rhythm assists [M]
Depends on: P4-T14b, P4-T06c
Goal: the per-module assists (AI-NATIVE-PLAN.md §2).
Deliverables: draft a goal and key results from an ambition; rewrite a failing objective or key result to satisfy its rule; suggest metrics, units, baselines, targets and alignment parents; draft the overdue check-in from real activity; draft the weekly digest, the retrospective, the review minutes and the diagnostic narrative; suggest KPIs, thresholds and formulas from plain language; narrate a KPI trend; cluster retro notes into themes; propose next-cycle objectives from carried learnings; natural language to a validated list filter. Every one behind a feature switch, with provenance recorded and a preview before applying.
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

### P5-T01: Channel port, email driver and routing [L]
Depends on: P5-T00, P4-T04c
Goal: the delivery layer (AI-NATIVE-PLAN.md §5).
Deliverables: the channel port with send, verify, parse and capability reporting; the email driver as the always-available baseline with one-click action links; the connection and identity tables with envelope-encrypted credentials; per-member primary channel and quiet hours; the message log with idempotency; routing so every nudge, digest and escalation reaches the member's chosen channel; the message builder degrading to plain text with a link where a capability is missing.
Test plan: a nudge routes to the member's primary channel and falls back to email when it fails; an unlinked member falls back to email and in-app; the log records every send with its outcome; idempotency prevents a duplicate send on relay retry.
Acceptance: Given a member whose primary channel is unreachable, when a nudge is delivered, then it arrives by email, the failure is logged, and the member is told once that their channel needs reconnecting.

### P5-T02: Slack driver [L]
Depends on: P5-T01
Goal: the first chat provider.
Reference mockup: [09-channels](../stakeholder/mockups/png/09-channels.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: self-serve installation and workspace connection; identity linking; outbound rich messages with buttons for direct messages and space channels; inbound signature verification with replay protection; slash command and button action handling; a modal-based check-in.
Test plan: a tampered inbound payload is rejected; an unlinked sender receives nothing at all; a check-in submitted from a modal produces the same record as one from the browser, with the channel recorded in the audit entry.
Acceptance: Given a champion with a due check-in, when they receive the nudge in Slack and complete the modal, then the check-in is published, the cadence advances and the reviewer's obligation is created, identically to the browser path.

### P5-T03: Microsoft Teams driver [L]
Depends on: P5-T01
Goal: the enterprise chat provider.
Reference mockup: [09-channels](../stakeholder/mockups/png/09-channels.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the application manifest and tenant consent flow; connection and identity linking; adaptive card outbound for direct messages and channels; inbound verification; command and card action handling.
Acceptance: Given a Teams-connected workspace, when a blocker escalates, then the coordinator receives an adaptive card in Teams with the blocker, its age and an action to reassign or resolve.

### P5-T04: WhatsApp driver [L]
Depends on: P5-T01
Goal: the reach provider.
Reference mockup: [09-channels](../stakeholder/mockups/png/09-channels.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: Business API connection; template registration per nudge kind with the template-versus-free-form window handled by the message builder; identity linking with verification; conversational inbound handling for check-in and blocker capture; a documented setup runbook.
Test plan: an outbound message outside the conversation window uses an approved template; inside it, free form is used; a conversational check-in collects status, confidence, narrative and values across turns and can be abandoned safely.
Acceptance: Given a member whose primary channel is WhatsApp, when their check-in is due, then they receive the approved template, and replying walks them through the check-in conversationally to a published result.

### P5-T05: Telegram driver [M]
Depends on: P5-T01
Goal: the lightweight provider.
Reference mockup: [09-channels](../stakeholder/mockups/png/09-channels.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: bot connection, identity linking with a verification code, outbound messages with inline keyboards, and inbound command and callback handling.
Acceptance: Given a Telegram-linked member, when they send the status command with a goal identifier, then they receive that goal's health, progress, confidence and next check-in date, subject to their permissions.

### P5-T06: The chat command surface [L]
Depends on: P5-T02, P5-T03, P5-T04, P5-T05
Goal: one command surface generated from the action registry (AI-NATIVE-PLAN.md §5.3).
Deliverables: the command router mapping each command to exactly one registry action; the commands for check in, blocker, status, acknowledge, commit, ask and snooze; per-provider rendering from one definition; rate limiting per member and per provider; audit entries naming the channel.
Test plan: every command resolves to a registry action and is refused when the member lacks the access level; the same command produces identical results across all four providers; rate limiting returns a clear message rather than silence for a linked member.
Acceptance: Given a member without edit access on a goal, when they attempt a check-in from chat, then it is refused with the same message the browser would show, and the attempt is audited.

### P5-T07: Public contract projections: REST, OpenAPI and the command line [L]
Depends on: P1-T07, Phase 4 complete
Goal: the public surfaces generated from one registry (TECHNICAL-PLAN.md §14).
Deliverables: the versioned REST surface with cursor pagination, the filter grammar, typed errors and scoped hashed bearer tokens with separated audiences; the OpenAPI document generated from the schemas; the generated command line with typed flags, file inputs, profiles and a browser device login; the drift check comparing regenerated artifacts against the committed ones.
Test plan: a token without write scope is refused on every write; a forbidden resource returns not-found; the drift check fails when a registry action changes without regeneration.
Acceptance: Given a change to a registry action's schema, when continuous integration runs without regenerating, then the drift check fails naming the action.

### P5-T08: MCP authorisation server [L]
Depends on: P5-T07, P2-T09
Goal: the authorisation half of the external agent surface (AI-NATIVE-PLAN.md §8.2).
Deliverables: the authorise, token and registration endpoints; the consent screen with a workspace picker (screen S-40); discovery documents with their transport variants and preflight; client allow-listing, metadata documents and dynamic registration, all fetched through the outbound-request rules; native redirect rules; single-use codes consumed in a transaction; short-lived access tokens; refresh rotation with reuse detection that revokes the whole lineage; resource binding validated at issue and on every use; every secret stored hashed; revocation on membership loss.
Test plan: a replayed authorisation code is refused; a reused refresh token revokes the lineage; an API token is rejected at the agent endpoint and the reverse; losing membership invalidates the grant on the next call.
Acceptance: Given an external client completing the flow, when it later presents a rotated-away refresh token, then the entire grant is revoked and the user is told in their connections list.

### P5-T09: MCP transport, sessions and tool catalogue [L]
Depends on: P5-T08
Goal: the tool half (AI-NATIVE-PLAN.md §8.3).
Deliverables: the streaming HTTP transport and the local standard-input transport; session lifecycle bound to the grant with version negotiation, header discipline and origin validation; the tool catalogue generated from the registry with safety hints, scopes, schemas and examples, pinned by an invariant test; the permission-filtered global search tool and the fetch tool turning a canonical URL into cited content; read-only resources; prompt templates.
Test plan: a live end-to-end run over the real transport asserting that an under-privileged call is denied by the permission layer and no cross-tenant data appears in any result; the catalogue invariant test fails when a tool loses its safety classification.
Acceptance: Given an external agent holding read scope, when it calls a write tool, then the call is denied by the permission layer, the denial is audited, and the agent receives a clear error rather than a partial result.

### P5-T10: Initiatives [M]
Depends on: P5-T00, P3-T04
Goal: the work that moves a key result (screen S-26).
Deliverables: initiatives with owner, dates, status, confidence and capacity verdict; the many-to-many link to key results; the list and detail surfaces; the capacity view feeding the cycle's align-and-commit capacity check (METHOD.md §5.5) and its publish gate, beside the per-key-result verdicts from P3-T04.
Acceptance: Given an initiative linked to two key results and marked as exceeding capacity, when the cycle's gates are evaluated, then gate five is red and links to that initiative.

### P5-T11: Tasks and the OKR board [L]
Depends on: P5-T10
Goal: the board keyed to key results (screens S-27, S-28).
Deliverables: tasks with status, due date, description and checklist; multiple assignees where assignment grants edit access and notifies; the key result and initiative links; the board across a space, an initiative or a key result with drag, optimistic updates, live presence and concurrency-safe ordering normalised against deleted and completed items; the objective and key result rail with progress derived from linked completed tasks shown as a separate signal beside measured progress; the task detail page; review-inbox coverage for tasks due.
Test plan: two simultaneous reorders converge with no lost or duplicated cards; the derived linked-work signal never overwrites the measured key result value; assignment notifies everyone except the actor.
Acceptance: Given a key result whose linked tasks are all complete but whose measured value has not moved, when the Coach's divergence check runs, then it reports exactly that, naming both figures.

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
Test plan: a term inside a private space's document returns nothing for a non-member and a highlighted result for a member; an export matches the visible rows and columns exactly.
Acceptance: Given any screen, when the palette is opened and a short identifier typed, then the entity opens inside the budget.

**Phase 5 exit:** all four chat providers deliver and accept commands with one generated command surface; the coach reaches members where they are and respects quiet hours; the public REST surface, OpenAPI and the command line are generated with drift checked; the external agent surface works end to end over the real transport with authorisation proven by machine; initiatives, tasks and the board are joined to key results; documents, search, the palette and exports are live.

---

# Phase 6: Data: import, export, portability

### P6-T01: CSV and XLSX importer with the AI mapper [L]
Depends on: Phase 5 complete
Goal: the generic migration path (TECHNICAL-PLAN.md §7).
Deliverables: the import command and the admin wizard; entity templates for goals, key results, KPIs, KPI records, initiatives and tasks; column mapping either supplied or proposed by the AI mapper and confirmed by a human; a dry-run preview through the registry's validation endpoints; a per-row error report; idempotent upsert; persisted run records.
Test plan: a file with one bad row previews as creatable minus one with the error explained and imports exactly that on the real run; re-running changes nothing; with AI off the manual mapping path is complete.
Acceptance: Given a goals spreadsheet with unfamiliar headers, when the wizard runs, then a mapping is proposed, the human confirms or corrects it, the dry run reports accurately and the real run matches it.

### P6-T02: FlowyTeam connector [M]
Depends on: P6-T01
Goal: the read-only source (TECHNICAL-PLAN.md §7.1).
Deliverables: the import command with a required company selector; a read-only session where an attempted write must fail; introspection, required-table assertions and version inference; the multi-company guard; the report writer; the legacy identifier map.
Acceptance: Given a source database, when the dry run executes for one company, then it prints that company's schema summary, writes an empty report, and provably cannot write to the source.

### P6-T03: FlowyTeam strategy mappers [L]
Depends on: P6-T02, P3-T15
Goal: the OKR and KPI import (TECHNICAL-PLAN.md §7.2).
Deliverables: mappers for teams to spaces with members and managers, cycles and settings, objectives to goals with owner, champion and reviewer resolution and two-pass alignment, key results with values, check-ins into narrative rows with snapshots and acknowledgements, KPI categories, KPIs and records, formula token translation into the expression tree with unparseable formulas dropped and logged, and KPI sharing; derived values recomputed through the engines; per-domain reconciliation; dispatch suppressed; proven idempotency.
Test plan: against a seeded multi-company source, counts match, alignment is correct, a documented calculated KPI recomputes to the source value, a re-run changes nothing, and a second company imports alongside without collision.
Acceptance: Given one company, when the full strategy import runs twice, then the report and reconciliation are clean and the second run is a no-op.

### P6-T04: FlowyTeam work and collaboration mappers [L]
Depends on: P6-T03, P5-T11
Goal: the remaining domains.
Deliverables: mappers for projects to initiatives, tasks to tasks with status from the board column, key result links, sub-tasks to checklists, accesses to subscriptions, comments with HTML converted and a two-phase reference rewrite, and files to blobs and attachments; every unmapped construct recorded in the report rather than dropped; the consolidated report and human-readable summary; the full orchestrated pipeline in dependency order with the selective and dry-run flags verified; a mixed test importing a spreadsheet and a company into one workspace.
Acceptance: Given a seeded company, when the full import runs end to end, then counts reconcile, every skip is explained, derived values are engine-computed and a re-run is a no-op.

### P6-T05: Workspace export and import [L]
Depends on: P6-T04
Goal: portability (TECHNICAL-PLAN.md §7.3).
Deliverables: admin-triggered export to a versioned, checksummed, encrypted archive with a policy list excluding secrets, sessions, tokens, channel credentials and the audit chain; import with a dry-run difference, deterministic key remapping, member de-duplication by email and blob re-upload; the run interfaces.
Acceptance: Given an exported workspace, when it is imported into a fresh instance, then the dry-run difference is accurate, the import reconciles, and goals, check-ins, sessions and documents render identically.

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

---

## Appendix A: index

Phase 1: P1-T01 to T10 (10). Phase 2: P2-T01 to T17 (17). Phase 3: P3-T00 to T17 (18). Phase 4: P4-T00 to T15 (16). Phase 5: P5-T00 to T13 (14). Phase 6: P6-T01 to T07 (7). Phase 7: P7-T01 to T09 (9). Phase 8: P8-T01 to T14 (14). **105 tasks.**

Design gates requiring human approval: P3-T00, P4-T00, P5-T00, P8-T01. Spikes with a recorded decision: P1-T03, plus the golden-master matrices at P3-T00 and the rule corpus at P4-T00.

Specification authority per task type: user interface to UIUX-PLAN.md, schema to TECHNICAL-PLAN.md §4 with the §7.2 mapping, engines to TECHNICAL-PLAN.md §6, rules and rituals to METHOD.md, AI and agents to AI-NATIVE-PLAN.md, security to TECHNICAL-PLAN.md §8.2, performance to TECHNICAL-PLAN.md §13.

Importer tasks that must keep the §7.2 mapping current: P6-T01 through P6-T04, and P6-T07.

## Appendix B: designed for, not built

Serverless runtime profile, custom fields, configurable statuses and workflows, a saved-query language and view builder, Gantt with dependency scheduling, sprints and backlogs, time and cost tracking, meetings beyond the OKR sessions, calendar two-way sync, additional chat providers, incoming email, source-control work links, collaborative document editing, native mobile applications, and importers beyond FlowyTeam and spreadsheets. Each keeps a design-for note in TECHNICAL-PLAN.md §16. Pulling any of them into v1 requires the human.
