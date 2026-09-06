---
name: ui-audit
description: Use when auditing an OpenOKR screen, flow or shared component for UI and UX defects, before or after a UI task. Runs eight review lenses in one pass against UIUX-PLAN.md, produces evidence-backed findings in three verdict classes, and never applies fixes.
---

# UI audit

An audit that produces opinions is worthless here. This skill produces findings
that can be argued with, because every one of them cites either a line in an
authority document or a number measured in a real browser.

Read `references/proportions.md` before the first lens. It holds the sizing
numbers, which of them are binding, and the conflicts already known.

## What this is not

- Not a fix pass. You report. Fixing is a separate run the human approves
  separately. An auditor allowed to patch stops looking after the first patch.
- Not a replacement for the UIUX-PLAN.md §9 checklist. §9 is what a UI task must
  satisfy to ship. This is how somebody checks whether it did.
- Not a taste review. "The spacing feels cramped" is not a finding. "Label to
  field gap is 12px, field to next label gap is 8px, so the form groups read
  upside down" is.

## Step 1: fill the scope block

Refuse to start until every line has a value. An audit without a scope returns
mush.

```
Target:      <route, or component in packages/ui>
Breakpoints: <e.g. 1280, 375>
Themes:      <light, dark, or both>
Density:     <comfortable, compact, or both>
States:      <loaded, loading, empty, error, permission-denied>
Data:        <seeded realistic, or thin>
```

If the human named a screen but not the rest, propose defaults and get a nod:
both breakpoints, both themes, both densities, all five states, seeded data.

## Step 2: read the authority, in this order

| Order | Document | What you take from it |
|---|---|---|
| 1 | UIUX-PLAN.md §6, the cited S-xx | What this screen is supposed to be |
| 2 | UIUX-PLAN.md §2 | Type scale, spacing grid, colour rules, elevation, motion, icons |
| 3 | UIUX-PLAN.md §4 | The interaction pattern each element owes |
| 4 | UIUX-PLAN.md §7 | Accessibility floors, and the status-dot exemption |
| 5 | UIUX-PLAN.md §9 | The shipping checklist |
| 6 | `docs/design/colour-system.md` | Token names and recipes |
| 7 | METHOD.md | Any rule key, band, corridor or taxonomy the screen shows |
| 8 | The mockup in UIUX-PLAN.md §10, if one exists | Reference only. Never the reason for a verdict |

A finding that cites a mockup as its authority is invalid. Mockups lose to the
specification (CLAUDE.md, UIUX-PLAN.md §10).

## Step 3: get it on screen and measure

Reading source cannot tell you a rendered height, a computed contrast, or
whether a row overflows. Do not guess it.

1. `pnpm dev`.
2. Drive the browser with the Playwright MCP tools. If that server is not
   connected, say so and switch to `next-devtools` `browser_eval`. If neither
   works, the audit is code-only and every proportion finding goes on the
   unverified list.
3. Calibrate on `/dev/components` first. It renders the shared primitives, so it
   tells you the real control ladder before you judge a screen against it.
4. Measure with `getComputedStyle`, not by eye. Collect, per element that
   matters: `height`, `padding`, `font-size`, `line-height`, `gap`,
   `border-radius`, and the resolved colour pair.

## Step 4: the eight lenses, in this order

One pass, one agent, all eight. Order matters: the earlier lenses find the
causes of what the later ones would otherwise report as separate symptoms.

