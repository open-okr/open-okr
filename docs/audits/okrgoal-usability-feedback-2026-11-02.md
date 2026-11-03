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

Status on 3 November 2026, after the fixes on branch `agung`. Each row in sections 1 to 9 carries its status and the commit that changed it. The status as first audited is in git history.

| Area | Items | Fixed | Partial | Open |
|---|---|---|---|---|
| Welcome wizard | 5 | 5 | 0 | 0 |
| Overview (Work Map) and tour | 6 | 4 | 1 | 1 |
| Updates (Inbox, Review), Search | 4 | 4 | 0 | 0 |
| Cycle | 7 | 4 | 3 | 0 |
| Scorecard | 1 | 0 | 1 | 0 |
| OKRs (Goals) | 4 | 3 | 1 | 0 |
| KPIs | 5 | 3 | 2 | 0 |
| Topbar, Initiatives, Board, Teams | 6 | 5 | 1 | 0 |
| **Reviewer items** | **38** | **28** | **9** | **1** |
| Found by this audit, not in the review | 5 | 4 | | 0 (N2 is not a defect) |
| Defects D1 to D9 | 9 | 9 | | 0 |
| Owner decisions Q1 to Q8 | 8 | 8 decided and built | | 0 |

ui-audit classes across the defects and new findings: 9 `VIOLATION`, 5 `RISK`, and 8 `QUESTION` (section 10).

## 1. Real defects (fix first)

Bugs, not wording. None needs an owner decision.

| # | Class | Defect | Evidence | Fix |
|---|---|---|---|---|
| D1 | RISK | Unread counts disagree. The demo showed 257 against "50 Unread". Locally the Updates badge reads 21 and Activity reads "18 Unread" (browser). The header counts only the rows loaded, capped at 50 | `apps/web/app/inbox/page.tsx:148`, `INBOX_PAGE_SIZE` = 50 in `packages/core/src/actions/notifications.ts:115` | **Fixed** (02e97c48). Count unread on the server. Say in the badge tooltip what it counts, because it now covers To do and Activity |
| D2 | VIOLATION, UIUX-PLAN §8 | Hard-coded English skips the catalogue: the "Company" scope tab, the To do counters "Overdue", "Today", "This week" and their group labels | `apps/web/app/work-map-screen.tsx:170`, `apps/web/app/review/page.tsx:51-53`, `:109-111` | **Fixed** (6f4b2513). Catalogue keys in `en` and `id` |
| D3 | VIOLATION, UIUX-PLAN §8 ("taxonomy labels all live in the catalogues") | Raw stored values reach the screen lowercase and untranslated. Measured on screen: "to come", "no trend yet", "none open", "week streak" (phase 6), "open", "portfolio average", "scored", "not scored" (phase 7), "open", "add driver" (KPI trees), "manager" (Spaces), "via in the app" (To do). Code also prints raw KPI frequency, state and indicator type | `cycle/running-cadence.tsx:177`, `kpis/page.tsx:229`, `:249`, `kpis/grid.tsx:428`, `kpis/trees/tree-rows.tsx:195` | **Fixed** (6f4b2513). Map every value to a catalogue key in sentence case. Covers K1, K2, K4, K5 and the C6 labels |
| D4 | VIOLATION, METHOD.md §12.1 confidence display | Running cadence prints confidence as the stored decimal and ignores "Confidence shown as" | `cycle/running-cadence.tsx:227` | **Fixed** (6f4b2513). `formatConfidence`, as the Work Map uses |
| D5 | RISK | Annual strategy note is a fixed `w-96` (384px) beside a `w-72` input, wider than a 375px phone | `cycle/annual-frame.tsx:203`, `:213` | **Fixed** (1c05b1e9). Stack full width below `md`. Not opened in the browser (no annual cycle locally) |
| D6 | VIOLATION, WCAG 1.4.10 reflow | To do at 375: the header title wraps one word per line, and item titles are squeezed to 18px and 49px wide columns with text clipped (browser: "Run the weekly session" 52px of text in 18px) | `review/page.tsx:108`, right block is `flex-none` with no wrap | **Fixed** (1c05b1e9). Stack the counters and the item action under the text below `sm` |
| D7 | VIOLATION, UIUX-PLAN §7 (visible focus must mean focus) | The tour outline is drawn in the brand colour on the Work Map container and stays while the card is open (browser: `work-map: solid rgb(14,116,144)`), which reads as focus | `work-map.tsx:355`, `globals.css:49-55` | **Fixed** (02e97c48). Its own highlight style, distinct from the focus ring |
| D8 | RISK | The trigger page title is the raw rule key `quality.process_health_low` | `apps/web/app/method/[id]/page.tsx:188` | **Fixed** (6f4b2513). Title from the existing `TRIGGER_NAME_KEYS`, key as a secondary line |
| D9 | RISK | The Board cannot delete a task. `tasks.delete` exists and nothing in the app calls it | `packages/core/src/actions/registry.ts:758`, `apps/web/app/board/` | **Fixed** (02e97c48). A delete action in the card menu, through the existing action |

