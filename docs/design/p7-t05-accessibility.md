# P7-T05: accessibility and web vitals

What is checked automatically, what a person has to check, and what neither
covers. Written 10 September 2026.

## 1. The three layers, and why one is not enough

| Layer | Where | Catches | Misses |
|---|---|---|---|
| Automated scan | `e2e/s43-accessibility.spec.ts` | Missing names, contrast, roles, landmarks, form labels, on every screen | Whether a name makes sense, focus order, whether an interaction is possible at all |
| Keyboard walkthrough | `e2e/s43b-accessibility-keyboard.spec.ts` | Unreachable controls, missing skip link, focus lost on close, invisible focus ring | Whether an announcement is useful, live-region timing |
| Screen-reader smoke | §4 below, by a person | Whether the product can actually be used by ear | Anything nobody thought to try |

An automated scan finds roughly a third to a half of real accessibility
defects. A repository with only the first row has a green gate and an unusable
product, which is the failure this table exists to prevent.

## 2. The automated gate

`e2e/s43-accessibility.spec.ts` runs inside the existing `e2e` continuous-integration job,
so it gates every pull request without a new job.

| Decision | Detail |
|---|---|
| Which screens | Derived by walking `apps/web/app` for `page.tsx`, the same way `apps/web/test/route-coverage.test.ts` does. A screen added tomorrow is scanned tomorrow |
| Which are skipped | Only those in `NOT_CHECKED_HERE`, each with a written reason, and a test fails when a reason outlives its route |
| Which rules | `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` |
| What fails the build | `serious` and `critical` only |
| Why not all four impacts | `minor` and `moderate` are largely advisory. A gate that fails on all four gets switched off within a month, and a gate that is off is worth less than a narrower one that holds |
| The library | `@axe-core/playwright`, a development dependency, approved by Agung on 10 September 2026. MPL-2.0, already on the licence allow-list, so no gate changed |

**The empty-glob assertion.** The first test in the file requires more than
forty routes found and more than twenty scanned. Without it, a change that
broke the directory walk would leave a green accessibility gate that scanned
nothing, which is the worst outcome available.

**It scans one viewport, and that hides things.** Playwright's default width
is narrower than a desktop, so anything behind `md:` is `display: none` when
axe looks and is skipped. The admin sidebar's own section heading was exactly
that: a 10.5px uppercase label in `--ink-4`, invisible to the scan and failing
contrast for everybody on a laptop. It was found by reading, not by the gate,
and fixed in the same change. Adding a second viewport is the obvious
improvement and is not done here.

**The gate was flaky before it was useful.** Two runs of identical code
produced baselines of two routes and of twenty-three. Most of these screens
are client-owned (TECHNICAL-PLAN §13.3), so the shell paints long before the
table under it does, and axe scanning a skeleton finds nothing and reports a
clean screen. That is flakiness in the direction of passing, which is the
worst kind. The spec now waits for the network to settle and for the main
region to have content, and two consecutive baseline runs are byte-identical.

**What the first run found.** Two rules, and both were one defect repeated.
Every screen failed `color-contrast` on the shell's `h1`, which rendered the
screen name at 10px in `--ink-4`, the token whose own comment reads
"placeholders and disabled labels only. Deliberately below 4.5". An `h1` is
neither, and it moved to `--ink-3`. Every screen with a progress column
failed `aria-progressbar-name`, because `Bar` set `role="progressbar"` with
no name, so a reader heard "progressbar, 40" once per row with nothing to say
which goal. `Bar` now takes a `label` and the Work Map passes the goal title.

**The contrast finding was one token, not seventeen screens.** `--ink-4` was
`#94a3b8`, chosen deliberately below 4.5 on the reasoning that it was for
placeholders and disabled labels, the two cases 1.4.3 exempts. The scan showed
the reasoning had not survived contact with the product: 152 uses, most of
them ordinary small text. Agung chose darkening the token on 10 September
2026, and one line took the contrast findings from seventeen screens to
three. The dark theme's own `--ink-4` failed the same way at 4.0 and was
moved to `#7d8ba1`, computed rather than measured, because the scan runs the
light theme only.

### The baseline

Findings that already existed are recorded per route in
`e2e/s43-accessibility-baseline.json`. A rule listed there is tolerated on
that route only: the same rule on another screen fails, a new rule anywhere
fails, and an entry that stops occurring also fails, so the file can only
shrink. That is the acceptance criterion read literally, a gate that blocks a
change which *introduces* a finding, and it is what any linter added to a
mature codebase does. Regenerate with `A11Y_WRITE_BASELINE=1` and read the
diff: a baseline that grows in a commit is a regression somebody has to
justify.

