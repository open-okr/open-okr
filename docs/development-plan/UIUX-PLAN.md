# UIUX-PLAN.md

Design authority for `OpenOKR`'s user interface. Every UI task in IMPLEMENTATION-PLAN.md must cite the relevant section here; if a screen or pattern is not specified here, the agent asks a human instead of inventing. When implementation deviates, update this doc in the same PR.

Why this doc exists: The legacy system's UI is its weakest point (heavy Angular pages, modal-heavy editing, reload-based updates, weak mobile). OpenOKR must feel like a modern tool (Linear/Notion/Height class) while keeping that depth.

---

## 1. Design principles (ranked)

1. **Fast is the feature.** Every interaction obeys the budgets in TECHNICAL-PLAN.md §13. Optimistic UI by default; the network is invisible.
2. **Inline over modal.** Edit in place wherever the value lives. Modals only for create-with-context, destructive confirmation, and pickers that need real estate.
3. **Keyboard-first, mouse-friendly.** Everything reachable via ⌘K and shortcuts; nothing only reachable via keyboard.
4. **Progressive depth.** Simple by default, powerful on demand: a new team sees a clean task list; a PMO can open the same list and add grouping, sums, baselines.
5. **Never lose work.** Drafts persist (comment boxes, descriptions survive navigation/refresh); destructive actions get undo toasts, not confirm dialogs, wherever reversible.
6. **States are designed, not defaulted.** Every view ships loading (skeleton), empty (guidance + primary action), error (retry + support info), and permission-denied states.
7. **One design system.** Only `packages/ui` components; no one-off styles. Density, radius, spacing come from tokens.

## 2. Foundations