## 2. Found by this audit, not in the review

| # | Class | Finding | Evidence | Fix |
|---|---|---|---|---|
| N1 | VIOLATION, CLAUDE.md hard rule (thresholds live in `packages/method`) | The Work Map's on-track colour hard-codes 70 and 40. No METHOD.md §11 row exists for an on-track share | `work-map-header.tsx:236-238` | **Fixed** (e73b7aa0). Add the band to METHOD.md §11 or drop the colour. METHOD.md change is the owner's (section 10, Q7) |
| N2 | VIOLATION, ui-audit proportions (input font on mobile) | Goals at 375: inline fields render at 11 to 14.5px (browser: objective title 14.5px, kind 11px, owner 12px, key result title 13px). Safari on iOS zooms on focus below 16px | `apps/web/app/goals/okr-cells.tsx`, `okr-table.tsx` | **Not a defect**. 16px for editable fields below 768px |
| N3 | VIOLATION, WCAG 2.2 SC 2.5.8 | Targets under 24px: "See the rule" 69x16 and "Snooze for a week" 120x22 (To do), "open" 28x16 and "add driver" 58x16 (KPI trees), Goals inline selects 74x22 and value fields 24x22, "Open" 29x16 (phase 4) | Browser measurement | **Fixed** (1c05b1e9). Pad links and inline controls to 24px height |
| N4 | VIOLATION, WCAG 1.4.10 reflow | Draft OKRs: the objective card header squeezes its title and meta to 22px at 1280 and 37px at 375, text clipped (browser) | `cycle/drafting.tsx` header row, beside "Suggest a parent" and "Open" | **Fixed** (1c05b1e9). Let the actions wrap under the title |
| N5 | RISK | Activity: items under "CHECK-IN" do not name their objective ("1 day after publication"), while items under "GOAL" do (browser) | `apps/web/app/inbox/page.tsx:221` | **Fixed** (02e97c48). Group check-in items under their objective, or name it in the row |

## 3. Welcome wizard (`/welcome`)

File: `apps/web/app/welcome/wizard.tsx`, keys `welcome.*`. Code-only: the local workspace is set up, so the route redirects.

