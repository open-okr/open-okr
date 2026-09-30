# OKR entry points: where a member goes to see and write an OKR

Written after a usability complaint on 30 September 2026: the OKR surface is
hard to navigate, there is no single place called OKR, and nothing on the
objective screens creates an objective. A FlowyTeam screenshot was given as the
comparison.

Authority: REQUIREMENTS.md, then PLAN.md, then METHOD.md, then UIUX-PLAN.md
§3 (shell and navigation), §6 S-01, S-04, S-09, S-13, S-14. No code is changed
by this document. It exists so the human can decide before anything is built.

## 0. The complaint, stated as behaviour

| What the member tried | What happened |
|---|---|
| Looked for a menu called OKR | There is none. The practice is split across eight sidebar rows |
| Opened Goals to add an objective | Goals is read-only. The empty state points at `/cycle?phase=4` |
| Opened Cycle to add an objective | The form exists but refuses while phases 0 to 3 are incomplete |
| Looked for a way to add a key result to an existing objective | Only on the drafting screen. The goal detail screen has none |

Four steps to reach a form that may then refuse. FlowyTeam reaches the
equivalent form in one click and never refuses.

## 1. Three of the four are already specification drift

This matters, because fixing drift needs no decision from anybody.

| UIUX-PLAN says | The product does | Where |
|---|---|---|
| §6 S-13: the goals explorer carries "a new-goal action" | No create affordance anywhere on `/goals` | [page.tsx](../../apps/web/app/goals/page.tsx) |
| §3: the topbar carries `+ New` | The topbar has breadcrumb, search, Ask AI, bell, avatar. No `+ New`. The component's own comment quotes the line it does not implement | [topbar.tsx:10](../../packages/ui/src/shell/topbar.tsx#L10) |
| §3: the practice block is four rows, Cycle, Goals, KPIs, Work | Eight rows: Cycle, Goals, KPIs, Initiatives, Board, Scorecard, Check in, Sessions | [registry.ts](../../packages/core/src/modules/registry.ts) |

The sidebar grew one row per screen as the screens shipped, and nothing ever
compared the result against §3. Eight rows is not a design; it is a changelog.

## 2. The fourth is deliberate and is the product

