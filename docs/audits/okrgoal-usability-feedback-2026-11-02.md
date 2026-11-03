# okrgoal.com usability and UX feedback: fix list

Source: `okrgoal.com usability & UX feedback.docx` (Downloads, 2 November 2026). The reviewer is not named in the file. It is a walkthrough of demo.okrgoal.com with 51 screenshots, each annotated with a suggestion.

## How this was checked

| Pass | What it did | Limits |
|---|---|---|
| Code | Every item checked against `agung` at `761b450b`: the message catalogue, the component, `git log` of the screen | None for copy. Layout claims need the browser |
| Browser | Local instance on the lean dev server, 17 screens at 1280 and 375, measured with `getComputedStyle` and `getBoundingClientRect`. Screenshots in `.audit-screens/okrgoal-usability/` (gitignored) | Thin local data (2 objectives), not the Northwind year. `/welcome` redirects on a set-up workspace, so the wizard is code-only. Annual strategy (phase 0) needs an annual cycle and was not opened |
| ui-audit | The repository's `ui-audit` lenses on the measured screens, with its three classes `VIOLATION`, `RISK`, `QUESTION` | Light theme, comfortable density, loaded state only. No screen reader, no dark theme |
| OKR practice | `okr-practitioner` on every item that changes vocabulary, defaults, confidence, onboarding or the tour, against METHOD.md, REQUIREMENTS.md and UIUX-PLAN.md | Recommendations, not decisions |

**The demo is behind the branch.** The current navigation already differs from the screenshots: the sidebar is Home, Updates, Goals, Work, Spaces, Cycle. Inbox and Review are now one "Updates" area with "To do" and "Activity" tabs. OKRs, KPIs and Map sit under "Goals". Cycle has Cycle, Sessions and Scorecard tabs, a phase rail and a quality panel. Read every "Open" below as "still true in the new layout", which was checked.

## Legend

| Status | Meaning |
|---|---|
| Fixed | The current code and screen already do what the reviewer asks |
| Partial | Some of it is done. "Still to fix" says what is left |
| Open | Still as the screenshot shows, in the new layout |
| Decide | Changes a product term, a default, a practice setting or an approved design. Goes to section 10 |

`(browser)` marks a status confirmed on screen. Paths are relative to the repository root. `en.json` is `packages/ui/src/i18n/messages/en.json`. Every copy change goes to `en.json` and `id.json` together.

## Summary

| Area | Items | Fixed | Partial | Open |
|---|---|---|---|---|
| Welcome wizard | 5 | 0 | 1 | 4 |
| Overview (Work Map) and tour | 6 | 0 | 1 | 5 |
| Updates (Inbox, Review), Search | 4 | 0 | 1 | 3 |
| Cycle | 7 | 0 | 2 | 5 |
| Scorecard | 1 | 0 | 1 | 0 |
| OKRs (Goals) | 4 | 0 | 4 | 0 |
| KPIs | 5 | 0 | 3 | 2 |
| Topbar, Initiatives, Board, Teams | 6 | 0 | 2 | 4 |
| **Reviewer items** | **38** | **0** | **15** | **23** |
| Found by this audit, not in the review | 5 | | | 5 |

ui-audit classes across the defects and new findings: 9 `VIOLATION`, 5 `RISK`, and 8 `QUESTION` (section 10).

## 1. Real defects (fix first)

Bugs, not wording. None needs an owner decision.

