# GAP-AUDIT.md

A per page and per module audit of what is missing from work already built, written 7 September 2026 against commit `795cfd9` on branch `agung`.

## What this is, and what it is not

**The question asked.** Is there any gap that stops a page or a module doing the job it was built for?

**The baseline.** Only scope whose task is `done` or `in_review` in STATUS.md. Phase 7 and Phase 8 hold 28 `todo` tasks and nothing here counts those as defects. Where a finding overlaps a `todo` task, the row says so.

**How it was produced.** Static reading only: route files, the action registry, the module registry, the settings registry, the outbox handler table, the nav wiring, the adapter drivers, the Helm chart, the plan set. Cross-checked against IMPLEMENTATION-PLAN.md deliverables, UIUX-PLAN.md §6 and §9, and TECHNICAL-PLAN.md §4.14.

**What it did not do.** No application was started, no browser opened, no test suite run, no static gate run. Every finding below cites a file and a line so it can be confirmed by reading. Findings that need a running instance to settle are marked `needs runtime`.

## Verdict classes

| Class | Meaning |
|---|---|
| **B** | Blocker. The page or module cannot do its stated job. A user reaches a dead end. |
| **G** | Gap. A specified capability is absent, but the page's main path still works. |
| **S** | Stale. On-screen text, a nav entry or a link that misstates the state of the product. |
| **T** | No end-to-end proof. The Definition of Done asks for one happy path per user-visible thing. |

## Summary

| Class | Count | Where |
|---|---|---|
| **B** | 12 numbered blockers | §1, plus B-12 in the account table |
| **G** | 10 numbered cross-cutting gaps, plus per-route gaps in §2 | §3 and §2 |
| **S** | 7 stale on-screen strings, 1 stale code comment | §6 housekeeping |
| **T** | 16 of 47 routes with no end-to-end path | G-10 |

Six screens specified in UIUX-PLAN.md §6 have no route at all (S-03, S-31, S-33, S-34, S-37, and the space-settings surface), and every one belongs to a task marked `done` except S-34, which is contested between a `done` task and a `todo` one.

**One fact frames everything below.** `contract/cli.json` and `contract/openapi.json` each carry all 323 registered actions, so the command line and the REST surface have no gap. Every blocker here is a browser gap: the capability exists, the screen does not.

---

# 1. Blockers

## B-01: Nothing schedules the agents, so the product is never active

- [x] Wire a job queue host and call `registerAgentSchedules` at boot. **Closed at P6-G01a.** `apps/web/lib/scheduler.ts` builds the pg-boss driver, subscribes a worker to every declared job and registers the schedules at boot, behind `OPENOKR_SCHEDULER` which defaults to on. The Coach gained the nightly cadence §6.1 gives it and had never had, fired at each workspace's own local hour. Proved by construction, not by observation: no run against a live pg-boss yet.
- [ ] **P6-G01b** the notification batch drain. `renderDigest` has had no caller outside the barrel since P2-T06, so no batched notification has ever been delivered.
- [ ] **P6-G01c** the orphan-blob reap, which needs `delete` on the action context's storage seam.

