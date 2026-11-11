# Plan: release 0.8.1

Owner: Akmal. Started 11 November 2026, the day 0.8.0 was published, against `main` at `ea94d5a0` (PR #210 merged).

Status: **approved by Akmal on 12 November 2026**: the plan, the L7 split it records in `docs/design/copilot-live-data.md`, and all five decisions in section 9 as recommended. S5-R's own design is still to be written, and its code waits for "design approved" on it.

A quick patch release. It ships what was found after 0.8.0 was cut: the copilot's first fixes, the cycle page's input pack, two dependency alerts, an upgrade trap the demo server hit, and the follow-ups from Obed's 0.8.0 acceptance test. No new engine, no migration and no change to the method. One row needs a short design first (S5-R, section 6).

It holds eight things:

1. **Already on `main`**: PR #210's three copilot bug fixes and the GPT-6 Luna default. Shipped by 0.8.1 with no further work. Section 1.
2. **The copilot**: three small fixes not in any plan yet (A1 to A3), and L7, the prompts tuned to Luna. Asked for by Akmal on 11 November 2026. Section 2.
3. **The cycle page**: a first note gathers an input-pack item, and the box reads as a checkbox (PR #211). Asked for by Akmal. Section 3.
4. **Dependencies**: one alert in code that ships, ten in development tools. Section 4.
5. **Upgrades and the demo**: what the demo server's 0.8.0 upgrade found on 11 November 2026. Section 5.
6. **Follow-ups from the 0.8.0 acceptance test**: Q-8, Q-9, Q-10 and S5-Q2 over REST, which Akmal named follow-ups on 11 November 2026. Section 6.
7. **Outside the release**: operations on the three servers, the site and local clean-up. Not code in this repository. Section 7.
8. **Left out on purpose**, and why. Section 8.

Each row is one change in the CLAUDE.md change loop: one branch, one commit, one pull request. Sizes are rough: **S** is under a day, **M** is a few days.

## 1. Already on `main`

Merged after v0.8.0 was tagged, so 0.8.1 is the first release that carries them. Each already has its changeset.

| # | What | Commit | Changeset |
|---|---|---|---|
| M1 | Check-ins, key results and blockers are indexed as themselves, not under their goal or space. **Data change 0035** indexes what is already stored | `bf4ae581` | `index-check-ins-and-key-results.md` |
| M2 | A copilot proposal survives strict structured output. Every proposal came back empty on OpenRouter | `05f9b360` | `copilot-proposals-strict-output.md` |
| M3 | Ask in Slack, Teams and Telegram answers through the copilot instead of "I have no language model configured" | `7ddce9e0` | `chat-ask-answers.md` |
| M4 | On OpenRouter, the fast and balanced tiers default to GPT-6 Luna; deep stays on Claude Sonnet 4.5. Only where nobody chose a model | `b30346db` | `openrouter-default-gpt-6-luna.md` |
| M5 | The approved design for the copilot reading live data, `docs/design/copilot-live-data.md` | `1f23242b`, `47b72539` | None, docs |
| M6 | Two CI fixes: a newcomer's setup found after the home page's redirect, and Chromium installed from the runner's own libraries when apt is down | `c3d9d37e`, `26653603` | None, tests and CI |

M1 and M4 change what an upgraded instance does, so the upgrade notes must name them (U3).

## 2. The copilot

The design's decision D9 put "the three bug fixes first (0.8.1)", which are M1 to M3, and everything else in 0.9.0. On 11 November 2026 Akmal added three more small fixes and L7 to 0.8.1. L1 to L6 stay in 0.9.0 (section 8).

### 2.1 Three small fixes, not yet in any plan

| # | Gap | Effect today | Where | Change | Size |
|---|---|---|---|---|---|
| A1 | Initiatives and tasks are offered only under objectives the person can **edit**, but creating one needs edit only on its **space** | Priya, who edits the Product space but does not own its objective, can never get an initiative or a task proposed | `packages/core/src/copilot/proposals.ts`, `offerScope().editableKeyResults`, which builds on `objectives()` (edit on the goal) | Offer the key results of open objectives the member can **view**, in a space the member can **edit**, from every cycle being planned or running, the running quarter first (A1-Q). That is the rule `initiatives.create` and `tasks.create` apply when the proposal is applied, including I2's check in `assertWhatATaskNames` (a key result needs view on its objective). `goals.addKeyResult` keeps edit on the objective, because adding a key result changes the objective | S |
| A2 | The answer does not know a proposal is coming | It says "I cannot create objectives" right above a working proposal card | `apps/web/app/copilot/actions.ts` (`proposeFromCopilotAction`), the streaming answer route, and the answer prompt in `packages/agents/src/drafter.ts` | The panel asks for the proposal first. The answer is then told in one line whether a card was made and what it proposes, so it can refer to it rather than deny it. With no card, the answer says plainly what the copilot cannot do yet. Decided in A2-Q | S |
| A3 | A dropped proposal leaves no trace | When the model's reply is unusable, nothing is logged. That is why the strict-schema bug (M2) took live testing to find | `proposeAction` in `packages/agents/src/drafter.ts` returns null on six paths with no record: no proposal wanted, an action it was not offered, an empty reason, unusable fields, a thrown error, and `buildProposal`'s refusal in `packages/core/src/copilot/proposals.ts` | Each null path names its reason: `declined`, `not_offered`, `no_reason`, `fields_refused`, `build_refused`, `provider_error`. Every reason but `declined` writes one structured log line with the reason, the action named, the feature, the provider and the model. **Never the request text, the fields or the reply**: they are a member's words. `pnpm ai:evaluate` prints the reason for each fixture that expected a proposal and got none. No new table and no new column | S |

Acceptance criteria:

| Row | Given | When | Then |
|---|---|---|---|
| A1 | Priya holds edit on the Product space and view on its objective "Make onboarding self-serve", owned by someone else | She asks the copilot to start an initiative for its key result | A card proposes `initiatives.create` in the Product space behind that key result, and applying it succeeds |
| A1 | A member who can only view a space | They ask for a task under one of its key results | No card; the key result was never offered |
| A2 | A request the copilot turns into a proposal card | The answer arrives | It names the card and does not say the copilot cannot do it |
| A2 | A request for an edit the copilot cannot propose yet, such as a check-in (L4, 0.9.0) | The answer arrives | It says it cannot make that change yet and where the person makes it, with no card |
| A3 | A model reply whose fields fail the schema | The proposal is dropped | One log line names `fields_refused`, the action and the model, and contains none of the member's words |

**A2-Q: how the answer learns about the card. Decided by Akmal on 12 November 2026: the proposal first.**

| Option | Cost | Outcome |
|---|---|---|
| **The proposal first, then the answer is told its outcome** | The answer starts about one to three seconds later on Luna, the time of one short structured call | **Chosen.** The answer can only say what is true |
| The answer prompt says writes are offered as cards by a separate step, both still run at once | No delay | Not chosen. The answer must guess, and when the proposal is dropped it points at a card that is not there |

**A1-Q: which cycles the key result choices come from. Decided by Akmal on 12 November 2026: I1's rule.** Today the copilot offers only the current quarter. I1 decided that every picker on screen offers every cycle being planned or running, the running quarter first (`apps/web/lib/linkable-key-results.ts`). The copilot's initiative and task choices follow the same rule, so the copilot never refuses what the screen allows. The choice list stays capped at its present limit, running quarter first.

### 2.2 L7: tune the prompts to GPT-6 Luna

| # | What | Effect today | Change | Size |
|---|---|---|---|---|
| L7 | Tune the copilot's prompts to GPT-6 Luna | Luna misread more often than the Claude models, for example quoting an objective's title as a check-in | Tune the answer prompt and the proposal prompt in `packages/agents/src/drafter.ts` against Luna, measured before and after by `pnpm ai:evaluate` (the mock sets must stay green), the live sets with `pnpm ai:evaluate --provider openrouter --model openai/gpt-6-luna`, and a live run of the design's §1 questions as Priya. Add a fixture for each misread found, the check-in one first | M |

**Deviation from the design, recorded in the same change.** The design's §8 makes L7 depend on L2 (the read-tool loop) and L5 (the evaluation for it), both 0.9.0. In 0.8.1, L7 covers the two prompts that exist: the answer and the proposal. The tool loop's prompt is tuned when L2 lands, as **L7b** in 0.9.0. `docs/design/copilot-live-data.md` §8 and D9 say so.

What the live run should show after 0.8.1, so nobody expects more:

| Asked (design §1) | After 0.8.1 |
|---|---|
| My last check-in | Should be answered, because M1 indexes check-ins as themselves. Not yet seen live |
| A key result's value, target and confidence | Better, but only what the index holds. Full answers need L1 to L3 |
| An objective's progress and health, a KPI's latest value, an initiative's status, a task's owner | Still weak or not found: these need the read loop (L1 to L3, 0.9.0) |
| Create an objective, a key result, an initiative, a task | A card each (M2, A1), and an answer that refers to it (A2) |
| Rename, check in, record a KPI value, move a task, change an initiative's status | No card: these are L4, 0.9.0. The answer says so plainly (A2) |

## 3. The cycle page

| # | What | Where | Change | Size | State |
|---|---|---|---|---|---|
| K1 | **A first note gathers an input-pack item, and the box reads as a checkbox.** Notes saved on all seven items left every one Missing, and the box was a dashed red outline with an invisible tick | PR #211, `apps/web/app/cycle/input-pack.tsx`, `actions.ts`, `phase-rail.tsx` | As in the pull request: a note saved into an empty item marks it Gathered; editing a note leaves the status alone; the box is a 24 px outline with a hover tick, a focus ring and the tooltip "Mark as gathered"; gathered draws lucide's `Check`. The rule is the screen's, so no action, contract or REST change | S | Open, CI running. Review and merge |
| K2 | The session page still draws a text `✓` | `apps/web/app/session/[id]/quarterly-review.tsx` | lucide's `Check` on the same token as K1, so dark mode draws it right | S | To do |
| K3 | Mockup `02-cycle-workspace` still draws the dashed red box | `docs/mockups/` | Redraw the input pack as K1 built it and render the PNG | S | To do |

## 4. Dependencies

| # | What | Alert | Change | Size |
|---|---|---|---|---|
| P1 | `fast-xml-parser` 5.11.1, pulled in by `@better-auth/sso` 1.7.18. Quadratic CPU on unterminated stop-node tags. **The only alert in code that ships**: it parses SAML responses | Dependabot #39, low, runtime | Move the lockfile to 5.12.0. `@better-auth/sso` already asks for `^5.8.0`, so this needs no override and no Better Auth upgrade. Run the SAML and SSO tests | S |
| P2 | Development tools only: `shell-quote` 1.10.0 and `launch-editor` 2.14.1 under `@changesets/cli`, `vite` 8.2.0 under `vitest` | #19 (critical), #20 to #28 (two high) | Move the lockfile to `launch-editor` 2.14.2 and `shell-quote` 1.12.0, both inside their declared ranges, and `vite` to 8.2.4 or later; an override only if `vitest`'s range refuses it. None reaches the image or a running instance, so the changeset is empty | S |

## 5. Upgrades and the demo

What upgrading demo.okrgoal.com found on 11 November 2026. Its first 0.8.0 attempt rolled back to 0.7.0 by itself.

| # | What | Where | Change | Size |
|---|---|---|---|---|
| U1 | **`pnpm db:change` refuses an argument it does not know since 0.8.0**, and 0.7.0 ignored it. The demo server's own wrapper passed `run`, so its upgrade stopped at the data changes. Nothing this repository ships or documents passes `run`, but an operator's script might, and early versions needed it | `packages/db/src/data-change-command.ts`; the comment in `packages/config/src/index.ts` that still says "db:change run" | Accept `run` as the spelling of the default, and say so in the usage line. Fix the comment. Decided in U1-Q | S |
| U2 | **`deploy/demo/reset.sh` never runs the data changes after the seed.** The demo server's wrapper has run them since 7 October 2026, because a seeded database still had work for 0001 (member time zones) and 0009 (agent bindings) | `deploy/demo/reset.sh` | Check first: a fresh database, `pnpm db:seed`, then `pnpm db:change --status`. If it names a script, the reset runs `pnpm db:change` after the seed and before `demo:prepare`. If it names none, close the row with that evidence | S |
| U3 | The upgrade notes for 0.8.1 | `docs/runbooks/upgrade.md` | A "0.8.0 to 0.8.1" section: data change 0035 (M1), which Helm runs after the upgrade and `./openokr upgrade` runs unless `OPENOKR_SKIP_DATA_CHANGE=1`; the Luna default (M4) and how to keep another model; U1 | S |

**U1-Q: accept `run`, or keep refusing it? Decided by Akmal on 12 November 2026: accept it.**

| Option | Outcome |
|---|---|
| **Accept `run` as the default's name** | **Chosen.** One word, and a script written for an early version keeps working. A refusal halfway through an upgrade costs more than a lenient parser |
| Keep refusing, and name it in the upgrade notes | Not chosen. Anyone who missed the note meets it mid-upgrade, as the demo did |

## 6. Follow-ups from the 0.8.0 acceptance test

From `docs/report/uat-0.8.0-report.md`. Akmal answered "follow-up after the release" on 11 November 2026. None is new in 0.8.0.

| # | Finding | Change | Size | Gate |
|---|---|---|---|---|
| Q-8 | Signed-out pages follow the instance language, not the browser's. A Malay browser sees English sign-in and confirmation pages | On a signed-out page, use the browser's language when the product ships it, otherwise the instance language. Signed in, the person's own choice still wins. Decided in Q-8-Q | S | None |
| Q-9 | Turning the cloud flag on after workspaces exist shows "0 tenants" until the hourly adopt runs | The operator console's empty state says workspaces are waiting to be adopted and offers **Adopt now**, which runs the same adopt as `pnpm cloud:adopt`, audited | S | None |
| Q-10a | "Sign out" in the avatar menu is a plain button, so arrow keys skip it | A menu item like the others | S | None |
| Q-10b | The footer band is sticky on a phone and takes 63 px | Not sticky below the phone breakpoint | S | None |
| Q-10c | The "Connect your AI agent" pill is cut off on both sides at 390 px | Fits at 390 px, checked with the overflow spec | S | None |
| Q-10d | The role matrix truncates "Manage" to "Man" | The column fits its longest level in English and Malay | S | None |
| Q-10e | `./openokr up` always ends with "Open ... to finish setup", also on an instance already set up | Read the instance state and print that line only when setup is unfinished | S | None |
| S5-R | **S5-Q2 over REST.** Accepting a personal invitation through REST, the command line or an agent joins without confirming the address; only the join page confirms it | Confirm inside `invitations.acceptLink`, so every surface does what the join page does | S | **Design first**: it changes who counts as confirmed. A short section in `docs/design/email-verification.md` §12, then "design approved". Akmal asked for it in 0.8.1 on 12 November 2026 |

**Q-8-Q: should the browser's language win on signed-out pages? Decided by Akmal on 12 November 2026: yes**, when the product ships that language. The instance language stays the fallback, and the person's own setting wins once signed in. Otherwise a Malay visitor to an English instance reads its sign-in in English, which is what Obed reported.

Retests from the same report, on a 0.8.1 image:

- **F-04**, never checked in a browser on an image: a Viewer-role member sees no Start drafting, and the menu names their role.
- **F-08**, the Malay wording, reviewed by a native speaker.

## 7. Outside the release

Not code in this repository, so no row and no commit here. Listed so nothing found during 0.8.0 is lost.

| What | Who | Note |
|---|---|---|
| Put the five planless workspaces on production on Free | Akmal | `/operator/default-plan` on app.okrgoal.com |
| Check that a session on production shows your own address, not a Cloudflare one | Akmal | Security, on app.okrgoal.com. Confirms `trustedProxyHops: 2` |
| Check that production's nightly erase job ran | Me | It failed two nights on 0.7.0's chart (no `BETTER_AUTH_SECRET`); 0.8.0's chart carries it. `kubectl get jobs` the morning after |
| Production's AI models | Akmal | If `ai.deployment.tierModels` is set there, it keeps its model and does not move to Luna (M4) |
| Lock the origin to Cloudflare with a secret header, then read `cf-connecting-ip` | Me, then Akmal | Until then, the hop count is the safe rule |
| The 0.8.0 after-release checks still open: a clean Compose install from the quickstart, and a Compose upgrade from 0.7.0 with data in it | Me | The Helm upgrade from 0.7.0 ran for real on staging and production on 11 November 2026, and the kind test passed during the build |
| okrgoal.com: the rows of `docs/site-changes-2026-11-03.md` marked "Next release" | The site session | Check each against 0.8.0 and 0.8.1 |
| Remove the superseded copilot branches and worktrees, and the 0.8.0 build worktrees and their test stacks | Me | Local only: `fix/copilot-index-check-ins`, `fix/copilot-proposals-strict-output`, `fix/chat-ask-answers`, `docs/copilot-live-data`, `backup/copilot-live-test`, `r8-auth`, `r8-infra`, `release-0.8.0` |

## 8. Left out on purpose

| What | Why |
|---|---|
| Copilot rows L1 to L6: the read loop, recording reads, the five edit proposals with undo, the evaluation and the end-to-end spec | Decision D9: 0.9.0. Two migrations and a port change, not a patch |
| Q-4: gating the input pack to the Owner, an Admin and the named facilitator | Akmal, 11 November 2026: "for later". It changes access, so it needs a design |
| Upgrading Better Auth to 1.7.20 | P1 needs only the lockfile. An auth library upgrade is its own change with its own tests |
| Twelve open CodeQL warnings and notes (trailing arguments, trivial conditionals, an unused variable) | None is a security finding. Worth a tidy-up change, not a patch |
| The vector index (H5-Q4) and the direct database connection (H7) | Decided in 0.8.0: build when a deployment needs them |

## 9. Decisions

Akmal answered all five on 12 November 2026, each as recommended.

| # | Question | Recommended | Akmal's answer |
|---|---|---|---|
| A1-Q | Do the copilot's initiative and task choices follow I1's rule, every cycle being planned or running, running quarter first? | Yes | **Yes** |
| A2-Q | Does the panel ask for the proposal before the answer, so the answer knows? | Yes, at one to three seconds' delay | **Yes** |
| U1-Q | Does `pnpm db:change` accept `run` again? | Yes | **Yes** |
| Q-8-Q | On signed-out pages, does the browser's language win over the instance's when the product ships it? | Yes | **Yes** |
| S5-R | Write S5-R's short design now, for 0.8.1? | Yes. It is small, and the gap is an address counted unconfirmed on three surfaces | **Yes**. The design is written next and needs its own "design approved" |

## 10. Suggested order

1. **K1**: PR #211 is built and its CI is running. Review and merge it first.
2. **P1 and P2**: lockfile only, and they clear the open alerts before anything else lands.
3. **A3**, so every later copilot change shows why a proposal was dropped. Then **A1** and **A2**.
4. **L7** last among the copilot rows, so the prompts are tuned against the behaviour A1 and A2 settled.
5. **U1, U2, U3**. U3 is written last, once the other rows are known.
6. **Q-10a to Q-10e, Q-9 and Q-8**: small, independent and parallel.
7. **S5-R**: its design, then the code.
8. **K2 and K3**.
9. The retests (F-04, F-08) and the live copilot run on a 0.8.1 image, then `/release`.

## 11. Build log

Statuses: **to do**; **design written**, waiting for "design approved"; **done**, committed and the local tier green; **merged**; **yours**, a decision or action only Akmal can take.

| Row | Status | Note |
|---|---|---|
| M1 to M6 | merged | PR #210, `ea94d5a0` |
| A1 | to do | A1-Q decided: I1's rule |
| A2 | to do | A2-Q decided: the proposal first |
| A3 | done | `ProposalDrop` on the drafter port (`onDropped`, plus the drafter's `identity`); core's `proposal-drops.ts` writes `copilot.proposal_dropped` lines; the evaluation runner prints the reason. Core 34, agents 72 tests, `pnpm ai:evaluate` 24 sets |
| L7 | to do | After A1 and A2. The split is approved |
| K1 | merged | PR #211, `079d37d5`, before this build started |
| K2 | to do | |
| K3 | to do | |
| P1 | done | Lockfile only: 5.12.0 and its own three dependencies, inside `@better-auth/sso`'s range. SAML and SSO suites: 82 core, 27 web |
| P2 | done | `shell-quote` 1.12.0 and `launch-editor` 2.14.2 inside their ranges. `vite` 8.3.7 (with `rolldown` 1.2.18) inside `vitest`'s `^8.0.0`: `pnpm update` will not move a package `vitest` holds as both dependency and peer, so a temporary override moved it and was removed again; none is left. Method 636, ui 454 and two web files pass on it. Empty changeset |
| U1 | to do | U1-Q decided: accept `run` |
| U2 | to do | Check first |
| U3 | to do | Last |
| Q-8 | to do | Q-8-Q decided: the browser's language when shipped |
| Q-9 | to do | |
| Q-10a to Q-10e | to do | |
| S5-R | to do | Design to write next, then "design approved" |