| # | Class | Defect | Evidence | Fix |
|---|---|---|---|---|
| D1 | RISK | Unread counts disagree. The demo showed 257 against "50 Unread". Locally the Updates badge reads 21 and Activity reads "18 Unread" (browser). The header counts only the rows loaded, capped at 50 | `apps/web/app/inbox/page.tsx:148`, `INBOX_PAGE_SIZE` = 50 in `packages/core/src/actions/notifications.ts:115` | Count unread on the server. Say in the badge tooltip what it counts, because it now covers To do and Activity |
| D2 | VIOLATION, UIUX-PLAN §8 | Hard-coded English skips the catalogue: the "Company" scope tab, the To do counters "Overdue", "Today", "This week" and their group labels | `apps/web/app/work-map-screen.tsx:170`, `apps/web/app/review/page.tsx:51-53`, `:109-111` | Catalogue keys in `en` and `id` |
| D3 | VIOLATION, UIUX-PLAN §8 ("taxonomy labels all live in the catalogues") | Raw stored values reach the screen lowercase and untranslated. Measured on screen: "to come", "no trend yet", "none open", "week streak" (phase 6), "open", "portfolio average", "scored", "not scored" (phase 7), "open", "add driver" (KPI trees), "manager" (Spaces), "via in the app" (To do). Code also prints raw KPI frequency, state and indicator type | `cycle/running-cadence.tsx:177`, `kpis/page.tsx:229`, `:249`, `kpis/grid.tsx:428`, `kpis/trees/tree-rows.tsx:195` | Map every value to a catalogue key in sentence case. Covers K1, K2, K4, K5 and the C6 labels |
| D4 | VIOLATION, METHOD.md §12.1 confidence display | Running cadence prints confidence as the stored decimal and ignores "Confidence shown as" | `cycle/running-cadence.tsx:227` | `formatConfidence`, as the Work Map uses |
| D5 | RISK | Annual strategy note is a fixed `w-96` (384px) beside a `w-72` input, wider than a 375px phone | `cycle/annual-frame.tsx:203`, `:213` | Stack full width below `md`. Not opened in the browser (no annual cycle locally) |
| D6 | VIOLATION, WCAG 1.4.10 reflow | To do at 375: the header title wraps one word per line, and item titles are squeezed to 18px and 49px wide columns with text clipped (browser: "Run the weekly session" 52px of text in 18px) | `review/page.tsx:108`, right block is `flex-none` with no wrap | Stack the counters and the item action under the text below `sm` |
| D7 | VIOLATION, UIUX-PLAN §7 (visible focus must mean focus) | The tour outline is drawn in the brand colour on the Work Map container and stays while the card is open (browser: `work-map: solid rgb(14,116,144)`), which reads as focus | `work-map.tsx:355`, `globals.css:49-55` | Its own highlight style, distinct from the focus ring |
| D8 | RISK | The trigger page title is the raw rule key `quality.process_health_low` | `apps/web/app/method/[id]/page.tsx:188` | Title from the existing `TRIGGER_NAME_KEYS`, key as a secondary line |
| D9 | RISK | The Board cannot delete a task. `tasks.delete` exists and nothing in the app calls it | `packages/core/src/actions/registry.ts:758`, `apps/web/app/board/` | A delete action in the card menu, through the existing action |

## 2. Found by this audit, not in the review

| # | Class | Finding | Evidence | Fix |
|---|---|---|---|---|
| N1 | VIOLATION, CLAUDE.md hard rule (thresholds live in `packages/method`) | The Work Map's on-track colour hard-codes 70 and 40. No METHOD.md §11 row exists for an on-track share | `work-map-header.tsx:236-238` | Add the band to METHOD.md §11 or drop the colour. METHOD.md change is the owner's (section 10, Q7) |
| N2 | VIOLATION, ui-audit proportions (input font on mobile) | Goals at 375: inline fields render at 11 to 14.5px (browser: objective title 14.5px, kind 11px, owner 12px, key result title 13px). Safari on iOS zooms on focus below 16px | `apps/web/app/goals/okr-cells.tsx`, `okr-table.tsx` | 16px for editable fields below 768px |
| N3 | VIOLATION, WCAG 2.2 SC 2.5.8 | Targets under 24px: "See the rule" 69x16 and "Snooze for a week" 120x22 (To do), "open" 28x16 and "add driver" 58x16 (KPI trees), Goals inline selects 74x22 and value fields 24x22, "Open" 29x16 (phase 4) | Browser measurement | Pad links and inline controls to 24px height |
| N4 | VIOLATION, WCAG 1.4.10 reflow | Draft OKRs: the objective card header squeezes its title and meta to 22px at 1280 and 37px at 375, text clipped (browser) | `cycle/drafting.tsx` header row, beside "Suggest a parent" and "Open" | Let the actions wrap under the title |
| N5 | RISK | Activity: items under "CHECK-IN" do not name their objective ("1 day after publication"), while items under "GOAL" do (browser) | `apps/web/app/inbox/page.tsx:221` | Group check-in items under their objective, or name it in the row |

