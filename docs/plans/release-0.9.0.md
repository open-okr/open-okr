# Plan: release 0.9.0

Owner: Akmal. Started 12 November 2026, the day 0.8.1 was published and deployed to app, staging and demo.okrgoal.com, against `main` at `7e2b847b` (the v0.8.1 tag).

Status: **draft**, waiting for Akmal's approval and the decisions in section 10.

A minor release. Its centre is the copilot reading live data: `docs/design/copilot-live-data.md`, approved by Akmal on 11 November 2026 ("design approved for all"), whose decision D9 put rows L1 to L6 and the tool loop's prompt (L7b) in 0.9.0. Today the copilot reads six passages from the search index, so it cannot say a key result's value, an objective's health or who owns a task. After 0.9.0 it reads through the product's own read actions, as the member asking, and it can propose five edits as well as four creates.

The panel rows that waited for the loop come with it (CP5, CP10, CP11). So does what 0.8.1's release and deployment found: three test and CI defects, a seed that leaves work for the data changes, and a chart note that misleads on every upgrade. Then the open security-scanner findings, the Better Auth upgrade 0.8.1 left out, and the checks carried from 0.8.1.

On 12 November 2026 Akmal asked for everything else still pending to join this plan. A sweep of the earlier plans, the designs, the reports, GitHub and the local branches found seven more pieces of work, owed by earlier designs or left on branches that never merged (section 5), and a few more operations (section 8). The 0.7.0, 0.8.0 and 0.8.1 build logs are complete. GitHub has no open issue, pull request or Dependabot alert, and the twelve open CodeQL alerts are C1 to C3.

It holds nine things:

1. **The copilot reads live data**: L1 to L6 and L7b, from the approved design. Two migrations, both in that design. Section 1.
2. **The copilot panel, the rest**: citation chips, reason codes, "Ask about this page", the panel's specification and mockup, and the first word arriving sooner. Section 2.
3. **What 0.8.1 found**: three test and CI defects, the seed, the chart's notes. Section 3.
4. **Security findings and dependencies**: one high and two medium CodeQL alerts, nine warnings, Better Auth. Section 4.
5. **Owed from earlier releases**: a setup code to claim an instance, recent items in the command palette, API tokens on the agent connections screen, KPI sharing from FlowyTeam, the profiles' source links, the mockups, and the commit attribution setting. Section 5.
6. **Upgrades**: the upgrade notes. Section 6.
7. **Checks before the release**: the retests and browser checks carried from 0.8.1, a live copilot run, and an acceptance test. Section 7.
8. **Outside the release**: operations on the three servers, the mail sender, the site and local clean-up. Section 8.
9. **Left out on purpose**, and why. Section 9.

Each row is one change in the CLAUDE.md change loop: one branch, one commit, one pull request. Sizes are rough: **S** is under a day, **M** is a few days, **L** is a week or more.

## 1. The copilot reads live data

From `docs/design/copilot-live-data.md` §8, in the order D9 chose: the edits first (L4), because they need no port change and are the smaller, safer step, then the loop.

| # | What | Migration | Depends on | Size |
|---|---|---|---|---|
| L4 | **Five edit proposals**: rename or redescribe an objective, check in, record a KPI value, move a task, change an initiative's status (§4.1). Each offered only over what the member may edit. Undo for an edit stores the values from before it was applied (§4.2, D5). The card shows before and after (§4.4). A mid-cycle target change needs a reason: the model writes it from the person's words, or the card asks for it (§4.3, D10). Every change stays a proposal the member applies (D4) | **Migration 2**: `proposed_changes.reverse_payload` | | L |
| L1 | **Port**: assistant tool-call turns in every driver, the Google tool result, tool-name mapping (§3.5). `chatWithTools` gets its first caller | None | | M |
| L2 | **The read tools and the loop**: the curated dozen read actions in §3.2 (D2), called as the member, 4 rounds, 6 reads a round, 6,000 characters a result (D7). Results are untrusted text (§3.4). Citations come from what was read (§3.3). The reading status line, "Reading New accounts reach value in their first week", joins 0.8.1's step line. A provider that cannot call tools keeps today's path, and AI off is unchanged | None | L1 | L |
| L3 | **Record the copilot's reads** in `ai_tool_calls`, beside the agent surface's (§3.6, D6). After a reload, the "Searched, read N" line under an answer is rebuilt from these rows, which closes W2-Q (section 10) | **Migration 1**: `ai_tool_calls.source` admits `copilot` | L2 | S |
| L5 | **Evaluation**: tool choice, the injection fixture, a fixture that needs several rounds, and the live smoke test on OpenRouter (`pnpm ai:evaluate --provider openrouter`) | None | L2, L4 | M |
| L6 | **The Northwind questions from design §1 as an end-to-end spec** against the mock provider | None | L2, L4 | M |
| L7b | **Tune the tool loop's prompt on GPT-6 Luna**, measured by L5's sets and a live run of the §1 questions as Priya, before and after, as L7 was in 0.8.1 | None | L2, L5 | M |

