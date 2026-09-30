# OpenOKR completeness review

**Date:** 28 September 2026
**Commit reviewed:** `main` at `7bbf31e` (the tree is identical to `agung` at `be1bf49`)
**Question asked:** Development is believed complete. Is it?

> **Fix progress.** ✅ marks a finding fixed and tested. High: 26 of 27 fixed on branch `fix/review-high`, including H-25 to H-27, which turned up during the fixes (section 5.3a). H-23 is a release, which a human cuts. Medium: all 36 fixed on branch `fix/review-medium`, including M-33, found after the review, and M-34 to M-36, which reviewing the coverage exemptions turned up (section 5.4a). Low follows in its own pull request.

> **Since the review.** `main` moved to `c529177` with PR #85, which changed documentation and a deck script only. No application, package, deployment or test code changed, so every code finding below still applies. PR #85 fixed the stale README (L-05). It also made H-22 more serious, because the install guides now tell self-hosters to build the image themselves.

---

## 1. The short answer

**No. The engineering is in very good shape, but the product is not complete against REQUIREMENTS.md.**

Every row in `STATUS.md` says `done` (270 rows, 200 tasks). Every gate is green, locally and in CI. Yet a person using the product in a browser cannot do several things REQUIREMENTS.md promises for v1. There are also security defects that only show up on a running deployment.

| | Count |
|---|---|
| High findings (security, data safety, or a P0 promise a user cannot reach) | 24 |
| Medium findings (a capability partly present, or deviating from the spec) | 32 |
| Low findings (polish, docs, test hygiene) | 20 |

### What is genuinely strong

- **Every gate is green.** All ten static gates pass: types, lint, dead code, migrations, boundaries, air gap, docs, licences, contract, method conformance. So do 4,525 unit and integration tests and 339 end-to-end tests. CI on `main` is green on every job.
- **The method canon is faithfully encoded.** `pnpm method:check` agrees with METHOD.md on 45 trigger keys, 26 checks, 56 thresholds, 148 word-list terms and 19 enumerations.
- **The database design holds the tenant floor.** All 139 tables have row-level security enabled, forced, and with a policy in the same migration, or a written exemption.
- **One contract, many surfaces, in sync.** 348 actions, 348 CLI commands and 350 MCP tools.
- **The code is clean.** No TODO or FIXME markers, no `@ts-ignore`, nine `any`s (each justified), an empty test quarantine, and no skipped tests beyond environment guards.
- **Deployment mostly works.** The Compose stack reaches healthy in 18 seconds. The Helm chart installs into a real Kubernetes cluster, serves two replicas, registers a user and upgrades cleanly. A nightly job proves the upgrade path.

### What is not there yet

The highest-impact gaps:

1. **The default self-hosted install turns the tenant floor off.** The app connects to Postgres as a superuser, which bypasses row-level security. Fixing that naively breaks the scheduler, so the agents would stop (H-01, H-02).
2. **Sessions cannot be scheduled from the browser.** After the one weekly session onboarding creates, nobody can hold a weekly, monthly or quarterly session (H-08).
3. **The guided cycle cannot complete from the browser.** Phases 4, 6 and 7 never compute. Gate 2 never evaluates. The product's own starter template fails its own quality check (H-09).
4. **The coach is quieter than promised.** 12 of 45 proactive triggers never fire. Nudges carry no goal name and no link. Blockers never reach their owner's inbox (H-10, H-11, H-12).
5. **Visible defects on a running instance.** Every server-rendered progress bar draws full. The phone view hides most of the product. The first screen says chat channels and AI are "not in this build" (H-15, H-16, H-24).
6. **Nothing has ever been released.** There are no tags, every package is at version 0.0.0, and 47 changesets are waiting. The launch task's acceptance checks were never run (H-23).

**Recommendation:** treat this as a release candidate that needs one more focused phase. Section 10 gives an order of work, and section 8 lists the decisions that belong to a human.

---

## 2. How the review was done

| Track | What was done |
|---|---|
| Status and plan | Parsed all 270 `STATUS.md` rows and matched them against the 280 task headings in IMPLEMENTATION-PLAN.md. Every plan task has a row. The 23 without a direct row are parents that were split into lettered parts. |
| Gates | Ran every gate in the order CI-GATES.md gives, on this machine, and read the output rather than the exit codes. |
| Deployment | Built the Docker image. Ran the Compose smoke test. Booted an instance by hand and inspected its database role. Ran the Helm chart checks. Installed the chart into a kind cluster (Kubernetes running inside Docker) and enabled backups there. Ran the S3 driver against an S3-compatible server. |
| Browser | Walked a fresh Docker instance as a new self-hoster: the setup wizard, onboarding, sessions, the cycle phases, phone width and the Malay language. |
| Code | Six parallel read-only audits, one per requirements area. The High claims were then re-checked by hand. |

**How far to trust each finding.** Every finding carries one of three marks:

| Mark | Meaning |
|---|---|
| **Run** | Reproduced on a running instance during this review |
| **Code** | Confirmed by reading the code during this review |
| **Audit** | Found by a review agent reading the code, and plausible on a spot check, but not reproduced. Treat these as strong leads |

---

## 3. Results of running everything

### 3.1 The gates

| Gate | Result | Notes |
|---|---|---|
| `pnpm typecheck` | Pass | 11 of 11 tasks, 12 minutes under load |
| `pnpm lint` | Pass | 0 errors, 6 warnings, 1 info. All cosmetic (L-07) |
| `pnpm dead-code` | Pass | |
| `pnpm db:lint` | Pass | 99 migration files; 109 soft-deletable tables across 569 files |
| `pnpm check:boundaries` | Pass | 964 files |
| `pnpm check:air-gap` | Pass | 6 checks, matching the guide |
| `pnpm check:docs` | Pass | 31 pages |
| `pnpm check:licences` | Pass | 15 allowed licences |
| `pnpm check:contract` | Pass | 348 actions, 348 commands, 350 MCP tools |
| `pnpm method:check` | Pass | 45 triggers, 26 checks, 56 thresholds, 148 terms, 19 enumerations |
| `pnpm test:ci` (whole repository as one suite, 4 workers) | Pass | 313 files, 4,525 tests passed, 5 skipped, 0 retried. MySQL suites ran |
| The 5 skipped S3 tests | Pass | Run against S3Mock, an S3-compatible server. 9 of 9 pass. CI has never run these |
| `pnpm build` | Pass | Host build |
| `pnpm test:e2e` | Pass | 339 of 339. See H-02 for what the server log said while it ran |
| CI on `main` (`7bbf31e`) | Pass | Every job green, including Compose, Helm, both test shards and end-to-end |
| CodeQL, Dependency review | Not run locally | Not runnable locally. CodeQL was green on the `main` push |

### 3.2 Deployment, run for real

| Check | Result | Finding |
|---|---|---|
| `docker build` with the stock Dockerfile | **Fail** | Out of memory in Next's type check on Docker Desktop's default 7.6 GB VM (H-22) |
| `docker build` with a 4 GB build heap | Pass, 84 seconds | Runtime stage unchanged |
| `deploy/docker/smoke-test.sh` | **Fail** at the last step | A timing race after `rotate-key`, not a product failure: rerun by hand, the instance was serving one second later (L-01). Every earlier check passed: healthy in 18 seconds, wizard, security headers, first account, upgrade, idempotent migrations |
| Database role of the running app | **Superuser with BYPASSRLS** | H-01 |
| `deploy/helm/check.sh` | Pass | Renders templates only |
| `deploy/helm/cluster-test.sh` on kind | Pass | Installs, migrates by hook, 2 replicas, registers a user, upgrades, keeps the key |
| Helm with `backup.enabled=true` on kind | **Fail** | `secret "okr-openokr" not found` (H-19) |

### 3.3 What a new self-hoster sees

Walked on a fresh Compose instance at `http://localhost:8088`:

| Step | What happened |
|---|---|
| Setup wizard | Database, mail and storage show green. **Chat channels and AI provider say "Not in this build. Arrives in Phase 5 / Phase 6"** (H-24) |
| Onboarding | Five skippable steps, sensible defaults. The page says "Four questions" above a "1 / 5" counter (L-08) |
| Starter template | Creates one objective, three key results, a KPI and one weekly session. **The objective fails KR-3 in red, and "publish gate 3 is red"** (H-09) |
| `/sessions`, `/cycle`, `/spaces`, space home | **No control anywhere to schedule a session** (H-08) |
| `/cycle?phase=4` to `7` | **"Not yet checkable: ... arrives at P4-T03", "P4-T04", "P3-T04", "P4-T08"**, and on phase 5 "Gate 2 cannot be evaluated: no thresholds were resolved" (H-09) |
| Strength meter and key result bar | **A bar at 0% draws full width. So does 79%.** The console shows a CSP violation on every page (H-15) |
| Phone, 375 px | **Only Overview, Inbox, Review and Cycle are reachable** (H-16) |
| Language set to `ms` | **Only the search placeholder changes ("Cari...")**. Everything else stays English (M-15) |
| Theme and density | Light, dark, system, comfortable and compact all present in the account menu. An old gap, now closed |

---