## 3. Welcome wizard (`/welcome`)

File: `apps/web/app/welcome/wizard.tsx`, keys `welcome.*`. Code-only: the local workspace is set up, so the route redirects.

| ID | Reviewer asks | Status | Still to fix |
|---|---|---|---|
| W1 | Step 1: subtitle "5 quick questions. Each has a default, so you can skip any of them."; "Step 1 of 5" with a progress bar; label "Workspace name"; time zone dropdown with "Local time now"; a not-detected message that disables Continue; "Skip for now" | Partial | Time zone is already a browser-seeded dropdown (`wizard.tsx:183`). Counter is text "1 / 5" (`:167`). Label "What is this workspace called?". No local time line. Skip reads "Skip". **Do not disable Continue**: UIUX-PLAN S-34 says every step is skippable and no screen blocks on an unanswered setting. Show the message, keep Continue |
| W2 | Step 2: "Check-in frequency"; "Weekly (recommended)", "Every 2 weeks", "Monthly"; drop "the practice", "the method's own default", "the Champion"; 44px buttons; Back from step 2 | Open | `welcome.rhythm.*` unchanged. Buttons `px-2.5 py-1 text-xs` (`:207`). No Back. "The Champion" here means the agent, which a new user reads as a person (practitioner, see Q1) |
| W3 | Step 3: "Invite a teammate"; placeholder "name@company.com"; drop "diary" and "invitations card"; primary "Invite and continue" | Open | `welcome.people.*` unchanged |
| W4 | Step 4: "Start from a template" without question mark; radio cards; "check-in" instead of "session"; drop "quality checks" and "nothing here is a lesser path"; primary "Use template" | Open | `aria-pressed` buttons (`:240`), not a radio group. Copy unchanged |
| W5 | Step 5: "Explore with sample data?"; plain description; "No one is notified. You can remove the sample data later."; drop "phase 6", "recovery objective", "blockers at different ages"; "Add sample data" and "Skip and finish" | Open | Steps 4 and 5 both end in "Start empty". Confirm a removal path exists before promising "remove later" |

## 4. Overview: Work Map and first-visit tour

Files: `apps/web/app/work-map-header.tsx`, `work-map-screen.tsx`, `work-map.tsx`, `goal-nodes.ts`, `first-visit-tour.tsx`. The Work Map now sits on Home under "My week".

| ID | Reviewer asks | Status | Still to fix |
|---|---|---|---|
| O1 | "On track 50%" orange with no explanation; "Outdated 0 goals"; "Alignment 100%" needs a tooltip | Open (browser) | No tooltip on any stat. Still "0 goals". "Alignment 0 %" shows in red with no explanation. The colour band is N1 |
| O2 | The root space shows as a team tab; nine tabs overflow; "Company" tab, divider, "Team: All" dropdown | Open (browser) | Tabs: "Company", then the root space "Agung Sidik's workspace" (`work-map-screen.tsx:167-177`) |
| O3 | Periods out of order (the annual cycle between Q2 and Q1); use a dropdown | Open | Sort `desc(cycles.startsOn)` (`packages/core/src/actions/cycles.ts:354`). Annual and Q1 share a start date. Only one cycle locally, so not seen |
| O4 | Indent-only nesting; "High 0.8"; "99.95 of 100 %"; "101 of 95 $"; "Champion" header; relative dates; narrower columns | Partial | Fixed: reduce KRs read "9 now, target 2 days" (browser). Open: indent only (`work-map.tsx:270`), header "CHAMPION" (browser), "50 of 100 %" unit spacing (browser, Home), relative date only within 7 days (`date-format.ts:57`). Confidence: keep the number (Q5) |
| O4a | Maintain KR shows target 100, not the 99.9 floor | Open | Check the seed. If it stores 100, METHOD.md §2.10 maintain is modelled wrongly: a data fix, not display |
| T1 | Tour highlight looks like focus; card stays at the top; dim and anchor; scroll into view; hide Back on step 1 | Open (browser) | Back shows disabled on 1/5. Highlight is D7. No `scrollIntoView`. The inline card is a UIUX-PLAN S-34 decision ("rather than an overlay, so it traps nothing"): keep it (Q4) |