Every row updates what the design's §7 names, in the same change: AI-NATIVE-PLAN §2.4, §9 and §11, UIUX-PLAN S-39, TECHNICAL-PLAN §4 and `DATABASE.md` for the two migrations, and `docs/design/agent-tool-calls.md`. Both migrations ship with their row-level security unchanged (no new table) and mark the changed tables as having no legacy source in TECHNICAL-PLAN §7.2.

Acceptance criteria are the design's §9. The ones a person would check first:

| Row | Given | When | Then |
|---|---|---|---|
| L2 | Priya, with AI on, owning a key result with a recent check-in | She asks "How is my activation key result doing?" | The answer names its value, target and confidence as stored, and links the key result it read |
| L2 | A member who cannot view an objective | They ask about it by name | The answer does not reveal it; the read returned not-found |
| L4 | Priya's key result needs a check-in | She asks the copilot to record 45% with a note | A card shows the check-in before and after; applying it records the check-in as her; Undo removes it |
| L3 | An answer that read three objectives | The page reloads | The line under the answer still lists the three reads |

## 2. The copilot panel, the rest

From `docs/report/copilot-panel-review-0.8.1.md`, the rows its decision Q7 left for 0.9.0, and what the 0.8.1 live run found.

| # | What | Fixes | Depends on | Size |
|---|---|---|---|---|
| CP5 | **Citation chips.** `[n]` in the prose becomes a small numbered chip linking to its source, with the title on hover and focus. The source list under the answer is numbered the same way, each with its entity's icon. Every kind of source links: objective, key result, KPI, initiative, task, check-in | Review F9, F10 | L2, L3 | S |
| CP10 | **Reasons as codes.** The server sends a reason code (AI off, no plan, capped, provider error, stopped partway) and the panel words it from the catalogue in English and Malay. Today some reasons reach a Malay reader in English | Review F15 | | S |
| CP11 | **Ask about this page.** On an objective, key result, KPI, initiative or task page, the panel offers to ask about it. The panel sends only the page's entity id; the copilot reads it through L2's tools as the member, so nothing the member cannot see reaches the model. Decided in CP11-Q | Review F12 | L2 | M |
| CP12 | **The panel's specification and mockup.** UIUX-PLAN S-39 describes the panel as 0.8.1 built it and 0.9.0 extends it. A new mockup, `docs/mockups/src/13-copilot.html`, with its PNG, shows the empty state, a streaming answer with the step line, an answer with citation chips and a card, and AI off. Neither landed in 0.8.1 | Review §4 | CP5 | S |
| A4 | **The first word sooner.** On Luna the first word arrives six to ten seconds after the question, most of it the proposal call that A2 put first in 0.8.1. The step line explains the wait, but six seconds is slow next to ChatGPT and Claude. Decided in A4-Q | Live run, 12 November 2026 | L2 | M |
| FB1 | **Thumbs up and down on an answer**, kept with the answer and read by L5's evaluation, so a poor answer becomes a fixture. A new table, so a short design first. Only if FB-Q says so | Review Q5 | L5 | M |

**A4-Q: how the first word comes sooner. Recommended: the proposal becomes a tool inside L2's loop.**

