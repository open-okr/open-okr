# PHASE-2-BREAKDOWN.md

A working breakdown of Phase 2, written to hand to an implementing agent one task at a time.

**This is a derived document, not authority.** It restates and decomposes
[IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) Phase 2. Where this file and any document in the
authority order disagree, the authority document wins and this file gets fixed. Nothing here
changes a rule, a threshold or an acceptance criterion.

Phase 2 goal, from the plan: the shared machinery every module needs, including the AI and agent
foundation, so the coach can ship with the OKR core rather than after it. Still no product modules.

---

## 1. How to run a task

The mechanism already exists. Do not invent a new one.

1. Paste the prompt from [START-PROMPT.md](START-PROMPT.md), with the task id on the last line.
2. The agent restates the task and confirms the Definition of Ready. It writes no code yet.
3. You reply `confirmed, proceed`, or correct the restatement.
4. The agent writes failing tests, implements until green, runs the quality checks, sets the
   STATUS.md row to `in_review`, commits on `task/<task-id>-<slug>`, and stops.
5. You review with the [EXECUTION-GUIDE.md](EXECUTION-GUIDE.md) §7 checklist, merge, and set the
   row to `done`. Only a human sets `done`.

The card for each task in §6 below gives the agent the specifics it would otherwise have to
reconstruct: which sections to read, what to build in what order, what to test, which follow-up it
inherits, and what it must ask about rather than decide.

**One task per session, one task per branch.** The agent never starts the next task on its own.

---

## 2. State of play

| Task | Title | Size | Depends on | Status |
|---|---|---|---|---|
| P2-T01 | Access model: contexts, bindings, groups | L | P1-T07 | in_review, local branch `task/p2-t01-access-model`, not pushed |
| P2-T02 | can() + access-aware reads | L | P2-T01 | todo |
| P2-T03 | People: profiles, manager chain, lifecycle | L | P2-T02 | todo |
| P2-T04 | Invitations | M | P2-T03 | todo |
| P2-T05 | Files and blobs | M | P1-T04, P2-T02 | todo |
| P2-T06 | Subscriptions + notification spine | L | P2-T02, P1-T04 | todo |
| P2-T07 | Typed activity feed engine | L | P2-T06 | todo |
| P2-T08 | Workspace settings + module registry | M | P2-T02 | todo |
| P2-T09 | Security baseline | M | P1-T05, P2-T02 | todo |
| P2-T10 | App shell + design system | L | P1-T08, P2-T08 | todo |
| P2-T11 | Rich text editor | L | P2-T10, P2-T05 | todo |
| P2-T12 | Data-change runner | S | P1-T03 | todo |
| P2-T13 | AIProvider port + drivers | L | P1-T04 | todo |
| P2-T14 | AI configuration, keys, encryption and rotation | M | P2-T13 | todo |
| P2-T15 | Model catalogue, tier routing, structured output, prompts | M | P2-T14 | todo |
| P2-T16 | Usage metering, quotas and hard caps | M | P2-T14 | todo |
| P2-T17 | Agent runtime: agents, runs, sandbox, proposals | L | P2-T16, P1-T07 | todo |

Nine large, seven medium, one small. Counting a large task as two, that is 26 units. At the
EXECUTION-GUIDE.md §6 assumption of three to five merged tasks per week with large counting double,
Phase 2 is roughly six to nine weeks of review-limited throughput.

---

## 3. Order of work

### The dependency graph

```
P1-T07 ──> P2-T01 ──> P2-T02 ──┬──> P2-T03 ──> P2-T04
                               ├──> P2-T05 ──────────────┐
                               ├──> P2-T06 ──> P2-T07     │
                               ├──> P2-T08 ──> P2-T10 ──> P2-T11
                               └──> P2-T09

P1-T03 ──> P2-T12                       (independent of everything else in Phase 2)

P1-T04 ──> P2-T13 ──> P2-T14 ──┬──> P2-T15
                               └──> P2-T16 ──> P2-T17
```

### The critical path

`P2-T01 → P2-T02 → P2-T08 → P2-T10 → P2-T11`. Five tasks, four of them large. Nothing about the
interface can start until settings and the module registry exist, and settings cannot start until
`can()` exists. Anything that slips here slips Phase 2.

### What can run in parallel

- **Now, without waiting for anything:** P2-T12 (needs only P1-T03) and P2-T13 (needs only
  P1-T04). Neither touches the access model. If you have a second track, start P2-T13 immediately:
  it is large, it heads the whole AI chain, and it is the only large task with no Phase 2
  dependency.
- **Once P2-T02 merges:** P2-T03, P2-T05, P2-T06, P2-T08 and P2-T09 all unblock together. That is
  the widest point in the phase.
- **Never in one working copy.** Parallel tracks need separate worktrees and separate sessions, per
  EXECUTION-GUIDE.md §6. Merge order follows the dependency graph.

