# IMPLEMENTATION-PLAN.md

The work, as ordered tasks. Each task has an identifier, dependencies, deliverables, a test plan and acceptance criteria. Claude Code executes one task at a time under the protocol in EXECUTION-GUIDE.md. A human reviews and merges every task.

Authority: this is the execution authority. It implements TECHNICAL-PLAN.md, AI-NATIVE-PLAN.md, UIUX-PLAN.md and METHOD.md. If a task conflicts with one of those, the design document wins and the task is corrected first.

| Phase | Theme | Tasks |
|---|---|---|
| 1 | Foundation | P1-T01 to P1-T10 |
| 2 | Platform and agent spine | P2-T01 to P2-T17 |
| 3 | The OKR core | P3-T00 to P3-T17 |
| 4 | The coaching layer | P4-T00 to P4-T15 |
| 5 | Reach: channels, agents, work | P5-T00 to P5-T13 |
| 6 | Data: import, export, portability | P6-T01 to P6-T07 |
| 7 | Hardening | P7-T01 to P7-T08 |
| 8 | Cloud, enterprise and launch | P8-T01 to P8-T14 |

**104 tasks.** Sizing: S is half a day or less, M is about a day, L is two to three days. Guidance, not promises. With the PLAN.md §11 throughput assumption of three to five merged tasks a week where large tasks count double, Phases 1 to 7 are a realistic seven to ten months. If actuals diverge by more than half over a month, re-baseline rather than slipping quietly.

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
Deliverables: the workspace and member tables per TECHNICAL-PLAN.md §4.1; a bootstrap flow where the first registration provisions a workspace with the user as its first member; the workspace switcher; the workspace setting wired from the member's active workspace.
Test plan: a fresh database, register, then a workspace and member exist; isolation verified across two workspaces; the same user joins a second workspace as a distinct member.
Acceptance: Given a first-run instance, when the first user registers, then a workspace exists with them as an active member and every query is scoped to it.

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
Deliverables: a settings service implementing the TECHNICAL-PLAN.md §4.14 settings map with validated storage where environment overrides win; the two-level admin shell; a typed module registry driving the sidebar and admin menus by access.
Acceptance: Given a module registering a navigation item that requires an access level, when a member lacks it, then the item is hidden and the route is denied.

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
Deliverables: the full port surface for chat, streaming, tool calling, embedding, structured extraction and capability reporting; drivers for Anthropic, OpenAI, OpenRouter, Ollama, any OpenAI-compatible endpoint and off; contract tests per driver against recorded fixtures; a deterministic mock driver for the test suite.
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
Deliverables: the seeded and refreshable model catalogue; per-workspace tier policies with sampling; the context-window guard; structured extraction with schema validation and one repair attempt then a clean failure; the versioned prompt registry with a default, an editor and restore.
Test plan: an oversized request is blocked before the call; malformed model output repairs once then fails cleanly; a prompt version change is recorded and reversible.
Acceptance: Given an air-gapped workspace mapping every tier to a local model, when any AI feature runs, then no external request is made.

### P2-T16: Usage metering, quotas and hard caps [M]
Depends on: P2-T14
Goal: cost visible and bounded (AI-NATIVE-PLAN.md §1.7, screen S-37).
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
Deliverables: spaces and space members with member, manager and coordinator roles; a creation Operation wiring the context, the standard group and manager bindings; the space home shell; join and leave; audit.
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
Acceptance: Given a weekly goal anchored to a chosen day and checked in the day before, when the cadence advances, then the next due date is the following anchor day, and three days plus the grace after a miss the goal renders outdated everywhere.

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