| Option | Cost | Outcome |
|---|---|---|
| **The proposal is one of the loop's tools.** The model calls "propose a change" when the question asks for one, in the same rounds as its reads | Changes the design's §4 path, so a short addition to `copilot-live-data.md` and "design approved". L5 needs a fixture for when it should and should not propose | **Recommended.** A question with no change in it pays nothing for proposals, and the answer still knows whether a card was made. This is how ChatGPT and Claude call their tools |
| Ask for a proposal only when the question reads as a request, by a fixed word list | Small, deterministic | Misses requests worded as questions ("can you add a key result for…?"), and a word list in English fails Malay |
| Run the proposal and the answer at the same time again | None | Undoes A2: the answer can again deny a card that is on screen |

**CP11-Q: what "Ask about this page" sends. Recommended: the entity's id only.** The copilot reads it through its tools as the member. The alternative, the page's visible text, sends whatever is on screen, including what the copilot's own reads would have refused, and it goes stale.

**FB-Q: thumbs up and down in 0.9.0? Recommended: yes, after L5, as the last copilot row.** It is a table, so it needs a short design: what is kept (the answer's id, the rating, an optional note), who can read it (the workspace's AI administrators, never other members), and how L5 turns it into fixtures. The alternative is a later release: the panel then has no way to say an answer was wrong.

## 3. What 0.8.1 found

From the 0.8.1 release run and the deployment to the three servers on 12 November 2026.

| # | What | Where | Change | Size |
|---|---|---|---|---|
| T1 | **The suspension spec loses a race with the hourly adoption.** `tenancy.adopt` runs at ten past the hour. When it adopts the claim workspace before the spec runs, the spec's tenant insert is `on conflict (workspace_id) do nothing`, so nothing is suspended and the page reads Active. It failed the release pull request #213 on both tries; 0.7.0's `main` lost the same race on another spec | `e2e/hosting-profiles.spec.ts` lines 210, 266 and 311 | Take over an existing tenant row and put it back after, as 0.8.0's `6d136566` did for the credits spec. All three inserts | S |
| T2 | **The flakiness gate reads the first attempt's report after a rerun.** Every attempt uploads `flaky-report-e2e-N` under the same name; on a rerun the gate downloaded the old one and failed on a test that had passed. 0.8.1's run needed the old artifact deleted by hand | `.github/workflows/ci.yml`, both `upload-artifact` steps (unit and end-to-end) | `overwrite: true` on both, so a rerun replaces its shard's report. A test that reruns one shard and checks the gate reads the new report | S |
| T3 | **The quarterly review spec timed out once on `main`.** "A quarterly review runs its rail, and the second client follows" passed its checks but ran past 30 seconds, and its serial group then failed the monthly spec on the retry, on data the first try had changed | `e2e/reviews.spec.ts:388` | Find what takes the time from a trace (a rerun with tracing on). Then either give the two-client test its own limit with a reason, or make the serial group's retry start from fresh data | S |
| D1 | **A fresh seed leaves work for the data changes.** On a fresh Northwind year, 0001 fills member time zones, 0005 gives check-ins their reviewer, and 0035 queued 684 items for indexing on the demo. The seed should write what the product writes | `packages/core` seed builders, `pnpm db:seed` | The seed sets each member's time zone and each check-in's reviewer as the product does, and queues indexing through the same outbox rows. A test: a fresh seed, then `pnpm db:change --status`, names no script with work to do | M |
| H1 | **The chart says "The instance has not been set up" on every upgrade.** Staging and production printed it on 12 November, both long set up | `deploy/helm/templates/NOTES.txt` | Print the setup note only on a first install (`.Release.IsInstall`). The chart cannot know whether setup finished, so the upgrade note says how to check instead. `deploy/helm/check.sh` asserts both | S |

Acceptance criteria:

| Row | Given | When | Then |
|---|---|---|---|
| T1 | The hourly adoption has already given the claim workspace a tenant row | The suspension spec runs | The workspace reads "Suspended by the provider", and after the spec its tenant row is as it was |
| T2 | An end-to-end shard failed and passed on its rerun | The gate reruns | It reads the rerun's report and passes |
| D1 | A fresh database seeded with the Northwind year | `pnpm db:change --status` runs | No script has work to do |
| H1 | An instance already set up | `helm upgrade` runs | The notes do not say it has not been set up |

## 4. Security findings and dependencies