| ID | Reviewer asks | Status | Still to fix |
|---|---|---|---|
| W1 | Step 1: subtitle "5 quick questions. Each has a default, so you can skip any of them."; "Step 1 of 5" with a progress bar; label "Workspace name"; time zone dropdown with "Local time now"; a not-detected message that disables Continue; "Skip for now" | **Fixed** (ff7b2d5c) | Nothing left |
| W2 | Step 2: "Check-in frequency"; "Weekly (recommended)", "Every 2 weeks", "Monthly"; drop "the practice", "the method's own default", "the Champion"; 44px buttons; Back from step 2 | **Fixed** (ff7b2d5c) | Nothing left |
| W3 | Step 3: "Invite a teammate"; placeholder "name@company.com"; drop "diary" and "invitations card"; primary "Invite and continue" | **Fixed** (ff7b2d5c) | Nothing left |
| W4 | Step 4: "Start from a template" without question mark; radio cards; "check-in" instead of "session"; drop "quality checks" and "nothing here is a lesser path"; primary "Use template" | **Fixed** (ff7b2d5c) | Nothing left |
| W5 | Step 5: "Explore with sample data?"; plain description; "No one is notified. You can remove the sample data later."; drop "phase 6", "recovery objective", "blockers at different ages"; "Add sample data" and "Skip and finish" | **Fixed** (ff7b2d5c) | Nothing left |

## 4. Overview: Work Map and first-visit tour

Files: `apps/web/app/work-map-header.tsx`, `work-map-screen.tsx`, `work-map.tsx`, `goal-nodes.ts`, `first-visit-tour.tsx`. The Work Map now sits on Home under "My week".

| ID | Reviewer asks | Status | Still to fix |
|---|---|---|---|
| O1 | "On track 50%" orange with no explanation; "Outdated 0 goals"; "Alignment 100%" needs a tooltip | **Fixed** (ff7b2d5c, e73b7aa0) | Nothing left |
| O2 | The root space shows as a team tab; nine tabs overflow; "Company" tab, divider, "Team: All" dropdown | **Fixed** (0385402b) | Nothing left |
| O3 | Periods out of order (the annual cycle between Q2 and Q1); use a dropdown | **Fixed** (0385402b) | Nothing left |
| O4 | Indent-only nesting; "High 0.8"; "99.95 of 100 %"; "101 of 95 $"; "Champion" header; relative dates; narrower columns | **Partial** (ff7b2d5c, 0c03fdfd) | Done: Owner header, High, 8 in 10. Left: indent-only nesting, unit spacing, relative dates |
| O4a | Maintain KR shows target 100, not the 99.9 floor | **Open** | Left: check the seed's maintain key result |
| T1 | Tour highlight looks like focus; card stays at the top; dim and anchor; scroll into view; hide Back on step 1 | **Fixed** (02e97c48) | Nothing left |

## 5. Updates (Inbox and Review), Search

| ID | Reviewer asks | Status | Still to fix |
|---|---|---|---|
| I1 | Counts disagree; a count per pill; name the objective | **Fixed** (02e97c48, 6f01dbb3) | Nothing left |
| R1 | Overdue, Today, This week jump to their sections; fix mobile | **Fixed** (1c05b1e9, 6b2969f0) | Nothing left |
| R2 | "See the rule" opens a raw key as title | **Fixed** (6f4b2513) | Nothing left |
| S1 | "Goals, key results..." should say "Objectives" | **Fixed** (ff7b2d5c) | Nothing left |

## 6. Cycle (`/cycle`)

The Cycle screen is now three columns: phase rail, the phase, and a quality panel with facilitator guidance (browser).

| ID | Phase | Reviewer asks | Status | Still to fix |
|---|---|---|---|---|
| C1 | Switcher | "Open" as a button labelled "View"; narrower select | **Partial** | Left: the button still reads Open, not View |
| C2 | 0, Annual strategy | Widen or stack both inputs; fix mobile | **Fixed** (1c05b1e9) | Nothing left |
| C3 | 1, Prepare | Input stretches so Save aligns right | **Fixed** (no change needed) | Nothing left |
| C4 | 2, Diagnose | Editors in a tiny one-line box | **Fixed** (6b2969f0) | Nothing left |
| C5 | 4, Draft OKRs | Each objective collapsible | **Fixed** (6afac778) | Nothing left |
| C6 | 6, Run the cadence | "Still needed" per team; sessions grouped by team with filters; KRs under objective; lowercase labels | **Partial** (6f4b2513, 72e3bbbe) | Done: lowercase labels, grouping by space and objective, gaps one per line. Left: team filters |
| C7 | 7, Review and learn | Gaps per team; summary and bands side by side; KRs grouped; team filter on Sessions | **Partial** (6b2969f0, 72e3bbbe) | Done: summary beside bands, key results grouped. Left: gaps per team, team filter on Sessions |