## 5. Updates (Inbox and Review), Search

| ID | Reviewer asks | Status | Still to fix |
|---|---|---|---|
| I1 | Counts disagree; a count per pill; name the objective | Partial (browser) | GOAL and SESSION groups name their subject. Pills have no counts. Count is D1, check-in rows are N5 |
| R1 | Overdue, Today, This week jump to their sections; fix mobile | Open (browser) | Counters are plain text (`review/page.tsx:242`), sections have no `id`. Mobile is D6 |
| R2 | "See the rule" opens a raw key as title | Open | D8 |
| S1 | "Goals, key results..." should say "Objectives" | Open | `search.allSearchable`. Recommended: Objectives (Q2) |

## 6. Cycle (`/cycle`)

The Cycle screen is now three columns: phase rail, the phase, and a quality panel with facilitator guidance (browser).

| ID | Phase | Reviewer asks | Status | Still to fix |
|---|---|---|---|---|
| C1 | Switcher | "Open" as a button labelled "View"; narrower select | Partial | Already a `Button` (`cycle-switcher.tsx:83`), label "Open", select `w-56` |
| C2 | 0, Annual strategy | Widen or stack both inputs; fix mobile | Open | `w-72` beside `w-96` (`annual-frame.tsx:203`, `:213`). Mobile is D5. Not opened in the browser |
| C3 | 1, Prepare | Input stretches so Save aligns right | Partial | Input `flex-1` (`input-pack.tsx:145`). Save in the middle column, status chip in its own (`:155`). Rows were empty locally |
| C4 | 2, Diagnose | Editors in a tiny one-line box | Open | `RichTextField` compact has no min-height (`rich-text-field.tsx:70`). Give it about four lines |
| C5 | 4, Draft OKRs | Each objective collapsible | Open (browser) | No collapse in `drafting.tsx`. Header squeeze is N4. Reuse the Goals collapsible card |
| C6 | 6, Run the cadence | "Still needed" per team; sessions grouped by team with filters; KRs under objective; lowercase labels | Open (browser) | One `<li>` per server reason (`cycle/page.tsx:503`). Lowercase is D3. No grouping, no filters |
| C7 | 7, Review and learn | Gaps per team; summary and bands side by side; KRs grouped; team filter on Sessions | Open (browser) | Phase 4's gap list is now one item per line (browser), so the per-reason split works there. Phase 6's per-team reason is still one string. Cards stacked (`review-and-learn.tsx:148-261`). `sessions/page.tsx` reads only `?finished` |

## 7. Scorecard

| ID | Reviewer asks | Status | Still to fix |
|---|---|---|---|
| SC1 | "N added mid-cycle" as a grey pill beside the cycle name; "Close a cycle out" and "Points" side by side | Partial | Plain list item now (`scorecard/page.tsx:325`), not beside the name. Cards stacked. Keep the marker visible: METHOD.md §12.1 default is "Live, marked added mid-cycle" |

## 8. OKRs (Goals > OKRs)

Revamped on 2 November 2026 (`89443a42`, `96b2089a`).

| ID | Reviewer asks | Status | Still to fix |
|---|---|---|---|
| G1 | "12 goals" chip beside "Objectives: 12"; "+" unclear | Partial (browser) | Chip "2 goals, filtered" beside "Objectives: 2". "+" has the tooltip "Add cycle" (`goals/cycle-picker.tsx:153`) but no visible text. Recommended: "objectives" everywhere (Q2) |
| G2 | Filters: no "\|"; sentence case; "Any" to "All"; "Kind" to "Type"; "Space" to "Team"; what is "Closed" | Partial | Fixed: one Filter panel, so no divider; Level "All, Company, Department, Team" (`goals/page.tsx:1001-1014`); "Include closed". Open: "Any" on Health, Kind, Champion, Space (`common.any`). "Kind" is method vocabulary (METHOD.md §2.8): see Q8 |
| G3 | Objectives only by default; red OBJ-5; "Space" to "Team"; due date twice | Partial (browser) | Fixed: rule chips carry their sentence ("KR-2 Verifiable ... Read the rule"); due date shows once, "31 Dec 2026 in 59 days". Keep key results open by default (Q3) |
| G4 | Three date formats on one page | Partial (browser) | List is one format now ("31 Dec 2026", "Next check-in 9 Nov 2026"). Drawer history still ISO (`okr-drawer.tsx:968`, `:983`). Native date input follows the browser locale (`date-input.tsx:106`) |