## 4. Why every row says `done` while these gaps exist

This section matters more than any single finding, because the same patterns will keep producing gaps until they change.

1. **Coverage tests carry exemptions with false reasons.**
   - [apps/web/test/action-coverage.test.ts:106](../apps/web/test/action-coverage.test.ts#L106) excuses `sessions.create` because "the sessions screen creates through `sessions.schedule`". That action does not exist.
   - Other entries say an action is "offered on the KPI detail" or "offered through the phase assists" when no screen calls it.
   - The gate is only as good as the list of excuses it accepts.
2. **Tests assert the placeholder instead of the product.** [e2e/first-run-wizard.spec.ts:58](../e2e/first-run-wizard.spec.ts#L58) asserts "Chat channels: Not in this build". Fixing the copy would turn CI red.
3. **Tests build state that the UI cannot build.**
   - [e2e/s26-session-entry.spec.ts:49](../e2e/s26-session-entry.spec.ts#L49) inserts sessions with SQL, "because there is no create-session control yet".
   - The review-inbox test inserts a blocker's `goal_id` by hand, which the real write never sets.
   - The workflow unit test passes `qualityChecksPass: true`, which the real loader never supplies.
4. **Rows closed with their acceptance unverified.** P8-T14 (Launch) is `done`, while its own note says the acceptance criterion could not be checked on that machine.
5. **Work that fell between tasks.** P4-T07a built the session record, and no task owned the screen that creates one.
6. **Both test environments differ from production, in opposite directions.**
   - The end-to-end suite uses a restricted database role, so the tenant floor holds but the scheduler never starts.
   - The Compose install uses a superuser, so the scheduler runs but the tenant floor is off.
   - Neither is the product as designed, and no gate compares them.
7. **Static gates cannot see runtime configuration.** None of these fail a gate:
   - the database role
   - a production-only CSP
   - a Secret name in a Helm template that is only rendered, never run

   Every High finding in this review coexisted with a fully green CI.

**Suggestion:** for each `done` row, require the acceptance criterion to be shown on a running instance, and review every exemption list line by line. Section 10 lists the rows worth reopening.

---

## 5. Findings

### 5.1 High: security and data safety

**H-01. The Compose install runs the app as a Postgres superuser, so row-level security is off.** `Run` ✅
- **Fixed.** The Compose helper writes two credentials. The server connects as `openokr_app`, which cannot bypass row-level security, and the image's superuser is used by the migrator only. An existing install is moved over on its next `up` or `upgrade`. The boot log, `/api/health` and `/admin/general` say when a role bypasses the floor.
- **Evidence.**
  - [deploy/docker/openokr:115](../deploy/docker/openokr#L115) sets `POSTGRES_USER=openokr`, and [:126](../deploy/docker/openokr#L126) points `DATABASE_URL` at that role. The Postgres image makes it a superuser.
  - On the running instance: `rolsuper = t`, `rolbypassrls = t`. With no tenant set, `select count(*) from goals` returned rows, although `goals` has security forced.
  - [packages/db/src/roles.ts:33](../packages/db/src/roles.ts#L33) creates the restricted roles, and its comment says the setup wizard would use it. Only the test harness does ([db-harness.ts:192](../packages/test-support/src/db-harness.ts#L192)).
- **Why it matters.** The database-enforced tenant floor is the foundation of the security model: "application code cannot leak across tenants even if it is wrong". `can()` still applies, so this removes the second line of defence rather than opening a door. But any query that forgets its filter now leaks. The demo and staging instances run on Compose.
- **Fix.** Make the migrator create an owner role and a `nosuperuser nobypassrls` application role, and run the app as the application role. Refuse to start, or warn loudly on `/admin`, when the app's role can bypass row-level security. Fix together with H-02.

**H-02. The job scheduler fails silently under a restricted role.** `Run` ✅
- **Fixed.** Migration 0099 creates the `pgboss` schema, and pg-boss starts with `createSchema` off. The scheduler lists workspaces through a system scan the floor allows. `/api/health` and the status page report a scheduler that failed to start.
- **Evidence.**
  - The end-to-end server logged `scheduler: could not start: permission denied for database openokr_e2e` on both servers.
  - pg-boss creates its own schema when it starts ([pg-boss.ts:28](../packages/adapters/src/drivers/jobs/pg-boss.ts#L28)), which a least-privilege role cannot do.
  - [apps/web/lib/scheduler.ts:533](../apps/web/lib/scheduler.ts#L533) only logs the failure, and [the health route](../apps/web/app/api/health/route.ts) does not report the scheduler at all.
- **Why it matters.** The agents, digests, the staleness sweep, audit chaining and the orphan reap all stop, while the instance still reports healthy. Fixing H-01 on its own would cause exactly this in production. The end-to-end suite has never run with a live scheduler.
- **Fix.** Create the `pgboss` schema in a migration as the owner and grant the application role usage. Report the scheduler's state in `/api/health` and on `/admin`.

**H-03. The public `/api/sso-providers` route lists every workspace's single sign-on setup.** `Code` ✅
- **Fixed.** The route takes an email address and returns only the provider its domain matches, with no workspace ids.
- **Evidence.**
  - [The route](../apps/web/app/api/sso-providers/route.ts) has no authentication and no filter, and [apps/web/proxy.ts:114](../apps/web/proxy.ts#L114) marks it public.
  - [packages/core/src/auth/sso.ts:232](../packages/core/src/auth/sso.ts#L232) returns the workspace id, display name, email domains and enforce flag of every enabled connection.
- **Why it matters.** On the managed cloud, anyone can list the customers and their identity providers.
- **Fix.** Take an email address and return only the matching provider, with no workspace ids.

**H-04. The Coach and the Champion run with full workspace authority, and ignore sandbox and propose.** `Code` ✅
- **Fixed.** Every reader behind both runs is limited to what the agent's bindings reach. A goal or KPI outside any space is bound to both agents by name, so coverage does not drop, and a data change does the same for existing rows. A sandboxed run happens inside a savepoint that is rolled back, so it commits nothing.
- **Evidence.**
  - Scheduled runs act as `{ kind: "system" }` ([scheduler.ts:381](../apps/web/lib/scheduler.ts#L381)), which resolves to full access.
  - The only code that reads an agent's `autonomy` is [run-executor.ts:248](../packages/agents/src/run-executor.ts#L248), and nothing in production calls it. So a sandboxed agent still writes nudges and proposals, flips goal health and queues messages.
  - The public demo puts both agents in sandbox and relies on it ([demo/personas.ts:384](../packages/core/src/demo/personas.ts#L384)).
- **Why it matters.** It breaks three CLAUDE.md hard rules: least privilege, no service account with ambient authority, and "sandbox mode commits nothing at all". It also fails P2-T17's own test plan.
- **Fix.** Run each agent as its own principal, filtered by its bindings. Branch on `autonomy` inside the Champion and Coach runs.

**H-05. Some session writes skip object authorisation.** `Code` ✅
- **Fixed.** `resolveBlocker`, `reassignBlocker` and `closeCommitments` load each row's space and authorise through the access getter. `sessions.read` does too.
- **Evidence.**
  - `sessions.resolveBlocker` ([sessions.ts:2063](../packages/core/src/actions/sessions.ts#L2063)), `sessions.reassignBlocker` ([:2128](../packages/core/src/actions/sessions.ts#L2128)) and `sessions.closeCommitments` ([:2352](../packages/core/src/actions/sessions.ts#L2352)) check only workspace-level `edit`, then act on a bare id.
  - `sessions.read` joins space membership by hand instead of using the access getter ([:1190](../packages/core/src/actions/sessions.ts#L1190)).
- **Why it matters.** A member with edit rights anywhere can resolve blockers and close commitments in spaces they cannot see, given an id. It breaks the "one `can()`" rule.
- **Fix.** Load each row's space and authorise through the access getter. Add session, cycle and KPI-tree resolvers.

**H-06. Slack form submissions read tenant tables with no tenant set.** `Code` ✅
- **Fixed.** `memberForChannelIdentity` resolves the member inside the workspace wrapper, by the same rules as the inbound message path. Three core tests run under the application role, one showing the old bare query returns nothing.
- **Evidence.** [slack/route.ts:238](../apps/web/app/api/channels/slack/route.ts#L238) runs a raw pool query on `channel_identities`, which has row-level security forced.
- **Why it matters.** Today it works only because of H-01. Under a correct role, every Slack form check-in is dropped with no reply. Every Slack slash command opens this form, so this is the main Slack path. No test covers the route.
- **Fix.** Read inside the workspace wrapper, or reuse the inbound identity resolution. Add a route test run under the restricted role.

**H-07. The AI base URL setting lets a cloud admin reach internal addresses (server-side request forgery).** `Audit` ✅
- **Fixed.** A guarded fetch applies the outbound address rules to every AI request and refuses redirects. It is on for the managed cloud, and private addresses stay allowed on self-host for local models.
- **Evidence.** [packages/core/src/actions/ai.ts:203](../packages/core/src/actions/ai.ts#L203) accepts any URL, and the drivers fetch it directly rather than through `outboundFetch`. TECHNICAL-PLAN §8.2 names AI base URLs explicitly.
- **Fix.** Route them through `outboundFetch` when cloud mode is on. Keep private addresses allowed on self-host, for local models.

### 5.2 High: P0 promises a user cannot reach

**H-08. Sessions cannot be scheduled from the browser.** `Run` ✅
- **Fixed.** A schedule control on `/sessions` and the space home, and "Book the whole cycle" (`sessions.bookCycle`), which books a weekly check-in each week, a monthly review each month and the quarterly review. Phase 6 reads what is booked.
- **Evidence.**
  - On a fresh instance, no screen has a control to create a session. The only code that creates one is the onboarding template ([templates/apply.ts:208](../packages/core/src/templates/apply.ts#L208)) and the demo builder.
  - The false exemption and the SQL-built spec are described in section 4.
- **Why it matters.** After week one, nobody can hold a weekly session, a monthly review or a quarterly review. REQUIREMENTS §3.6 and §3.7 cannot be met, and neither can METHOD's "book every check-in and review for the whole cycle" (CY-8).
- **Fix.** Add a schedule control on `/sessions` and the space home, plus "book the whole cycle".

**H-09. The guided cycle cannot complete from the browser.** `Run` `Code` ✅
- **Fixed.** Phases 4, 6 and 7 compute from real inputs, and `phaseCompletion` passes its thresholds to the gates. Gate 2 also refuses a failing OBJ-1, which a human approved and METHOD.md §4.5 now says. Phases 1, 2, 3 and 5 have their controls, key results drafted in the browser carry an owner and a due date, and drafting in a blocked phase 4 is refused with the reason.
- **Phases 4, 6 and 7 never compute.** [cycles/workflow.ts:215](../packages/core/src/cycles/workflow.ts#L215) never supplies `qualityChecksPass`, `allKeyResultsScored` or `retrospectiveWritten`. Nothing outside `packages/method` names them.
- **Gate 2 can never evaluate inside phase completion.** `phaseCompletion` calls `publishGates(input)` without the thresholds it was given ([method/src/workflow.ts:875](../packages/method/src/workflow.ts#L875)). The running instance shows exactly that message on phase 5.
- **The screens show users stale task IDs.** For example "arrives at P4-T03" and "P4-T04" (section 3.3).
- **KR-3 fails on every key result drafted in the browser.** The browser cannot set a key result's owner or due date ([cycle/goal-actions.ts](../apps/web/app/cycle/goal-actions.ts)). The product's own starter template fails KR-3 on a fresh instance.
- **Phases 1 to 3 and gate 5 cannot go green.** Sponsor, facilitator, session dates, baseline health, capacity notes and annual focus key results have no browser control.
- **Drafting in a blocked Phase 4 is not refused.** It only shows a banner, against the §3.1 acceptance criterion.
- **Why it matters.** §3.1 is the spine of the product, and in practice every publish from the browser needs the override.
- **Fix.** Supply the four inputs, pass the thresholds, add the missing controls, and remove the stale text.

**H-10. Blockers never reach their owner's review inbox, and escalation at 0.3 does not exist.** `Code` ✅
- **Fixed.** A blocker takes its goal from its key result, so it reaches its owner's inbox. The top rung of an aging blocker stamps who it was escalated to, and `confidence.critical` has a producer (H-11).
- **Evidence.**
  - Every blocker, whether raised in a session or from a chat command, is created by `sessions.createBlocker`, which never sets `goal_id` ([sessions.ts:2022](../packages/core/src/actions/sessions.ts#L2022)).
  - The inbox skips any blocker without a goal ([review.ts:438](../packages/core/src/actions/review.ts#L438)).
  - Nothing writes `escalated_to_id`, and `confidence.critical` has no producer.
- **Why it matters.** Two promises never happen: §3.5 "blockers they own", and Pillar B "escalation at 0.3 and below".
- **Fix.** Derive `goal_id` from the key result on insert, stamp the escalation, and add the producer.

**H-11. 12 of the 45 proactive triggers never fire.** `Code` ✅
- **Fixed.** All twelve fire, each decision a pure function in `packages/method` reading the §11 registry. A gate fails when a catalogue key has neither an emitter nor a written exemption.
- **The twelve:** `confidence.critical`, `digest.weekly`, `commitment.due`, `streak.at_risk`, `cycle.phase_blocked`, `quality.no_not_doing`, `quality.too_many_objectives`, `quality.sandbagging_draft`, `quality.sandbagging_close`, `quality.no_cuts`, `quality.trending_off` and `quality.process_health_low`.
- **Evidence.** Their only reference outside `packages/method` is a display-name map ([apps/web/lib/identifier-names.ts:45](../apps/web/lib/identifier-names.ts#L45)). `pnpm method:check` passes because it compares the document with the package, not with the code that sends messages.
- **Why it matters.** REQUIREMENTS §3.8 and Pillar B name several of these: the weekly digest, commitments due, a streak at risk, and sandbagging at draft and at close.
- **Fix.** Build the emitters, or have a human strike the triggers from AI-NATIVE-PLAN §6.4. Add a gate that fails when a catalogue key has neither an emitter nor a written exemption.

**H-12. Nudges say nothing specific and carry no link.** `Code` ✅
- **Fixed.** A nudge names its subject, links to it, and offers a check-in: a button in chat, and a link to the check-in page by email. The links are plain links and carry no sign-in token.
- **Evidence.** Every nudge other than a blocker, on email, Slack, Teams or Telegram, reads "You have a reminder waiting in OpenOKR. Rule: checkin.due" ([nudges/deliver.ts:56](../packages/core/src/nudges/deliver.ts#L56)). It carries no goal name, no link and no button.
- **Why it matters.** It fails two requirements: the §3.8 acceptance criterion ("a one-tap check-in") and Pillar E ("one-click check-in links" in email).
- **Fix.** Per-rule wording from METHOD.md, the goal title, a signed deep link, and a check-in button.

**H-13. Comments and mentions notify nobody.** `Code` ✅
- **Fixed.** A comment notifies the people following its subject, and a mention notifies the person mentioned. A published check-in and a closed goal notify their followers. Nobody is notified twice for one change.
- **Evidence.** The operation fans out notifications only when an activity sets `notify`, and no action does: searching `packages/core/src` for `notify: true` finds nothing. A mention subscribes the person and never tells them ([comments/service.ts:101](../packages/core/src/comments/service.ts#L101)).
- **Why it matters.** Pillar F P0: "comments, reactions, mentions, subscriptions, notifications ... everywhere".

**H-14. Only the founder can ever be an administrator.** `Code` ✅
- **Fixed.** `people.setAdministrator` makes a member an administrator or returns them to standard access. It refuses the last one, agents, guests and placeholders. The member's page has the control.
- **Evidence.** No action changes a member's workspace access level, and invitations grant `edit` at most ([actions/invitations.ts](../packages/core/src/actions/invitations.ts)). The profile page tells a sole admin to "hand over first", and there is no way to hand over.
- **Why it matters.** If that one person leaves, the workspace has no administrator.
- **Fix.** Add an action that sets the access level, protected by the existing last-owner check.

**H-15. Every server-rendered progress bar draws full.** `Run` ✅
- **Fixed.** The policy adds `style-src-attr 'unsafe-inline'`, which covers attributes only: a `<style>` element still needs the nonce. An end-to-end spec compares every bar's drawn fill with its value.
- **Evidence.**
  - The production CSP is `style-src 'self' 'nonce-...'` ([apps/web/proxy.ts:200](../apps/web/proxy.ts#L200)), which blocks inline `style` attributes.
  - On the running instance, a bar declared `width:0%` rendered 1,038 px wide, the whole track. The 79% strength bar also rendered full.
  - Development mode allows `unsafe-inline`, which is why nobody saw it.
- **Why it matters.** Users read progress that is not there.
- **Fix.** Either allow `style-src-attr 'unsafe-inline'` or set widths on the client. Add an end-to-end assertion on a bar's rendered width.

**H-16. Most of the product is unreachable on a phone.** `Run` ✅
- **Fixed.** A More tab opens a sheet with every screen the sidebar lists. An end-to-end spec walks it at 375 pixels.
- **Evidence.** At 375 px the tab bar shows four items ([app-shell.tsx:249](../apps/web/lib/app-shell.tsx#L249)). KPIs, Spaces, Board, Initiatives, Search and Admin have no link and no drawer.
- **Why it matters.** REQUIREMENTS §9 says the responsive web app covers mobile in v1.

**H-17. Method thresholds are hardcoded in nine places.** `Code` `Audit` ✅
- **Fixed.** Every place in the table reads the workspace's resolved value. The KPI corridor, the confidence dial, the strength bands, the blocker clock, the carry-forward impact, the strategy bounds and the importer's status cutoffs.
- **Why it matters.** Each one means a workspace override silently does nothing, which breaks a CLAUDE.md hard rule.

| Where | Hardcoded | Should read |
|---|---|---|
| [schema/kpis.ts:152](../packages/db/src/schema/kpis.ts#L152) | KPI corridor 90 / 70 | `kpi.healthyThreshold`, `kpi.watchThreshold`. **Both are editable on `/admin/rhythm` and nothing reads them** |
| [confidence-dial.tsx:13](../apps/web/app/session/[id]/confidence-dial.tsx#L13) | 0.3 / 0.4 / 0.7, and "Low (0.4)" lands in Medium | Confidence thresholds |
| [coach-strip.tsx](../apps/web/app/goals/[id]/coach-strip.tsx) | Strength bands 75 / 45 | `quality.strengthScoreBands` |
| [sessions.ts:2016](../packages/core/src/actions/sessions.ts#L2016), [method/src/digest.ts](../packages/method/src/digest.ts) | Blocker clock 24 hours | `cadence.blockerClockHours` |
| [cycles/archive.ts](../packages/core/src/cycles/archive.ts) | Carry-forward impact 4 | `quality.carryForwardIssueImpact` |
| [method/src/workflow.ts](../packages/method/src/workflow.ts) | Annual strategy bounds 2 to 5 | `quality.annualStrategyBounds` |
| [flowyteam/mappers/check-ins.ts](../packages/importer/src/flowyteam/mappers/check-ins.ts) | Status cutoffs 0.7 / 0.4 | Resolved confidence thresholds |

**H-18. Moving a workspace between instances loses people and files.** `Audit` ✅
- **Fixed.** An archive is sealed with a passphrase chosen at export (scrypt), not the instance's key. It carries each member's email, so a person who signs up on the new instance claims their own member row, and import writes every file's bytes to storage.
- **Evidence.**
  - The archive carries no email for registered members, and import clears `user_id` ([portability/export.ts](../packages/core/src/portability/export.ts), [portability/import.ts](../packages/core/src/portability/import.ts)). Everyone arrives as an account nobody can claim.
  - Import never passes storage, so files arrive as rows with no bytes ([actions/portability.ts](../packages/core/src/actions/portability.ts)).
  - Reading an archive needs the source instance's root key ([archive.ts](../packages/core/src/portability/archive.ts)). Moving from the cloud to self-host would mean handing over the cloud's key.
- **Why it matters.** REQUIREMENTS §4 Pillar F promises moves "self-host and cloud in both directions", and [docs/install/cloud.md](install/cloud.md) promises "every uploaded file".

**H-19. Helm backups cannot run, and no restore drill runs in CI.** `Run` `Audit` ✅
- **Fixed.** The backup and verify jobs use the chart's own secrets and back up files when they live on a volume. The kind test runs a backup and `helm test`. `./openokr restore` exists, and the Compose smoke test ends with a restore drill.
- **Evidence.**
  - With backups enabled on kind, the backup job failed with `secret "okr-openokr" not found`. The chart creates `okr-openokr-secrets` and `okr-openokr-database`, but [backup-cronjob.yaml:77](../deploy/helm/templates/backup-cronjob.yaml#L77) and the verify job read `okr-openokr`. `check.sh` passes because it only renders.
  - No workflow runs [restore-drill.sh](../deploy/docker/restore-drill.sh).
- **Why it matters.** It fails REQUIREMENTS §7 and P6-T06 ("a restore drill in continuous integration").

**H-20. A calculated KPI can be blanked by a finer-frequency source.** `Audit`, not reproduced ✅
- **Fixed.** A calculated KPI recomputes for its own period, whatever the source's frequency.
- **Evidence.** `kpis.record` passes the source's period start to the cascade ([actions/kpis.ts](../packages/core/src/actions/kpis.ts)). The dependent KPI's period is then recomputed as null ([kpis/formula.ts](../packages/core/src/kpis/formula.ts)).
- **Why it matters.** Recording a daily value on any day but the 1st would clear a monthly total. That is silent data loss.
- **Reproduce.** Create a daily source and a monthly `sum` formula KPI, then record a value on the 15th.

**H-21. The cloud cannot be operated as designed.** `Audit` ✅
- **Fixed.** An administrator changes plan on S-49, which also lists who holds each seat. An operator sets a plan, or a seat count of their own, on S-46. Both refuse a plan with fewer seats than are in use and name both numbers. `pnpm cloud:operator` grants and revokes the operator role: never to oneself, only by an operator once one exists, and always recorded on the instance audit chain.
- **Evidence.**
  - Nothing writes a tenant's plan or seats after creation ([tenancy/store.ts](../packages/core/src/tenancy/store.ts)), so seat limits can never apply.
  - The first operator can only be created with hand-written SQL, and the UAT guide says so.
  - Screen S-49 has no seat list and no upgrade control.

### 5.3 High: build, release and first impression

**H-22. The Docker image does not build on a default Docker Desktop, or on the server size the install guide recommends.** `Run` ✅
- **Fixed.** The image build skips Next's own type check (`OPENOKR_SKIP_NEXT_TYPECHECK=1`), which is the step that ran out of memory. `pnpm typecheck` still gates every change and every release tag, and a host `pnpm build` still runs the check.
- **Evidence.** The stock Dockerfile fails with "JavaScript heap out of memory" during Next's type check, at about 2 GB. Node sizes its heap from total memory: Docker Desktop's default VM has 7.6 GB, while CI runners have more.
- **Why it matters.** With no released image (H-23), building from source is the only way to self-host. Since PR #85, the [README](../README.md) and [docs/install/compose.md](install/compose.md) tell people to run `docker build` on a server of "2 CPU cores, 4 GB memory". A 4 GB machine gives Node a smaller heap than the 7.6 GB one where the build already failed, so the documented install path fails at its first step. That last point is inferred from how Node sizes its heap, not tested on a 4 GB machine.
- **Fix.** Either set `NODE_OPTIONS=--max-old-space-size=4096` in the build stage (tested: it builds in 84 seconds with the runtime stage unchanged), or skip Next's type check, since `pnpm typecheck` already gates it.

**H-23. Nothing has ever been released, and the launch task's acceptance was never run.** `Code`
- **Still open, and it is a human's to close.** It is the last step of this review, once every other finding is done: section 11 has the checklist. The first release is a tag a person pushes. Every High fix is on branch `fix/review-high` with its changeset, so the first `pnpm changeset version` after it merges gathers them. After that release exists, the upgrade half of P8-T14's acceptance can run.
- **Evidence.** There are no git tags, all 11 packages are at `0.0.0`, and 47 changesets are pending. P8-T14 (Launch) is `done`, but its note says the acceptance checks were not verifiable at the time: a clean-machine install, an upgrade from the previous release, and a chart install.
- **What this review covered.** It ran two of those three, a clean install and a chart install, and both work apart from the defects above. An upgrade from a previous release cannot be tested until a first release exists. The nightly Upgrade workflow covers upgrading from a pinned 11 September commit (81 migrations to 97), and it is green.

**H-24. The first screen tells self-hosters that channels and AI are "not in this build".** `Run` ✅
- **Fixed.** The setup page probes the configured channel and AI drivers. No user-facing text names a task. The accessibility walk fails any screen whose text names one, and a unit test scans both catalogues and the generated contracts.
- **Evidence.**
  - [apps/web/app/setup/page.tsx:61](../apps/web/app/setup/page.tsx#L61) still calls `notInThisBuild("channel", "Phase 5")` and `notInThisBuild("ai", "Phase 6")`. That text was written at P1-T09 on 6 August, and the helper's own comment says a later task would replace it.
  - The end-to-end spec asserts the stale text (section 4).
  - "Phase 6" was never right: AI providers arrived in Phase 2.
  - The same kind of stale wording is visible on cycle phases 4 to 7, on `/scorecard` ("arrives at P6-G16") and on `/account/channels` ("until P6-G08").
- **Fix.** Real probes for the configured channel and AI drivers. Remove every task ID from user-facing copy, and add a test that fails on the pattern `P[0-9]-[TG][0-9]` in rendered text.

### 5.3a High: found while fixing

The review missed these three. Each turned up while fixing another finding, and each is fixed.

**H-25. Root key rotation left most secrets on the old key.** `Code` ✅
- **Evidence.** `pnpm keys:rotate` re-wrapped `system_settings` and nothing else. AI provider keys, chat channel credentials and SSO client secrets are sealed under the same root key, and `./openokr rotate-key` drops the previous key as soon as rotation returns.
- **Why it matters.** After a rotation, every one of those secrets would fail to decrypt.
- **Fixed.** Rotation re-wraps all three tables in every workspace, deleted rows included. Found while fixing H-01.

**H-26. `/api/status` sent uptime monitors to the sign-in page.** `Run` ✅
- **Evidence.** P8-T06c built `/api/status` for uptime monitors, and its first acceptance criterion is an unauthenticated request. The path was never added to the proxy's public list, so a monitor got a redirect to the sign-in page, which reads as a 200 and a healthy instance whatever its state.
- **Fixed.** The path is public, and it still answers with three component states and a time. Found by the instance-health end-to-end spec.

**H-27. Every AI call used OpenRouter, whatever the workspace configured.** `Code` ✅
- **Evidence.** The drafter (every assist, the copilot and the agents' drafting) and the embedder resolved an OpenRouter credential and built an OpenRouter client. Tier routing named a provider and model for each tier, and its answer was discarded. An enabled Ollama with no key did not resolve at all.
- **Why it matters.** A workspace that configured its own provider, or an air-gapped Ollama as REQUIREMENTS promises, got nothing.
- **Fixed.** The provider the route names is built from that provider's own credential and base URL, and a keyless Ollama resolves. Found while fixing H-07.

### 5.4 Medium

| ID | Finding | Evidence | Mark |
|---|---|---|---|
| M-01 ✅ | Documents attach only from goals, files only to initiatives and documents, comments only on goals. Documents have no comments or reactions | `SubjectDocuments` used once; `Attachments` accepts two subject types | Audit |
| M-02 ✅ | The board has no live presence (a P5-T11 deliverable), exists only per space rather than per initiative or key result, and reordering within a column needs a mouse | `board/page.tsx`, `board.tsx` | Audit |
| M-03 ✅ | Step 1 of the weekly session breaks when team voting is off. Revealed votes and the team average are never shown | `confidence-round.tsx`, `sessions.ts:1513` | Audit |
| M-04 ✅ | Closing a monthly or quarterly session adds a 0.0 point to the weekly trend and extends the streak. A week with no session never breaks the streak. Dates use UTC rather than the workspace timezone | `sessions.ts` close path | Audit |
| M-05 ✅ | Feed-forward and the scorecard snapshot are buttons, not automatic at close. The lowest process-health statement becomes a Phase 2 issue, not a Phase 3 priority: a practice change nobody approved | `cycles/archive.ts` | Audit |
| M-06 ✅ | Annual cycles cannot be opened or created in the browser, and mid-cycle calibration has no UI | `cycle/page.tsx`, `cycle/admin-actions.ts` | Audit |
| M-07 ✅ | KPI-backed key results cannot be created in the browser, and recording a KPI never recomputes the goals that read it | `cycle/goal-actions.ts`, `actions/kpis.ts` | Audit |
| M-08 ✅ | A review-inbox proposal links to `/admin/agents`, which a non-admin cannot open. A champion cannot apply their own drafted check-in | `review.ts`, `agents.ts` | Audit |
| M-09 ✅ | Six assists are built but have no browser caller. "Summarise a thread" and "decompose a key result" are not built. The copilot can propose only `goals.create` | `copilot/proposals.ts` | Audit |
| M-10 ✅ | AI egress controls are missing. The Privacy card is static text | [governance.tsx](../apps/web/app/admin/ai/governance.tsx) | Audit |
| M-11 ✅ | Custom agents cannot run: `agents.startRun` enqueues nothing and no handler continues a run | [actions/agents.ts](../packages/core/src/actions/agents.ts) | Audit |
| M-12 ✅ | MCP has no scoped-token path for local agents, and no rate limit on `/api/mcp`, `/api/mcp/register`, `/api/mcp/token` or `/api/scim/v2` | route handlers | Audit |
| M-13 ✅ | No undo, and no restore for deleted goals, initiatives, tasks or documents. The delete control promises "an administrator can bring it back" | [delete-control.tsx](../apps/web/lib/delete-control.tsx) | Audit |
| M-14 ✅ | Terminology labels and the brand colour are saved and never applied. The branding card says the colour "is in force" | `admin/branding` | Audit |
| M-15 ✅ | Bahasa Melayu (P1) is a stub: 1,494 of 1,578 strings are identical to English. The language setting is a free-text box expecting `ms` | [ms.json](../packages/ui/src/i18n/messages/ms.json) | Run |
| M-16 ✅ | The FlowyTeam importer checks about ten source tables exist and then neither reads nor reports them, including `performance_settings`, `indicator_accesses`, `keyresult_indicator`, `key_result_files` and `scores`. CLAUDE.md forbids silent drops | [introspect.ts](../packages/importer/src/flowyteam/introspect.ts), [report.ts](../packages/importer/src/flowyteam/report.ts) | Audit |
| M-17 ✅ | The spreadsheet importer has no template downloads (REQUIREMENTS §6) | no route found | Audit |
| M-18 ✅ | Personal data export exists only inside erasure. Erasure writes the erased name into a new activity, and the `users` row keeps name and email | `people.ts` | Audit |
| M-19 ✅ | The outbox keeps raw invitation tokens and email addresses forever, with no purge | `invitations.ts` | Audit |
| M-20 ✅ | The accessibility scan excludes 26 detail routes (goal, KPI, space, session, task, person, initiative) | [s43-accessibility.spec.ts](../e2e/s43-accessibility.spec.ts) | Audit |
| M-21 ✅ | Command palette entity jump works for KPIs only. There are no palette actions, and semantic search is never called | `search/palette.tsx` | Audit |
| M-22 ✅ | The space home has no goals or KPI trees. Avatar and bio cannot be edited. Guests can only be made by converting a member | `spaces/[id]/page.tsx` | Audit |
| M-23 ✅ | Teams has no check-in form. No channel posts to a space. A per-rule channel override skips the reachability check and has no email fallback | `routing.ts` | Audit |
| M-24 ✅ | File previews, thumbnails, image re-encoding and the scan hook are still scaffolding. P2-T05 asked for a dependency decision that was never taken | `blobs/provisioning.ts` | Audit |
| M-25 ✅ | Seven settings in the registry are missing from the TECHNICAL-PLAN §4.14 map, and nothing compares the two | settings registry | Audit |
| M-26 ✅ | Initiatives feed neither the key result's linked work nor its forecast (REQUIREMENTS §4 Pillar C), which conflicts with TECHNICAL-PLAN §4.9 | `tasks/service.ts` | Audit |
| M-27 ✅ | OBJ-1 checks its rows in a different order from METHOD.md's "first match wins", so some objectives pass that should warn | `method/src/quality.ts` | Audit |
| M-28 ✅ | Aligning under a parent key result skips both the loop check and the access check | `actions/goals.ts` | Audit |
| M-29 ✅ | KPI recovery misfires: a KPI with only a standing target never gets its proposal, workspace-owned KPIs get no nudges, and "recovered" cannot fire | `nudges/sweep.ts`, `kpis/service.ts` | Audit |
| M-30 ✅ | The coverage tests accept false exemptions (section 4), and the route-coverage test counts `/initiatives/[id]` as visited whenever `/initiatives` is | [action-coverage.test.ts](../apps/web/test/action-coverage.test.ts), [route-coverage.test.ts](../apps/web/test/route-coverage.test.ts) | Code |
| M-31 ✅ | Search is empty after an archive import, because nothing reindexes | `portability/import.ts` | Audit |
| M-32 ✅ | The review badge is not live, although TECHNICAL-PLAN makes the review inbox live | `lib/review-badge.ts` | Audit |
| M-33 ✅ | The instance name cannot be changed. `OPENOKR_INSTANCE_NAME` and the wizard's name are stored and never read, so every screen, email and message says "OpenOKR". Found after the review: section 5.4a | [instance-registry.ts:41](../packages/core/src/secrets/instance-registry.ts#L41) | Run |
| M-34 ✅ | Trusted-domain auto-join never happens. The trusted domains are saved on `/admin/general` and `invitations.joinByTrustedDomain` exists, but nothing calls it. Found while fixing M-30: section 5.4a | [invitations.ts](../packages/core/src/actions/invitations.ts) | Code |
| M-35 ✅ | A goal dependency is added in the alignment studio and can never be removed in the browser. Found while fixing M-30: section 5.4a | [studio/actions.ts](../apps/web/app/goals/studio/actions.ts) | Code |
| M-36 ✅ | A member cannot set their own AI key, which P2-T14's acceptance needs. The three actions exist and no screen calls them. Found while fixing M-30: section 5.4a | [actions/ai.ts](../packages/core/src/actions/ai.ts) | Code |

**How each Medium finding was fixed**, on branch `fix/review-medium`, in the order of the table above.

| Finding | What is true now |
|---|---|
| M-01 | Documents, files, comments and reactions are on every page the plans name, and a comment is read and written by whoever reads what it hangs on |
| M-02 | The board shows who else has it open, there is one per initiative and per key result, and a card moves anywhere with the keyboard |
| M-03 | The confidence round works with team voting off, and shows what it revealed |
| M-04 | The streak counts weeks of check-ins, and a skipped week breaks it |
| M-05 | Closing a cycle records its result and feeds the next cycle, and the lowest process-health statement is a Phase 3 priority |
| M-06 | An annual cycle can be made and opened from the cycle screen, and the calibration is recorded on phase 6 |
| M-07 | A key result can read a KPI from the browser, and recording the KPI moves it and the goals above it |
| M-08 | An agent's proposal is decided in the review inbox, by the person it is for |
| M-09 | Every assist is offered where it helps, summarise-a-thread and decompose-a-key-result exist, and the copilot proposes four planning writes |
| M-10 | An administrator decides what may leave for an AI provider, and every AI request passes one guard that obeys it |
| M-11 | A custom agent's run is queued when it starts and the relay carries it step by step to its end. How a custom agent plans its own work is left for a person to decide |
| M-12 | A local agent connects with a scoped token, every public door is rate limited, and a token can no longer mint a wider one |
| M-13 | A deleted goal, initiative, task or document can be undone at once or restored later from Admin, Deleted items |
| M-14 | A workspace's brand colour and its own words for the method's terms reach its screens |
| M-15 | Bahasa Melayu is translated, and the catalogue gates hold it. A native reader has not yet reviewed it |
| M-16 | The FlowyTeam importer names every source table it does not read, with its row count for the company. Whether to import each is a question for a person |
| M-17 | The spreadsheet importer offers a CSV and an Excel template for each kind of row, and importing work the importer owns no longer fails |
| M-18 | Erasure takes the name out of the feed and, when it was their only workspace, anonymises the account |
| M-19 | A delivered invitation loses its token and address, and settled outbox rows are purged after `outbox.retentionDays` |
| M-20 | The accessibility scan opens every detail page on a real record and the sign-in pages signed out. It found and fixed two unnamed controls |
| M-21 | The command palette jumps to anything by name, offers actions, and asks the semantic index when AI is on |
| M-22 | A space home shows its goals and KPI trees, members edit their own picture and bio, a guest can be invited into one space, and an attached file opens for whoever reads what it hangs on |
| M-23 | A rule's channel falls back when it cannot reach somebody, Teams checks in with a card, and a space posts its digest to its own channel |
| M-24 | Uploaded images are re-encoded with a thumbnail through `sharp`, and files can be held for an optional clamd scan |
| M-25 | The §4.14 settings map names every registered setting, and a test holds it |
| M-26 | An initiative's tasks count as linked work for every key result it serves. Whether initiatives feed the forecast is decision 4 |
| M-27 | OBJ-1 reads its table top to bottom, METHOD.md §4.1 is reordered to match, and `method:check` holds the order |
| M-28 | Aligning under a parent key result checks access and loops |
| M-29 | KPI recovery messages reach a person in all three cases |
| M-30 | Both coverage tests check their own excuses: every reason makes a claim the test verifies. The review of them found M-34 to M-36 |
| M-31 | An archive import queues its rows for the search and embedding indexes |
| M-32 | The Review badge is live |
| M-33 | An instance carries the name its operator gave it, on every screen, email and message |
| M-34 | A trusted email domain lets people join, offered with one press to a confirmed address |
| M-35 | A dependency between two goals can be removed in the alignment studio |
| M-36 | A member keeps their own AI key under Your AI keys, and their own assists and copilot answers use it |

The questions these fixes raised for a person are listed in the pull request.

### 5.4a Medium: found after the review

**M-33. The instance name cannot be changed. `OPENOKR_INSTANCE_NAME` and the setup wizard's name are stored, and nothing reads them.** `Run` `Code` ✅

- **Found** on 29 September 2026, while deploying the public demo at `demo.okrgoal.com`. The demo overlay sets `OPENOKR_INSTANCE_NAME` to "OpenOKR demo", and every page still says "OpenOKR".
- **What is wanted.** An operator renames their instance with `OPENOKR_INSTANCE_NAME`, for example to "OKR Goal". Every place a person sees the product's name then shows that name: screens, emails, chat messages and notifications. With the variable unset, everything reads "OpenOKR", as it does today.
- **Evidence.**
  - [instance-registry.ts:41](../packages/core/src/secrets/instance-registry.ts#L41) declares `instance.name`, bootstrapped from `OPENOKR_INSTANCE_NAME`, as "what this deployment calls itself in mail and the page title". Apart from the setup wizard, which writes it, no code reads it.
  - The page title is the literal "OpenOKR" in [layout.tsx:16](../apps/web/app/layout.tsx#L16). `APP_NAME` in [app-info.ts:7](../apps/web/lib/app-info.ts#L7) is declared and used nowhere.
  - The wizard pre-fills its name field with the literal "OpenOKR" ([setup-account-form.tsx:76](../apps/web/app/setup/account/setup-account-form.tsx#L76)) and stores whatever the field holds ([actions.ts:81](../apps/web/app/setup/account/actions.ts#L81)). A stored value beats the environment ([instance-settings.ts:197](../packages/core/src/secrets/instance-settings.ts#L197)). So an operator who sets the variable and then clicks through the wizard loses it for good.
  - No admin screen can change the name after setup.
  - `instance.name` is not in the TECHNICAL-PLAN §4.14 map (see M-25).
- **Why it matters.** An organisation running its own instance cannot put its own name on it. The registry promises a setting that does nothing, which is the pattern section 4 describes.

**Should show the instance name**

| What a person sees | Where | Today |
|---|---|---|
| Browser tab title | [layout.tsx:16](../apps/web/app/layout.tsx#L16) | "OpenOKR" |
| Sign-in heading | `auth.signIn.signInToOpenokr` in [en.json](../packages/ui/src/i18n/messages/en.json) | "Sign in to OpenOKR" |
| Setup heading | `setup.setUpOpenokr` | "Set up OpenOKR" |
| Error page when the app cannot start | `globalError.openokrCouldNotStart` | "OpenOKR could not start" |
| The system's name in the feed and activity | `activity.openOkr`, `feedPanel.openOkr` | "OpenOKR" |
| Linking a chat account | `account.channels.actions.sendThisToTheBot`, [channel-inbound.ts:220](../apps/web/lib/channel-inbound.ts#L220) | "Send this to the OpenOKR bot…", "OpenOKR will send your nudges here." |
| Password reset email | [lib/auth.ts:73](../apps/web/lib/auth.ts#L73) | "Reset your OpenOKR password" |
| Email address confirmation | [lib/auth.ts:94](../apps/web/lib/auth.ts#L94) | "…setting up your OpenOKR account." |
| Invitation email | [outbox/handlers.ts:255](../packages/core/src/outbox/handlers.ts#L255) | "You have been invited to OpenOKR" |
| Nudge subject, by email and chat | [nudges/message.ts:170](../packages/core/src/nudges/message.ts#L170), [nudges/deliver.ts:90](../packages/core/src/nudges/deliver.ts#L90) | "OpenOKR: …", "OpenOKR: 3 updates" |
| Nudge button | [nudges/message.ts:165](../packages/core/src/nudges/message.ts#L165) | "Open in OpenOKR" |
| Blocker card | [nudges/blocker-card.ts:149](../packages/core/src/nudges/blocker-card.ts#L149) | "OpenOKR: a blocker needs you" |
| Channel test message | [actions/channels.ts:1013](../packages/core/src/actions/channels.ts#L1013) | "This is a test from OpenOKR…" |
| Email subject when none is given | [channel/email.ts:81](../packages/adapters/src/drivers/channel/email.ts#L81) | "OpenOKR" |
| Entry in an authenticator app (two-factor issuer) | [core/auth/auth.ts:603](../packages/core/src/auth/auth.ts#L603) | "OpenOKR" |
| Passkey prompt (relying party name) | [core/auth/auth.ts:608](../packages/core/src/auth/auth.ts#L608) | "OpenOKR" |
| Consent screen for the command line | [oauth/clients.ts:36](../packages/core/src/api/oauth/clients.ts#L36) | "The OpenOKR command line" |
| Server name shown in an AI client over MCP | [api/mcp/route.ts:193](../apps/web/app/api/mcp/route.ts#L193) | "OpenOKR" |
| Title of the live API document at `/api/v1/openapi.json` | [api/openapi.ts:224](../packages/core/src/api/openapi.ts#L224) | "OpenOKR" |
| App name sent to the AI provider, shown in its dashboard | [ai-provider.ts:63](../apps/web/lib/ai-provider.ts#L63) | "OpenOKR" |
| The same ten catalogue strings in Malay | [ms.json](../packages/ui/src/i18n/messages/ms.json) | "OpenOKR" |

**Should keep "OpenOKR"**, because it names the software or the company running the managed cloud, not this instance

| Text | Where | Why it stays |
|---|---|---|
| "Nobody from OpenOKR can enter this workspace…", "OpenOKR support is in this workspace…", and the support session's name "OpenOKR support" | `admin.support.*`, `lib.supportBanner.supportIsHere`, [operator/sessions.ts:224](../packages/core/src/operator/sessions.ts#L224) | Names the operator of the managed cloud, not the customer |
| "OpenOKR speaks OIDC and SAML 2.0" | `admin.sso.connectAnIdentityProvider` | Describes the software. Rewording it to "This instance speaks…" works too |
| Importer report lines, such as "OpenOKR spaces do not nest" | [domains.ts](../packages/importer/src/flowyteam/domains.ts), [organisation.ts](../packages/importer/src/flowyteam/mappers/organisation.ts) | Explains the software's model to an operator |
| Command line help and errors, such as "Is that an OpenOKR instance?" | [packages/cli](../packages/cli/src/run.ts) | Names the software |
| "not an OpenOKR archive" | [archive.ts](../packages/core/src/portability/archive.ts) | The name of a file format |
| Server start-up error, Grafana dashboards, the Helm chart description | [instrumentation.node.ts](../apps/web/instrumentation.node.ts), `deploy/` | Read by the operator, not by members |
| The committed `contract/openapi.json` | [api/openapi.ts](../packages/core/src/api/openapi.ts) | Generated with no instance. Keeping "OpenOKR" keeps `pnpm check:contract` stable |
| Identifiers: `@openokr/*`, `OPENOKR_*`, `openokr://`, cookie names, the `okr` and `openokr` commands | everywhere | Not display text. Never renamed |
| The Teams app manifest | [deploy/teams/manifest.json](../deploy/teams/manifest.json) | A static file the operator uploads. The install guide should tell them to edit the name there |

- **Fix.**
  1. One server-side reader for the resolved name: the stored value, then `OPENOKR_INSTANCE_NAME`, then "OpenOKR". Everything in the first table reads it. Email and nudge builders resolve it when they send, because the outbox relay has no request to read it from.
  2. Catalogue strings take an `{instanceName}` placeholder instead of the word, in English and in Malay. Rename the keys that carry the brand in their own name, such as `auth.signIn.signInToOpenokr`.
  3. The page title comes from `generateMetadata` in the root layout. Delete the unused `APP_NAME`.
  4. The wizard pre-fills the resolved name and stores a row only when the operator changes it, so the environment variable keeps working. Add the name to `/admin/general` so it can change after setup.
  5. Better Auth reads the two-factor issuer and the passkey name when the auth instance is built, so a change applies after a restart. Say so on the admin screen. Changing either is safe: a passkey is bound to the domain, not to its display name, and an existing authenticator entry keeps the name it was created with.
  6. Add `instance.name` to the TECHNICAL-PLAN §4.14 map, with its default.
- **Tests.**
  - A unit test that fails when a catalogue string contains "OpenOKR", except an allow-list of the texts in the second table. The M-15 test already keeps a brand-word allow-list to extend.
  - For each email and message builder: given a name, the subject and body use it; given none, they say "OpenOKR".
  - End to end, with `OPENOKR_INSTANCE_NAME` set on the server: the tab title and the sign-in heading show it.
  - The wizard stores no name when the field is left as pre-filled.

**M-34, M-35 and M-36. Three gaps the action-coverage exemptions hid.** `Code` ✅

- **Found** on 30 September 2026, while fixing M-30 by checking every exemption in [action-coverage.test.ts](../apps/web/test/action-coverage.test.ts) against the code. Each was excused by a reason that named a caller which does not exist, which is the pattern section 4.1 describes.

| Finding | What the exemption said | What is true | Plan that asks for it |
|---|---|---|---|
| M-34 | `invitations.joinByTrustedDomain`: "the pipeline calls it, from the join route once the domain matches" | Nothing calls it. An administrator can save trusted domains and they change nothing | REQUIREMENTS §4 People and org (P0) "trusted-domain auto-join"; IMPLEMENTATION-PLAN P2 invitations, "trusted-domain joining works" |
| M-35 | `goals.removeDependency`: "the alignment studio removes them through its own canvas write" | The studio adds a dependency and has no way to remove one | UIUX-PLAN S-16 |
| M-36 | `ai.setPersonalCredential`, `ai.removePersonalCredential`, `ai.readOwnCredentialStatus`: "no screen yet, and it is P7's own row" | No P7 row builds it | P2-T14 acceptance, "their own key is used"; S-37's deliverables name the personal credential flow |

- **Fix.** Give each its caller, and remove its exemption. M-30 makes the exemption list check its own claims so the next false reason fails the build.

### 5.5 Low

| ID | Finding | Mark |
|---|---|---|
| L-01 | The smoke test checks the app straight after `rotate-key`, which returns before the recreated container is serving. Locally, the check failed; the app answered one second later | Run |
| L-02 | `smoke-test.sh` leaves `deploy/docker/backups/` behind | Run |
| L-03 | One full test run fills 95% of Docker Desktop's default Postgres tmpfs (162 databases, 2.7 GB) before the next run sweeps them. A slightly larger suite would fail with "no space left" | Run |
| L-04 | The end-to-end server log holds 1,076 "The destination stream closed early" errors. The noise hides real errors such as H-02 | Run |
| L-05 | The README said Phase 1 was "in progress", counted 104 tasks, and showed an "in development" badge. **Fixed on `main` by PR #85.** Its new badge says "feature complete", which this review does not support | Code |
| L-06 | GAP-AUDIT.md's checkboxes were never updated as tasks closed them. Stale comments remain in [notifications/create.ts:10](../packages/core/src/notifications/create.ts#L10), [e2e/reviews.spec.ts:325](../e2e/reviews.spec.ts#L325) and the session page header | Code |
| L-07 | `biome.json` names schema 2.5.7 against CLI 2.5.14, and there are six lint warnings in two test files | Run |
| L-08 | Onboarding says "Four questions" over a "1 / 5" counter. It has no tour and cannot be resumed from admin | Run |
| L-09 | `/favicon.ico` returns 404 on every page | Run |
| L-10 | Channel webhooks answer 200 for an unknown tenant and 401 for a bad signature, which tells a caller which tenants are installed | Audit |
| L-11 | Identity-provider OAuth tokens are stored in plain text in `accounts` | Audit |
| L-12 | The default console mail driver logs full message bodies, including invitation links | Audit |
| L-13 | `./openokr restore` does not re-run migrations, and the restore runbook names a CronJob that does not exist | Audit |
| L-14 | 41 tables are not named in the TECHNICAL-PLAN §7.2 importer mapping, and no gate checks it | Audit |
| L-15 | A new OIDC connection takes effect only after a restart | Audit |
| L-16 | Rule-key safety is a runtime throw. Nothing checks statically that the keys the code emits exist | Audit |
| L-17 | No end-to-end path publishes a cycle, overrides a gate, publishes or acknowledges a check-in, or casts a vote. No cloud screen has one | Audit |
| L-18 | The Caddyfile is unformatted and sets two headers Caddy already forwards | Run |
| L-19 | The admin audit log can be verified and exported but not browsed | Audit |
| L-20 | A Helm `values.yaml` comment says local disk is the only storage driver. S3 exists | Audit |
| L-21 | `/admin/sso` lists every workspace's SSO connections, with their names, email domains and enforcement, because it read the instance-wide list the sign-in page uses. Found while fixing L-15. On the managed cloud this shows one customer which identity provider another uses, so it is arguably Medium; it ships with the Low fixes because the Medium pull request had already passed | Audit |
| L-22 | The rich-text editor's base styles were blocked in production. TipTap injects them as an inline `<style>`, which the Content-Security-Policy refuses, so the browser logged a violation on every document page and the editor ran without `pre-wrap`. Found while checking a console error during the Medium work | Run |

---

## 6. Requirements coverage, by area

| Area | Verdict | Works | Missing or partial |
|---|---|---|---|
| Guided cycle (§3.1) | Partial | Phase rail, input pack, missing-item list, gates engine, override with reason | Completion for phases 1 to 7, drafting refusal, owner and due date, annual cycles (H-09, M-06) |
| Quality at writing (§3.2) | Mostly | 26 live checks, strength score, six hard gates | An OBJ-1 failure does not block publishing (section 8); hardcoded bands in the interface (H-17) |
| Cadence and staleness (§3.3) | Mostly | Next-due arithmetic, timezone, the scheduled `outdated` sweep, awaiting acknowledgement | Depends on the scheduler running (H-02) |
| Check-ins (§3.4) | Built in core | Narrative, snapshot, draft then publish, private voting | No end-to-end publish (L-17) |
| Review inbox (§3.5) | Partial | All seven sources, overdue-first ranking | Blockers never appear (H-10); proposals dead-end (M-08); badge not live (M-32) |
| Weekly session (§3.6) | Partial | Four-step rail, digest, streak, trend, blocker board | Cannot be scheduled (H-08); voting-off defect (M-03); no escalation at 0.3 (H-10) |
| Quarterly review (§3.7) | Built, not reachable | Eleven timed stages, reveal, retro, diagnostic, minutes export | Cannot be scheduled (H-08); feed-forward is manual (M-05) |
| Agents (§3.8) | Partial | Scheduler, check-in escalation ladder, deduplication, quiet hours, snooze | 12 silent triggers (H-11); generic messages (H-12); authority and sandbox (H-04) |
| Work Map (§3.9) | Partial | Goals and key results with health, progress and confidence | No initiatives or KPIs as nodes; not virtualised |
| OKR core (Pillar A) | Partial | Goals, key results, alignment score, dependency register, KPI grid and trees, recovery board | KPI-backed key results (M-07); calculated KPI defect (H-20); corridors (H-17) |
| Rhythm (Pillar B) | Partial | Blockers, commitments, monthly record, daily digest | Weekly digest (H-11); calibration UI (M-06) |
| Work (Pillar C) | Partial | Initiatives, tasks, board with drag and concurrency-safe ordering, documents with versions and diff | Presence (M-02); documents and files on most surfaces (M-01); previews and scan (M-24) |
| Coaching and AI (Pillar D) | Mostly | Draft Coach, copilot with access-filtered citations, background runs, six providers, caps, metering, OAuth 2.1 with PKCE, 350 MCP tools | Egress (M-10); assists (M-09); custom agents (M-11); local MCP path (M-12) |
| Channels (Pillar E) | Partial | Five drivers behind one port, signature verification, member resolution through `can()`, per-member preference and quiet hours | Generic nudges (H-12); Slack form path (H-06); Teams form and space posts (M-23) |
| Platform (Pillar F) | Partial | Spaces, people, org chart, invitations, trusted domains, SSO, SCIM, feed at four scopes, search, audit chain, freeze, theme and density | Notifications (H-13); second admin (H-14); undo (M-13); phone (H-16); terminology and branding (M-14) |
| Deployment (§5) | Partial | Compose in 18 seconds, Helm install and upgrade, nightly upgrade test | Database role (H-01); image build (H-22); Helm backups (H-19) |
| Managed cloud (§5) | Partial | Tenancy, admission limits, support sessions visible to the customer | Plans and seats, first operator (H-21); SSO listing (H-03); SSRF (H-07) |
| Importers (§6) | Mostly | Spreadsheet wizard with AI mapping, dry run, per-row report; FlowyTeam read-only and idempotent | Template downloads (M-17); silent table skips (M-16) |
| Portability (§4 F, §7) | Partial | Encrypted, checksummed archive covering every table | Cross-instance moves (H-18); restore drill in CI (H-19) |
| Languages (§6) | English complete; Malay a stub | | M-15 |
| Accessibility (§6) | Mostly | Axe scan on every list screen, keyboard flows | 26 detail routes unscanned (M-20) |
| Air gap (§6) | Mostly | Six checks pass; AI off by default; assets self-hosted | The Helm backup job installs `openssl` at run time |

---

## 7. Release readiness

| Item | State |
|---|---|
| A tagged release | None. No git tags |
| Package versions | All `0.0.0` |
| Pending changesets | 47 (24 minor, 23 patch) |
| Release workflow | Present: verify, build, sign, publish, SBOM, chart. Never exercised by a real tag |
| P8-T14 acceptance | Clean install and chart install run in this review, and both work apart from the defects above. Upgrade from a previous release cannot run until one exists |
| Published image | None, so self-hosters must build from source (H-22). Since PR #85 the install guides say so plainly |
| README | Corrected by PR #85, apart from the "feature complete" badge (L-05) |
| Open GitHub issues | None at the time of the review |
| Open pull requests | None at the time of the review |

---

## 8. Decisions that belong to a human

CLAUDE.md puts these on the "ask the human" list. None should be settled by a developer.

| # | Decision | Why it needs a human |
|---|---|---|
| 1 | Should a failing OBJ-1 block publishing? REQUIREMENTS §3.2's acceptance criterion says yes; METHOD.md §4.5's gate 2 judges key result checks only | A REQUIREMENTS versus METHOD conflict, and a practice change |
| 2 | The lowest process-health statement is fed forward as a Phase 2 issue, not a Phase 3 priority | Practice changed in code without approval (M-05) |
| 3 | Build the 12 silent triggers, or strike them from AI-NATIVE-PLAN §6.4 | Adding or removing a proactive message kind (H-11) |
| 4 | Should initiatives feed the key result forecast? REQUIREMENTS §4 Pillar C says yes; TECHNICAL-PLAN §4.9 limits it | Document conflict (M-26) |
| 5 | Which library re-encodes images and scans files | A new runtime dependency (M-24) |
| 6 | The database role model for Compose, and whether Helm should require a restricted role | A deployment change (H-01, H-02) |
| 7 | How an archive is keyed for cross-instance moves: a passphrase, or a recipient key | A security design choice (H-18) |
| 8 | Whether an external accessibility audit is needed before launch | Open question in REQUIREMENTS §10 |
| 9 | Which `done` rows to reopen (section 10) | Only a human sets `done`, so only a human should unset it |

---

## 9. What this review did not verify

- **Real providers.** Slack, Teams, WhatsApp and Telegram apps; SMTP delivery; real Anthropic, OpenAI, Google and Ollama endpoints; a real MCP client such as Claude Desktop; a real identity provider. The repository tests all of these against fakes or fixtures.
- **Performance and load.** The 100,000-goal budgets and the load and soak runs were not repeated.
- **CodeQL and Dependency review.** Neither is runnable locally.
- **A screen reader.** The accessibility procedure in `docs/design/p7-t05-accessibility.md` is a person's job.
- **The managed cloud deployment itself.**
- **Every finding marked `Audit`.** Each was read from code and spot-checked, not reproduced. Section 5 gives reproduction steps where they are short.

---

## 10. Suggested order of work

1. **Security, as one change.** H-01 and H-02 together, then H-03, H-05, H-06, H-07, H-04.
2. **Make the rhythm usable.** H-08 (schedule sessions, book the cycle), H-10, H-12, the rhythm half of H-11 (`confidence.critical`, `digest.weekly`, `commitment.due`, `streak.at_risk`), H-13.
3. **Make the cycle completable.** H-09, H-17, H-15.
4. **Admin and mobile.** H-14, H-16.
5. **Data safety.** H-18, H-19, H-20, M-16.
6. **First impression.** H-22, H-24, and the README badge (L-05). The first tag waits until everything else here is done (section 11).
7. **Close the loopholes that let these ship.** Rewrite the false exemptions (M-30). Add a gate for trigger emitters (H-11), a check for task IDs in rendered text (H-24), and an end-to-end run with a live scheduler under the restricted role (H-02).
8. **The Medium table**, in the order a user would notice it: M-01, M-13, M-03, M-07, M-08, then the rest.
9. **The Low table.**
10. **Last, the first release.** Section 11.

**Rows worth reopening in STATUS.md**, because their own plan text promises what is missing:

| Row | What its plan text promises that is not there |
|---|---|
| P1-T09 | The setup wizard's real probes and role setup (H-01, H-24) |
| P2-T05 | Images re-encoded, and the scan hook (M-24) |
| P2-T17 | "A sandbox run commits nothing" (H-04) |
| P5-T11 | Live presence on the board (M-02) |
| P6-T05a, P6-T05b | Moves between instances (H-18) |
| P6-T06 | A restore drill in continuous integration (H-19) |
| P8-T14 | Its acceptance criterion (H-23) |

---

## 11. Last: the first release

Do this only when everything above is done. It closes H-23. Tagging is a human decision, and Agung makes it.

**Ready when**

| Check | How to tell |
|---|---|
| Every finding in section 5 is ✅, or a human has deferred it in writing here | This document |
| The High, Medium and Low fix branches are merged to `main` | GitHub |
| CI on `main` is green, every job | `gh run list --branch main` |
| Every gate in [CI-GATES.md](development-plan/CI-GATES.md) is green locally on `main` | The list in CLAUDE.md, "Committing and pushing" |

**Steps**, by [the release runbook](runbooks/release.md)

1. **Set the version.** On `main`, run `pnpm changeset version`. It uses up the pending changesets, writes the version into every package and writes `CHANGELOG.md`. Every package is at `0.0.0` and minor bumps are pending, so expect `0.1.0`. Read the changelog it writes, commit it with a sign-off, and merge it to `main`.
2. **Tag it.** `git tag v0.1.0` then `git push origin v0.1.0`. Nothing publishes without a tag.
3. **Watch the Release workflow to the end.** Every job must be green: verify, build and sign, the signature check, the GitHub release and the chart. `gh run watch` follows it.
4. **Make the image public.** Go to [the organisation's packages](https://github.com/orgs/open-okr/packages), open `open-okr`, then Package settings, Danger Zone, Change visibility, Public. This cannot be undone. Public packages are already allowed in the organisation's settings (checked on 29 September 2026).
5. **Check that anyone can pull it.** `docker logout ghcr.io`, then `docker pull ghcr.io/open-okr/open-okr:0.1.0`, with no sign-in.
6. **Run the runbook's checks after release.** A clean-machine install by [the Compose quickstart](install/compose.md), and a chart install with `deploy/helm/cluster-test.sh`. The third check, upgrading from the previous release, has nothing to upgrade from on a first release. It becomes possible from the second one.
7. **Check the demo moved.** `demo.okrgoal.com` follows releases. At 03:00 Malaysia time after the tag, it pulls the new image, rebuilds, and rolls back on its own if the release fails to come up. The next morning, its log should say `now running v0.1.0`.
8. **Announce it** with [the announcement text](runbooks/announcement.md).
9. **Close the loop.** Mark H-23 ✅ here, and ask a human to review the P8-T14 row in `STATUS.md`.

---

## Appendix: commands run

```
pnpm typecheck && pnpm lint && pnpm dead-code && pnpm db:lint
pnpm check:boundaries && pnpm check:air-gap && pnpm check:docs
pnpm check:licences && pnpm check:contract && pnpm method:check
pnpm test:ci --maxWorkers=4          # against the running test stack
pnpm build && pnpm test:e2e
docker build -f deploy/docker/Dockerfile -t openokr:test .
OPENOKR_IMAGE=openokr:test sh deploy/docker/smoke-test.sh
sh deploy/helm/check.sh
kind create cluster --name openokr
kind load docker-image openokr:test --name openokr
OPENOKR_IMAGE_TAG=test sh deploy/helm/cluster-test.sh
```

The S3 tests were run against `adobe/s3mock` with `TEST_S3_ENDPOINT`, `TEST_S3_BUCKET`, `TEST_S3_ACCESS_KEY_ID` and `TEST_S3_SECRET_ACCESS_KEY` set. Every stack, cluster and container this review started was removed afterwards. The test database stack that was already running was left as it was.