## 3. Web vitals

`e2e/s44-web-vitals.spec.ts` measures the three §13.1 rows that
`pnpm perf:budgets` hands to this task.

| Row | Budget | How |
|---|---|---|
| Largest contentful paint | 2.5 s | `PerformanceObserver`, on `/`, `/goals` and `/board` |
| Interaction to next paint | 200 ms | The longest `event` entry after a real key press |
| Scroll frame budget | 16 ms | `long-animation-frame` entries during a scripted scroll |

**Read from the browser, not from a stopwatch.** A wall-clock number around
`page.goto` measures the runner and the network as much as the product, and it
cannot see a late paint at all.

**A green result here is a floor, not a promise.** These run against the
seeded database `e2e/prepare-database.ts` builds, which is much smaller than
§13.1's own 100,000-goal dataset, on whatever hardware the run is given. The
server-side half of the same screens is measured against the full dataset by
`pnpm perf:budgets`, and the two together are the answer. Neither on its own
is.

**A zero is a failure, not a pass.** A page that painted nothing contentful
would satisfy "less than 2.5 seconds", so the spec asserts a paint happened
before it asserts the paint was fast.

## 4. The screen-reader smoke procedure

Run by a person, once per release, and after any change to the shell, a
dialog, or a live region. Twenty minutes.

**Setup.** One of: NVDA on Windows with Firefox, VoiceOver on macOS with
Safari, or Orca on Linux with Firefox. Speech on, screen visible (this is a
smoke test, not a blindfolded usability study).

| # | Step | Expected |
|---|---|---|
| 1 | Load `/`, listen to the first thing announced | The page title, then the skip link. Not "clickable" with no name |
| 2 | Activate the skip link | Focus lands in the main region and the next announcement is the page heading |
| 3 | Read the heading structure (NVDA `H`, VoiceOver rotor) | One `h1`, then `h2`s in reading order. No level skipped, no heading used for styling |
| 4 | Tab through the primary navigation | Every item announces its own name and says whether it is the current page |
| 5 | Open the command palette with the keyboard | It announces itself as a dialog, and the search field is what has focus |
| 6 | Type two letters, wait | Results are announced as they arrive, once, not on every keystroke |
| 7 | Press `Escape` | The dialog closes, and the next announcement is the control that opened it |
| 8 | Open a goal, start a check-in | Each field announces its label, its required state and any inline error |
| 9 | Submit with a validation error | The error is announced without moving focus away from where it happened |
| 10 | Open the board, tab to a card | The card announces its title and its column. If it announces only a title, the column is invisible by ear |
| 11 | Trigger a save | The confirmation reaches a live region and is spoken once |
| 12 | Open a review session as a participant | The stage change is announced when it happens, not only on the next tab |

**Recording the result.** A run is a note in the release's own STATUS row:
which reader, which browser, which steps failed. A step that fails becomes an
issue with its number, never a silent retry.

**Known limitation.** Steps 6, 11 and 12 depend on live regions, which no
automated check in this repository verifies. They are the reason this
procedure exists, and they are the first thing to automate if somebody finds a
way that is not flaky.

## 5. What none of this covers

- **Cognitive load and plain language.** METHOD.md's coaching messages are
  written to be direct; nothing here measures whether they land.
- **Zoom and reflow at 400%.** WCAG 1.4.10. Worth adding to the keyboard spec
  as a viewport case; not done here.
- **Motion sensitivity.** SmoothUI animations respect
  `prefers-reduced-motion`; no test asserts it.
- **Colour alone as meaning.** The health bands pair colour with a label
  everywhere the author knows of, and axe cannot check the pairing.

Each of these is a real gap, listed so the next audit reads a decision rather
than counting the same absence again.

## 6. Acceptance

**Given** a change that introduces a serious accessibility finding on any
screen, **when** continuous integration runs, **then** the `e2e` job fails and
names the rule, the screen and the first offending element.

**Given** a change that pushes largest contentful paint or interaction to next
paint past its §13.1 budget, **when** continuous integration runs, **then**
the `e2e` job fails with the measured number.

**Given** a screen added with no accessibility coverage, **when** continuous
integration runs, **then** it is scanned anyway, because the list is derived
from the route tree rather than maintained by hand.