### A workable sequence for a single track

P2-T02, P2-T08, P2-T13, P2-T09, P2-T05, P2-T06, P2-T07, P2-T03, P2-T04, P2-T14, P2-T10, P2-T11,
P2-T15, P2-T16, P2-T12, P2-T17.

The reasoning: get the enforcement point in first, then unblock the interface path early
(P2-T08 before P2-T10), start the AI chain before it becomes the tail, and leave P2-T17 last
because it depends on the most.

---

## 4. Standing rules for every Phase 2 task

These come from [CLAUDE.md](../../CLAUDE.md) and are not negotiable. The agent has them loaded
automatically, but the ones Phase 2 will actually collide with are:

| Rule | What it means here |
|---|---|
| Every write is one Operation | The domain change, access bindings, activity row, audit row and outbox row commit together. A direct driver call on a write path fails `pnpm check:boundaries`. Escapes need an `openokr:allow-mutation:` comment with a written reason |
| Every read of a protected aggregate goes through the access getter | From P2-T02 onward this is enforced by a lint. Before P2-T02 it does not exist yet |
| Every business table gets `workspace_id` and an RLS policy in the same migration | Checked by `pnpm db:lint`. Exceptions need an explicit marker with a reason |
| Soft delete is the default scope | `activeOnly` or the explicit `includeDeleted`. Checked by the soft-delete lint |
| Every setting is in the TECHNICAL-PLAN.md §4.14 map with a working default | No screen may block until a setting is chosen |
| No vendor SDK outside `packages/adapters` | Bites P2-T13 hardest. Every LLM client lives behind the port |
| Deterministic first | Every Phase 2 AI capability must degrade cleanly with the provider off. CI proves the product is whole with AI disabled |
| Migrations are forward-only | Never rewrite a shipped migration |
| No new runtime dependency without asking | P2-T10, P2-T11 and P2-T13 all want new dependencies. Ask first |
| Never commit under the Claude name | No co-author trailers, no generated-with lines |

### Definition of Ready, checked before code on every task

1. Every dependency is `done`.
2. Specification sources exist. UI tasks cite a screen and the UIUX-PLAN.md §4 patterns. Schema
   tasks cite TECHNICAL-PLAN.md §4 and keep the §7.2 importer mapping current.
3. Acceptance criteria are unambiguous. If not, ask before coding.
4. No open decision in PLAN.md §13 or AI-NATIVE-PLAN.md §12 blocks the task.

### Definition of Done additions that Phase 2 tasks keep forgetting

- The §7.2 importer mapping updated in the same change as any new table, or the table marked as
  having no legacy source.
- DATABASE.md updated alongside any schema change.
- Loading, empty, error and permission-denied states, not just the happy path.
- Contract projections regenerated if the action registry changed, with the drift check green.

### Environment notes for whoever runs the checks

Learned while building P2-T01 on this machine:

- **Node.** The repo requires Node 22 (`engines: >=22 <23`, every entry point runs
  `--experimental-strip-types`). If the machine's default is Node 20, pnpm itself will not start.
  A standalone Node 22 on `PATH` fixes it.
- **Docker.** `pnpm db:up` needs Docker. Without it, no Vitest project in this repo can run at all,
  because every one of them opens a real database in global setup. Static checks (typecheck, Biome,
  `pnpm db:lint`, `pnpm check:boundaries`, the soft-delete lint) all run without a database.
- Anything reported as verified must say which of the two situations it was verified under.

---

## 5. Cross-cutting items to settle

### Open decisions that touch Phase 2

None of PLAN.md §13 or AI-NATIVE-PLAN.md §12 blocks a Phase 2 task outright. Three have a stated
position that Phase 2 code will encode, so build to the position and do not quietly widen it:

| Reference | Position to build to | Touches |
|---|---|---|
| PLAN §13 #3, AI-NATIVE §12 A5 | Propose and approve is the default. Scoped direct writes are opt-in per agent, by an admin | P2-T17 |
| AI-NATIVE §12 A3 | Per-user keys allowed, admin-toggleable | P2-T14 |
| AI-NATIVE §12 A2 | Drivers in v1 are Anthropic, OpenAI, Google, OpenRouter, Ollama, OpenAI-compatible, and off | P2-T13 |

PLAN §13 #6 and AI-NATIVE §12 A6, the embedding model and vector dimension, are explicitly deferred
to the retrieval task (P4-T13). P2-T13 builds the embedding capability into the port surface
without choosing a model. Keep the column swappable.

### A documentation defect to raise before P2-T16

IMPLEMENTATION-PLAN.md P2-T16 cites `AI-NATIVE-PLAN.md §1.7`. **That section does not exist.**
AI-NATIVE-PLAN.md §1 is "The stance" and has no subsections. The real sources for metering, quotas
and caps are:

- AI-NATIVE-PLAN.md §4, the "Budgets and limits" and "Usage and logs" cards.
- AI-NATIVE-PLAN.md §7, the `ai_usage_events` table.
- UIUX-PLAN.md screen S-37.

Definition of Ready item 2 requires the specification source to exist, so this needs a human to
correct the citation in IMPLEMENTATION-PLAN.md before P2-T16 starts. Do not let the agent guess.

### Follow-ups Phase 2 rows already carry

Recorded in STATUS.md. The agent must read its own row's notes, but here they are in one place:

| Task | Inherited work |
|---|---|
| P2-T01 | P1-T06: first member holds no binding. P1-T07: the pipeline's slot for an aggregate's context and default bindings is empty. Both closed by the in_review branch |
| P2-T02 | P1-T08: `workspace.overview` resolves the reading member with its own query. P1-T07: every active member currently resolves to `full`. Plus a live question, below |
| P2-T03 | P1 hardening: migration 0008 aligned the cross-workspace read policies, so a soft-deleted member no longer reads their own membership row. Removal semantics build on those policies |
| P2-T04 | P1 hardening: the one direct mail send in the app (password reset) carries an `openokr:allow-side-effect` marker because it has no transaction. Invitations do have one, so they go through the outbox |
| P2-T05 | P1 hardening: `LocalDiskStorage` keeps content types in a process-local Map that nothing reads, is lost on restart, and is unshared across replicas |
| P2-T06 | P1 hardening, two: `PostgresRealtime` never clears a rejected connect promise, so one failed connect poisons publish and subscribe for the process lifetime, and a dropped LISTEN connection ends delivery silently. The outbox relay has no attempt ceiling and no dead-letter state |
| P2-T07 | P1-T07: `activities` ships with `kind` as a free string and `context_id` nullable |
| P2-T09 | P1 hardening: `InProcessCache` drops an expired key only when that exact key is read again, and `rateLimit` mints a key per subject, so counters accumulate for the process lifetime |
| P2-T10 | P1-T08: S-35 screens need JavaScript. P1-T05: auth screens ship with no design system. P1-T06: the workspace switcher ships as behaviour only and has no screen of its own, so the row is its specification |
| P2-T13 | P1 hardening: the port set has no agreed lifecycle. `JobQueue` and `Realtime` declare `stop()`; five others declare nothing, and `SmtpMailer.close()` exists but is not on the port |
| P2-T17 | P1 hardening: `PgBossJobQueue.stop()` clears `#running` but not `#started`, so a `start()` after a `stop()` sends into queues pg-boss no longer knows about |

### No Phase 2 screen has a reference mockup

UIUX-PLAN.md §10 maps eleven mockups, all to Phase 3, 4 and 5 tasks. Every Phase 2 interface task
(S-03, S-30, S-31, S-33, S-36, S-37, S-38, and the shell) is built from the §6 specification and
the §4 patterns. The instruction in §10 applies: **ask rather than invent.**

---

## 6. Task cards

### P2-T01: Access model: contexts, bindings, groups [L]

**Depends on** P1-T07 (done). **Status** in_review on `task/p2-t01-access-model`, not pushed.

Already built. What shipped: four tables (`access_contexts`, `access_groups`,
`access_group_memberships`, `access_bindings`) in migration 0009 with the tenant floor and RLS; the
`workspace_standard` group and the workspace's own context created inside provisioning; the first
member given a `full` binding through their own `member` group; a pure `derivePrivacy`; the
`manage_ai` and `manage_coaching` permission constants; reusable `ensureContext`,
`ensureWorkspaceStandardGroup`, `ensureMemberGroup` and `bindGroup` helpers.

Deliberately not written to yet: `access_group_memberships`. Workspace-wide membership is read off
`workspace_members` rather than enumerated, so nothing populates it until `space_standard` groups
exist at P3-T01.

**Before it merges:** the Vitest suites have never run. Run `pnpm db:up && pnpm test` first.

---

### P2-T02: can() + access-aware reads [L]

**Depends on** P2-T01. **The single most important task in the phase.** Everything after it assumes
one enforcement point exists.

**Read first**
- TECHNICAL-PLAN.md §4.1, the "one read chokepoint" and "sub-resources inherit" rules.
- TECHNICAL-PLAN.md §8.1, layer 2.
- `packages/core/src/operations/operation.ts`, the `resolveActor` comment. It names this task.

**Build**
1. `can(member, level, resource)` in `packages/core`.
2. The access-aware getter: join member to groups to bindings to context, take the **maximum**
   level, exclude suspended members, return **not-found** on forbidden.
3. Composable list filters, so a list query is access-scoped by the same path as a single read.
4. The subject-to-context resolver, with an exhaustive and fail-closed list. An unknown subject type
   raises rather than defaulting.
