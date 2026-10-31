# Navigation in five areas

Source: the OKRGoal UX review (`docs/audits/okrgoal-ux-habit-review-2026-10-13.md`, findings N1 to N3, backlog row 13). Agung decided on 30 October 2026 that the review is priority one and the specification follows it. This document changes UIUX-PLAN.md §3.

## 0. What exists

| Today | Count |
|---|---|
| Sidebar rows: Overview, Inbox, Review, Search, Cycle, OKRs, KPIs, Initiatives, Board, Spaces, five account rows, Admin | 15, 16 for an admin |
| Labels | Shown from 1280 px; 768 to 1279 px is icon-only, with no hover label |
| Search | In the sidebar and in the top bar (⌘K) |
| Account rows | In the sidebar and in the avatar menu |
| Phase strip | Every member at view level or above, while the cycle is in planning |

## 1. Decision

| Area | Sidebar row | Opens | Tabs on the page | Who sees it |
|---|---|---|---|---|
| Home | Home | `/` | none | Everyone. Becomes "My week" with the role homes (backlog 12) |
| Updates | Updates | `/review` | To do (`/review`), Activity (`/inbox`) | Everyone. One badge: what is owed plus what is unread |
| Goals | Goals | `/goals` | OKRs (`/goals`), KPIs (`/kpis`) | Everyone |
| Work | Work | `/initiatives` | Initiatives (`/initiatives`), Board (`/board`) | Everyone |
| Teams | the workspace's term for spaces, plural | `/spaces` | none | Everyone |
| Cycle | Cycle | `/cycle` | as today | Workspace administrators, and members who are a coordinator or manager of any space |

| Moved | To |
|---|---|
| Search | The top bar only. The palette still offers the page |
| Where to reach you, Security, API tokens, Connected apps, Your AI keys | The avatar menu only, as "Settings" items |
| Admin | The avatar menu, "Workspace admin", for those who reach it |
| Inbox, Review | One area, Updates, as two tabs |
| KPIs | A tab of Goals |
| Board | A tab of Work. Initiatives and tasks stay separate objects; the review's "one object, two views" would merge two tables and is not done here |
| The phase strip | Shown only to the people who see Cycle |

Group headings go: five rows need none. The sidebar link carries a `title`, so its label shows on hover where the sidebar is icon-only.

## 2. Rules

- Routes do not move. Every old URL still opens the same screen, so links in mail, chat and bookmarks keep working.
- The registry stays the one list. The account rows keep their registry entries, read by the avatar menu and the palette, and are no longer drawn in the sidebar. The hidden rows become `inside` items of the area that holds them, so the palette still offers them and the area row lights when one is open.
- "Who sees Cycle" is a visibility rule, not access: `/cycle` still opens for anybody at view level who types it, as it does today.
- A renamed term still renames: a workspace that calls a space a team reads Teams.

## 3. Acceptance criteria

- **Given** a member, **when** any screen opens, **then** the sidebar shows Home, Updates, Goals, Work and the spaces term, in that order, and no account rows, no Search and no Admin.
- **Given** a workspace administrator or a space coordinator or manager, **then** the sidebar also shows Cycle, and the phase strip shows while the cycle is in planning; **given** anybody else, neither shows.
- **Given** `/inbox` is open, **then** the Updates row is active and the page shows the To do and Activity tabs with Activity current.
- **Given** a reviewer owes 2 and has 3 unread, **then** the Updates row's badge reads 5.
- **Given** the avatar menu is opened by an administrator, **then** it lists the account rows and "Workspace admin".
- **Given** the sidebar is icon-only, **then** hovering a row shows its label.

## 4. Tests

| Test | Where |
|---|---|
| Sidebar rows and order, inside parents, account rows not drawn | `apps/web/test/nav-groups.test.ts`, `packages/core/test/modules.test.ts` |
| Who sees Cycle | `apps/web/test/cycle-visibility.test.ts` |
| Area tabs | `apps/web/test/area-tabs.test.tsx` |
| The More sheet and the Inbox badge | `e2e/s01-mobile-navigation.spec.ts`, `e2e/s03-inbox.spec.ts` |

## 5. Not done here

- "My week", the team digest and the champion cockpit: backlog 12, the next change.
- Renaming the default term for a space to "team": a terminology default, left to each workspace.
- Merging initiatives and tasks into one object.