## 9. KPIs, Topbar, Initiatives, Board, Teams

| ID | Reviewer asks | Status | Still to fix |
|---|---|---|---|
| K1 | Lowercase frequency and state; "All" and "Uncategorised" both selected | Partial | Category fixed (`kpis/page.tsx:46`, `:280`). Filters moved behind a Filter button (browser). Raw values are D3 |
| K2 | Row meta and "recovering" misaligned; footer hint misaligned | Partial (browser) | The hint moved into the toolbar ("Enter saves and moves down"). Meta still prints raw indicator type ("lagging", "leading") |
| K3 | Tree connector lines or chevrons; check the stack | Partial | Elbow connector (`trees/tree-rows.tsx:138`), no chevron. Stack not checked: the local tree is small |
| K4 | Recovery board: sentence case; progress bar placement | Open | D3. Bar between header and recovery box (`recovery/page.tsx:309`). Keep the taxonomy words (METHOD.md §6.4), change only the case |
| K5 | Trees: "watch", "open", "add driver" | Open (browser) | D3 |
| TB1 | "+ New" lacks context; collapsible sidebar | Partial (browser) | "+ New" is a menu now, so "+ New Objective" would be wrong. No sidebar collapse |
| IN1 | Team filter as a dropdown; "Any" to "All" | Open (browser) | Label "Space", pills "Every space" plus each space. "Any" on Status and Capacity |
| IN2 | Long unbroken title overflows; selects and "Watch this" in one row | Partial | Title `truncate` (`:425`), selects in a `flex-wrap` row. No initiative locally to test a 200-character title |
| IN3 | Styled file button | Open | Raw `<input type="file">` (`apps/web/lib/attachments.tsx:216`), shared by every Files card |
| B1 | Delete on a Board card | Open | D9 |
| TM1 | New team: one row; "Create team" | Open | Stacked (`spaces/page.tsx:127`). Button "Create the {termSpaceLower}". Mission is a textarea, so one row on desktop only |

## 10. Owner decisions

Recommendations are from the `okr-practitioner` review, with the sections it cited.

| # | Question | Recommendation | Why | Confidence |
|---|---|---|---|---|
| Q1 | "Champion" to "Owner", "Space" to "Team"? | **Rename Champion to Owner. Keep Space** | METHOD.md §0 names "Owner" as the common alternative, and REQUIREMENTS §3 already says "a goal with no owner". "Champion" also names the OKR Champion agent, so `welcome.rhythm.help` reads as a person. A space can be a company, department or team (§2.7, §12.1), and "Team" would clash with the Level filter's own "Team". Cost: METHOD §0 and §2.5 default, `term.champion.*`, mockups, specs. Open sub-question: do coaching messages follow the label (TECHNICAL-PLAN §4.14 keeps method words)? | Medium |
| Q2 | "Goals" or "Objectives"? | **"Objectives" everywhere a user reads it** | UIUX-PLAN S-13 (decision D5) already says "OKRs" and "+ New objective". METHOD §0 says the two words mean the same. Copy only | High |
| Q3 | Objectives only by default? | **Keep key results open.** Add "collapse all", remember each person's choice | METHOD §1 principle 1, "key results are the proof". UIUX-PLAN S-13 draws KRs under each card. Per-person memory is a UIUX addition | High |
| Q4 | Tour as an anchored popover? | **Keep the inline card.** Fix the highlight (D7), scroll the target into view, hide Back on step 1 | UIUX-PLAN S-34 chose a card so it traps nothing | Medium |
| Q5 | Confidence as "High" with no number? | **Keep the number**: "High, 8 in 10", with a tooltip of the bands | METHOD §3.2, "a drop matters more than a level": 0.9 to 0.7 stays High. §12.1 defaults to "x in 10". A screen showing "0.8" is a defect like D4 | High |
| Q6 | Welcome copy rewrite? | **Adopt the plain copy.** Keep "weekly is recommended" and "every step has a default" | METHOD §1 principle 5, §11 rhythms, REQUIREMENTS §6 "Zero setup". Confirm "remove sample data later" is true | High |
| Q7 | On-track colour band (N1) | Decide the band in METHOD.md §11, or drop the colour | A threshold outside `packages/method` breaks a hard rule. A tooltip would state a band that has no source | Not rated |
| Q8 | "Kind" to "Type" (G2)? | Copy is fine, but "kind" is method vocabulary (METHOD §2.8 committed/aspirational, §2.10 KR kinds). Rename in METHOD first or keep it | Moves method vocabulary | Not rated |