| # | What | Alert | Change | Size |
|---|---|---|---|---|
| C1 | `scripts/gen-api-reference.ts` escapes `|` in a summary but not `\`, so a summary ending in a backslash breaks its table cell | CodeQL #79, high, `js/incomplete-sanitization`, since 18 September 2026. A build script, not in the image | Escape backslashes before pipes; regenerate `docs/api/reference.md` (it should not change) | S |
| C2 | `okr mcp` sends the stored token to the URL in the stored profile | CodeQL #93 and #94, medium, `js/file-access-to-http`, `packages/cli/src/mcp-bridge.ts:92-94`, since 9 November 2026 | This is the command's purpose, but the URL is not checked. Refuse a profile URL that is not `https`, except `localhost`, and refuse a redirect to another origin. Then dismiss both alerts as intended use, with the reason. Decided in C2-Q | S |
| C3 | Nine warnings and notes: trailing arguments, trivial conditionals, an unused variable, defensive code that cannot run | CodeQL, none a security finding | One tidy-up change | S |
| P1 | Better Auth 1.7.18 to the newest 1.7 patch | Left out of 0.8.1 on purpose | Its own change: the lockfile, then the auth, SSO, SCIM and invitation suites and the sign-up and sign-in specs. Read its changelog for anything that touches sessions, email confirmation or the SSO callback | S |

**C2-Q: fix `okr mcp`, or dismiss the two alerts as they are? Recommended: fix, then dismiss.** Today a profile edited to name another server sends it the token. The check is a few lines. Dismissing without it leaves the alerts right.

## 5. Owed from earlier releases

Work an earlier design or decision named "for a later release", or left on a local branch that never reached `main`. Found on 12 November 2026.

| # | What | Owed by | Change | Size | Gate |
|---|---|---|---|---|---|
| G1 | **A setup code to claim a new instance.** Today the first person to reach `/setup` owns the instance, and certificate transparency logs publish a new hostname within minutes. OKRGoal kept its new instances behind Cloudflare until claimed for this reason | `registration-policy.md`, H3-Q1: "not in 0.8.0; a row for a later release" (Akmal, 11 November 2026) | `./openokr up` and the Helm notes print a one-time code, and the setup wizard asks for it before the first account. The code is single use and stored hashed. An instance already claimed is unaffected | M | **Design first**: a new security mechanism |
| G2 | **Recent items in the command palette and search.** Nothing records what a member opened, so the palette has no recents, recents do not lift the ranking, and the palette has no scoped tabs (the search page has them as type filters) | `work-layer.md`, "Not built, and still owed to UIUX-PLAN §3 and S-32" | A per-member record of recently opened objects, read by the palette's empty state and its ranking, and scoped tabs in the palette | M | **Design first**: a new table |
| G3 | **API tokens for agents on the agent connections screen.** An agent can connect with an API token whose audience is `mcp`. Those tokens are not grants, so the admin screen does not list them, and an administrator cannot see or end one | `agent-connections-admin.md`, Q2: "list them in the same screen in a later change" | List them beside the grants. Ending one for somebody else records a reason, so its owner's page can say why it stopped | S | **Design first**: the reason needs a column on `api_tokens` |
| G4 | **KPI sharing from FlowyTeam.** The importer does not read `indicator_accesses` (a member, `read` or `update`, a view option and a view frequency). Every run reports its rows as not imported | TECHNICAL-PLAN §7.2, completeness review M-16: "Pending a decision" since September | Decided in G4-Q. If imported: each row becomes a `kpi_shares` row (member and level), and the view option and frequency, which have no home, go in the import report by name | S | **Yours**: dropping or approximating source data is your decision (CLAUDE.md) |
| G5 | **The Google-style and Radical Focus profiles link to their sources.** Built on 3 November 2026 on branch `feat/profile-source-links` and never opened as a pull request. The practice screen links the work each profile follows, and METHOD.md §12.2 carries the link, compared word for word by `method:check` | The branch, one commit, 13 files | Rebase onto `main`, run `pnpm method:check`, open the pull request | S | **Yours**: it changes METHOD.md (G5-Q) |
| G6 | **The reference mockups catch up.** Eleven still draw an agent as the gradient `.av.bot` circle: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10 and 12. `guided-inputs.md` also asks 03, 07, 08, 12 and 12b to be checked for the fields it changed | `agent-faces.md` (the reference mockups row), `guided-inputs.md` §6 | Redraw the agents' faces and any changed field, then render the PNGs. Docs only | S | None |
| G7 | **The repository turns off the assistant's commit attribution.** CLAUDE.md forbids a co-author trailer or a generated-with line, but the assistant's own configuration still asks for one, and on 11 November 2026 a harness reminder did again. Branch `ci/no-assistant-attribution` (23 September 2026) added the switch to `.claude/settings.json` and never merged | The branch, one commit | Commit the project setting, under the name the current Claude Code release uses for it | S | None. No changeset: nothing a running instance does |

Acceptance criteria:

| Row | Given | When | Then |
|---|---|---|---|
| G1 | A new instance nobody has claimed | Somebody opens `/setup` without the code | They cannot create the first account |
| G1 | The same instance | The operator enters the code `up` printed | The wizard creates the owner, and the code no longer works |
| G2 | Priya opened two objectives and a task today | She opens the command palette | The three are listed first, newest first, and only objects she may still read appear |
| G3 | A member connected an agent with an `mcp` API token | An administrator opens the agent connections screen and ends it with a reason | The token stops working, and the member's own page says why |
| G4 | A FlowyTeam source with KPI shares, and G4-Q answered "import" | A dry run of the importer | The report counts the shares it will write and names the view options and frequencies it cannot keep |

**G4-Q: import FlowyTeam's KPI shares? Recommended: yes, as `kpi_shares`, with the view option and frequency named in the report.** A member who could read or update a KPI in FlowyTeam keeps that access. Not importing leaves every shared KPI visible only to its owner after a migration.

**G5-Q: may the profiles' source links go into METHOD.md? Recommended: yes.** They add a link to two sources the method already names and change no rule.

## 6. Upgrades

| # | What | Change | Size |
|---|---|---|---|
| U1 | The upgrade notes for 0.9.0 | `docs/runbooks/upgrade.md`, "0.8 to 0.9": the two migrations (L3, L4) and that both are additive; any data change a row adds; the copilot's new reads and what they cost (design §6: about a thirtieth of Sonnet on Luna, a five-call run well under a cent); the chart note (H1); the setup code (G1), which a new install now needs before the wizard; and the new tables G2 and G3 add, if they land. Written last, once the other rows are known | S |

The release skill asks for this section before it tags, so it must exist before `/release`.

## 7. Checks before the release

Carried from 0.8.1 and still open, plus what 0.9.0 itself needs.

| What | Who | Note |
|---|---|---|
| F-04 retest on an image: a Viewer sees no Start drafting, and the menu names their role | Me | Never checked in a browser on an image |
| F-08: the Malay wording reviewed by a native speaker, including 0.8.1's and 0.9.0's new copilot strings | A Malay speaker | 0.8.1 added the step line, the panel's controls and the reasons; 0.9.0 adds the reading line, the edit cards and CP10's reasons |
| The copilot panel in Safari, Firefox, on a phone, and with a screen reader | Me, then Akmal for the screen reader | Never checked for 0.8.1 |
| A live copilot run on a 0.9.0 image, as Priya on a fresh Northwind year, the design's §1 questions | Me | The same run as L7, with the read loop on |
| An acceptance test of 0.9.0, as Obed ran for 0.8.0 | Obed, if Akmal agrees | Decided in UAT-Q |
| The Goals page's pending marks on a 1,000-row list: whether `usePendingOkrIds` costs a visible render delay | Me | Open since the pending-indicators review (its Q7). `pnpm perf:budgets` measures the server, not the browser. Measure on the large dataset; change it only if it is slow |

**UAT-Q: an acceptance test before 0.9.0 ships? Recommended: yes.** This release changes what the copilot can read and what it can propose to change. Obed's test of 0.8.0 found eleven things no suite had.

## 8. Outside the release

Not code in this repository, so no row and no commit here. Listed so nothing found during 0.8.1 is lost.

| What | Who | Note |
|---|---|---|
| Push `okrgoal-infra` | Done | Pushed by 12 November 2026; nothing is ahead of origin |
| Move production mail off the temporary sender | Akmal, then me | Since 10 November 2026 production sends as `hello@okrinstitute.org` through SES in us-east-1, in an AWS account shared with other products. Move to okrgoal.com's own SES in eu-west-1 once its production access is granted, matching the legal page's "delivered from Ireland" |
| OKRGoal's error tracker in the docs | Akmal's call | `docs/design/error-reporting.md` and its runbook still say OKRGoal uses Sentry EU; it has used Bugsink since 10 November 2026. Also E4's check by hand against GlitchTip, never done. Update both only if you want OKRGoal's choice in the public docs |
| Check that production's nightly erase job succeeds | Me | It failed twice on 0.7.0's chart; 0.8.0's chart carries the fix but had not run on it by 12 November. Its first run on the fixed chart was 03:30 UTC that day |
| Move okrgoal's values from `database.adminUrl` to `database.existingSecretAdminKey` | Me | Both deploys print the chart's warning about it. The chart already supports the key |
| Put the planless workspaces on production on Free | Akmal | `/operator/default-plan` on app.okrgoal.com. Carried from 0.8.1 |
| Check that a session on production shows your own address, not a Cloudflare one | Akmal | Confirms `trustedProxyHops: 2`. Carried from 0.8.1 |
| Production's AI models | Akmal | If `ai.deployment.tierModels` is set there, it did not move to Luna with 0.8.1 |
| Lock the origin to Cloudflare with a secret header, then read `cf-connecting-ip` | Me, then Akmal | Carried from 0.8.1 |
| A clean Compose install from the quickstart, and a Compose upgrade from 0.8.1 with data in it | Me | The after-release checks the release skill leaves undone |
| okrgoal.com: the 12 rows of `docs/site-changes-2026-11-03.md` marked "Next release" | Done | Each checked against v0.8.1 and applied on 12 November 2026 (okr-goal `95fdd6d`), live the same minute |
| Remove the 0.8.1 build worktree and branch (`open-okr-release-0.8.1`, `release-0.8.1`) | Me | Merged as #212 |
| Remove the other stale local worktrees and branches | Me | Worktrees `open-okr-copilot-combined`, `open-okr-input-pack`, `open-okr-plan-0.8.1` and `open-okr-resend-invite`, all merged or superseded. Branches: 29 `worktree-agent-*` from the September completeness review, whose rows reached `main` by pull request under other commits; the release, phase and October fix branches already merged; and `docs/site-copy-2026-11-03`, whose brief now lives in the okr-goal repository. Local only, and each checked against `main` before it goes. G5's and G7's branches stay until their rows land |
| Delete two stale remote branches | Akmal's call | `origin/obed` (29 September, superseded) and `origin/backup/pre-signoff-2026-08-18`. Deleting a branch on GitHub cannot be undone from here |
| Put the main checkout back on `main` | Me, when no session is using it | `/Users/akmal/Documents/Work/github/open-okr` still sits on `docs/plan-0.8.0-your-account`, merged long ago |

## 9. Left out on purpose

| What | Why |
|---|---|
| Any write the copilot makes without the member applying it | D4, and CLAUDE.md: raising an agent's autonomy is Akmal's decision. Every edit in L4 is a proposal |
| More edits than L4's five, such as reassigning an owner | D3: it changes somebody else's work, so it stays a person's act |
| A full `/copilot` page | W3-Q1, 0.8.1: the side panel with Expand, and a page later if people ask |
| Renaming a conversation | W3-Q4, 0.8.1: delete now, rename later |
| Q-4: only the Owner, an Admin and the named facilitator may change the input pack | Akmal, 11 November 2026: "for later". It changes access, so it needs a design first. Say if 0.9.0 is later enough |
| `DATABASE_DIRECT_URL` and the vector index | Decided in 0.8.0 (H7, H5-Q4): built when a deployment needs them. None does yet |
| A mail driver for the SES API | Production sends through SES over SMTP, which works. A driver would add the AWS SDK, a new runtime dependency that needs asking |
| SAML requests signed by the product | `saml.md`: built when a customer's identity provider requires it, together with the key handling. Storing a key nothing uses is worse than none |
| `PhoneInput` | `guided-inputs.md` §4.12: specified, and built when a screen needs a phone number. None does |
| Extending a support session, and break-glass access | `support-access.md`: not built by design. A second request is what the owner should see |
| Incident history and a feed on the status page | `status-and-capacity.md` §5: the feed needs the history, and neither is asked for |
| One identity provider for a group of workspaces, and OKRs across a group | `hosting-test-matrix.md` records it as future work; group OKRs are in REQUIREMENTS.md §9's deferred list |
| Whether `verify-backup` runs on a schedule, and runs the audit chain verifier | `backup-verification.md` §7: the operator's choice, not the product's |
| Anything in REQUIREMENTS.md §9's deferred list | Pulled into scope only by Akmal |

## 10. Decisions

| # | Question | Recommended | Akmal's answer |
|---|---|---|---|
| 0.9-Q1 | Is the copilot reading live data (L1 to L6, L7b) the centre of 0.9.0, with CP5, CP10, CP11 and CP12? | Yes. The design is approved, and its D9 put these rows here | Open |
| A4-Q | How does the first word come sooner? | The proposal becomes a tool inside L2's loop, after a short addition to the design and "design approved" | Open |
| CP11-Q | What does "Ask about this page" send the copilot? | The entity's id only; the copilot reads it as the member | Open |
| FB-Q | Thumbs up and down on answers in 0.9.0? | Yes, after L5, design first (a new table) | Open |
| W2-Q | Are the copilot's steps stored? (open since 0.8.1) | No new column: L3 records the reads, and the line under an answer is rebuilt from them | Open |
| C2-Q | Fix `okr mcp`'s URL check, or dismiss the alerts as they are? | Fix, then dismiss | Open |
| P1-Q | Upgrade Better Auth in 0.9.0? | Yes, as its own change with the auth suites | Open |
| UAT-Q | An acceptance test before 0.9.0 ships? | Yes, by Obed if he is free | Open |
| Q-4 | Does the input-pack access rule come into 0.9.0? | No, still later, unless you say otherwise. It needs a design | Open |
| G4-Q | Import FlowyTeam's KPI shares as `kpi_shares`? | Yes, with the view option and frequency named in the import report | Open |
| G5-Q | May the profiles' source links go into METHOD.md? | Yes. They add links and change no rule | Open |

G1, G2 and G3 need no question here. Each starts with its design, and its code waits for "design approved" on that design.

## 11. Suggested order

1. **T2, T1 and T3**, so the release's own CI runs are honest and nobody reruns past a real failure. Then **C1, C2, C3**.
2. **L4**, the edits and migration 2 (D9: edits first).
3. **L1, L2, L3**: the port, the loop, then migration 1. **CP5** once L3 records the reads.
4. **A4**, once its design addition is approved, because it changes the loop L2 built.
5. **L5, L6**, then **L7b**: tuning comes last, against the loop as it will ship.
6. **CP10, CP11, CP12**, then **FB1** if FB-Q says so.
7. **D1, H1, P1**: independent, at any point.
8. **G7, G6**, small and independent; **G5** and **G4** once G5-Q and G4-Q are answered.
9. The designs for **G1**, **G3** and **G2**, written early so their approval does not hold the release; the code once each is approved. G1 first, because every new install meets it.
10. **U1**, written last.
11. The checks in section 7, then `/release`.

If 0.9.0 grows too large, G2 and G3 are the rows to move to the next release: neither fixes something broken, and the copilot is this release's centre.

## 12. Build log

Statuses: **to do**; **design written**, waiting for "design approved"; **done**, committed and the local tier green; **merged**; **yours**, a decision or action only Akmal can take.

| Row | Status | Note |
|---|---|---|
| L4 | to do | Design approved 11 November 2026 |
| L1 | to do | |
| L2 | to do | |
| L3 | to do | |
| L5 | to do | |
| L6 | to do | |
| L7b | to do | |
| CP5 | to do | |
| CP10 | to do | |
| CP11 | to do | |
| CP12 | to do | |
| A4 | yours | A4-Q, then a design addition |
| FB1 | yours | FB-Q, then a design |
| T1 | to do | |
| T2 | to do | |
| T3 | to do | |
| D1 | to do | |
| H1 | to do | |
| C1 | to do | |
| C2 | yours | C2-Q |
| C3 | to do | |
| P1 | yours | P1-Q |
| G1 | to do | Design first |
| G2 | to do | Design first |
| G3 | to do | Design first |
| G4 | yours | G4-Q |
| G5 | yours | G5-Q |
| G6 | to do | |
| G7 | to do | |
| U1 | to do | Last |
| Decisions | yours | Section 10 |