- **Component base:** shadcn/ui on Tailwind, extended in `packages/ui`. **Base UI** primitives for a11y behavior — shadcn/ui is configured against its **Base UI** registry, not Radix. All accessible behavior (focus management, dismissal, ARIA wiring, keyboard) comes from Base UI components; do not add Radix or another primitive library alongside it. Any component that needs a primitive not yet in Base UI is raised to the human, not swapped to Radix.
- **Animated components:** **SmoothUI** (smoothui.dev) is the animation component layer, added through the shadcn registry and **vendored** (source copied) into `packages/ui` — never loaded from an external host at runtime, so the air-gap rule (REQUIREMENTS §5) holds. SmoothUI is built on **Motion** (the `motion` package, ex-Framer Motion), which is the one approved animation runtime; no other animation library. The layers compose: **Base UI** provides behavior + a11y, **SmoothUI/Motion** provides motion, tokens provide the look. When a SmoothUI component ships its own interactive behavior, wrap or back it with the matching Base UI primitive so a11y is never lost to animation. Animations must run under the **nonce-based strict CSP** (TECHNICAL-PLAN §8.2) without `unsafe-inline` — Motion animates via the CSSOM/`element.style`, which is compatible; verify no component injects an inline `<style>` that would need `unsafe-inline`.
- **Adding components (dev tooling):** use the **shadcn MCP** to pull components from the shadcn (Base UI) and SmoothUI registries into `packages/ui`, then adapt to tokens. Initialize once per the repo README: `npx shadcn@latest mcp init --client claude`, with the shadcn/Base-UI and `https://smoothui.dev` registries configured. The MCP is a build-time convenience only; it adds no runtime dependency and no runtime network call.
- **Typography:** Inter (self-hosted, air-gap safe). Scale: 12/13/14 (base)/16/18/24/30. Tabular numerals for tables.
- **Spacing:** 4 px grid. Density mode: `comfortable` (default) and `compact` (tables −4 px vertical padding); user preference, stored per user.
- **Color:** neutral gray ramp + one brand hue (workspace-themable: a single brand color + auto-derived shades stored in workspace settings; replaces the legacy system's custom_styles). Semantic tokens: `success`, `warning`, `danger`, `info`. Status/type/priority colors imported from the legacy system `colors` stay user-editable.
- **Dark mode:** first-class from day one (`class` strategy, token pairs). Every component ships both. User preference: light / dark / system.
- **Icons:** Lucide. Entity iconography fixed early: project, work package (per type: task/milestone/phase/bug/feature/epic), board, sprint, wiki, meeting.
- **Motion:** delivered with **SmoothUI on Motion** (`motion/react`). 120–200 ms ease-out for micro-transitions; none on data-heavy re-renders (no entrance animations on virtualized rows/cards); respects `prefers-reduced-motion` (reduced motion disables non-essential transitions, keeping only opacity/instant state). Motion must never gate content on an animation finishing, and never block a performance budget in §13.1.
- **Elevation:** flat surfaces + 1 px borders; shadows only for overlays.

## 3. App shell and navigation IA

```
┌────────────┬──────────────────────────────────────────────┐
│  Sidebar   │  Topbar: breadcrumb · search(⌘K) · + New ·   │
│            │          notifications · avatar               │
│  Home      ├──────────────────────────────────────────────┤
│  Inbox     │                                              │
│  My work   │                Content area                  │
│  ────────  │      (list / detail / split / canvas)        │
│  Favorites │                                              │
│  Projects  │                                              │
│   ▸ Proj A │                                              │
│     Work   │                                              │
│     Board  │                                              │
│     Gantt  │                                              │
│     ...    │                                              │
│  ────────  │                                              │
│  Admin     │                                              │
└────────────┴──────────────────────────────────────────────┘
```

- **Sidebar (global):** Home (dashboard), Inbox (notification center with unread badge), My work (assigned/created/watched tabs), **Strategy** (OKRs, KPIs, Check-ins, Alignment, Scorecard — permission-gated, S-16/S-19/S-21/S-18/S-22), Favorites (starred projects/views, drag-reorderable), Projects (tree, expandable; per-project sub-nav shows only enabled modules), Admin (permission-gated). The **Strategy** section carries a cycle switcher shared across its screens.
- **Project sub-nav order:** Overview, Work packages, Board, Gantt, Backlog (if enabled), Calendar, Team planner, Wiki, Meetings, Time & costs, Settings. Saved views pin beneath the module they belong to (replaces the legacy system query menu items).
- **Topbar:** breadcrumb `Workspace / Project / View`; global search field (focuses with `/`, full palette with ⌘K); `+ New` quick-create (work package from anywhere, project, meeting); an **Ask AI** entry point (⌘J) opening the copilot (S-25) when a provider is configured; notification bell (live badge via Realtime); avatar menu (profile, preferences, theme, language, sessions, sign out).
- **Command palette (⌘K):** actions ("Create work package", "Go to project…", "Toggle theme"), entity jump (fuzzy search WPs by #id/subject, projects, wiki pages), recent items. Powered by the Search port + client-side recents. This is a P0-class differentiator (P3-T32).
- **Responsive:** ≥1280 full; 768–1279 collapsible sidebar (icons); <768 bottom tab bar (Home, My work, Inbox, Search) + drawer; tables become card lists via the same query definition; boards get horizontal snap-scroll columns with touch drag.
- **URLs are share-stable:** every view state that matters (query id or inline DSL, selected WP, board, zoom) lives in the URL. Deep links always restore the exact view.

## 4. Interaction patterns (the contract for every feature task)

| Pattern | Rule |
|---|---|
| Optimistic updates | Mutate UI immediately; rollback + toast on server reject; `CONFLICT` (stale lockVersion) → auto-refetch, reapply if clean, else inline conflict banner with "their change / your change" |
| Inline edit | Click-to-edit on: subject, status (dropdown), assignee (picker), dates (range picker), priority, version, custom fields — in tables, detail view, and board cards. Esc cancels, Enter/blur commits |
| Undo | Deletes, bulk edits, drag moves show a 6 s undo toast instead of confirm dialogs. Hard-confirm only for irreversible destruction (project delete types the identifier) |
| Drafts | Comment/description editors autosave drafts locally (per entity, per user); restored on return; cleared on submit |
| Empty states | Icon + one sentence + primary action + docs link. First-run empties may embed a 3-step mini-checklist |
| Loading | Skeletons matching final layout (no spinners on full surfaces); stale-while-revalidate keeps old data visible with a subtle refresh indicator |
| Errors | Inline field errors from Zod; surface-level error card with retry; never a blank screen; error boundary per route segment |
| Keyboard | Global: ⌘K palette, `/` search, `c` new WP (in project), `g` then `b/g/w` go to board/gantt/work. List: `j/k` move, `x` select, `e` edit, `⌘⏎` save. Detail: `[`/`]` prev/next. Shortcuts help: `?` overlay |
| Presence | Realtime: avatar stack on WP detail/board ("who's here"), typing indicator on comments. Foundation for future co-edit (PLAN.md §7) |
| Notifications | In-app first: bell badge updates live; Inbox groups by project/WP with reason chips (mentioned/assigned/watched/date alert); mark-read on view; email respects per-user settings + digest |
| Bulk actions | List multi-select → floating action bar (edit fields, move, delete, export selection) with per-item permission awareness |
| Rich text | One editor everywhere (TipTap-class, Markdown storage): slash commands (/heading, /table, /wp to link a work package), @mentions, ##1234 WP autolink, paste-to-upload attachments, code blocks. Macros from the legacy system render read-only with a "legacy macro" chip (importer note, data-model §9) |
| Date handling | All dates workspace-timezone aware; pickers highlight non-working days (from P3-T11 calendar) and warn when a pick violates scheduling constraints |
| Confirmation of scheduling effects | When an edit reschedules other WPs (follows-chain), show a preview popover: "This moves 3 work packages" with expand list, before commit (fixes the legacy system's silent cascades) |
| AI assist affordance | A ✨ action sits beside the value it helps with (objective, KR, KPI, WP subject, comment box, query). Click runs the assist, streams, and returns a **proposal** the user applies or dismisses. Shown only where a provider is configured and the feature is on (AI-NATIVE-PLAN.md §2/§4) |
| AI preview before apply | Every AI *write* renders as a preview or diff ("current → suggested") with Apply/Dismiss; applying goes through the normal mutation layer so optimistic UI, undo, and audit all work. AI output is never auto-committed |
| AI provenance + undo | AI-generated or AI-edited values carry an "AI" chip and a normal undo toast; the source and model are recorded (AI-NATIVE-PLAN.md §7) |
| Copilot (agentic) | ⌘K and the topbar expose "Ask AI"; the copilot answers in a SidePanel (S-25), streams with a Stop control, cites only what the user may see, and proposes any action for confirmation |
| Cost/limit transparency | When a quota or cost cap is near or hit, the affordance shows the remaining budget and, on hit, disables with a clear message while manual paths continue |
| AI degradation | With AI `off` or the provider unreachable, every ✨/copilot affordance is hidden or disabled and the manual path is unchanged — no dead buttons, no errors |

## 5. Component inventory (`packages/ui`)

Beyond stock shadcn: `DataTable` (virtualized, TanStack Table: column resize/reorder/pin, group headers with sums, inline-edit cells, row selection, keyboard nav), `EntityPicker` (user/group, WP, project, version — async, recent-first, avatars), `FilterBar` (chip-based filter builder bound to the query DSL; add/edit/remove filter chips, operator dropdowns per field type), `ViewSwitcher` (table/board/gantt/calendar tabs on a query), `StatusBadge`/`TypeIcon`/`PriorityFlag` (color-token driven), `AvatarStack` (+N overflow, presence ring), `RichTextEditor` + `CommentComposer`, `DateRangeField` (working-day aware), `GanttCanvas` (virtualized rows, dependency arrows, drag handles), `BoardColumn` (virtualized cards, drop zones, WIP count), `ProgressRing/Bar` (done_ratio, budgets), `EmptyState`, `SkeletonTable/Card`, `KbdHint`, `Toast+Undo`, `SidePanel` (split-view container with resize), `CommandPalette`, `NotificationItem`, `AuditLogRow`, `Timeline` (activity feed), `MetricTile` (dashboards).

Each component gets a Storybook-style preview page (Ladle or Storybook — human picks, PLAN dependency rule) with light/dark and states; components are tested for keyboard + screen-reader behavior at build time.

## 6. Screen specifications (S-01…S-25)

Format: purpose · layout · primary actions · states · notes. IDs referenced by tasks. S-01…S-15 are the work-management and platform screens; S-16…S-23 are the Strategy screens (OKR / KPI / check-ins, built in Phase 4 — schema in TECHNICAL-PLAN.md §4.12); S-24…S-25 are the AI screens (admin AI console + copilot, built in Phase 5 — scope in AI-NATIVE-PLAN.md §4/§6). Inline AI assists live inside existing screens (S-16/S-17 for OKR, S-02 for work packages, S-10 wiki, S-11 meetings). All obey the §4 patterns and §9 gates equally.

### S-01 Work package list (table)
The core screen. Layout: FilterBar + ViewSwitcher header; virtualized DataTable; right SidePanel opens on row click (split view) without losing scroll; URL carries query + selected WP. Actions: inline edit cells, multi-select bulk bar, column config drawer, group-by with collapsible groups + sums, save view (private/public), export menu, ⌘K quick-jump. States: skeleton table; empty "No work packages match — clear filters / create one"; error retry. Notes: hierarchy mode indents parents with expand carets; drag-to-reparent within hierarchy mode; baseline chip when comparing (P2 feature slot).

### S-02 Work package detail (split + full)
Split panel (default) and full page (`⌘⇧F` expands). Header: type icon + editable subject + status pill + ⋯ menu (watch, share, copy link, move, delete-with-undo). Two-column body: left = description (rich editor), activity feed (comments interleaved with changes, filterable: all/comments/changes), comment composer with internal-comment toggle (permission-gated); right = attribute rail (status, assignee, dates via range picker, priority, version, story points, custom fields by section, watchers avatar stack, attachments dropzone, linked GitHub/GitLab items, relations list with add-relation picker showing blocks/follows badges). Presence avatars top-right. `[`/`]` navigate list order. States: not-found (deleted → offer restore if within undo), no-permission (minimal card).

### S-03 Board
Column header: name + count + WIP indicator + column menu. Virtualized cards: type icon, #id, subject, avatar, due chip (red when overdue), priority flag, story points. Drag: card between columns (optimistic, mutates keyed attribute), card within column (manual order), column reorder. Board switcher dropdown + "New board" wizard (pick type: free/status/assignee/version/subproject/parent). Live updates via Realtime: cards move for everyone; presence stack in toolbar. Empty column: ghost "Drop here or + Add".

### S-04 Gantt
Left: mini WP table (subject, dates, assignee — resizable). Right: GanttCanvas timeline with zoom (day/week/month/quarter, ⌘scroll), today line, non-working-day shading, milestone diamonds, dependency arrows (click arrow to select/delete relation), drag bar = move dates, drag edge = resize duration, drag between bars = create follows relation (with preview popover per §4 scheduling confirmation). Baseline overlay slot (P2). Auto vs manual scheduled bars visually distinct (solid vs outlined).

### S-05 Project overview
Widget grid (drag/resize, edit mode toggle): description, status card (traffic light + explanation), members, recent activity, WP status donut, milestones/versions upcoming, time logged this week, custom project attributes by section (inline-editable with permission). "Customize" enters edit mode; widget catalog drawer.

### S-06 My work + Home
Home: greeting, favorites row, recent items, workspace activity highlights, "resume where you left off". My work: tabs Assigned / Created / Watched / Recently viewed, each a saved query using S-01 table in compact density.

### S-07 Inbox (notifications)
Two-pane: left list grouped by WP/project with reason chips + unread dots, right preview renders the target (WP split view embedded). Actions: mark read/unread, mark all, filter by reason/project, mute WP. Live insert on new notification; date-alert items show due badge. Settings link → per-project matrix editor (S-13).

### S-08 Global search + palette
⌘K overlay: input, scoped tabs (All / Work packages / Projects / Wiki / People), results grouped with highlights, footer key hints. `/` focuses inline topbar search with same backend. Full results page for "see all" with filters. Recent + frequently visited boost ranking (client-side recents + server score).

### S-09 Sprint backlog (P1, backlogs)
Two stacked virtualized lists: Sprint (with capacity header: story points sum vs velocity hint, dates, sprint goal editable) and Product backlog; drag between them; rank = manual order; burndown sparkline in sprint header expanding to chart; "Start/Complete sprint" actions with confirm summarizing scope.

### S-10 Wiki (P1)
Left page tree (drag to reorganize, permission-aware), breadcrumb, page body (rich editor with /toc), page actions (history diff viewer, watch, move, export PDF), backlinks panel ("linked from"). Slug conflicts resolved with redirect creation (parity with wiki_redirects).

### S-11 Meetings (P1)
List (upcoming/past, recurring series grouped) → meeting page: header (time, location/URL, participants with invite status, ICS buttons), agenda sections + items (drag order, duration chips with over-time warning, per-item notes, link WP), outcomes per item, "Close meeting" locks minutes + emails summary. Recurring editor: RRULE builder with plain-language preview ("Every 2 weeks on Tuesday").

### S-12 Time & costs (P1)
My timesheet week grid (rows = WPs, cells = hours, keyboard-entry optimized) + running timer widget in topbar (start from any WP ⋯ menu; one active timer; stop → prefilled log form). Project cost view: table by user/activity/type with permission-scoped rate columns; export.

### S-13 Settings & admin screens
Consistent two-level pattern: left section nav, right content cards with save-per-card. Workspace admin: General, Members & roles (matrix editor: roles × permissions grid with search + diff-on-save summary), Types (list → form-config editor: drag attributes into groups, per-type), Statuses, Workflows (matrix: from-status × to-status per type+role with copy-from), Custom fields (list + builder with live preview, per-format options), Working days & holidays (calendar editor with reschedule-warning), Authentication (providers, MFA policy, session/rate settings), Notifications defaults, Audit log (filterable table + export), Backups, Branding (logo, brand color with live preview, dark-mode check). Project settings: Info & attributes, Modules, Members, Versions, Categories, Backlog settings, Storages. Every destructive admin action audit-logged with actor.

### S-14 Auth screens
Sign in (email+password, passkey button, SSO buttons when configured, MFA step, lockout messaging with retry-after), registration (if enabled) with email verify, invite-accept (name+password/passkey set), forgot/reset. Clean single-card layout, workspace branding, language switcher visible pre-auth.

### S-15 Onboarding (first-run)
After first login as Owner: 3-step guided setup (name workspace + brand color → invite teammates (skippable) → create first project from template gallery or import banner "Coming from the legacy system? Run the importer" linking docs). Sample project offer ("Explore with demo data") using the seed. Per-user first-visit: 4-stop product tour (sidebar, ⌘K, create WP, inbox), dismissible, never auto-repeats.

### S-16 OKR explorer
The Strategy home. Layout: scope tabs (Company / Team / Personal) + cycle switcher + FilterBar (owner, status, confidence); virtualized list/tree of objectives, each row = title, owner avatar/chip, weight, progress bar with RAG color, confidence chip, status pill (completed/on track/at risk/not tracked), KR count. Group-by owner with collapsible groups. Actions: inline weight/confidence edit, quick check-in, `+ New objective` (owner + cycle context), open detail in SidePanel (split view), move-OKR menu, export. States: skeleton; empty "No objectives in this cycle — create one / switch cycle"; error retry. Notes: alignment indent when tree mode on; drag-to-realign within tree.

### S-17 Objective detail (split + full)
Header: title (inline edit) + owner + cycle + score ring (result %) + status pill + ⋯ menu (watch, move, copy, delete-with-undo). Body: left = description (rich), key results list (each with inline value/confidence check-in, unit, weight, progress bar, direction hint, KPI-backed badge when linked), check-in history, threaded discussion + composer; right = attribute rail (owner, lead, cycle, weight, confidence, parent alignment (objective/KR) with picker, child objectives rolled up, linked work packages, watchers). Presence avatars. States: not-found (restore if within undo), no-permission card.

### S-18 Alignment diagram
The cascade tree company → team → individual, laid out from `parent_objective_id`/`parent_key_result_id`. Pan/zoom canvas, node = objective card (title, owner, progress ring, RAG), edges show alignment; collapse/expand branches; click a node → S-17 in SidePanel. Toolbar: cycle switcher, scope filter, layout (vertical/horizontal), display lock. Keyboard: arrow to traverse, Enter to open. Empty: "No aligned objectives yet". Performance: virtualize off-screen nodes.

### S-19 KPI board (grid)
KPIs as rows, periods as columns (frequency-driven, scrollable window). Each cell = actual/target with RAG background; inline entry (keyboard-optimized, Enter commits, arrows move); row header = KPI title, category chip, owner, unit, direction icon, trend sparkline. Group-by category with subtotals. FilterBar (frequency, owner, category, RAG). Actions: `+ New KPI`, record entry, open detail. States: skeleton grid; empty; error. Notes: calculated KPI cells are read-only with a formula chip; editing a source cell updates dependents live.

### S-20 KPI detail + tree + formula editor
Header: title + category + owner + current RAG. Body: period chart (actual vs target over time, RAG bands), parent/child KPI tree, records table (editable). For calculated KPIs: a visual formula builder — drag KPI references and operators into an expression, pick the aggregation function per source, live preview of the resolved value; validation errors inline. States + no-permission as standard.

### S-21 Check-in flow
A guided session for the current period: optional mood, then a stepper over the user's objectives and key results — each step shows current value/progress and asks for new value (KR), confidence (0–10 slider with RAG preview), a remark (rich), and a category (challenge/blocker/risk/suggestion/solution/resource-request). Progress indicator, save-draft, submit. Manager view: list of submitted check-ins with a review composer and "reviewed" toggle. Empty: "Nothing to check in this period". Notes: autosaves drafts (§4 Drafts); confidence changes preview the resulting status.

### S-22 Scorecard
Per owner (person/team) per cycle: header (owner, cycle, result value ring), RAG bucket tiles (objectives + key results counts by completed/on-track/at-risk/not-tracked), a trend across cycles, and — only when points are enabled — a points breakdown (OKR/KPI/tasks/attendance contributions). Filter by owner/cycle; export CSV/PDF. Empty when a cycle is not yet archived: "This cycle has not been archived".

### S-23 OKR/KPI settings & cycles (admin)
Two-level settings pattern (as S-13): cadence + quotas (max objectives/KRs), RAG thresholds (fail/pass with live preview), term labels (okr/objective/keyresult/kpi/task/vision), level enablement (company/team/personal), cycle management (list + create/archive/generate-next with an archive-warning), scorecard/points toggle (**off by default**), and the OKR/KPI permission matrix editor. Every change audit-logged.

### S-24 AI settings & agents (admin)
The AI console (AI-NATIVE-PLAN.md §4), two-level settings pattern (as S-13), permission `manage_ai`. Cards: **Provider & connection** (provider dropdown incl. Ollama / OpenAI-compatible, base URL, masked key with **Test connection**, allow-user-keys toggle); **Models & routing** (tier→model map validated against the live model list, per-tier temperature / max-tokens / JSON-mode); **Features** (a switch per capability from §2, default-on where a provider is set); **Budgets & limits** (token / cost / call quotas, hard cost cap, throttle); **Prompts** (versioned system prompt per feature, restore-to-default, live variable list); **Privacy & governance** (context-egress level, PII redaction, no-train header, egress allow-list, per-workspace opt-out — greyed with a "zero egress" note for local providers); **MCP & agents** (enable server, mint / rotate / revoke scoped tokens with per-token scope + rate limit, connected-agents list with last-used + audit link); **Usage & logs** (token / cost dashboards by user / feature / model / period, request log with truncated payloads + flag-misuse, latest eval results). States: skeleton; provider-not-configured empty ("Add a provider to enable AI, or leave it off"); connection-error card. Every change audit-logged.

### S-25 AI copilot
A SidePanel (⌘J, or "Ask AI" in the topbar/palette) available across the app, scoped to the current workspace and, when opened from an entity, that entity. Body: a thread of turns (user / assistant / tool), streaming assistant output with a **Stop** control, and inline **action proposals** — each a preview/diff card with Apply/Dismiss that commits through the normal mutation layer (§4 AI preview). Grounded answers cite source entities the user may see (links open S-02 / S-17 / etc.); citations never expose records the user cannot access. Composer: prompt box with entity mentions (`##id`, `@user`, objective/KR), suggested prompts, and a model/tier hint. States: empty ("Ask about your OKRs, projects, or a work package"); AI-off ("AI is disabled for this workspace", with a link to S-24 for admins); rate-limited / cost-capped notice. Obeys §9 gates (keyboard, reduced motion, dark mode) and never gates content on an animation.

## 7. Accessibility standard (WCAG 2.1 AA)

- Semantic landmarks; one `h1` per page; focus outlines always visible; focus trapped in overlays and returned on close.
- All interactive elements keyboard operable incl. drag alternatives (move-via-menu on cards/gantt bars: "Move to column…", "Set dates…").
- Contrast ≥ 4.5:1 text, ≥ 3:1 UI; status/type colors never the sole signal (icons/labels accompany).
- Live regions for toasts, realtime list changes, notification badge.
- Virtualized lists expose `aria-rowcount`/`aria-rowindex`; tables have proper header associations.
- Forms: label + description + error wired via `aria-describedby`; Zod errors announced.
- Automated axe checks in Playwright on every screen spec above (P6-T06 formal audit).

## 8. i18n & localization

- ICU MessageFormat catalogs (`en` source, `ms` at launch; `id` seeded from the legacy system's crowdin base as a bonus, per feature inventory §7); no concatenated strings; all dates/numbers via `Intl` with workspace timezone + user locale.
- Language: per-user setting + pre-auth switcher; instance default in workspace settings.
- Pseudo-locale build check catches hardcoded strings in CI; keys namespaced per module.
- RTL not required for v1; avoid direction-dependent CSS anyway (logical properties).

## 9. UX quality gates (added to every UI task's QA)

- [ ] Matches the screen spec section cited by the task (or spec updated in same PR).
- [ ] Loading, empty, error, no-permission states implemented and visually checked.
- [ ] Dark mode + compact density verified.
- [ ] `prefers-reduced-motion` honored: SmoothUI/Motion animations reduce to opacity/instant; no content is gated on an animation finishing; no entrance animation on virtualized rows/cards.
- [ ] Keyboard path for every action; shortcuts registered in the `?` overlay.
- [ ] Optimistic update + conflict path exercised (where mutating).
- [ ] Mobile breakpoint behaves per §3.
- [ ] axe scan clean on the changed screens.
- [ ] Strings in catalogs, none hardcoded; `ms` keys stubbed.
- [ ] Meets the §13 performance budget relevant to the surface (spot-check with seeded data).
- [ ] Any AI affordance on the screen is hidden/disabled when the provider is `off`; no AI value commits without the preview→apply step; AI-generated values carry provenance (AI-NATIVE-PLAN.md §2/§4).