5. Replace `resolveActor`'s placeholder in the Operation pipeline with the real binding walk. The
   comment says one function is replaced wholesale and no handler changes. Hold it to that.
6. Replace `workspace.overview`'s own member query with the getter, closing the P1-T08 follow-up.
7. A lint that fails raw selects on protected tables outside the helper.
8. Document the composition rules and test them.

**Tests**
- A permission matrix across member, guest, suspended, agent and anonymous, against every level,
  with overlapping grants, asserting maximum wins.
- A suspended member loses every read and every write.
- A forbidden read returns not-found, so there is no existence oracle.
- An unknown subject type raises.

**Acceptance.** Given a member holding view through the workspace group and full through a champion
binding, when access is computed, then it is full. Given their suspension, then every read returns
not-found.

**Ask the human.** The STATUS.md row raises one live question: does the workspace switcher list
suspended and invited memberships? Today `listMembershipsForUser` returns them, so a suspended
member sees the workspace in the switcher and then not-found from the overview. That is secure but
odd. Decide it here, do not leave it.

**Watch out.** The lint in step 7 is the kind of gate this repository has been bitten by four times.
Make it report how many files it checked, and make it fail when it finds none.

---

### P2-T03: People: profiles, manager chain, lifecycle [L]

**Depends on** P2-T02. Screen S-33. No mockup.

**Read first**
- UIUX-PLAN.md S-33 and §4 patterns, §9 gates.
- TECHNICAL-PLAN.md §4.1 `workspace_members`.
- STATUS.md P2-T03 note about migration 0008.

**Build**
1. Profiles: title, timezone, avatar, bio. Two editable field sets, self versus others.
2. The manager chain, cycle-safe, with a possible-managers query that excludes anyone who would
   close a loop.
3. The directory, with search and filters, and the org chart from the manager chain.
4. Suspend and restore.
5. The guest kind, and a convert action that strips prior bindings.
6. Erasure as anonymisation: a placeholder identity, authorship intact, an audit event, and a
   machine-readable export.
7. Last-owner invariants: removing the last owner is refused.

**Tests.** A manager cycle is rejected. Suspend removes all access and restore returns it.
Converting to guest leaves no stale binding. Erasure keeps comments readable with an anonymised
author. Removing the last owner is refused.

**Acceptance.** Given a suspended member, when any request arrives under their identity, then access
is denied. Given erasure, then their content survives anonymised and an export is produced.

**Watch out.** Erasure touches stored user data, which is on the "ask the human" list. Confirm the
anonymisation shape before writing the migration. The directory is a list surface, so check the
TECHNICAL-PLAN.md §13.1 budgets.

---

### P2-T04: Invitations [M]

**Depends on** P2-T03.

**Read first**
- TECHNICAL-PLAN.md §4.1 `invite_links`.
- STATUS.md P2-T04 note about the password-reset mail marker.

**Build**
1. Invitation by email, through the mailer and **the outbox**, not a direct send.
2. Reusable workspace links: hashed token, use count, maximum uses, expiry, revoke, allowed domains.
3. Single-use personal links.
4. Trusted-domain automatic joining.
5. One member-provisioning operation that every path lands in, with consistent defaults and audit.

**Tests.** Invite, accept, member exists. A link past its limit, expiry or revocation refuses. A
domain-restricted link rejects other domains. Trusted-domain joining works. Only members with
sufficient access may invite.

**Acceptance.** Given a reusable link limited to one domain, when someone outside it tries, then
joining is refused and audited.

**Watch out.** The password-reset send in `apps/web/lib/mail.ts` carries an allow-side-effect marker
because it has no transaction to attach an outbox row to. Invitations do have one. Do not copy that
line. The marker names this row as the reason.

---

### P2-T05: Files and blobs [M]

**Depends on** P1-T04, P2-T02.

**Build**
1. The blob table, with prepare, upload and claim using signed URLs.
2. Type and size validation. Images re-encoded.
3. Per-workspace byte accounting, a quota, and exactly one warning at ninety percent.
4. A preview and thumbnail worker.
5. An optional scan hook that drives the status.
6. An orphan cleanup job.
7. Fix the inherited defect: `LocalDiskStorage` keeps content types in a process-local Map that
   nothing reads, is lost on restart, and is unshared across replicas. It reads like a content-type
   source and is not one.

**Tests.** Upload, claim and download on the disk driver. Oversized and blocked types rejected.
Crossing the quota fires exactly one warning. Orphans are reaped.

**Acceptance.** Given an upload finishing above the warning threshold, when accounting runs, then
one warning is emitted and the file still saves, with a hard stop only at the quota.

**Watch out.** "Exactly one warning" is the interesting assertion. Test it under a second upload
that also sits above the threshold.

---

### P2-T06: Subscriptions + notification spine [L]