## 11. Suggested order of work

1. D1 to D9 and N2 to N5: no decision needed.
2. One catalogue change for case and translation: D3, plus "Any" to "All" (G2, IN1).
3. Decisions Q1, Q2, Q6, Q7. Then the copy they unlock: W1 to W5, S1, G1, O1.
4. Layout with a browser check on Northwind data: C2, C3, C4, K2, IN2, SC1, C7 cards.
5. Larger structure: O2 and O3 dropdowns, C5 collapsible drafts, C6 and C7 grouping and filters, TB1 collapsible sidebar.

## 12. Not verified

| What | Why | Next run |
|---|---|---|
| Welcome wizard on screen | `/welcome` redirects on a set-up workspace | A fresh workspace, or the staging stack |
| Annual strategy (C2, D5) | No annual cycle locally | Seed `pnpm db:seed` in a spare workspace |
| Period order (O3), long titles (IN2), KPI tree stack (K3), session grouping volume (C6) | Local data is two objectives and one cycle | Northwind year data |
| Dark theme, compact density, loading, empty, error, permission-denied states | Out of this pass's scope | `ui-audit` per screen |
| Screen reader output, contrast ratios | Not measured | The procedure in `docs/design/accessibility.md` |
| Cycle phase 6 load time | The first request timed out at 120 s, the second loaded in 2.7 s. Read as a dev-server first compile | Time it on a production build |

## 13. Progress

### Owner decisions, 3 November 2026

Q1 to Q6 follow the `okr-practitioner` recommendation in section 10: rename Champion to Owner and keep Space (Q1), "Objectives" where a user reads it (Q2), key results stay open with "collapse all" (Q3), keep the inline tour card (Q4), keep the confidence number (Q5), adopt the plain welcome copy (Q6). Q7 and Q8 stay open, because both change METHOD.md. None of the six is built yet. Q1 changes METHOD.md §0 and §2.5 and needs its own change.

### Fixed

| Item | What changed |
|---|---|
| D2 | The Work Map's "Company" scope tab and its two scope labels, the To do groups and counters, and the space role picker read the catalogue |
| D3 | Session kinds, KPI frequency, state, indicator and tier, and space roles are named through maps in `apps/web/lib/identifier-names.ts`, tested against the method's own lists. The phase 6 and 7 chips, KPI tree links, recovery bands, rule chips, nudge provenance, the frequency options and the "done" and "open" chips are in sentence case in `en` and `ms`. "Via in the app" reads "Via the app" |
| D4 | Running the cadence formats confidence with the workspace's "Confidence shown as" |
| D8 | A trigger's rule page is titled with the rule's name, with the key under it |
| G2, IN1 | "Any" reads "All" on the Goals and Initiatives filter rows |

