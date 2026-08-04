# Reference mockups

Eleven hand-built screens showing what the specifications in [UIUX-PLAN.md](../../development-plan/UIUX-PLAN.md) look like when they are drawn. They exist so that a person or an agent starting a UI task can see the target before writing any code.

They live here rather than in `docs/development-plan/` because the stakeholder document and deck are built from the same files. That is a packaging detail. **Their job is to be a development reference.**

## What authority they have

**None.** They are illustrations, in the same class as `docs/development-plan/reference/`.

| Question | Answer |
|---|---|
| The mockup and UIUX-PLAN.md disagree | **UIUX-PLAN.md wins.** Fix the mockup |
| The mockup and METHOD.md disagree on a rule, band, threshold or key | **METHOD.md wins.** Fix the mockup |
| The mockup shows a detail no document specifies (a spacing, a chip shape, a row density) | Treat it as a **proposed default**. Follow it unless there is a reason not to, and say so in the change if you deviate |
| The implementation ends up looking different for a good reason | Fine. Update the mockup in the same change, or delete it if the screen has moved on |

Never cite a mockup as the reason for a behaviour. Cite the specification.

## The screens

| Mockup | Screen specification | Implementation task | What it is there to show |
|---|---|---|---|
| [01-work-map](png/01-work-map.png) | S-01 | P3-T11 | The uniform node contract at every row, the outdated badge overriding reported health, a KPI tile in the tree, the cycle strip |
| [02-cycle-workspace](png/02-cycle-workspace.png) | S-04, S-06 | P3-T03 | The eight-phase rail with computed completion, drafting blocked on an incomplete input pack, the facilitator guidance rail |
| [03-draft-coach](png/03-draft-coach.png) | S-09 | P4-T02 | Rule verdicts inline beside the field they judge, the strength meter, the quality panel, a passing set beside a failing one |
| [03b-rule-card](png/03b-rule-card.png) | S-09 detail | P4-T02 | One verdict opened: prompt, reason, weak-versus-strong pair, rewrite and dismiss |
| [04-gates-capacity](png/04-gates-capacity.png) | S-10 | P4-T03, P3-T09 | The six gates as a checklist with two unmet, the disabled publish control stating its reason, the capacity table and the mandatory cut, the dependency register |
| [05-alignment-studio](png/05-alignment-studio.png) | S-16 | P3-T10, P3-T09, P4-T06 | Contribution as solid connectors and dependencies as dashed, an unaligned goal, the health score with each gap and its penalty, the Coach's typed findings |
| [06-kpi-recovery](png/06-kpi-recovery.png) | S-18, S-19 | P3-T14 | The driver tree with corridor bars and tier labels, a live recovery objective with one key result per leading driver at the edge of the unhealthy branch, effective health, the cross-tree recovery board |
| [07-weekly-session](png/07-weekly-session.png) | S-22 | P4-T07 | The four-step rail, the confidence dial with its bands, private votes revealed together, a low score becoming a typed blocker on a clock, the streak |
| [08-quarterly-review](png/08-quarterly-review.png) | S-24 | P4-T10, P4-T11 | The lap bar proportional to stage minutes, the stage rail grouped by act, the diagnostic card, the eight root causes, the five process-health statements |
| [09-channels](png/09-channels.png) | AI-NATIVE-PLAN §5 | P5-T02 to P5-T05 | The same nudge in four channels, a conversational check-in capturing a typed blocker, and nudge provenance on every message |
| [10-review-inbox](png/10-review-inbox.png) | S-02 | P3-T08, P4-T04 | Overdue-first grouping, agent proposals in the queue, the five-step escalation ladder, the provenance panel with snooze and change-channel |

## Everything in them is a real value

The mockups quote the canon rather than inventing numbers, because a developer will copy what they see. Where a mockup shows a rule key, a band, a corridor, a penalty or a threshold, it comes from a document:

| Shown in the mockups | Source |
|---|---|
| `OBJ-1`, `KR-2`, `AL-1`, `CY-6` and the other quality rules | METHOD.md §4 |
| Confidence bands: high 0.7 and above, medium 0.4 to below 0.7, low below 0.4, escalating at 0.3 | METHOD.md §3.2 |
| Alignment penalties: 12 orphan, 8 silo, 4 no key results, 3 level skip, healthy at 75 | METHOD.md §5.2 |
| Semantic finding types: relink, dependency, conflict, gap | METHOD.md §5.3 |
| KPI corridors, tiers and the effective-health projection | METHOD.md §6.2, §6.4, §6.5 |
| The five blocker types and the 24-hour clock | METHOD.md §7.3 |
| The eleven quarterly stages and their minutes, the eight root causes, the five process statements | METHOD.md §8.1, §8.4, §8.5 |
| `checkin.overdue`, `kpi.recovery_proposed`, `quality.conflict` and the other trigger keys | AI-NATIVE-PLAN.md §6.4 |
| The escalation ladder steps and the blocker ladder | AI-NATIVE-PLAN.md §6.3 |
| Colour, spacing, chips, badges and density | UIUX-PLAN.md §2, §4 |

**When one of those changes, the mockup that quotes it is stale.** `pnpm method:check` cannot see these files, so treat them the way you would treat documentation: update them in the same change, or note them in the change as needing a follow-up.

## Rebuilding

```bash
./render.sh          # src/*.html -> png/*.png at 1440 wide, 2x, palette-optimised
```

Needs a Chromium headless shell. It looks in the Playwright browser cache, falls back to Google Chrome, and `CHROME=/path/to/binary` overrides both. Each file declares its own size in a `window-width` / `window-height` comment.

`src/style.css` carries the shared tokens, and they are deliberately the same values as UIUX-PLAN.md §2 describes: one brand hue, a neutral grey ramp, semantic tokens for success, warning, danger and info, and health or confidence colour never used without a label beside it.

The rendered PNGs are also used by [OpenOKR-Overview.docx](../OpenOKR-Overview.docx) and [OpenOKR-Deck.pptx](../OpenOKR-Deck.pptx), so re-run those builds after re-rendering. See [../README.md](../README.md).

## A note on 06-kpi-recovery

`06-kpi-recovery` shows the recovery objective on **expansion revenue**, a KPI whose immediate children are leading. Per METHOD.md §6.5 the drafter walks the unhealthy KPI's subtree breadth-first for the leading drivers at the edge of the unhealthy branch, so for this KPI the key results are exactly its leading children, which is what the mockup draws.