**Depends on** P2-T02, P1-T04. Screen S-03. No mockup. **The largest surface in the phase.**

**Read first**
- TECHNICAL-PLAN.md §4.11, the `notifications`, `notification_settings` and `notification_batches`
  rows.
- UIUX-PLAN.md S-03.
- STATUS.md P2-T06, which carries two real defects.

**Build**
1. Subscription lists and subscriptions with reasons. Authors auto-joined. Mentions auto-subscribed
   and re-diffed on edit. Suspended, placeholder and agent members excluded.
2. Notifications with access gating **at send time**, not only at enqueue time.
3. Per-member settings: per-reason routing, batching window, daily summary time, quiet hours in the
   member's own timezone.
4. Batches found or created **under a row lock**, with an idempotent send worker.
5. Per-reason mail templates in HTML and plain text, a digest variant, and a development preview
   page.
6. A bulk-suppression flag.
7. The in-app inbox: live badge, mute, snooze.
8. Fix the two inherited defects. `PostgresRealtime` never clears a rejected connect promise, so one
   failed connect poisons publish and subscribe for the life of the process, and a dropped LISTEN
   connection ends delivery silently with no reconnect. The outbox relay has no attempt ceiling and
   no dead-letter state, so a poisoned row retries every 300 seconds forever and is surfaced
   nowhere. Both matter first here, because this is the task that puts user-visible traffic on them.

**Tests.** A mention delivers immediately when opted in. Three rapid events produce one batch with
no duplicates under concurrency. A recipient who lost access after enqueue receives nothing.
Un-mentioning on edit stops their notification but keeps watchers. The daily summary fires at the
member's local time across a daylight-saving boundary. The suppression flag silences a bulk insert.

**Acceptance.** Given a member with a ten-minute window, when four notifications arrive inside it,
then they receive one digest listing four items, each deep-linked.

**Watch out.** Two of these tests are concurrency tests and one is a timezone test across a
daylight-saving boundary. They are the point of the task, not decoration. A snooze never hides a
review-inbox obligation. Consider proposing a split if the surface proves too wide for one review.

---

### P2-T07: Typed activity feed engine [L]

**Depends on** P2-T06. Screen S-31. No mockup. Distinct from the audit log.

**Read first**
- TECHNICAL-PLAN.md §4.11 `activities`.
- Migration 0006, which shipped the table with `kind` as a free string and `context_id` nullable.

**Build**
1. The typed event catalogue as a discriminated union, with payloads that snapshot human labels.
2. Per-kind payload validation. An event kind outside the catalogue cannot be persisted.
3. The access-scope `context_id`, set by the fail-closed resolver from P2-T02.
4. Feed queries at workspace, space, goal and profile scope. Access-filtered, hiding soft-deleted
   subjects, paginated by key.
5. Aggregation of consecutive same-actor edits that **never** collapses narrative events.
6. Per-kind renderers behind a registry.
7. Live inserts.
8. Notification fan-out driven from activities.

**Tests.** An event kind outside the catalogue cannot be persisted. A private-space activity never
appears in a non-member's workspace feed. Aggregation collapses five field edits into one row but
never a check-in. Feeds paginate stably under concurrent inserts.

**Acceptance.** Given a member without access to a space, when they read the workspace feed, then no
activity from it appears, while a member of that space sees typed, readable entries.

**Watch out.** This is the leak-test task. The private-space assertion is the one that matters. Key
pagination, not offset pagination, or the concurrent-insert test cannot pass.

---

### P2-T08: Workspace settings + module registry [M]

**Depends on** P2-T02. Screen S-36 skeleton. **On the critical path.**

**Read first**
- TECHNICAL-PLAN.md §4.14, the whole settings map.
- `packages/core/src/settings/registry.ts`, which already exists from P1-T06.

**Build**
1. A settings service implementing the §4.14 map, with validated storage where environment
   overrides win.
2. Every key carrying a declared default, so an unset key always resolves.
3. A reset-to-default action, per setting and per card.
4. The two-level admin shell.
5. A typed module registry driving the sidebar and admin menus by access level.

**Tests.** Every setting in the map resolves to its documented default on a workspace where nothing
has been configured, **proven by a test that enumerates the registry rather than a fixed list**, so
a setting added later without a default fails. Resetting a card restores the defaults exactly.

**Acceptance.** Given a module registering a navigation item that requires an access level, when a
member lacks it, then the item is hidden and the route is denied. Given a freshly provisioned
workspace, when every setting is read, then each returns its documented default and none is unset.

**Watch out.** The enumerating test is explicitly specified. A fixed list would pass today and rot
silently. Hiding the navigation item is cosmetic; denying the route is the real check. Do both.

---

### P2-T09: Security baseline [M]

**Depends on** P1-T05, P2-T02.