## 7. Scorecard

| ID | Reviewer asks | Status | Still to fix |
|---|---|---|---|
| SC1 | "N added mid-cycle" as a grey pill beside the cycle name; "Close a cycle out" and "Points" side by side | **Partial** (6b2969f0) | Done: the mid-cycle chip beside the cycle name. Left: Close and Points side by side |

## 8. OKRs (Goals > OKRs)

Revamped on 2 November 2026 (`89443a42`, `96b2089a`).

| ID | Reviewer asks | Status | Still to fix |
|---|---|---|---|
| G1 | "12 goals" chip beside "Objectives: 12"; "+" unclear | **Fixed** (ff7b2d5c) | Nothing left |
| G2 | Filters: no "\|"; sentence case; "Any" to "All"; "Kind" to "Type"; "Space" to "Team"; what is "Closed" | **Fixed** (6f4b2513, 8c204380) | Nothing left |
| G3 | Objectives only by default; red OBJ-5; "Space" to "Team"; due date twice | **Fixed** (6afac778) | Nothing left |
| G4 | Three date formats on one page | **Partial** (6b2969f0) | Left: the native date input follows the browser's locale |

## 9. KPIs, Topbar, Initiatives, Board, Teams

| ID | Reviewer asks | Status | Still to fix |
|---|---|---|---|
| K1 | Lowercase frequency and state; "All" and "Uncategorised" both selected | **Fixed** (6f4b2513) | Nothing left |
| K2 | Row meta and "recovering" misaligned; footer hint misaligned | **Fixed** (6f4b2513) | Nothing left |
| K3 | Tree connector lines or chevrons; check the stack | **Partial** | Left: chevrons, and the stack checked on a large tree |
| K4 | Recovery board: sentence case; progress bar placement | **Partial** (6f4b2513) | Done: sentence case. Left: the progress bar placement |
| K5 | Trees: "watch", "open", "add driver" | **Fixed** (6f4b2513) | Nothing left |
| TB1 | "+ New" lacks context; collapsible sidebar | **Fixed** (d8404db9) | Nothing left |
| IN1 | Team filter as a dropdown; "Any" to "All" | **Fixed** (6f4b2513, 6afac778) | Nothing left |
| IN2 | Long unbroken title overflows; selects and "Watch this" in one row | **Partial** | Left: test with a 200-character title |
| IN3 | Styled file button | **Fixed** (6b2969f0) | Nothing left |
| B1 | Delete on a Board card | **Fixed** (02e97c48) | Nothing left |
| TM1 | New team: one row; "Create team" | **Fixed** (6b2969f0) | Nothing left |

## 10. Owner decisions

Recommendations are from the `okr-practitioner` review, with the sections it cited.