Drafting is blocked until the earlier phases pass. That is METHOD.md §2,
implemented in [phaseWorkAllowed](../../packages/method/src/workflow.ts#L1035),
and it is the reason this product is not a tracker. The FlowyTeam screen in the
complaint shows four key results at 100 per cent with no signal about whether
any of them was worth measuring. Copying that layout means copying that
silence.

**So the recommendation is: keep every gate, and move the door.** A member
should meet the refusal on the screen where they looked for the action, with
the reason and the link that resolves it, rather than after three navigations.

## 3. Proposed structure

### 3.1 Sidebar, back to §3 plus one rename

| Block | Rows |
|---|---|
| (unlabelled) | Home, Review, Inbox, Search |
| OKR | Cycle, **OKRs** (today's Goals), KPIs |
| Work | Initiatives, Board |
| Spaces | Spaces |
| Account | unchanged |

Moves, not deletions:

| Row | Where it goes | Why it is still reachable |
|---|---|---|
| Check in | A button on OKRs, on the goal detail, and on Review | Review already lists every check-in owed and is the screen built to drive them |
| Sessions | A tab inside Cycle | Sessions belong to a cycle's cadence, phase 6 |
| Scorecard | Shown only when the points layer is on | It is off by default (REQUIREMENTS.md) and today it is a permanent row for a feature most workspaces never enable |

**Risk to check before building:** `apps/web/test/reachability.test.ts` asserts
the sidebar and the avatar menu agree with the registry. Every moved row needs
its new door asserted there, or a screen goes dark and no test notices.

**Drawn.** [12-okr-home](../stakeholder/mockups/png/12-okr-home.png) is the
list, [12b-okr-create](../stakeholder/mockups/png/12b-okr-create.png) is the
create action in both its states. Sources in
`docs/stakeholder/mockups/src/`. They illustrate this proposal and nothing
else: no specification cites them, and they are deleted if this is rejected.

### 3.2 OKRs becomes the screen the complaint asked for

```
OKRs                                    [Q3 2026 v]   [+ New objective]
────────────────────────────────────────────────────────────────────────
[ Mine ] [ My team ] [ Company ]                         [Filter] [Tree]
────────────────────────────────────────────────────────────────────────
  Ship the onboarding rebuild                    on track   68%  ▓▓▓▓▓░░
  Priya champions it, Ada reviews it             Q3 2026
    Key results
    ◉ New accounts reaching value in 7 days, 40 to 70     62%  ▓▓▓▓░░░
    ◉ Median time to first value, 14 to 5 days            80%  ▓▓▓▓▓▓░
    + Add a key result
────────────────────────────────────────────────────────────────────────
```

Three things this borrows from FlowyTeam, none of which cost a rule:

1. One screen holds the objectives and their key results together.
2. The level filter is a tab row, not a filter menu. Mine, My team, Company
   map to the `level` column that already exists.
3. `+ Add a key result` sits under the key results it adds to.

Three things it does not borrow:

1. The strength meter and the rule verdicts stay. A key result added here runs
   the same quality checks as one added on S-09, because both call the same
   pure functions in `packages/method`.
2. `+ New objective` respects the phase gate. When drafting is closed it opens
   a panel that says which phase is incomplete and what it needs, with a link.
   It does not hide, and it does not silently fail.
3. Publish gates are untouched. This screen writes drafts; S-10 still publishes.

### 3.3 Goal detail gains the same add action

S-14 lists key results with inline value and confidence editing and no way to
add one. The same `+ Add a key result` row closes it.

## 4. Acceptance criteria

```
Given a member with edit rights and an open drafting phase
When they open OKRs and press + New objective
Then the objective form opens on that screen
And the objective is created in the current cycle
And the quality verdicts render as they type, from packages/method
```

```
Given a member with edit rights and phase 2 incomplete
When they press + New objective
Then the action is offered, not hidden
And the panel names phase 2 and what it still needs
And it links to /cycle?phase=2
And no objective is written
```

```
Given an objective with two key results
When the member uses + Add a key result
Then the new key result is checked by the same rules as one added on S-09
And a failing rule is shown before it is saved
```

```
Given the points layer is off
When the sidebar renders
Then Scorecard is absent
And every other screen in the registry is still reachable from the sidebar
or the avatar menu, as reachability.test.ts asserts
```

## 5. What changes in the plan set if this is approved

| Document | Change |
|---|---|
| UIUX-PLAN §3 | The sidebar table above replaces the ASCII block, and `+ New` is specified rather than implied |
| UIUX-PLAN §6 S-13 | Rewritten around tabs, inline key results, the create action and the blocked-phase panel |
| UIUX-PLAN §6 S-14 | Gains the add-a-key-result row |
| IMPLEMENTATION-PLAN | New tasks. Four look right: the sidebar regroup with its reachability assertions, the OKRs screen, the create-and-blocked-panel behaviour, the goal detail row |
| METHOD.md | Nothing. That is the point of this shape |

## 6. Open questions for the human

1. **Rename Goals to OKRs?** The product calls them goals everywhere, including
   the workspace terminology settings that let a workspace rename them. A
   sidebar row saying OKR and a screen saying goal is the kind of split that
   makes people ask which is which.
2. **Mine, My team, Company as tabs.** `level` has four values, the fourth
   being `department`. Three tabs need a rule for where department objectives
   appear. Suggestion: My team covers `team` and `department`.
3. **Check in as a row or a button.** Removing the row is the biggest single
   reduction and also the most likely to be missed by somebody who has learned
   where it is.
4. **Does this belong in v1 or after the first release?** It is interface work
   with no schema change, so it can land late. The counter-argument is that
   first impressions of an OKR product are formed on exactly this screen.