**Read first**
- TECHNICAL-PLAN.md §8.2.
- STATUS.md P2-T09, the unbounded-keyspace defect.

**Build**
1. Rate limiting through the cache port, per address and per member, on authentication, the API,
   channels and exports.
2. Account lockout with backoff and audit. This closes the P1-T05 follow-up: lockout is enforced
   today but writes no audit entry, because the audit spine did not exist then.
3. A strict content security policy with per-response nonces, plus transport, frame and referrer
   headers.
4. A secure cookie audit.
5. The sessions interface listing devices, with revoke.
6. The workspace freeze overlay with an admin recovery list.
7. Verified refusal of placeholder secrets in production.
8. Fix the inherited defect: `InProcessCache` drops an expired key only when that exact key is read
   again, and `rateLimit` mints a key per subject, so counters for subjects that never return
   accumulate for the life of the process. Rate limiting authentication by IP address is exactly the
   unbounded-keyspace case.

**Tests.** Repeated failed sign-ins trigger lockout with audit and a retry hint. A revoked session's
next request is rejected. A frozen workspace refuses every write except the recovery list. The
policy nonce varies per response.

**Acceptance.** Given a workspace set to read-only, when any member saves anything, then it is
refused with a clear message while admins can still manage members and settings.

**Watch out.** The freeze overlay is specified in TECHNICAL-PLAN.md §4.1 as collapsing everything to
view-only except an admin recovery list. It belongs in the permission layer, not in each handler.

---

### P2-T10: App shell + design system [L]

**Depends on** P1-T08, P2-T08. **On the critical path.** No mockup for the shell.

**Read first**
- UIUX-PLAN.md §2, §3, §5, and the §9 gates in full.
- STATUS.md P2-T10, which carries three follow-ups.

**Build**
1. Components on the Base UI registry, with the animation library vendored into `packages/ui`.
   Registry components are added at build time only. No runtime dependency, no network call, safe
   for an air-gapped install.
2. Design tokens: type scale, spacing, semantic colours, density.
3. Dark mode with light, dark and system.
4. The shell: sidebar, topbar, cycle strip placeholder, workspace switcher. The switcher ships as
   behaviour only from P1-T06 and belongs at the top of the sidebar. This row is its specification.
5. Responsive behaviour, including the mobile tab bar.
6. Core components with preview pages.
7. The keyboard registry and the shortcut overlay.
8. The message-catalogue pipeline, with a pseudo-locale check. Bahasa Melayu keys stubbed.
9. The persisted client cache keyed by build identifier, with the stale-deployment reload.
10. Restyle the S-35 authentication screens, which ship with behaviour and semantics but no design
    system. Decide progressive enhancement for them here: they currently need JavaScript because
    they drive sign-in through the client. That is a decision for this task, not an accident to
    inherit.
11. Style the proving dashboard's loading, error and not-found states, which ship unstyled.

**Tests.** Keyboard and focus component tests. Theme and density persistence end to end. A mobile
viewport smoke test. The pseudo-locale build catches a hardcoded string. A simulated version
mismatch triggers exactly one reload.

**Acceptance.** Given a deployment bumping the application version, when a stale tab makes its next
request, then it shows an update message and reloads once, with caches invalidated.

**Ask the human.** Vendoring the animation library and any registry component pull is a dependency
question. Ask before adding.

**Watch out.** "Reloads once" is the assertion. A reload loop is the failure mode.

---

### P2-T11: Rich text editor [L]

**Depends on** P2-T10, P2-T05. Screen S-30. **Requires its own design document.**

**Read first**
- UIUX-PLAN.md S-30 and §2.
- The CLAUDE.md rule on rich text: editor JSON in `jsonb` with a version column, never Markdown as
  storage, parsed and rendered through the one shared `packages/core` module.

**Build**
1. **A design document first.** It is a named deliverable.
2. The editor over the canonical schema, with the node and mark allow-list enforced by the shared
   validator.
3. Slash commands, mentions, entity autolink by short identifier, tables, code blocks.
4. Inline attachments: optimistic placeholders, progress, submit gating while uploading, deletion on
   failure.
5. Local draft autosave per entity and member, fingerprinted against base content, with an expiry.
6. The sanitising renderer and the excerpt utility, shared by server and client.
7. The decode-safe mention and attachment extraction interface.

**Tests.** Schema round-trip golden tests. A malicious pasted payload renders inert. A draft against
changed base content does not resurrect. Extraction on malformed content returns an empty list.

**Acceptance.** Given a comment with an upload in flight, when the user submits, then submission
waits for the upload or fails loudly, never dropping the attachment silently.

**Watch out.** Rendering is a sanitising allow-list at **every** surface, including email and
exports. Imported content is untrusted. The golden tests are the contract for every later module.

---

### P2-T12: Data-change runner [S]