| D5 | The annual strategy inputs are full width below 768px. Not opened in the browser: still no annual cycle locally |
| D6 | To do wraps its counters under the title, and each item's due label and action under its text on a phone (browser, 375: titles 291px) |
| N2 | Not a defect: Goals fields carry `data-text-first`, and `globals.css` makes them 16px on focus, which is when Safari decides to zoom. The audit measured them at rest |
| N3 | "See the rule", "Snooze for a week", the KPI tree "Open" and "Add driver", the phase 4 "Open", and the Goals inline fields are at least 24px tall on a phone (browser: no Goals field under 24px at 375) |
| N4 | The Draft OKRs card header wraps its actions under the title (browser, 375: titles 309px) |

| D1 | Activity's "Unread" is `notifications.unreadCount`, not the rows on the page. The Updates badge carries "N to do, N unread" as its title and accessible name (browser: 22 = 3 to do + 19 unread, Activity 19) |
| D7, T1 | The tour outline is dashed and set 4px out, the stop is scrolled into view with `block: nearest`, and Back is not drawn on stop 1 (Q4: the inline card stays) |
| D9, B1 | A delete button on each Board card, behind a confirmation, through `tasks.delete` (browser: a test task was created and soft-deleted) |
| N5 | A check-in group in Activity is titled with its objective, read after the access filter (browser) |

| W1 to W5 | Q6 copy on every step. "Step 1 of 5" with a bar, "Local time now", "Skip for now", Back from step 2, "Check-in frequency" with "Weekly (recommended)" and 44px buttons, "Invite a teammate" and "Invite and continue", templates as a radio group, "Use template", "Explore with sample data?", "Add sample data" and "Skip and finish". Continue stays enabled (S-34). "You can remove the sample data later" is not said: there is no removal path (browser, every step) |
| O1 | On track, Outdated and Alignment carry an info button with what each counts. Outdated reads "0 objectives". The on-track colour band stays as it is until Q7 |
| Q5, O4 | The Work Map confidence chip reads "High, 8 in 10", with the bands on hover and read out with the chip (browser) |
| S1, G1 | Search and the Goals count chip say objectives (browser: "2 objectives, filtered") |

| Q1 | Owner is the canon term in METHOD.md §0 and §2.5 and in `TERMINOLOGY.champion`, with Champion as the suggested alternative. The stored key stays `champion`, so no data moves and a workspace's own label is kept. Quality checks, gate 1, trigger recipients, the export column and about twenty catalogue strings follow. Space is kept. Coaching messages use the method's word, which is now Owner, so the sub-question resolves itself. The OKR Champion agent keeps its name |

Follow-ups recorded, not done here: the reference mockups in `docs/mockups/src` (ten files) still draw "Champion", and the spreadsheet import templates still label the column "Champion" (both headers are accepted). UIUX-PLAN screen entries that say "champion" are left as written; the label comes from the terminology setting.

| C4 | Every `RichTextField` starts 80px tall, about four lines (browser, phase 2) |
| R1 | To do's counters link to `#group-overdue`, `#group-today` and `#group-this_week` when above zero (browser) |
| G4 | The goal drawer's target changes and value history use `dayLabel`. The native date input still follows the browser's locale |
| TM1 | The new space form is one row from 768px, button "Create space" (browser) |
| IN3 | The attachment input's own button is styled as the kit's secondary button, still the native input |
| SC1 | "N added mid-cycle" is a grey chip beside the cycle name under What moved. Not seen locally: no cycle has one |
| C7 cards | Summary and bands sit side by side once the phase column is 672px wide, a container query. At 1280 the column is 364px, so they stay stacked (browser) |

| O2 | Company tab, a divider, and a space picker with "All" first. The company's own space (`isCompany`) is not offered (browser: no root space tab) |
| O3 | The cycle picker sorts newest start first, and a shorter cycle before a longer one on the same start, so Q1 comes before the year. Not seen with several cycles locally |

| Q3, G3 | Key results stay open. "Collapse all" and "Expand all" above the cards, remembered in `localStorage` as `openokr.goals.fold` (browser: survives a reload) |
| C5 | Each draft objective's body is a native `details`, open by default, "Hide the draft" and "Show the draft" (browser) |
| IN1 | The Initiatives space filter is a picker with "Every space" first (browser) |

A count inside a phrase ("6 healthy, 3 watch") stays lowercase on purpose.
