# Release 0.10.0 checks (card R1)

Branch `feat/0.10.0-build`. Checks follow [release plan 0.10.0](../plans/release-0.10.0.md) section 5, one section per row. Screenshots and raw output are kept in the scratchpad of the checking session and are not part of the repository.

## Summary

| Plan row | Result |
|---|---|
| KPI access | Importer suites pass (19 files, 202 tests). AC map: 36 covered, 2 partly, 1 not. |
| Settings and upgrade | AC-12 passed against commit `f8691b82` (tag `v0.9.0` does not exist). |
| Catalogue and formats | `pnpm i18n:check --release` passes, formats suite passes (6 files, 93 tests). |
| Visual and offline | 58 routes at 2 widths in `ar`, all `rtl`, no page overflow. Print and PDF samples checked offline for `ar` and `zh-Hans`. Air-gap check passes. Image size not measured. |
| Translation and delivery | Two members with different locales checked with the provider off. Mail, chat and exports only partly verified. |
| Local tier (step 7) | `pnpm test:changed`: 10,074 passed, 4 failed (3 fixed, 1 machine-only). `pnpm check:fast`: 14 of 14 gates pass. Build passes. End-to-end specs: 5 required plus 15 chosen, all pass after 4 updated expectations. |

## KPI access

Source: [KPI design](../design/kpi-access.md) section 12.

Importer suites (`pnpm --filter @openokr/importer test`, local test MySQL, no production FlowyTeam database touched): 19 files, 202 tests, all passed.

Acceptance criteria to tests (read-only mapping, no tests run for it):

| Design | Covered | Partly covered | Not covered |
|---|---|---|---|
| kpi-access AC-1 to AC-39 | 36 | AC-13 (MCP `search` as guest and title search not asserted), AC-14 (no KPI-specific copilot or `fetch` guest test) | AC-39 (no KPI-specific provider-off test; generic `apps/web/test/ai-off-leg.test.ts` only) |

The full table with file and line per criterion was produced during the check. Covered criteria cite `packages/core/test/kpi-*.test.ts`, `packages/db/test/data-change.test.ts`, `packages/importer/test/flowyteam-kpi-shares.test.ts` and `e2e/s20d-kpi-guest-access.spec.ts`, `e2e/s21b-kpi-sharing.spec.ts`.

## Settings and upgrade (languages AC-12)

Verdict: passed. No data loss and no unhandled error on the old build (no error lines in either server log).