| # | Question | Recommendation | Why | Confidence |
|---|---|---|---|---|
| Q1 | "Champion" to "Owner", "Space" to "Team"? | **Rename Champion to Owner. Keep Space** | METHOD.md §0 names "Owner" as the common alternative, and REQUIREMENTS §3 already says "a goal with no owner". "Champion" also names the OKR Champion agent, so `welcome.rhythm.help` reads as a person. A space can be a company, department or team (§2.7, §12.1), and "Team" would clash with the Level filter's own "Team". Cost: METHOD §0 and §2.5 default, `term.champion.*`, mockups, specs. Open sub-question: do coaching messages follow the label (TECHNICAL-PLAN §4.14 keeps method words)? | Medium. **Decided 3 Nov 2026, built** (0c03fdfd) |
| Q2 | "Goals" or "Objectives"? | **"Objectives" everywhere a user reads it** | UIUX-PLAN S-13 (decision D5) already says "OKRs" and "+ New objective". METHOD §0 says the two words mean the same. Copy only | High. **Decided 3 Nov 2026, built** (ff7b2d5c) |
| Q3 | Objectives only by default? | **Keep key results open.** Add "collapse all", remember each person's choice | METHOD §1 principle 1, "key results are the proof". UIUX-PLAN S-13 draws KRs under each card. Per-person memory is a UIUX addition | High. **Decided 3 Nov 2026, built** (6afac778) |
| Q4 | Tour as an anchored popover? | **Keep the inline card.** Fix the highlight (D7), scroll the target into view, hide Back on step 1 | UIUX-PLAN S-34 chose a card so it traps nothing | Medium. **Decided 3 Nov 2026, built** (02e97c48) |
| Q5 | Confidence as "High" with no number? | **Keep the number**: "High, 8 in 10", with a tooltip of the bands | METHOD §3.2, "a drop matters more than a level": 0.9 to 0.7 stays High. §12.1 defaults to "x in 10". A screen showing "0.8" is a defect like D4 | High. **Decided 3 Nov 2026, built** (ff7b2d5c) |
| Q6 | Welcome copy rewrite? | **Adopt the plain copy.** Keep "weekly is recommended" and "every step has a default" | METHOD §1 principle 5, §11 rhythms, REQUIREMENTS §6 "Zero setup". Confirm "remove sample data later" is true | High. **Decided 3 Nov 2026, built** (ff7b2d5c) |
| Q7 | On-track colour band (N1) | Decide the band in METHOD.md §11, or drop the colour | A threshold outside `packages/method` breaks a hard rule. A tooltip would state a band that has no source | Not rated. **Decided 3 Nov 2026, built** (e73b7aa0) |
| Q8 | "Kind" to "Type" (G2)? | Copy is fine, but "kind" is method vocabulary (METHOD §2.8 committed/aspirational, §2.10 KR kinds). Rename in METHOD first or keep it | Moves method vocabulary | Not rated. **Decided 3 Nov 2026, built** (8c204380) |

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

| TB1 | A button at the sidebar's foot, from 1280px, sets `data-sidebar="rail"` on `<html>`; the sidebar's own classes narrow it to the icon rail. Remembered as `openokr.sidebar` (browser: 236px to 68px, kept after a reload) |
| C3 | No change needed: the note field already takes the row and Save sits at its right end (code) |

| C6, C7 grouping | Phase 6 groups sessions by space and confidence rows by objective; phase 7 groups key results by objective, through `lib/group-rows.ts`. A "still needed" reason that carries its gaps as sentences lists them under it, unless it quotes a title (browser: groups drawn on both phases) |

### Still open

| Item | What is left |
|---|---|
| C1 | The cycle switcher's button still reads Open, not View |
| C6, C7 | A team filter on the cadence lists and on Sessions (`?space=`), and phase 7 gaps per team |
| SC1 | Close a cycle out and Points side by side |
| G4 | The native date input follows the browser's locale |
| K3, K4 | KPI tree chevrons and a large-tree check; the recovery card's progress bar placement |
| O4, O4a | Indent-only nesting on the Work Map, unit spacing, relative dates; the maintain KR seed check |
| IN2 | Needs an initiative with a 200-character title to test |
| Follow-ups | The reference mockups in `docs/mockups/src` and the spreadsheet import templates still say Champion |

Decided and built after the first pass: Q7 (`e73b7aa0`, the on-track share band in METHOD.md §3.5 and §11), Q8 (`8c204380`, Kind reads Type), I1 (`6f01dbb3`, `notifications.reasonCounts` and counts on Activity's pills).

A count inside a phrase ("6 healthy, 3 watch") stays lowercase on purpose.