| # | Lens | Check |
|---|---|---|
| 1 | Design system | Every colour through a token, no raw hex or `rgba`. Every font size on the §2 scale. Every spacing on the 4px grid. One radius ladder. A card separated by border and surface, not shadow. Nothing styled outside `packages/ui` |
| 2 | Proportion | The whole of `references/proportions.md`: control ladder consistency, icon to text ratio, input font size on mobile, chip geometry, table row height, nested radius, and the proximity law |
| 3 | Accessibility | Contrast 4.5:1 text and 3:1 interface, per §7 including its exemptions. Visible focus, focus trapped in overlays and returned on close. A keyboard path for every action, drag always having a menu alternative. Live regions on toasts, badges and stage changes. Label, description and linked error on every field. Status colour never the only signal |
| 4 | Visual hierarchy | Can you name the single most important thing on the screen in two seconds. Heading levels semantic, one h1. Type sizes that actually differentiate rank. Tabular numerals in every grid and score. Numbers right-aligned, labels left |
| 5 | States | Loading skeleton matches the final layout, not a grey blob. Empty state has icon, one sentence, primary action, docs link. Error card retries. Permission-denied is a designed state, not a crash. Optimistic update rolls back with a toast. Six second undo, not a confirm dialog, for reversible destruction |
| 6 | Data density | Re-render with a realistic worst case: 500 rows, the longest member name in the workspace, a 120 character objective title, a fully expanded tree. Column widths follow content type, never an equal split. Virtualised rows appear instantly with no entrance animation |
| 7 | Motion and perceived speed | 120 to 200ms on hover, focus, selection and state change. Reduced motion honoured. No content gated on an animation. Ambient motion only where something is genuinely live |
| 8 | Internationalisation | No concatenated strings. Every string in a catalogue with a Bahasa Melayu key stubbed. Logical CSS properties. Re-check the layout with strings 30 percent longer. Dates, numbers and times through the workspace timezone and the user locale |

Then two passes that are not lenses but questions.

- **First run.** Open it with no data, as somebody who has never seen the
  product. Write down the first thing you would click, and whether the screen
  told you to.
- **Agent members.** The Coach and the Champion are members. Check the agent
  badge, their proposals in the review queue, and nudge provenance with snooze
  and channel change. Then turn the AI provider off and confirm every sparkle
  affordance is hidden or disabled with the deterministic path untouched.

## Step 5: verdict classes

Three, never merged. The third is the one this repository most needs, because
CLAUDE.md forbids deciding practice, design authority or thresholds alone.

| Class | Meaning | Requires |
|---|---|---|
| `VIOLATION` | A written rule is broken | The document and section, plus `file:line` or a measured number |
| `RISK` | The specification is silent and the current behaviour is probably wrong | A concrete failure scenario, not a preference |
| `QUESTION` | The specification is silent or contradicts itself and a human must decide | Both readings, and what each one costs |

Every finding carries: class, lens, `file:line`, the measured or quoted
evidence, and one sentence on what breaks for a user. A finding without evidence
is dropped, not downgraded to a maybe.

Rank by user impact, not by lens order.

## Step 6: the unverified list

Close every report with what you could not check, and why. This list is not an
apology, it is the scope of the next run. Typical entries: screen reader output,
real network latency, a state needing data you could not seed, touch behaviour
on a real device, print and email rendering.

## Step 7: report

Write to the scratchpad, summarise in chat. Do not commit a report under `docs/`
unless the human asks. The summary leads with the count per class, then the
three findings with the highest user impact.

## Known conflicts

Carry these into every run so they are not re-discovered as new findings.

| Conflict | Status |
|---|---|
| UIUX-PLAN.md §2 locks the type scale to 12/13/14/16/18/24/30. The mockups' `style.css` uses 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 15 and 21, with a 13px body. `packages/ui` followed the mockups | Open `QUESTION`. Report the conflict once. Do not report each off-scale size separately |
| §2 states a 4px spacing grid. The mockups use 7, 9, 14, 18 and 31px, and `button.tsx` carries `h-7.5` (30px) and `h-6.25` (25px) | Open `QUESTION`, the same conflict, the same single finding |

## Never

- Never apply a fix during an audit.
- Never cite a mockup as the reason a behaviour is right or wrong.
- Never change a rule, threshold, band, corridor, taxonomy or coaching message.
  Those are METHOD.md and a human decision.
- Never report an off-scale size or an off-grid spacing as a fresh finding while
  the conflicts above are open.
- Never claim a proportion, a contrast ratio or an overflow without a measured
  number.
