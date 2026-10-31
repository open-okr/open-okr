# Role homes

Source: the OKRGoal UX review (`docs/audits/okrgoal-ux-habit-review-2026-10-13.md`, "Role plans" and backlog row 12): "Give each role its own home ('My week') instead of showing everyone the company Work Map." Agung decided on 30 October 2026 that the review is priority one. This changes UIUX-PLAN.md S-01.

## 1. Who sees what on Home

| Reader | Home shows, top to bottom |
|---|---|
| Every member | **My week**: the open goals they champion as cards, most overdue first. Each card has the health, the due date as a day ("Mon", "9 Nov"), its key results with their value lines, and one action: Check in when due or within two days, Post an update otherwise. Their own streak sits under the heading |
| A reviewer with acknowledgements owed | **Waiting for your acknowledgement**: each check-in with the first line of what it says, Acknowledge all from two up, and a link to Updates |
| Administrators, space coordinators and managers | **The cockpit**: Rhythm by team (each space's open goals not past due, weakest first), then the Work Map as it was: phase and gates, the numbers, the scope tabs and the company tree |
| Everybody else | A link to the company map |

The company tree is the Map tab of Goals (`/map`) for everybody. Its first-visit tour goes with it.

## 2. Rules

- Deterministic. Nothing on Home needs the AI provider.
- Reads only, through the actions every member already has: `goals.list` with `mine`, `goals.myStreak`, `review.inbox`, `spaces.list`, `cycles.current`.
- The week is the champion's because METHOD.md §2.5 puts the check-in on the champion.
- "Who runs the cycle" is the same rule that draws Cycle in the sidebar (`lib/cycle-visibility.ts`).

## 3. Acceptance criteria

- **Given** a member who champions two open goals, one overdue, **when** Home opens, **then** "My week" lists the overdue one first with Check in, and the other with Post an update.
- **Given** a reviewer owing two acknowledgements, **then** Home shows both with their first line and offers Acknowledge all.
- **Given** an administrator, **then** Home shows My week as a second-level heading, Rhythm by team, and the Work Map with its own first-level heading.
- **Given** an ordinary member, **then** Home shows no Work Map and links to `/map`, which shows it with the Goals tabs.

## 4. Tests

| Test | Where |
|---|---|
| The week's order and actions, the rhythm rows | `apps/web/test/my-week.test.ts` |
| The tour and the tree moved with the map | `apps/web/test/onboarding.test.ts`, `apps/web/test/space-home-work.test.tsx` |
| `/map` renders inside the shell | `e2e/s42-route-coverage.spec.ts` |

## 5. Not done here

- A reaction or a comment on each digest row: the row links to the check-in, where comments already are.
- A sponsor's monthly read, which the review names as a later role.