The newest 0.9 build was not available as a tag: `v0.9.0` does not exist and none was created. Commit `f8691b82` (merge of PR #219) was used as the 0.9.x build instead. The new build was `06b40b1c` on this branch. Both were built with `next build` (standalone) in separate git worktrees and ran against one database at the same time.

| Step | Observed |
|---|---|
| Old build, workspace language `ms`, member language `ms` then null | 200, values stored |
| Old build before migration, save `ar` | 422 `invalid_input`, row unchanged |
| Migrate with this branch | migrations 0172 and 0173 applied, constraint lists ten codes |
| New build saves `ar` | 200 |
| Old build reads the `ar` member | 200, `"language":"ar"`, no error |
| Old build renders `/`, `/goals`, `/account` | 200, `<html lang="ms">` (workspace language) |
| Old build mail locale for `ar` | falls back to `en`; workspace locale `ms` (function level, nothing sent) |
| Old build saves `ar` again | 422, row stays `ar` |
| Old build saves another field while the row holds `ar` | 200, language stays `ar` |

Mail was checked at function level only (no mail sink in that setup).

## Catalogue and formats

| Check | Result |
|---|---|
| `pnpm i18n:check --release` | passed across 10 UI and 10 server catalogues |
| Formats suite (`packages/formats`) | 6 files, 93 tests passed |
| Languages section 17 acceptance criteria | 20 covered, 9 partly, 4 not covered |

Languages AC coverage, by id:

| Status | Ids |
|---|---|
| Covered | AC-2, 3, 4, 7, 8, 9, 10, 11, 16, 17, 19, 20, 21, 22, 26, 27, 29, 30, 31, 32 |
| Partly covered | AC-1 (new workspaces starting in the instance language not asserted), AC-5 (cookie attributes), AC-6 (no Noto-not-downloaded check on `/sign-in`), AC-13 (picker UI), AC-15 (html lang and dir on app screens, icon mirroring), AC-23 (no `de` member case), AC-25 (no live Indonesian reply check), AC-28 (joined Arabic letters and footer not asserted), AC-33 (no `de` reset mail case) |
| Not covered | AC-12 (checked by hand above, no automated test), AC-14 (CI gate, no test), AC-18 (`dir="auto"` fields, no test), AC-24 (AI off, `fr` coach labels) |

## Visual and offline

Arabic review: dev server, `ar`, viewports 1440 and 390, Playwright Chromium. Member screens as a member, `/admin/*` as an owner. Screenshots are in the scratchpad under `shots-ar/<route>-<width>.png`.

- 58 routes at 2 widths load. All are `dir=rtl lang=ar`. No page overflows horizontally.
- Skipped (need a token, a setup state, or are dev-only): `/join/[token]`, `/join`, `/reset-password`, `/backup-code`, `/dev/components`, `/dev/rich-text`, `/sign-up`, `/setup`, `/setup/account`, `/key-results/[id]`, `/admin/plan`, `/operator`, `/operator/[workspaceId]`, `/operator/instance`, `/operator/default-plan`, `/workspaces/new`.
- No seed row, not reachable: `/documents/[id]`, `/initiatives/[id]`, `/tasks/[id]`.
- Redirects: `/welcome` to `/`, `/goals/studio` to `/goals`, `/admin` to `/admin/general`.
- The pass was by DOM checks (direction, scroll width, elements past the viewport, Latin-only text leaves) plus screenshots. The defects it found are listed below. The screenshots were taken before the fixes.

Offline print and PDF sample, network blocked except localhost (no external request was attempted):

| Locale | Output | Result |
|---|---|---|
| `ar` | Minutes print view (HTML, browser print to PDF) | Font Noto Sans Arabic from the bundled files. `dir=rtl`. Letters joined, lines run right to left, labels Arabic. |
| `zh-Hans` | Minutes PDF (`@react-pdf/renderer`) | `NotoSansSC-Regular` embedded as a subset. All Chinese glyphs extract. Headings, labels and footer Chinese. |

Remaining English in both samples is data (session title, goal titles) and method text (process-health statements), see the deferred list.

| Check | Result |
|---|---|
| `pnpm check:air-gap` | passed, 8 checks, same 8 in `docs/runbooks/air-gap.md` |
| Image size (`docker image inspect`) | not measured: the container runtime was not running and was not started |

## Translation and delivery

Dev server, provider off, two members of one workspace: one `ar`, one `zh-Hans`. No `de` member existed, so these two stand in.

| Surface | Result |
|---|---|
| Page shell | Pass. Each member gets their own locale and direction at the same URL. |
| Copilot affordance | Pass in each locale. The button stays visible with AI off (see deferred list). |
| `POST /api/copilot` with AI off | Pass. Streams `unavailable` with code `ai_off`, no error. The `reason` string in the event is English, the panel words it from the catalogue. |
| Agents (Coach, Champion) | Partial. Rows exist with AI off. Method headlines are English (deferred list). |
| Notifications inbox | Chrome translated. Activity summaries were English before fix D6. |
| Account mail | Not conclusive. The requests came from a browser sending `en`, so English was expected. Follow-up requests with `ar` and `zh-Hans` hit the rate limit. |
| Notification mail, chat | Not verified. The scheduler was off, so no relay ran and nothing was delivered. No chat provider was configured and inbound payloads need a signature. |
| Exports | Scorecard CSV headers were machine names (D7, fixed). Search export not present. Account export and workspace archive need the background worker, not run. |
| Minutes PDF | Pass for both members (see above). |
| Provider-off path | No HTTP 500 in the server log. One React hydration warning was seen during the screenshot run and was not traced to a locale. |

Live per-locale `pnpm ai:evaluate`: not run, no cost cap was granted.

## Defects found and fixed

| Id | Defect | Commit |
|---|---|---|
| D1 | Hard-coded English "Command" in `Kbd` | `36e111dd`, `109e2f4b` |
| D2 | Hard-coded English nudge volume labels | `ba962172` |
| D3 | Copilot button visible with AI off | No change. By design, see deferred list. |
| D4 | Review inbox words built in English on the server | `bfa03714` |
| D5 (rule text) | Quality rule titles, conditions and prompts bypassed the catalogue | `160753f0` |
| D6 | Activity summaries in English | `f5b2ae98` |
| D7 | Scorecard CSV headers were machine names | `4e6d0f3b` |
| D8 | Raw codes shown as badge text | `2f67bfbf` |
| D9 | Inbox rows and actions clipped at phone width | `366f7bc8` |
| D10 | Scorecard table clipped at phone width | `ac43039b` |
| D11 | Elements past the viewport at phone width | Not traced. Canvas and charts are expected to pan. |
| Catalogue | Keys added by the fixes translated for all locales | `e90e8123` |
| Catalogue speed | Translation batches run in parallel | `755a0069` |

Fixes made while running the local tier:

| Commit | Change |
|---|---|
| `7c7cb9b7` | Plural-form key `reviewInbox.word.blockerType.one` in the `en`, `ms`, `id` and `zh-Hans` server catalogues. The blocker type `other` ends in `.other`, which the plural check reads as a plural form. |
| `422be840` | Updated expectations: query budgets in `packages/core/src/perf/query-budget.ts`, `review.inbox` 12 to 17 and `notifications.list` 3 to 7 statements. Both actions now resolve the reader's locale on each call (D4, D6). The cost is constant per call and the N+1 check is unchanged. A cheaper locale lookup would lower the budget again. |
| `e2ae21c4` | Import order in `packages/ui/test/components.test.tsx` and two unused type exports in `packages/core/src/activities/renderers.ts`. |

## Known issues deferred to 0.10.1 (owner decision 2026-11-22)

| Id | Issue |
|---|---|
| D5b | Method phases, phase outputs, gate titles, agenda stages, minutes statements and the fires and recipient text on the admin nudges rule cards stay English. This extends A-7 beyond rule titles, conditions and prompts. |
| D8 | Run-log messages stored as text stay as stored. |
| D3 | The copilot stays visible with AI off by design. `docs/design/ai-off-leg.md` (disabled state, panel says AI off) and `e2e/ai-off.spec.ts` define it. The owner confirmed. |

## Not verified

| Item | Reason |
|---|---|
| Live per-locale `pnpm ai:evaluate` | No cost cap granted. |
| Container image size | Container runtime not running. |
| Mail delivery in a non-English locale, notification mail, chat | No relay or chat provider ran, and the account mail test hit the rate limit. |
| Exports (account export, workspace archive, search export) | Need the background worker, or the control was absent. |
| Test failure on a machine-only case | `packages/db/test/roles.test.ts`, "applies a changed password to a role that already exists" fails on this machine (ruling R2). |

## Local tier results

| Command | Result |
|---|---|
| `pnpm test:changed` | 10,074 passed, 11 skipped, 4 failed: the machine-only test above, the mail word table test and the two query budget tests (the last three fixed in `7c7cb9b7` and `422be840`, rerun and passed) |
| `pnpm check:fast` | 14 of 14 gates passed after `e2ae21c4` |
| `pnpm build` | passed |
| End-to-end specs | see the next section |

## End-to-end specs

Run after `pnpm build` with `pnpm test:e2e` (ports 3210 and 3211 free before the run). The `claim` project runs first.

Required: `e2e/s35i-locale-smoke.spec.ts`, `e2e/s35h-visitor-language.spec.ts`, `e2e/s43-accessibility.spec.ts`, `e2e/s43b-accessibility-keyboard.spec.ts`, `e2e/ai-off.spec.ts`.

Chosen because they assert text or test ids the series changed (grep of `e2e/` for Acknowledge, Command, scorecard, inbox, nudges, activity, `/method/`, `/admin/agents`, `/admin/channels`, `/admin/rhythm`, `/kpis/`, and the D8 badge words): `e2e/s03-inbox.spec.ts`, `e2e/s14d-rule-previews.spec.ts`, `e2e/s24e-cycle-rules.spec.ts`, `e2e/s32-search.spec.ts`, `e2e/s34-onboarding.spec.ts`, `e2e/s36d-nudge-rules.spec.ts`, `e2e/s36-channels.spec.ts`, `e2e/s36c-rhythm.spec.ts`, `e2e/s36m-agent-runs.spec.ts`, `e2e/s36q-agent-instructions.spec.ts`, `e2e/s14e-dependency-delivered.spec.ts`, `e2e/s13d-okr-drawer.spec.ts`, `e2e/s42-route-coverage.spec.ts`, `e2e/s33-people.spec.ts`, `e2e/s21b-kpi-sharing.spec.ts`, plus the `claim` spec `e2e/registration-to-dashboard.spec.ts`.

Updated expectations (commit `b6ed16e9`, expected values only):

| Spec | Change | Reason |
|---|---|---|
| `e2e/registration-to-dashboard.spec.ts` | "propose" to "Propose", "sandbox" to "Sandbox" (5 selectors) | D8 names the stored write policy codes |
| `e2e/ai-off.spec.ts` | "completed" to "Completed" (2) | D8, run status |
| `e2e/s36m-agent-runs.spec.ts` | "cancelled" to "Cancelled" (2) | D8, run status |
| `e2e/s33-people.spec.ts` | `language-ms` and `language-en` buttons to the `member-language` select (2) | The control became a select in an earlier card. The spec was stale, not caused by this series. |

Other observations:

- `e2e/s43-accessibility.spec.ts` failed once on `/session/[id]` with a colour contrast ratio of 4.49 against 4.5 on a `.text-warn` element. It passed on the rerun with no change to the page colours. Not traced, treat as flaky until it recurs.
- The final runs: 276 passed in the first full set run (3 failures, all dealt with above), then 174 passed (the three files rerun together, `e2e/s33-people.spec.ts` failing on the stale selector), then 50 passed (`e2e/s33-people.spec.ts` after the fix).