**Depends on** P1-T03 only. **Startable immediately.** Delivers `pnpm db:change`.

**Build**
1. A versioned, idempotent, batched, resumable change runner.
2. Scripts freeze their own column expectations, so a later schema change cannot silently alter what
   an old script does.
3. A completion ledger.
4. A conventions document.
5. One sample change, with tests.

**Acceptance.** Given a change script run twice across a deployment boundary, when it re-runs, then
it does nothing and the ledger shows one completion.

**Watch out.** Data backfills go through this runner and are never mixed into schema migrations.
Small task, and the only S in the phase. Good one to slot between two large tasks.

---

### P2-T13: AIProvider port + drivers [L]

**Depends on** P1-T04 only. **Startable immediately, and it heads the whole AI chain.**

**Read first**
- AI-NATIVE-PLAN.md §3.1 and §3.2.
- AI-NATIVE-PLAN.md §12 A2, the driver list.
- STATUS.md P2-T13, the port lifecycle defect.

**Build**
1. The full port surface: chat, streaming, tool calling, embedding, structured extraction, and
   capability reporting.
2. Drivers for Anthropic, OpenAI, Google, OpenRouter, Ollama, any OpenAI-compatible endpoint, and
   off. **All inside `packages/adapters`.** No LLM client is imported anywhere else.
3. Contract tests per driver, against recorded fixtures.
4. A deterministic mock driver for the test suite.
5. A documented driver contract, so a new vendor is added without touching feature code.
6. Settle the inherited question: the port set has no agreed lifecycle. `JobQueue` and `Realtime`
   declare `stop()`. `Mailer`, `Cache`, `Search`, `Channel` and `FileStorage` declare nothing, and
   `SmtpMailer.close()` exists but is not on the port, so `Adapters.close()` leaks its connection
   pool. Settle it before a ninth driver with long-lived HTTP clients joins.

**Tests.** Every driver satisfies the contract. The off driver reports every capability unavailable
without raising. A model without tool support degrades rather than failing.

**Acceptance.** Given the provider set to off, when any capability is requested, then it reports
unavailable and the caller's manual path is unaffected.

**Ask the human.** Every driver is a new runtime dependency. Ask before adding any of them.

**Watch out.** The embedding capability goes on the port, but the model and vector dimension are
deferred to P4-T13 by AI-NATIVE-PLAN.md §12 A6. Keep the column swappable and do not choose here.
The off driver is not a stub to add later. It is what makes "deterministic first" testable.

---

### P2-T14: AI configuration, keys, encryption and rotation [M]

**Depends on** P2-T13.

**Read first**
- AI-NATIVE-PLAN.md §3.3 and §7, the `ai_providers` and `ai_credentials` rows.
- `packages/core/src/secrets/`, where envelope encryption and the key ring already exist from
  P1-T09. Reuse them rather than building a second scheme.

**Build**
1. The provider and credential tables.
2. Envelope encryption with per-secret data keys wrapped by a master key ring.
3. The precedence resolver: user, then workspace, then deployment, then off.
4. A masked hint and a live connection test.
5. A one-command rotation that re-wraps data keys only.

**Tests.** A stored key never appears in any response or log. Rotation leaves every credential
usable with no downtime. A user key overrides the workspace key for that user's calls only.

**Acceptance.** Given a workspace key and a personal key, when the member runs an assist, then their
own key is used, and an admin cannot read it.

**Watch out.** "An admin cannot read it" is an access rule, not just a masking rule. Per-user keys
are admin-toggleable per AI-NATIVE-PLAN.md §12 A3. `pnpm keys:rotate` already exists from P1-T09;
extend it rather than adding a second rotation command.

---

### P2-T15: Model catalogue, tier routing, structured output and prompts [M]

**Depends on** P2-T14.

**Read first**
- AI-NATIVE-PLAN.md §3.4 and §7, the `ai_models`, `ai_model_policies`, `ai_feature_settings` and
  `ai_prompts` rows.

**Build**
1. The seeded and refreshable model catalogue, with admin add and edit for custom models carrying
   their own context window and cost figures.
2. A seeded default tier map per driver, so supplying a key is the only step a workspace must take.
3. Per-workspace tier policies with sampling.
4. The optional per-feature tier override.
5. The context-window guard, which blocks an oversized request **before** the call.
6. Structured extraction with schema validation, one repair attempt, then a clean failure.
7. The versioned prompt registry, with a default, an editor and restore.

**Tests.** An oversized request is blocked before the call. Malformed model output repairs once then
fails cleanly. A prompt version change is recorded and reversible. A custom catalogue entry meters
cost from its own figures. A feature with a tier override routes to that tier while every other
feature is unaffected. A workspace that has supplied only a key resolves every tier through the
driver's seeded map.

**Acceptance.** Given an air-gapped workspace mapping every tier to a local model, when any AI
feature runs, then no external request is made.