### P4-T01: The method package [L]
Depends on: P4-T00
Goal: METHOD.md as executable data and pure functions (TECHNICAL-PLAN.md §6.1).
Deliverables: `packages/method` with no database or network access, holding the twenty-six-check quality catalogue with word lists, conditions, statuses, prompts, reasons and example pairs; the score, confidence and portfolio bands; the progress signal; the KPI corridors; the blocker and root-cause taxonomies; the publish gates; phase completion conditions; session stage definitions with durations; the process-health statements and management-retro questions; the rhythm diagnostic; the facilitator guidance; the METHOD.md §11 threshold registry with its keys, types, valid ranges, defaults and override schema; and the nudge trigger catalogue from AI-NATIVE-PLAN.md §6.4 as data, so every proactive message's rule key resolves inside the package. Plus the pure evaluators over each, and the strength-score calculation with strictness as a parameter.
Test plan: a golden-master suite over every rule, band, corridor, gate and diagnostic; the corpus from the design gate produces its expected verdicts exactly; a conformance test comparing the package's rule keys and thresholds against METHOD.md fails on drift.
Acceptance: Given the corpus of real OKR drafts, when the package evaluates them, then every verdict matches the reviewed expectation, and changing a threshold in the document without changing the package fails the build.

### P4-T02: The quality engine and Draft Coach surfaces [L]
Depends on: P4-T01, P3-T04
Goal: quality at the point of writing (REQUIREMENTS.md §3.2, screen S-09).
Reference mockup: [03-draft-coach](../stakeholder/mockups/png/03-draft-coach.png), [03b-rule-card](../stakeholder/mockups/png/03b-rule-card.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: server-side evaluation on every goal and key result write, storing the strength score and flags; client-side evaluation as the user types, from the same package; the rule verdict component showing a status dot, a short label and on demand the coaching prompt, the reason and the example pair; the strength meter in the composer header; the quality panel listing every open issue across a set grouped by objective; a link from every verdict to the rule itself; per-workspace strictness.
Test plan: evaluation completes inside the sixteen-millisecond budget on the client for a five-key-result objective; server and client verdicts are identical for the same input; strict mode promotes every warning to a failure; the flags stored on the goal match the last evaluation.
Acceptance: Given an objective beginning with an output verb, when the champion types it, then the rule fails inline with its coaching prompt and example within one keystroke's latency, and the strength score drops immediately.

### P4-T03: Publish gates [M]
Depends on: P4-T02, P3-T03
Goal: the six gates as hard server-side enforcement (METHOD.md §4.5, screen S-10).
Reference mockup: [04-gates-capacity](../stakeholder/mockups/png/04-gates-capacity.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: gate evaluation from the method package over the cycle's whole set, recomputed on every relevant write; the gate checklist interface where each unmet gate links to what would fix it; the publish action refusing with the specific gate and reason; an override path that requires elevated access, a written reason and an audit event.
Test plan: each gate flips exactly on its condition; publishing with any gate red is refused server-side even when the interface is bypassed; an override records its reason and actor.
Acceptance: Given a set with one unconfirmed and unowned dependency, when the facilitator publishes, then it is refused naming gate four and linking to the dependency register.

### P4-T04: The nudge engine, triggers and escalation [L]
Depends on: P4-T01, P3-T08
Goal: the machinery that makes the product active (AI-NATIVE-PLAN.md §6.3, §6.4).
Reference mockup: [10-review-inbox](../stakeholder/mockups/png/10-review-inbox.png), [09-channels](../stakeholder/mockups/png/09-channels.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the nudge table and rule registry; the engine computing what is due now per member with deduplication of one per subject per member per day unless escalating; quiet hours in the member's timezone; workspace quiet mode; per-rule enable and channel override; escalation ladders for check-ins, acknowledgements and blockers; the suppression record with a reason; the nudge provenance component offering snooze, a channel change and a link to the rule; the volume dashboard with the noisiest rules, all administered from workspace admin (screen S-36) behind `manage_coaching`. Delivery goes to the in-app inbox and email in this task; chat channels arrive in Phase 5.
Test plan: a burst of triggers on one subject produces one nudge; an escalation advances exactly one step and is delivered even inside quiet hours when marked urgent; a snooze silences the nudge but never the review-inbox obligation; a simulated month against the demo workspace stays under the volume ceiling per member.
Acceptance: Given a champion who misses their check-in, when the engine runs over the following fortnight, then they are nudged on the due day and once daily after, the reviewer is brought in at the grace boundary, the coordinator at seven days and the sponsor at fourteen, each step recorded and visible to the champion.

### P4-T05: The OKR Champion agent [L]
Depends on: P4-T04, P2-T17
Goal: the rhythm agent (AI-NATIVE-PLAN.md §6.2).
Deliverables: the seeded Champion agent member with its persona, staged instructions, schedule and least-privilege scope; the hourly nudge run, the daily sweep covering staleness, blocker aging, KPI corridors and the morning summary, the weekly session lifecycle, and the per-cycle countdown and review preparation; proposal generation for drafted check-ins and recovery OKRs; the readable run log; deterministic behaviour with AI off where it still nudges, escalates and computes but drafts nothing.
Test plan: with AI off every trigger still fires and no drafting occurs; with a provider on, an overdue check-in produces a drafted narrative as a proposal that a human applies; a KPI unhealthy for two periods produces a recovery proposal; the run halts on the cost cap.
Acceptance: Given a workspace with the agent enabled and AI configured, when a check-in is three days overdue, then the champion receives a nudge containing a drafted check-in they can review and publish in one action, and the draft is marked as AI-generated.

### P4-T06: The OKR Coach agent [L]
Depends on: P4-T05
Goal: the quality agent (AI-NATIVE-PLAN.md §6.1).
Reference mockup: [05-alignment-studio](../stakeholder/mockups/png/05-alignment-studio.png), [03-draft-coach](../stakeholder/mockups/png/03-draft-coach.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the seeded Coach agent with its persona, instructions, schedule and scope; write-triggered evaluation feeding the goal's quality flags; the nightly semantic sweep producing relink, dependency, conflict and gap findings into the shared finding table with severity, reason and a one-click apply where mechanical; divergence detection between reported health and the data; the quality triggers from AI-NATIVE-PLAN.md §6.4; the rewrite assist per failing rule; the coach strip on the goal page and the review tab in the alignment studio; every message citing its rule key.
Test plan: a message citing a rule key the method package does not define fails the build; a dismissed finding stays dismissed; applying a relink finding re-parents the goal through the normal Operation with audit; with AI off the structural findings and the quality triggers still fire while the semantic ones do not.
Acceptance: Given two goals in different spaces that double-count the same metric, when the nightly sweep runs, then a conflict finding appears for both champions with a specific reason, and dismissing it on one side dismisses it everywhere.

### P4-T07: Weekly session: confidence round, voting, blockers [L]
Depends on: P4-T04, P3-T07
Goal: steps one and two of the ritual (METHOD.md §7.2, screen S-22).
Reference mockup: [07-weekly-session](../stakeholder/mockups/png/07-weekly-session.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the session record with kind, schedule, facilitator, stage state and elapsed time, synchronised live so every participant sees the same screen; the confidence round with the key result list, the focus panel, the draggable dial with band shortcuts, the synchronised vote reveal with a team average, the what-changed note and the confirm that advances; the blocker step with the five-type picker showing each type's definition, the owner, the next action, the twenty-four hour clock and the escalation notice at the critical threshold; the blocker table, board and aging.
Test plan: a step cannot be completed while any key result is unscored or any low score lacks a type, an owner and an action; the vote reveal is atomic across clients; a blocker's due time is its opening plus the workspace clock; a confidence at or below the critical threshold escalates immediately.
Acceptance: Given a session where one key result scores below the threshold, when the coordinator tries to continue, then it is refused until that key result has a blocker type, a named owner and a next action, and the blocker's clock starts on save.

### P4-T08: Weekly session: commitments, digest, streaks [M]
Depends on: P4-T07
Goal: steps three and four (METHOD.md §7.2).
Deliverables: the commitment table with the previous week closed as delivered or not and the new week set with owner and linked key result; the digest engine assembling the headline with its change on last week, on track, at risk, blockers and commitments; the coordinator note; publishing to the in-app feed and email now and to chat in Phase 5; the streak engine with break-on-skip and the streak ribbon; the twelve-week confidence trend; the space home before the session.
Test plan: closing a session rolls this week's commitments into next week's list to close; a skipped week breaks the streak and a held one extends it; the digest content matches the session record exactly.
Acceptance: Given a completed session, when it closes, then the digest is generated with correct figures, the streak advances, last week's commitments are closed and this week's are open.

### P4-T09: Monthly review and decision log [M]
Depends on: P4-T08
Goal: the monthly ritual (METHOD.md §7.5, screen S-23).
Deliverables: the objective trend record; the dependency and risk log view; the decision table where every decision names the key result or goal it affects, with the log surfaced on the goal page and in the cycle workspace.
Acceptance: Given a monthly review recording a decision against a key result, when the goal page is opened, then the decision appears in its history with its date and author.

### P4-T10: Quarterly review: session shell, scoring, narratives [L]
Depends on: P4-T09
Goal: the first act (METHOD.md §8, screen S-24).
Reference mockup: [08-quarterly-review](../stakeholder/mockups/png/08-quarterly-review.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the session shell with the eleven-stage rail grouped by act, the lap bar segmented by duration, the stage timer with pacing cues and an add-a-minute control, private facilitator notes per stage, and live stage synchronisation; the open and check-in stage with the pulse picker and the room-pulse read; the scoring stage with evidence, sliders, reasons, the hidden objective score with an animated reveal that respects reduced motion, and the running cycle score; the narratives stage with the pass-the-mic control; the recognition stage.
Test plan: stage changes reach every connected client inside the budget; the reveal is deterministic and instant under reduced motion; scores written here land on the key results when the session closes.
Acceptance: Given a running review at the scoring stage, when the facilitator reveals an objective's score, then every participant sees the same number at the same time, and the cycle score updates.

### P4-T11: Quarterly review: retro, diagnostic, reset [L]
Depends on: P4-T10
Goal: the second and third acts (METHOD.md §8).
Reference mockup: [08-quarterly-review](../stakeholder/mockups/png/08-quarterly-review.png). Reference, not authority: UIUX-PLAN.md §10.
Deliverables: the team retro with prompt chips, two columns, sticky notes and dot voting; the management retro with its four questions; the root-cause stage listing every key result below the threshold with the eight-cause picker and a detail field; the anonymous process-health survey with live averages and response counts; the rhythm diagnostic computed from the cycle score and the rhythm score with its verdict and narrative; keep, modify and abandon per objective with the meaning of the chosen decision and a required why; learnings with promotion from top-voted themes and carry-forward flags; next-cycle drafts; decisions and actions with owner and due date.
Test plan: the diagnostic verdict matches METHOD.md §8.6 across the three cases; process-health responses cannot be attributed to a member but cannot be submitted twice; a keep, modify or abandon decision writes back to the goal on close; the lowest process-health statement becomes an issue in the next cycle.
Acceptance: Given a cycle score below the threshold and a rhythm score above it, when the diagnostic renders, then it reads as a strategy or quality problem with the specific figures, and the prescription tells the facilitator to fix the key results before pushing the team.

### P4-T12: Minutes, exports and review feed-forward [M]
Depends on: P4-T11, P3-T15
Goal: the artifact and the handover (METHOD.md §8.10, screen S-25).
Deliverables: the minutes document with the executive summary and every stage's record; document and PDF export; the close action writing scores, decisions and learnings back to their objects and running the feed-forward into the next cycle; a link from the closed cycle to its minutes.
Acceptance: Given a completed review, when the facilitator closes it, then the minutes are generated and exportable, every score and decision is written back, and the next cycle's Phase 2 already holds the scores and carry-forward issues.

### P4-T13: Embeddings and retrieval [L]
Depends on: P2-T15
Goal: grounded answers over workspace data (AI-NATIVE-PLAN.md §9).
Deliverables: the pgvector extension and embedding table with an appropriate index; the outbox-driven worker chunking and embedding goals, key results, check-ins, blockers, sessions, documents, comments and cycle artifacts, keyed by content hash; access-filtered hybrid retrieval combining vectors and full text; degradation to full text where vectors are unavailable; local embedding support.
Test plan: retrieval never returns a chunk the requester cannot read; re-embedding is skipped when content is unchanged; with the extension absent the product still answers using full text.
Acceptance: Given a private space's check-in, when a non-member asks a question that would match it, then no chunk from it is retrieved or cited.

### P4-T14: Copilot [L]
Depends on: P4-T13, P1-T07
Goal: the interactive assistant (screen S-39).
Deliverables: threads and messages anchored to the workspace or an entity; the side panel with streaming and a stop control; grounded answers with citations only to what the viewer may see; action proposals rendered as a preview or difference with apply and dismiss, committing through the normal mutation layer; long tool runs executing as background jobs and streaming back over realtime; the states for empty, AI off and capped.
Test plan: a proposal that the user lacks permission to apply is refused by the permission layer, not hidden by the interface; a background run survives a page reload; with AI off the panel explains and links admins to the console.
Acceptance: Given a member asking the copilot to create a goal, when they approve the proposal, then the goal is created through the normal Operation with audit, an AI provenance chip and a working undo.

### P4-T15: Coaching and rhythm assists [M]
Depends on: P4-T14, P4-T06
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
Depends on: P5-T00, P4-T04
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
Depends on: P5-T12, P4-T13
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
Depends on: P4-T01
Deliverables: a full pass comparing every rule, threshold, band, corridor, taxonomy, gate, agenda and diagnostic in METHOD.md against `packages/method` and against the behaviour observed in the running product; the coaching-prompt corpus reviewed for tone and accuracy against the tuned false-positive rate; any drift corrected in the document or the code, whichever is wrong.
Acceptance: the conformance suite is complete, and a human confirms that a sample of twenty real OKR drafts receive verdicts they agree with.

### P7-T08: Privacy: export, erasure and retention [M]
Depends on: P7-T03
Deliverables: personal data export and erasure as anonymisation tested end to end; retention settings for message logs, nudge records and agent run logs; a review that no personal data reaches logs, prompts or telemetry.
Acceptance: Given an erasure request, when it completes, then the member's content survives anonymised, an export is produced, and no personal data of theirs remains in message logs, prompts or telemetry.

---

# Phase 8: Cloud, enterprise and launch

### P8-T01: Cloud design gate [DESIGN GATE] [M]
Depends on: Phase 7 complete
Goal: the design documents for vendor operation.
Deliverables: design documents covering tenant provisioning and lifecycle, per-tenant limits and noisy-neighbour protection, the operator console's surface and its boundaries, the support-access contract, and the plan and seat model behind its flag.
Acceptance: the human approves with an explicit statement.

### P8-T02: Tenant provisioning, signup and onboarding [L]
Depends on: P8-T01
Deliverables: the tenant table and provisioning Operation; cloud signup with email verification and workspace creation; the onboarding flow (screen S-34) shared with self-host; the workspace lifecycle of active, suspended and closed with data retention on closure; region recorded per tenant.
Acceptance: Given a new cloud signup, when it completes, then a workspace exists with the user as owner, the onboarding runs, and the tenant record carries its plan and region.

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
Acceptance: the tagged release installs from the documented path on a clean machine, in both self-hosted forms and in the cloud.

---

## Appendix A: index

Phase 1: P1-T01 to T10 (10). Phase 2: P2-T01 to T17 (17). Phase 3: P3-T00 to T17 (18). Phase 4: P4-T00 to T15 (16). Phase 5: P5-T00 to T13 (14). Phase 6: P6-T01 to T07 (7). Phase 7: P7-T01 to T08 (8). Phase 8: P8-T01 to T14 (14). **104 tasks.**

Design gates requiring human approval: P3-T00, P4-T00, P5-T00, P8-T01. Spikes with a recorded decision: P1-T03, plus the golden-master matrices at P3-T00 and the rule corpus at P4-T00.

Specification authority per task type: user interface to UIUX-PLAN.md, schema to TECHNICAL-PLAN.md §4 with the §7.2 mapping, engines to TECHNICAL-PLAN.md §6, rules and rituals to METHOD.md, AI and agents to AI-NATIVE-PLAN.md, security to TECHNICAL-PLAN.md §8.2, performance to TECHNICAL-PLAN.md §13.

Importer tasks that must keep the §7.2 mapping current: P6-T01 through P6-T04, and P6-T07.

## Appendix B: designed for, not built

Serverless runtime profile, custom fields, configurable statuses and workflows, a saved-query language and view builder, Gantt with dependency scheduling, sprints and backlogs, time and cost tracking, meetings beyond the OKR sessions, calendar two-way sync, additional chat providers, incoming email, source-control work links, collaborative document editing, native mobile applications, and importers beyond FlowyTeam and spreadsheets. Each keeps a design-for note in TECHNICAL-PLAN.md §16. Pulling any of them into v1 requires the human.