`registerAgentSchedules` declares four cron cadences for the Champion ([schedule.ts:69](../../packages/agents/src/schedule.ts#L69)). Nothing calls it. No file outside `packages/adapters` and `packages/agents` references `JobQueue` at all, and `apps/web` constructs no queue: [instrumentation.node.ts](../../apps/web/instrumentation.node.ts) starts the outbox relay and nothing else.

Consequences in a running instance:

| What should happen on its own | What happens today |
|---|---|
| The Champion chases a due check-in on the hour | Nothing, unless an admin presses Run now on `/admin/agents` |
| The daily summary sends at 08:00 local (TECHNICAL-PLAN §4.14) | Never sends |
| Notification batches drain on their window | Never drain |
| Staleness flips to `outdated` past the grace | Only when somebody runs `pnpm cadence:sweep` by hand |
| Orphan blobs are reaped, thumbnails generated (P2-T05) | Never |

The outbox relay does run, so a side effect that a write enqueues is delivered. The gap is everything that has to start on a clock rather than on a write. This contradicts the product's stated differentiator in CLAUDE.md: "The product is active. Two agent members ship with every workspace. They initiate, escalate and propose."

`schedule.ts:7` states the reason as "The repository has no relay host and no worker process". The relay host now exists ([relay.ts](../../apps/web/lib/relay.ts)); the worker process still does not, and the comment is stale.

## B-02: The review inbox shows two of six obligation sources

- [ ] Fill the four `PENDING_SOURCES` entries whose tasks are done

[obligations.ts:79-88](../../packages/core/src/review/obligations.ts#L79-L88) declares four sources as unbuilt, each naming the task that fills it:

| Source | Named task | Task status |
|---|---|---|
| Blockers you own | P3-T09 | done |
| Commitments due | P4-T07 | done |
| Sessions to run | P4-T04 | done |
| Agent proposals awaiting your decision | P4-T05 | done |

All four tasks have landed. S-02 is "what I owe right now" and it does not tell a member about a blocker they own, a commitment due, a session they must run, or an agent proposal waiting on their decision. The file's own comment says why this matters: "A screen that silently rendered two of six sources would look complete while quietly failing to tell somebody about a blocker they own."

## B-03: Three of the eight cycle phases have no surface

- [ ] Build the phase 0, phase 6 and phase 7 panels on `/cycle`

[cycle/page.tsx:291-299](../../apps/web/app/cycle/page.tsx#L291-L299) renders a text card for phases 0, 6 and 7 naming tasks that are all done:

| Phase | Screen | On-screen text | Named task | Status |
|---|---|---|---|---|
| 0 Annual strategy | S-05 | "arrives with the frame editor at P4-T02" | P4-T02 | done |
| 6 Run the cadence | S-11 | "arrives with check-ins at P3-T07 and sessions at P4-T04" | P3-T07, P4-T04 | done |
| 7 Review and learn | S-12 | "arrive with the review at P4-T08" | P4-T08 | done |

The phase rail draws all eight phases as reachable ([phase-rail.tsx](../../apps/web/app/cycle/phase-rail.tsx)), so a facilitator can click into three phases that do nothing.

`frame.read` and `frame.set` are registered actions with no caller anywhere in `apps/web`, which is the same finding from the data side: the annual frame (mission, vision, mid-term strategy, horizon) cannot be read or written from the browser.

## B-04: Publish gate 4 cannot be satisfied from the browser

- [ ] Build the dependency register block on phase 5

Gate 4 is "Every dependency is confirmed, or logged with a named risk owner" ([workflow.ts:224](../../packages/method/src/workflow.ts#L224)). Its remediation link points at `/cycle?phase=5` with the label "Confirm the dependencies" ([gates.tsx:37](../../apps/web/app/cycle/gates.tsx#L37)), which is the page the gates panel is already on.

Phase 5 renders two components, `Capacity` and `Gates` ([cycle/page.tsx:261-276](../../apps/web/app/cycle/page.tsx#L261-L276)). S-10 specifies four blocks: alignment mapping, the dependency register, the capacity check and the commit block. Two are missing.

Four actions exist and no UI calls them: `goals.confirmDependency`, `goals.setDependencyRiskOwner`, `goals.removeDependency`, `goals.removeKeyResultDependency`. Dependencies render read-only in the goal rail ([rail.tsx:127-147](../../apps/web/app/goals/[id]/rail.tsx#L127-L147)).

A cycle carrying any dependency therefore cannot pass its own publish gates without the command line or the REST surface.

## B-05: The AI console does not exist

- [ ] Build screen S-37

P2-T16 is `done` and its deliverables name "the AI console (screen S-37) assembling the provider, models, features, budgets, prompts, privacy and usage cards from P2-T13 to P2-T16" (IMPLEMENTATION-PLAN.md:232).

There is no `/admin/ai` route, and the admin nav has seven cards, none of them AI ([registry.ts](../../packages/core/src/modules/registry.ts)). Nineteen of the twenty-four `ai.*` registered actions have no caller in `apps/web`:

`updateProviderConfig`, `setWorkspaceCredential`, `removeWorkspaceCredential`, `setPersonalCredential`, `removePersonalCredential`, `readOwnCredentialStatus`, `rotateCredentials`, `readModelCatalog`, `addCustomModel`, `updateCustomModel`, `removeCustomModel`, `readTierRouting`, `setTierPolicy`, `removeTierPolicy`, `readFeatureSettings`, `updateFeatureSetting`, `readPrompt`, `updatePrompt`, `restorePrompt`, `readBudgets`, `setBudget`, `removeBudget`, `readUsageSummary`.

Practical effect: an administrator cannot supply a provider key, route a tier, set a budget, edit a prompt or see what AI has cost, from the product. Only `ai.readProviderConfig` is read, in two places, to decide whether to hide an AI affordance.

## B-06: The notification inbox does not exist

- [ ] Build screen S-03

P2-T06 is `done` and names "the in-app inbox with a live badge, mute and snooze" (IMPLEMENTATION-PLAN.md:169). There is no `/inbox` route and no notification UI anywhere in `apps/web`.

Five registered actions have no caller: `notifications.list`, `notifications.markRead`, `notifications.snooze`, `notifications.getSettings`, `notifications.updateSettings`. `subscriptions.toggle` has none either, so a member cannot watch or unwatch anything from the browser.

UIUX-PLAN §3 puts Inbox in the primary sidebar block beside Home and Review. The module registry's primary block is Overview, Review and Search ([registry.ts](../../packages/core/src/modules/registry.ts)), so Inbox is absent from the nav as well as from the routes. The string catalogue still carries `shell.mobile.inbox` in both languages for a screen that does not exist ([en.json:10](../../packages/ui/src/i18n/messages/en.json#L10)).

The member half of TECHNICAL-PLAN §4.14 is unreachable with it: per-reason routing, batch window and daily summary time have no surface. `/account/channels` covers the primary channel and quiet hours only.

## B-07: No way to invite anybody

- [ ] Build the invitation surface

P2-T04 is `done`. The words "invite" and "invitation" appear in `apps/web/app` in three places only: the sign-up page, `not-found.tsx` and the setup account page. All five invitation actions have no caller: `invitations.createWorkspaceLink`, `invitations.createPersonalLink`, `invitations.revokeLink`, `invitations.acceptLink`, `invitations.joinByTrustedDomain`.

A workspace admin cannot add a second person to the workspace from the browser. Since registration closes after the first user (P1-T06), a self-hosted instance is a one-person instance unless somebody uses the command line.

## B-08: The people directory and org chart do not exist

- [ ] Build screen S-33

P2-T03 is `done` and its deliverables name "the directory and org chart" plus suspend, restore, guest conversion and erasure (IMPLEMENTATION-PLAN.md:142). There is no `/people` route. Seven actions have no caller: `people.updateMember`, `people.suspend`, `people.restore`, `people.convertToGuest`, `people.erase`, `people.orgChart`, `people.possibleManagers`.

Only `people.updateOwnProfile` is called, from the channels page ([account/channels/actions.ts:98](../../apps/web/app/account/channels/actions.ts#L98)), and that is a timezone write rather than a profile editor. There is no profile screen.

Effect: an administrator cannot suspend a leaver, convert somebody to a guest, or run an erasure. Those are the safety half of the people lifecycle and the only path to them is the command line.

## B-09: Spaces cannot be created or managed

- [ ] Build space creation, space settings and space membership management

Four space actions are called from the browser: `list`, `read`, `join`, `leave`. Six are not: `spaces.create`, `spaces.update`, `spaces.archive`, `spaces.addMember`, `spaces.setMemberRole`, `spaces.removeMember`.

Provisioning creates one space named after the workspace (TECHNICAL-PLAN §4.14). A second space, a renamed space, an archived space, or a member given the manager role all need the command line. TECHNICAL-PLAN §4.14 also names a "Space settings" surface for `spaces.settings` (team voting opt-in, strictness override, space defaults); no such screen exists.

## B-10: The weekly session screen still says its data does not exist

- [ ] Render the confidence trend, blocker ages, streak and commitments on the session screen

[session/[id]/page.tsx:702-708](../../apps/web/app/session/[id]/page.tsx#L702-L708) renders, to end users:

> Confidence trend (P4-T07b), blockers (P4-T07c) and streak (P4-T08) appear once their tables exist.

All three tasks are `done` and migration 0039 created `commitments`, `digests` and `streaks`. S-22 asks the space home for "the run control, the twelve-week confidence trend, the streak ribbon, the open blockers with ages, and last week's scores".

Commitments have no UI at all. Five actions have no caller: `sessions.setCommitments`, `sessions.closeCommitments`, `sessions.listCommitments`, `sessions.setCoordinatorNote`, `sessions.readStreak`. P4-T08's own STATUS row already records "Not done: commitment rollover from last week, twelve-week confidence trend chart, coordinator note rendered in digest".

The weekly session stage gate refuses the move to digest below two commitments, and no browser path can enter one. `needs runtime` to confirm the refusal is reachable in practice.

## B-11: Helm's default install loses every uploaded file

- [x] Change the chart defaults and correct its advice. **Closed at P6-G04.** The shipped values are one replica with persistence on, so a default install keeps files. The refusal no longer offers an S3 driver that does not exist, and `helm install` warns plainly when persistence is off. Several replicas with no shared storage is not refused, because an instance that accepts no uploads is entitled to run that way and refusing it would break a release already running.
- [ ] **P6-G05** the S3-compatible driver, which is what makes the third remedy true. Agung approved both halves on 7 September 2026.

`deploy/helm/values.yaml` sets `replicaCount: 2` and `persistence.enabled: false`. With persistence off, the storage path is an `emptyDir` ([deployment.yaml:142](../../deploy/helm/templates/deployment.yaml#L142)). Two consequences on a default install: a file uploaded through pod A is not readable from pod B, and every file is lost when a pod restarts.

The chart's own refusal message offers three remedies, one of which does not exist: "point storage at S3-compatible object storage and leave persistence disabled" ([_validate.tpl:29](../../deploy/helm/templates/_validate.tpl#L29)). `packages/adapters/src/drivers/storage/` holds one driver, `local-disk.ts`. There is no S3 driver, and `packages/config`'s environment schema exposes `OPENOKR_STORAGE_ROOT` and nothing else.

P1-T09's STATUS row records the human decision as "local disk stays the only storage service, with S3-compatible storage reachable by environment variable". The second half is not true today.

---

# 2. Per page

47 route files, grouped as the nav groups them. `Reach` is whether the route can be reached from the interface without typing a URL.

## Authentication and setup

| Route | Screen | Reach | E2E | Findings |
|---|---|---|---|---|
| [/sign-in](../../apps/web/app/(auth)/sign-in/page.tsx) | S-35 | link | yes | |
| [/sign-up](../../apps/web/app/(auth)/sign-up/page.tsx) | S-35 | link | yes | |
| [/forgot-password](../../apps/web/app/(auth)/forgot-password/page.tsx) | S-35 | link | no | **T** |
| [/reset-password](../../apps/web/app/(auth)/reset-password/page.tsx) | S-35 | email | no | **T** |
| [/backup-code](../../apps/web/app/(auth)/backup-code/page.tsx) | S-35 | link | no | **T** |
| [/setup](../../apps/web/app/setup/page.tsx) | none | first run | yes | **G** no demo-data checkbox (P3-T17 STATUS: "the wizard does not offer the choice yet") |
| [/setup/account](../../apps/web/app/setup/account/page.tsx) | none | wizard | yes | |

## Primary

| Route | Screen | Reach | E2E | Findings |
|---|---|---|---|---|
| [/](../../apps/web/app/page.tsx) | S-01 | nav | yes | |
| [/review](../../apps/web/app/review/page.tsx) | S-02 | nav | yes | **B-02** four of six sources missing. **G** "Your week" absent ([page.tsx:35](../../apps/web/app/review/page.tsx#L35)) |
| [/search](../../apps/web/app/search/page.tsx) | S-32 | nav | yes | |
| *missing* | S-03 Inbox | none | none | **B-06** |
| *missing* | S-31 Activity feed | none | none | **G-01**, below |
| *missing* | S-33 People | none | none | **B-08** |
| *missing* | S-34 Onboarding | none | none | **G-02**, below |
| *missing* | S-37 AI console | none | none | **B-05** |

## Practice

| Route | Screen | Reach | E2E | Findings |
|---|---|---|---|---|
| [/cycle](../../apps/web/app/cycle/page.tsx) | S-04 to S-12 | nav | yes | **B-03** phases 0, 6, 7 have no panel. **B-04** phase 5 missing alignment mapping and the dependency register. **G** `workflow.setRevalidation`, `setBaselineHealth`, `setCapacityNotes`, `calibrate` have no caller |
| [/goals](../../apps/web/app/goals/page.tsx) | S-13 | nav | yes | |
| [/goals/[id]](../../apps/web/app/goals/[id]/page.tsx) | S-14, S-17 | link | yes | **B-04** dependencies read-only. **G** `goals.delete`, `moveToCycle`, `reviewDecision`, `unlinkKpi`, `draftRetrospective` have no caller. **G** `reactions.remove` has no caller, so a reaction cannot be taken back |
| [/goals/studio](../../apps/web/app/goals/studio/page.tsx) | S-16 | link | no | **T** |
| [/check-in](../../apps/web/app/check-in/page.tsx) | S-15 | nav | yes | **S** "Reactions and comments arrive with the discussion wiring at P3-T16" ([timeline.tsx:228](../../apps/web/app/check-in/timeline.tsx#L228)); P3-T16 is `in_progress` so confirm before removing |
| [/scorecard](../../apps/web/app/scorecard/page.tsx) | S-12 | nav | no | **S** "part of the quarterly review's own close at P4-T12" ([page.tsx:283](../../apps/web/app/scorecard/page.tsx#L283)); P4-T12 is done. **T** |
| [/kpis](../../apps/web/app/kpis/page.tsx) | S-20 | nav | yes | **S** two cards cite P3-T13 as pending ([page.tsx:148](../../apps/web/app/kpis/page.tsx#L148), [page.tsx:197](../../apps/web/app/kpis/page.tsx#L197)); P3-T13 is done. **G** sparklines, category subtotals and the four grid filters absent, as those cards state |
| [/kpis/[id]](../../apps/web/app/kpis/[id]/page.tsx) | S-21 | link | no | **G** no `notFound()`: an unknown or forbidden id raises out of `callAction` into the root error boundary rather than a 404, unlike every other detail route. **G** `kpis.narrateTrend`, `kpis.suggest`, `kpis.recoveryDraft` have no caller. **T** |
| [/kpis/trees](../../apps/web/app/kpis/trees/page.tsx) | S-18 | tab | yes | |
| [/kpis/recovery](../../apps/web/app/kpis/recovery/page.tsx) | S-19 | tab | yes | |
| [/initiatives](../../apps/web/app/initiatives/page.tsx) | S-26 | nav | yes | |
| [/initiatives/[id]](../../apps/web/app/initiatives/[id]/page.tsx) | S-26 | link | no | **S** a "What is not here yet" card names P5-T11 and P5-T12 as pending ([page.tsx:252-257](../../apps/web/app/initiatives/[id]/page.tsx#L252-L257)); both are done. **G** the tasks and documents panels S-26 asks for are still absent, and `tasks.linkedWork` and `initiatives.delete` have no caller. **T** |
| [/board](../../apps/web/app/board/page.tsx) | S-27 | nav | yes | |
| [/tasks/[id]](../../apps/web/app/tasks/[id]/page.tsx) | S-28 | link | no | **G** `tasks.list`, `tasks.delete`, `tasks.removeChecklistItem` have no caller: a checklist item cannot be removed and a task cannot be deleted. **T** |
| [/documents/[id]](../../apps/web/app/documents/[id]/page.tsx) | S-29 | link | yes | **G** `documents.delete`, `attachments.list`, `attachments.attach`, `attachments.detach`, and all four `blobs.*` actions have no caller: no file can be attached to anything from the browser |
| [/sessions](../../apps/web/app/sessions/page.tsx) | S-22 | nav | yes | **G** `sessions.create` has no caller. **G** no error state in the route's own files |
| [/session/[id]](../../apps/web/app/session/[id]/page.tsx) | S-22 to S-24 | link | yes | **B-10**. **G** the blocker actions `createBlocker`, `resolveBlocker`, `reassignBlocker`, `blockerStatus`, `sessions.votes`, `blockers.summarise`, `sessions.draftMinutes`, `proposeFromLearnings` have no caller. **S** the stage fallback still names P4-T11, P4-T11c and P4-T12 as pending ([quarterly-review.tsx:350-353](../../apps/web/app/session/[id]/quarterly-review.tsx#L350-L353)); all twelve panels are now wired, so the branch is unreachable and its text is wrong |
| [/session/[id]/minutes](../../apps/web/app/session/[id]/minutes/page.tsx) | S-25 | link | export only | **T** the page itself is not exercised, only its export and pdf routes |
| [/method/[id]](../../apps/web/app/method/[id]/page.tsx) | none | rule link | yes | |

## Spaces

| Route | Screen | Reach | E2E | Findings |
|---|---|---|---|---|
| [/spaces](../../apps/web/app/spaces/page.tsx) | none | nav | yes | **B-09** no create. **G** no error state in the route's own files |
| [/spaces/[id]](../../apps/web/app/spaces/[id]/page.tsx) | S-22 space home | link | yes | **B-09** no settings, no member management beyond join and leave. **B-10** no confidence trend, no streak, no last-week scores |

## Account

| Route | Screen | Reach | E2E | Findings |
|---|---|---|---|---|
| [/account/security](../../apps/web/app/account/security/page.tsx) | none | nav, menu | no | **T** |
| [/account/channels](../../apps/web/app/account/channels/page.tsx) | S-36 | nav, menu | yes | **B-06** per-reason routing, batch window and daily summary time have no surface |
| [/account/api-tokens](../../apps/web/app/account/api-tokens/page.tsx) | none | menu | yes | |
| [/account/connections](../../apps/web/app/account/connections/page.tsx) | S-40 | **none** | yes | **B-12** unreachable. Nothing links to it: the avatar menu carries three items and this is not one ([app-shell.tsx:174-177](../../apps/web/lib/app-shell.tsx#L174-L177)). P5-T08c's goal is "screen S-40, and the place a person sees and ends what they granted", and a person cannot find that place. The same defect as the two account pages P5-T08's STATUS row already records fixing |
| [/account/device](../../apps/web/app/account/device/page.tsx) | none | CLI print | yes | By design: the device flow prints the URL |

## Admin

| Route | Screen | Reach | E2E | Findings |
|---|---|---|---|---|
| [/admin](../../apps/web/app/admin/page.tsx) | S-36 | nav | yes | Redirect to `/admin/general` |
| [/admin/general](../../apps/web/app/admin/general/page.tsx) | S-36 | nav | yes | |
| [/admin/branding](../../apps/web/app/admin/branding/page.tsx) | S-36 | nav | no | **T** |
| [/admin/rhythm](../../apps/web/app/admin/rhythm/page.tsx) | S-36 | nav | no | **G-03**, below. **T** |
| [/admin/nudges](../../apps/web/app/admin/nudges/page.tsx) | S-36 | nav | no | **G-04**, below. **T** |
| [/admin/channels](../../apps/web/app/admin/channels/page.tsx) | S-36 | nav | yes | **G** `channels.listIdentities`, `linkIdentity`, `send` have no caller |
| [/admin/imports](../../apps/web/app/admin/imports/page.tsx) | S-36 | nav | yes | **G** `imports.startRun`, `imports.finishRun` have no caller |
| [/admin/agents](../../apps/web/app/admin/agents/page.tsx) | S-38 | nav | yes | **G-05**, below |
| *missing* | S-36 workspace state | none | none | **G** the workspace freeze overlay and admin recovery list (P2-T09, done) do not exist. `workspace.setState` has no caller |

## Other

| Route | Screen | Reach | E2E | Findings |
|---|---|---|---|---|
| [/oauth/authorize](../../apps/web/app/oauth/authorize/page.tsx) | S-40 | external | yes | |
| [/dev/components](../../apps/web/app/dev/components/page.tsx) | none | dev only | no | Guarded with `notFound()` outside development |
| [/dev/rich-text](../../apps/web/app/dev/rich-text/page.tsx) | none | dev only | no | Guarded the same way |

---

# 3. Cross-cutting page gaps

## G-01: No activity feed anywhere

- [ ] Build screen S-31

P2-T07 is `done` and its deliverables name "per-kind renderers behind a registry" and "live inserts" (IMPLEMENTATION-PLAN.md:176). The engine is real: 19 catalogued kinds, `queryFeed`, `aggregateFeed`. No screen renders any of it, and `activities.workspaceFeed` has no caller. Nineteen kinds of typed, access-scoped, human-readable history are written on every operation and never shown to anyone.

## G-02: No onboarding

- [ ] Build screen S-34, or move it explicitly to P8-T02

S-34 is cited by P3-T17 (`in_review`) and P8-T02 (`todo`). The four-step onboarding after a first sign-in as owner does not exist and no route resembles it. Because a `todo` task also claims the screen, this is the one screen gap that may be correctly deferred. Confirm which task owns it and record the answer in IMPLEMENTATION-PLAN.md.

## G-03: Three of about sixty-five method thresholds are editable

- [ ] Extend the rhythm and thresholds cards to the METHOD §11 registry

TECHNICAL-PLAN §4.14 gives the rhythm cards "the METHOD.md §11 registry: frequency, anchor day, grace, clocks, ladders, bands, corridors, caps, boundaries and timings, plus terminology labels".

[rhythm-form.tsx](../../apps/web/app/admin/rhythm/rhythm-form.tsx) has three fields: `defaultCheckInFrequency`, `checkInAnchorDay`, `coachStrictness`. METHOD.md §11 holds roughly 65 registry rows. Terminology labels have no surface at all, though `packages/method/src/terminology.ts` implements them.

Nothing here is hardcoded in the wrong place, so this is a missing surface rather than a method violation. A workspace that wants a different grace period, ladder or corridor cannot set one.

## G-04: Nudge rules cannot be configured

- [ ] Build the coaching and nudges cards

TECHNICAL-PLAN §4.14 names "per-rule enable, channel override, ladder override and quiet-mode exemption; workspace quiet mode" and per-space strictness overrides.

`/admin/nudges` calls `nudges.list`, `nudges.snooze` and `nudges.volume`. It is a volume dashboard. `nudges.run` has no caller. Nothing writes a `nudge_rules` row from the browser, so every rule stays at its provisioning default and a workspace drowning in one rule can only snooze instances of it, never turn it off.

## G-05: Agents can be watched but not configured

- [ ] Add agent configuration and the proposal review queue

`/admin/agents` reads the agent list and the run log and offers a Run now control. Six actions have no caller: `agents.create`, `agents.setEnabled`, `agents.bindScope`, `agents.startRun`, `agents.readRun`, `agents.cancelRun`. Three more have none: `proposals.list`, `proposals.bulkApply`, `proposals.bulkDismiss`.

CLAUDE.md's hard rule is "Propose by default. Agents produce proposals into the review queue." The review queue has no screen. An agent proposal can be created and can never be seen or applied by a human in the browser. Copilot proposals have their own path ([copilot/actions.ts](../../apps/web/app/copilot/actions.ts)) and are not affected.

An agent also cannot be disabled or scoped from the product, which is the control CLAUDE.md's least-privilege rule assumes exists.

## G-06: No loading state on any route

- [ ] Decide whether Next's own pending state is enough, and if not add `loading.tsx` where a read is slow

`find apps/web/app -name loading.tsx` returns nothing, and one file in the whole app tree mentions `Suspense`. Every page is an async server component that awaits its reads before rendering, so a navigation shows the previous page until the new one is ready with no indication that anything is happening.

UIUX-PLAN §9's first checked item is "Loading, empty, error and permission-denied states implemented and checked". Empty and permission-denied are well covered; error is covered by one root boundary; loading is covered nowhere. `needs runtime` to judge how bad it feels on seeded data.

## G-07: One error boundary for the whole application

- [ ] Add section-level `error.tsx` files, or record the single boundary as the decision

[apps/web/app/error.tsx](../../apps/web/app/error.tsx) is the only error boundary and there is no `global-error.tsx`. Any thrown read anywhere replaces the entire shell, including the sidebar, so a failure in one admin card looks like a failure of the product. This is also what makes G-06's `kpis/[id]` finding user-visible: a mistyped KPI id shows "something went wrong" rather than not-found.

## G-08: Strings are not catalogued and the locale is pinned

- [ ] Extend the catalogue past the shell, and wire the language setting to the provider

[packages/ui/src/i18n/messages/en.json](../../packages/ui/src/i18n/messages/en.json) holds eleven keys, all `shell.*`. Everything on all 47 pages is a hardcoded English string. UIUX-PLAN §9 asks for "Strings in catalogues, none hardcoded, Bahasa Melayu keys stubbed", and P2-T10's own STATUS row records the scope honestly: "only the strings this task's own shell components render".

[layout.tsx:79](../../apps/web/app/layout.tsx#L79) pins `<TranslationsProvider locale="en">`. The `language` setting is in the registry and the `ms.json` catalogue exists; neither has any effect. Four `shell.mobile.*` keys are unused, one of them for the Inbox screen that does not exist.

## G-09: No theme or density control

- [ ] Add a theme and density switcher, or state that the system preference is the only input

`ThemeProvider` exposes `setTheme` and `setDensity` ([theme-provider.tsx:37-38](../../packages/ui/src/theme/theme-provider.tsx#L37-L38)) and no component in `apps/web` calls either. The pre-hydration script reads a stored preference that nothing ever writes, so the only reachable theme is the system preference and the only reachable density is `comfortable`.

UIUX-PLAN §9 asks every UI task to verify "Dark mode and compact density". A reviewer cannot reach either state through the product.

## G-10: Sixteen routes have no end-to-end path

- [ ] Add an end-to-end happy path per route, or record the exemption

24 spec files reach 31 of the 47 routes. The 16 with no path: `/backup-code`, `/forgot-password`, `/reset-password`, `/account/security`, `/admin`, `/admin/branding`, `/admin/nudges`, `/admin/rhythm`, `/goals/studio`, `/initiatives/[id]`, `/kpis/[id]`, `/scorecard`, `/session/[id]/minutes` (the page itself; its export and pdf routes are covered), `/tasks/[id]`, `/dev/components`, `/dev/rich-text`. The last three of those are arguably exempt: two are development-only and one is a redirect.

Spec file names have drifted from the screen numbers: `s37-api-tokens.spec.ts` covers `/account/api-tokens` while S-37 is the AI console, `s38-device-login.spec.ts` covers the device flow while S-38 is agent detail, and `s41-mcp-transport.spec.ts` names a screen that does not exist.

**Closed at P6-G03 by documenting rather than renaming.** Six documents cite these paths, including two design documents and STATUS.md rows that are the audit trail for reviewed work, so a rename would point a historical record at a file that does not exist. `e2e/README.md` now carries the table of which five prefixes are task-era labels, and states that a new spec takes the screen number it drives or no prefix at all.

---

# 4. Per module

| Package | Files (src) | Tests | Verdict |
|---|---|---|---|
| `packages/method` | 22 | 16 | Sound. `pnpm method:check` exists. `terminology.ts` has no consumer surface (**G-03**) |
| `packages/core` | 230 | 126 | Sound as a library. 129 of its 323 registered actions have no browser caller (§5) |
| `packages/db` | 77 | 11 | 73 migrations. `pnpm db:lint` enforces the tenant floor and soft delete. Not re-verified here |
| `packages/adapters` | 40 | 19 | Nine ports, 25 drivers. **B-11**: one storage driver and no S3. `JobQueue` has no host (**B-01**) |
| `packages/agents` | 5 | 5 | **B-01**: `registerAgentSchedules` is never called. **G**: CLAUDE.md's repo layout says this package holds "the Coach and Champion runtimes"; they live in `packages/core/src/agents/`. Fix the layout note or move the code |
| `packages/importer` | 24 | 16 | Sound. The §7.2 mapping has 57 rows and 33 "no legacy source" marks, so it is being kept current |
| `packages/cli` | 8 | 3 | Sound. `contract/cli.json` and `contract/openapi.json` both carry all 323 actions, so the CLI and REST surfaces have no gap. This is why every gap above is a browser gap rather than a capability gap |
| `packages/ui` | 31 | 3 | **G-08** eleven catalogue keys. **G-09** no theme or density control. Three test files for 31 components is thin |
| `packages/config` | 4 | 4 | Sound. **B-11**: no storage variable beyond `OPENOKR_STORAGE_ROOT` |
| `packages/test-support` | 7 | 5 | Sound |

**No stub markers anywhere.** A sweep for `TODO`, `FIXME`, `XXX` and `HACK` across `apps/web/app` and every `packages/*/src` returns zero hits. Nothing above was found by a marker; every finding is a surface that was never built or a caller that was never wired.

**The outbox has a guard and it works.** `handlers.test.ts:199` scans source for `topic: "..."` and fails when a topic has no handler. Ten topics, ten handlers, no orphans. One handler is deliberately inert: `workspace.renamed` maps to `acknowledge`, which records "no consumer for this topic yet" ([handlers.ts:480](../../packages/core/src/outbox/handlers.ts#L480)). That is a declared no-op rather than a gap.

---

# 5. The 129 unreached actions

Every registered action is projected to REST and the CLI, so nothing below is unreachable in absolute terms. These are the 129 that no browser code calls, which is what turns each into a page gap.

**Legitimately not a browser path (18).** Importer and provisioning entry points: `people.importMember`, `goals.importCheckIn`, `comments.importComment`, `comments.replaceImportedBody`, `subscriptions.importWatcher`, `blobs.prepareImport`, `workspace.provision`, `cycles.ensureCurrent` (called in-transaction by provisioning), `imports.startRun`, `imports.finishRun`, plus the eight `copilot.*` and `channels.*` entries reached through `/api/copilot` and the channel webhooks rather than by a literal action name.

**Accounted for by a finding above (98).** All `ai.*` (B-05), all `notifications.*` and `subscriptions.*` (B-06), all `invitations.*` (B-07), all `people.*` lifecycle (B-08), all `spaces.*` writes (B-09), all `agents.*` and `proposals.*` (G-05), the blocker and commitment sets (B-10), the dependency set (B-04), `frame.*` and the `workflow.*` writes (B-03), `activities.workspaceFeed` (G-01), `nudges.run` (G-04), `blobs.*` and `attachments.*` (documents row).

**Out of baseline (1).** `workspace.exportArchive` belongs to P6-T05c, which is `todo`.

**Not yet explained (12).** Confirm each is deliberate or file it: `workspace.overview`, `workspace.rename`, `workspace.setState`, `cycles.create`, `cycles.update`, `cycles.archive`, `goals.publishDraftedCheckIn`, `goals.addKeyResultDependency`, `comments.previewNotify`, `documents.delete`, `initiatives.delete`, `goals.delete`.

`cycles.create` deserves its own line: a workspace gets one cycle at provisioning and there is no browser path to the next quarter's.

---

# 6. Order of work

Grouped so each group is one working session or a small run of them. Sizes are guesses for planning, not commitments.

## First, because they change what everything else means

- [ ] **B-01** the scheduler host. Without it no agent, summary, batch or sweep runs, and the product's central claim is untrue. Everything in the coaching layer is untested in the shape a user meets it.
- [ ] **B-02** the four review-inbox sources. The obligations are all computable today and the file already names what is missing.
- [ ] **B-11** storage. Decide the driver question before anybody runs the Helm chart in earnest.

## Then, the screens that do not exist

- [ ] **B-05** AI console (S-37). Largest of these; twenty-three actions and seven cards.
- [ ] **B-06** inbox (S-03) plus member notification settings.
- [ ] **B-07** invitations. Smallest of these and it unblocks every multi-person test.
- [ ] **B-08** people directory and org chart (S-33).
- [ ] **G-01** activity feed (S-31).
- [ ] **G-05** proposal review queue and agent configuration.

## Then, the cycle and the session

- [ ] **B-03** phases 0, 6 and 7.
- [ ] **B-04** the dependency register on phase 5, which unblocks publish gate 4.
- [ ] **B-09** space creation, settings and membership.
- [ ] **B-10** the session screen's trend, blockers, streak and commitments.

## Then, configuration and polish

- [ ] **G-03** rhythm and threshold cards.
- [ ] **G-04** nudge rule cards.
- [ ] **G-08** string catalogue and locale wiring.
- [ ] **G-09** theme and density control.
- [ ] **G-06** and **G-07** loading and error states.
- [ ] **G-02** decide who owns S-34.

## Housekeeping, cheap and worth doing in one pass

Closed at **P6-G03** on 7 September 2026, except where noted.

- [x] Correct the stale on-screen strings: `cycle/page.tsx`, `session/[id]/page.tsx`, `initiatives/[id]/page.tsx`, `kpis/page.tsx` (twice), `scorecard/page.tsx` and `quarterly-review.tsx`. Each now names the gap-closure row that fills it. `check-in/timeline.tsx:228` is left as it stands, because P3-T16 is genuinely `in_progress`.
- [x] **B-12** `/account/connections` linked. Both it and `/account/api-tokens` are module-registry rows now, and the avatar menu is built from the registry rather than a literal list, which is what made this recur four times.
- [x] `notFound()` added to `kpis/[id]`.
- [x] CLAUDE.md's repo layout reconciled. The split is intentional: the Coach and Champion are seeded inside the workspace-provisioning transaction, so they need `packages/db` and cannot live above it.
- [x] The four unused `shell.mobile.*` catalogue keys deleted.
- [x] The e2e spec-name drift documented in `e2e/README.md` rather than renamed, because six documents cite the current paths. See G-10.
- [ ] Correct the stale comment at `packages/agents/src/schedule.ts:7`, which says no relay host exists. Left for **P6-G01**, which is the row that makes the rest of that comment wrong too.

## What P6-G03 added that the audit did not ask for

- `apps/web/test/reachability.test.ts`. The audit found the fourth instance of one defect, so the fix is a test rather than a link: every `page.tsx` must be in the module registry or named by a source file **outside its own directory**. The directory exclusion is the part that matters, because the only mention of `/account/connections` in the whole application was the `revalidatePath` in its own action file.
- **P6-G30**, for the KPI grid's sparklines, subtotals and filters. The grid's own card named P3-T13 as the blocker, P3-T13 had landed, and no task anywhere owned the three items, so correcting the string honestly meant creating the row it points at.

---

# 7. Verification this audit did not do

Static reading cannot settle these. Run them before treating any row above as final.

- [ ] `pnpm typecheck` and `pnpm lint`
- [ ] `pnpm check:contract`, `pnpm check:boundaries`, `pnpm db:lint`, `pnpm dead-code`
- [ ] `pnpm method:check`
- [ ] `pnpm test` (one suite at a time against one Postgres, per CLAUDE.md)
- [ ] `TEST_DB_PORT=<port> pnpm build && TEST_DB_PORT=<port> pnpm test:e2e`
- [ ] Walk all 47 routes in a browser on seeded data, which is the only way to settle G-06, and confirm the empty, error and permission-denied states each page claims
- [ ] Boot the Helm chart with default values and upload a file, to confirm B-11