**Watch out.** Features request a tier, never a model. That is the whole point of the task. The
air-gapped acceptance test needs a way to assert that no outbound request happened, not just that
the local model answered.

---

### P2-T16: Usage metering, quotas and hard caps [M]

**Depends on** P2-T14. Screen S-37. No mockup.

**Blocked on a documentation fix.** IMPLEMENTATION-PLAN.md cites `AI-NATIVE-PLAN.md §1.7`, which
does not exist. See §5 above. Get the citation corrected before starting.

**Read instead**
- AI-NATIVE-PLAN.md §4, the "Budgets and limits" and "Usage and logs" cards.
- AI-NATIVE-PLAN.md §7, `ai_usage_events`.
- UIUX-PLAN.md S-37.

**Build**
1. Usage events per call: tokens, cost from the catalogue, latency, source, status.
2. Quotas per user, per agent and per workspace.
3. A hard cap that disables features and halts running agents.
4. The AI console (S-37), assembling the provider, models, features, budgets, prompts, privacy and
   usage cards from P2-T13 through P2-T16.
5. Anomaly flagging.

**Tests.** A call records tokens and cost accurately against the catalogue. Crossing a quota disables
the feature with a clear message. Crossing a hard cap halts a running agent mid-flight with a log
line.

**Acceptance.** Given a workspace at its hard cap, when an agent run is in progress, then it halts
with an explanatory log entry and every manual path still works.

**Watch out.** The console assembles cards from four tasks, so it lands last in the AI chain even
though it depends only on P2-T14. "Every manual path still works" is the deterministic-first rule
being tested directly.

---

### P2-T17: Agent runtime: agents, runs, sandbox, proposals [L]

**Depends on** P2-T16, P1-T07. Screen S-38. No mockup. **Depends on the most, so it lands last.**

**Read first**
- AI-NATIVE-PLAN.md §6.5 and §7, the `agents`, `agent_runs` and `proposed_changes` rows.
- AI-NATIVE-PLAN.md §12 A5 and PLAN.md §13 #3, the autonomy position.
- UIUX-PLAN.md S-38.
- STATUS.md P2-T17, the pg-boss restart defect.

**Build**
1. The agent table, owning a member with the agent kind.
2. Least-privilege binding wiring, scoped to named resources. **Never a workspace-wide grant.**
   There is no service account with ambient authority.
3. The run state machine: a task list, a bounded tool loop, an append-only readable log,
   self-rescheduling through the job queue, and resumption across restarts.
4. The three write policies: sandbox, propose, scoped direct. Propose is the default. Scoped direct
   requires an explicit per-agent admin opt-in.
5. The proposal envelope table, and the bulk apply and dismiss action. Applying goes through the
   normal Operation pipeline with audit.
6. The run history interface (S-38).
7. Fix the inherited defect: `PgBossJobQueue.stop()` clears `#running` but not `#started`, so a
   `start()` after a `stop()` skips `createQueue` for every queue it has already seen and then sends
   into queues pg-boss no longer knows about. This is the first component likely to cycle the queue
   inside one process.

**Tests.** A sandbox run commits nothing. A proposal run commits nothing until applied, and applying
goes through the normal Operation pipeline with audit. A run resumes after a restart. A run cannot
touch a resource outside its bindings.

**Acceptance.** Given an agent scoped to one space in proposal mode, when it runs against a goal in
another space, then the tool call is denied by the permission layer and the denial is logged.

**Ask the human.** Raising an agent's autonomy beyond propose-and-approve is on the CLAUDE.md "ask
the human" list. Build the scoped-direct policy, but leave propose as the default and require the
opt-in.

**Watch out.** The denial in the acceptance criterion must come from the permission layer, not from
a check inside the agent. An agent that polices itself is not least privilege.

---

## 7. Phase 2 exit checklist

From IMPLEMENTATION-PLAN.md. Run it before the first Phase 3 task, and report each line as met,
partially met or not met, with evidence.

- [ ] Relationship access enforced through one entry point, with its lint.
- [ ] The people lifecycle safe.
- [ ] Invitations and links.
- [ ] Files with quotas and previews.
- [ ] Subscriptions and access-gated notifications, with batching and the daily summary.
- [ ] The typed feed live and leak-tested.
- [ ] Settings and the module registry.
- [ ] The security baseline.
- [ ] The shell, tokens, editor and languages.
- [ ] The data-change runner.
- [ ] The provider port with every driver.
- [ ] Keys encrypted, with rotation.
- [ ] Tier routing, structured output and versioned prompts.
- [ ] Metering with quotas and hard caps.
- [ ] The agent runtime with sandbox and proposals.

Phase 3 opens with a design gate (P3-T00) that needs an explicit "design approved for phase 3"
before any Phase 3 implementation task starts.
