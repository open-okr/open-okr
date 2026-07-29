# UIUX-PLAN.md

Design authority for `OpenOKR`'s user interface. Every UI task in IMPLEMENTATION-PLAN.md cites a screen spec (S-xx) and the §4 interaction patterns here; if a screen or pattern is not specified, the agent asks rather than inventing. When implementation deviates, update this doc in the same PR.

Why this doc exists, and its stance: the product's edge over the benchmark (Operately) is **installed opinion, not configurability** (OPERATELY-COMPARISON.md Part 2). So the UI **leads with the opinionated path** — the Work Map, the review inbox, the check-in ritual, champion/reviewer — working with zero configuration. Power-user configuration (custom fields, configurable workflows, a query/view builder, Gantt) is a deferred "power floor" (REQUIREMENTS §6) and is explicitly *not* in the v1 screen set below. It must feel like a modern tool (Linear/Height/Notion class) while carrying real accountability.

---

## 1. Design principles (ranked)

1. **Opinion first.** The default screens impose the operating rhythm; there is no "configure your process" step before a user can work. Simplicity by default; depth on demand.
2. **Fast is the feature.** Every interaction obeys the budgets in TECHNICAL-PLAN §13. Optimistic UI by default; the network is invisible.
3. **Inline over modal.** Edit in place. Modals only for create-with-context, destructive confirmation, and pickers needing room.
4. **Keyboard-first, mouse-friendly.** Everything reachable via ⌘K and shortcuts; nothing *only* reachable by keyboard.
5. **Accountability is visible.** Staleness (`outdated`), who owns it (champion), who must review it (reviewer), and what you owe (the review inbox) are surfaced everywhere, not buried.
6. **Never lose work.** Drafts persist (fingerprinted against base content + TTL, so a stale draft never resurrects wrong); destructive actions get undo toasts, not confirm dialogs, wherever reversible.
7. **States are designed, not defaulted.** Every view ships loading (skeleton), empty (guidance + primary action), error (retry), and permission-denied states.
8. **One design system.** Only `packages/ui`; no one-off styles. Density, radius, spacing from tokens.

## 2. Foundations

- **Component base:** shadcn/ui on Tailwind, extended in `packages/ui`, configured against the **Base UI** registry (not Radix). All accessibility behavior (focus, dismissal, ARIA, keyboard) comes from Base UI. A primitive missing from Base UI is raised to the human, never swapped for Radix.
- **Animation:** **SmoothUI** (smoothui.dev), vendored into `packages/ui`, built on **Motion** (`motion/react`) — the one approved animation runtime. Runs under the nonce-based strict CSP (no injected inline `<style>`; Motion animates via CSSOM). When a SmoothUI component ships behavior, back it with the matching Base UI primitive so a11y is never lost.
- **Adding components:** the shadcn MCP pulls from the shadcn/Base-UI and SmoothUI registries into `packages/ui`, then adapt to tokens. Build-time only; no runtime dependency or network call (air-gap safe).
- **Typography:** Inter (self-hosted). Scale 12/13/14(base)/16/18/24/30. Tabular numerals in tables/grids.
- **Spacing:** 4 px grid. Density: `comfortable` (default) / `compact`; per-user.
- **Color:** neutral gray ramp + one workspace-themable brand hue (single color + auto-derived shades in workspace settings). Semantic tokens `success`/`warning`/`danger`/`info`. Status/health colors are token-driven and never the sole signal (icon + label always accompany).
- **Dark mode:** first-class (`class` strategy, token pairs). Every component ships both. Preference light/dark/system.
- **Icons:** Lucide. Entity iconography fixed early: goal, key result, KPI, project, milestone, work item, space, document, folder, file, link, agent.
- **Motion:** 120–200 ms ease-out micro-transitions; none on data-heavy re-renders (no entrance animation on virtualized rows/cards); respects `prefers-reduced-motion`; never gates content on an animation.
- **Rich text editor:** a TipTap-based editor (ProseMirror JSON storage — TECHNICAL-PLAN §1) is its own subsystem with a dedicated design doc (see S-26): slash commands, @mentions (contextually enabled only where a workspace/entity context exists), `##id` entity autolink, inline attachments (optimistic placeholder → progress → uploaded; submit blocked while uploading; delete-on-failure; image preview modal), code blocks, tables. Draft autosave keyed per entity+user, fingerprinted + TTL'd.

## 3. App shell and navigation

```
┌────────────┬──────────────────────────────────────────────┐
│  Sidebar   │  Topbar: breadcrumb · search(⌘K) · + New ·   │
│            │          Ask AI(⌘J) · notifications · avatar │
│  Home      ├──────────────────────────────────────────────┤
│  Review ●  │                                              │
│  Inbox     │                Content area                  │
│  ────────  │      (Work Map / list / detail / split)      │
│  Goals     │                                              │
│  Projects  │                                              │
│  KPIs      │                                              │
│  ────────  │                                              │
│  Spaces    │                                              │
│   ▸ Space  │                                              │
│  ────────  │                                              │
│  Admin     │                                              │
└────────────┴──────────────────────────────────────────────┘
```

- **Sidebar:** **Home** (the Work Map), **Review** (the "what I owe" inbox, with a live overdue badge — the highest-placed nav item after Home), **Inbox** (notifications), then **Goals**, **Projects**, **KPIs**, then **Spaces** (each a team home with its own goals/projects/docs), then **Admin** (permission-gated). A **workspace switcher** sits at the top for members of more than one workspace.
- **Topbar:** breadcrumb; global search (`/` focuses, ⌘K full palette); `+ New` (goal, project, work item, document, discussion from anywhere); **Ask AI** (⌘J → copilot S-25) when a provider is configured; the live notification bell; avatar menu (profile, preferences, theme, language, sessions, sign out).
- **Command palette (⌘K):** actions, entity jump (fuzzy by short-id/title across goals/projects/work items/docs/discussions), recent items — permission-filtered.
- **Responsive:** ≥1280 full; 768–1279 collapsible icon sidebar; <768 bottom tab bar (Home, Review, Inbox, Search) + drawer; the Work Map and lists become card lists; boards get horizontal snap-scroll with touch drag.
- **Share-stable URLs:** every view state that matters (filters, selected entity, board, map scope) lives in the URL and restores exactly. A stale-deploy version mismatch triggers a one-time "app updated — reload" toast (TECHNICAL-PLAN §13.2).

## 4. Interaction patterns (the contract for every feature task)

| Pattern | Rule |
|---|---|
| Optimistic updates | Mutate UI immediately; rollback + toast on reject; `CONFLICT` (stale version) → auto-refetch, reapply if clean else an inline "their change / your change" banner |
| Inline edit | Click-to-edit on title, status, assignee, dates, champion/reviewer, confidence, KR values — in lists, detail, and cards. Esc cancels, Enter/blur commits |
| Undo | Deletes, bulk edits, drag moves show a 6 s undo toast, not a confirm dialog. Hard-confirm only for irreversible destruction (delete a project types its name) |
| Drafts | Comment/description/check-in editors autosave locally per entity+user, fingerprinted against base content with a TTL; restored on return; cleared on submit |
| Empty states | Icon + one sentence + primary action + docs link; first-run empties may embed a 3-step mini-checklist |
| Loading | Skeletons matching the final layout; stale-while-revalidate keeps old data visible with a subtle refresh indicator (persisted cache, TECHNICAL-PLAN §13.2) |
| Errors | Inline Zod field errors; surface-level error card with retry; never a blank screen; error boundary per route segment |
| Keyboard | Global: ⌘K palette, `/` search, ⌘J Ask AI, `c` new (contextual). List: `j/k` move, `x` select, `e` edit, `⌘⏎` save. Detail: `[`/`]` prev/next. `?` shortcut overlay |
| Presence | Realtime avatar stack on detail/board/map ("who's here"); typing indicator on comments; foundation for future co-edit |
| **Staleness** | An `outdated` badge (amber, icon + label) renders on any goal/project past its check-in due date, overriding the last reported health color, in every list, the Work Map, and dashboards |
| **Accountability chips** | Champion and reviewer avatars render on goal/project rows and headers; a "needs your review" chip appears on a published check-in awaiting the viewer's acknowledgement |
| Notifications | Bell badge live; Inbox groups by entity with reason chips (mentioned/assigned/watching/review/due); mark-read on view; a compose-time "will notify X and N others" preview; email respects per-user settings + digest window |
| Rich text | One editor everywhere (S-26); slash commands, @mentions, `##id` autolink, paste-to-upload, code/tables; imported legacy content rendered read-only-safe |
| Dates | Workspace-timezone aware; contextual granularity (a goal can say "Q3 2026"); pickers show relative labels |
| AI assist affordance | A ✨ action beside the value it helps (goal, KR, KPI, check-in narrative, work-item title, comment). Runs the assist, streams, returns a **proposal** the user applies or dismisses. Shown only where a provider is configured and the feature is on |
| AI preview before apply | Every AI *write* renders as a preview/diff (current → suggested) with Apply/Dismiss; applying goes through the normal mutation layer so optimistic UI, undo and audit all work. Never auto-committed |
| AI provenance | AI-generated/edited values carry an "AI" chip + a normal undo toast; source/model recorded |
| Copilot | ⌘J / "Ask AI" opens the copilot side panel (S-25); streams with Stop; cites only what the user may see; proposes any action for confirmation |
| AI teammate presence | An agent member appears with an "AI" avatar badge in feeds, mentions, assignments and as a possible champion/contributor; its check-in and comment proposals surface in the review inbox (batch-approval) |
| Cost/limit transparency | When a quota/cap is near or hit, the affordance shows remaining budget and, on hit, disables with a clear message while manual paths continue |
| AI degradation | With AI `off` or the provider unreachable, every ✨/copilot/agent affordance is hidden or disabled and the manual path is unchanged — no dead buttons, no errors |

## 5. Component inventory (`packages/ui`)

Beyond stock shadcn: `WorkMapTree` (virtualized hierarchy with per-node status/health/next-step/champion/progress), `ReviewInboxList` (grouped, overdue-first, one-click actions), `CheckInComposer` (status picker + confidence slider + required narrative + auto-snapshot of KR values with previous-value diff), `CheckInCard` (published check-in with acknowledge action + reactions + comments), `HealthBadge`/`StalenessBadge`/`RagBar`, `KeyResultRow` (inline value edit, direction hint, sparkline + trend forecast, KPI-backed badge), `KpiGrid` (periods × KPIs, keyboard entry, calculated-cell formula chip), `FormulaBuilder` (drag KPI refs + operators, per-source aggregation, live preview), `AlignmentTree`, `DataTable` (virtualized, inline-edit cells, group headers, keyboard nav), `BoardColumn` (virtualized cards, drop zones, WIP count), `EntityPicker`, `AvatarStack` (+N, presence ring), `RichTextEditor` + `CommentComposer`, `ResourceNodeTree` (folders/docs/files/links with breadcrumbs, drag upload), `FilePreview` (image/video/pdf), `ProgressRing/Bar`, `EmptyState`, `SkeletonTable/Card`, `KbdHint`, `Toast+Undo`, `SidePanel`, `CommandPalette`, `NotificationItem`, `ActivityTimeline`, `MetricTile`, `AiProposalCard`, `ConsentScreen`.

Each gets a Storybook/Ladle preview (human picks) with light/dark and all states; components are tested for keyboard + screen-reader behavior at build time.

## 6. Screen specifications (S-01 … S-26)

Format: purpose · layout · primary actions · states. `[power-floor]` marks screens deferred to post-v1 (REQUIREMENTS §6), specified only as design-for stubs so v1 does not block them.

### Home & rhythm

**S-01 Work Map (Home).** The front door. One virtualized tree: goals → sub-goals → projects → work items, each row = title, champion avatar, health/staleness badge, progress bar, next step, timeframe. Scope tabs (Company / My spaces / a space) + a cycle switcher + filters (status, champion, space). Group/collapse; deep-link every node; open any node in a right SidePanel without losing scroll. States: skeleton tree; empty ("No goals yet — create your first" + template gallery link); error retry. This — not a saved-query builder — is the canonical company view.

**S-02 Review (My Assignments).** The accountability surface. Server-computed, overdue-first list of what the viewer owes: check-ins due (as champion), acknowledgements owed (as reviewer), work items/milestones due. Grouped `Overdue / Due today / This week / Upcoming`; each row = action label ("Submit weekly check-in", "Review goal progress"), due-status ("Overdue by 3 days"), one-click action (opens the composer inline). Drives the sidebar badge. Empty: "You're all caught up."

**S-03 Inbox (notifications).** Two-pane: left grouped by entity with reason chips + unread dots; right preview renders the target. Mark read/unread, mark all, filter by reason/entity, mute an entity, snooze. Live insert on new notification. Settings link → S-24 notification prefs (per-reason routing, mention immediacy, digest window, daily-summary time).

### Strategy

**S-04 Goals explorer.** Scope tabs + cycle switcher + filters; virtualized list/tree of goals: title, champion + reviewer chips, weight, progress + RAG, health/staleness badge, KR count. Inline weight/confidence edit; quick check-in; `+ New goal` (champion, reviewer, owner, cycle/timeframe); open detail in SidePanel. Tree mode shows alignment indent.

**S-05 Goal detail (split + full).** Header: title (inline) + champion + reviewer + cycle/timeframe + progress ring + health/staleness pill + ⋯ (watch, align, close-with-retrospective, reopen, delete-with-undo). Body left: description (rich), key results (each: inline value/confidence check-in, unit, direction hint, weight, progress bar, sparkline + forecast, KPI-backed badge), the check-in history (each `CheckInCard` with its value diff + acknowledge state + reactions/comments), a titled discussion + composer. Right rail: champion/reviewer (with reassignment), cycle/timeframe, weight, alignment parent (picker), rolled-up child goals, linked projects/work items, watchers, resource hub link. Presence avatars. Close flow requires an outcome + a retrospective (S-08 style). States: not-found (restore if within undo), permission-denied card.

**S-06 Check-in composer & session.** For a due goal/project: status (on_track/caution/off_track), optional confidence (0–10 slider with health preview), a required narrative (rich), and an auto-populated snapshot of every KR/target value (editable, showing previous → new). Draft/publish; publishing advances the cadence, notifies subscribers and puts an acknowledgement obligation in the reviewer's Review inbox. A weekly "check-in session" walks the user through all their due goals/projects in sequence. Autosaves drafts. Empty: "Nothing to check in this period."

**S-07 Alignment diagram.** The cascade tree (company → space → individual) from alignment pointers. Pan/zoom canvas; node = goal card (title, champion, progress ring, health); edges = alignment; collapse/expand; click → S-05 in SidePanel. Cycle switcher, scope filter. Keyboard traverse. Virtualize off-screen nodes.

**S-08 Retrospective.** Shown at goal/project close and thereafter: outcome (achieved/missed) + a structured rich-text retrospective (AI-draftable from check-in history via a ✨ proposal). Editable; reopening the goal/project keeps it. Reactions/comments.

**S-09 KPI grid.** KPIs as rows, periods as columns (frequency-driven, scrollable). Each cell = actual/target with RAG background; keyboard entry (Enter commits, arrows move). Row header = title, category, owner, unit, direction, trend sparkline. Group by category with subtotals; filters (frequency, owner, category, RAG). Calculated-KPI cells are read-only with a formula chip; editing a source cell updates dependents live.

**S-10 KPI detail + formula builder.** Header: title, category, owner, current RAG. Body: period chart (actual vs target, RAG bands), parent/child KPI tree, records table (editable), and for calculated KPIs the `FormulaBuilder` (drag KPI refs + operators, per-source aggregation, live preview, inline validation). KPI↔KR link control.

**S-11 Scorecard.** Per owner (person/space) per cycle: result ring, RAG bucket tiles (goals + KRs by completed/on-track/at-risk/outdated), a trend across cycles, and — only when points are enabled — a points breakdown. Filter by owner/cycle; export. Empty when a cycle isn't archived.

### Execution

**S-12 Project detail.** Header: name (inline) + state (active/paused/closed) + health/staleness + champion/reviewer + ⋯ (pause/resume, close-with-retrospective, watch). Body: description (rich), milestones (each with timeframe, status, next-step indicator), the project check-in history (`CheckInCard`s with acknowledgement), discussion. Right rail: contributors (champion/reviewer/contributor with reassignment), linked goal, resource hub, dates, watchers. Pausing suspends the cadence; resuming reschedules and records it.

**S-13 Milestone + board.** Milestone header (title, timeframe, status, complete/reopen) + a per-milestone kanban of its work items keyed on status; drag optimistically, live presence, concurrency-safe order. A comment can carry a complete/reopen action.

**S-14 Work item detail (split + full).** Header: title (inline) + status + ⋯ (watch, link to KR/goal/KPI, delete-with-undo). Body: description (rich), checklist, activity+comments. Right rail: assignees (multi), due (contextual), reminders (due-relative), milestone/project, linked key result/goal/KPI (progress-flow indicator), blocked-by relations (with the cannot-complete-while-blocked guard), watchers. `[`/`]` navigate list order.

**S-15 Board (project).** Work items grouped by status across a project (or a milestone); the S-13 board generalized. Card = title, assignee avatars, due chip (red overdue), linked-KR badge. New-item inline per column.

### Collaboration & platform

**S-16 Resource Hub.** Left: node tree (folders/documents/files/links, drag to reorganize, drag-drop upload, permission-aware). Center: breadcrumb + the node — a rich document (draft/publish, version history with visual diff, backlinks), a file (preview/thumbnail, download), or a typed link (provider icon, enriched preview). Per-node comments/reactions/subscriptions. Available on a space, project, or goal.

**S-17 Discussions / space board.** A space's titled discussion threads (announcements) + threads anchored to a goal/project. Draft → publish (drafts silent). Thread = title, rich body, reactions, threaded comments, subscriber list with a "who will be notified" preview.

**S-18 Activity feed.** The typed, human-readable feed at company/space/goal/project/profile scope: each event rendered by its kind (checked in, closed, aligned, milestone completed, member joined, document published…), reactable/commentable, consecutive same-actor edits aggregated, permission-filtered, live-updating. Distinct from the audit log.

**S-19 Global search + palette.** ⌘K overlay: scoped tabs (All / Goals / Projects / Work items / Docs / People), grouped highlighted results, footer key hints; `/` focuses inline search. Recents boost ranking. Semantic search (from the AI layer) blends in when available.

**S-20 People directory & profile.** Directory (search, filter by space/manager) + a member profile (name, title, timezone, rich bio, manager/reports, the goals/projects they champion). Self-vs-others edit rules. Org-chart view from the manager chain.

**S-21 Onboarding (first-run).** After first login as Owner: a 3-step guided setup (name workspace + brand color → invite teammates (email or reusable link) → create the first goal from a template, or "Explore with demo data" using the in-product demo builder). Per-user first-visit: a 4-stop tour (Work Map, Review inbox, check-in, ⌘K). Dismissible, never auto-repeats.

**S-22 Auth.** Sign in (email+password, passkey button, TOTP step, SSO buttons when configured, lockout messaging with retry-after), registration (if enabled) with email verify, invite-accept (name + password/passkey), forgot/reset. Clean single-card, workspace branding, pre-auth language switcher.

**S-23 Admin & settings.** Two-level pattern (left section nav, right cards with save-per-card). Workspace: General, Members & access (people, the access editor — public/workspace/space/invite-only levers, roles as binding sugar), Spaces, Strategy (cadence + anchor day, staleness grace, RAG thresholds, cycles create/archive, term labels, scorecard points toggle **off by default**), Notifications defaults, Authentication (providers, MFA policy, sessions, rate limits), Branding, Audit log (filterable + export + a "verify chain" action), Freeze/read-only switch, Backups, Import (CSV + FlowyTeam wizards with dry-run preview), Export (workspace archive). Every destructive admin action is audit-logged with the actor.

### AI

**S-24 AI settings & agents (admin).** The AI console (AI-NATIVE-PLAN §4), permission `manage_ai`: Provider & connection (incl. Ollama/OpenAI-compatible, allow-user-keys); Models & routing; Features (per-capability switches); Budgets & limits (token/cost/call quotas per user/agent/workspace, hard cap, throttle); Prompts (versioned, restore-to-default); Privacy & governance (egress level, PII redaction, allow-list — greyed with a "zero egress" note on local providers); **Agents** (create/edit AI teammates: persona, planning + execution instructions, provider/tier, schedule, access scope, sandbox toggle, autonomy policy, run history + logs); MCP & connections (enable server, connected grants with last-used + audit + revoke); Usage & logs (dashboards by user/feature/agent/model, flag-misuse, latest evals).

**S-25 Copilot.** A SidePanel (⌘J / "Ask AI"), workspace-scoped and entity-scoped when opened from one. Thread of turns (user/assistant/tool), streaming with Stop, inline **action proposals** (preview/diff with Apply/Dismiss committing through the normal mutation layer). Grounded citations only to what the viewer may see. Composer with entity mentions and suggested prompts. States: empty, AI-off (link to S-24 for admins), rate-limited/capped.

**S-26 Rich text editor (design doc + component).** Its own spec: the ProseMirror schema (node/mark allowlist), draft persistence + recovery, contextual mention/attachment enablement, `##id`/link resolution shared with the importer's reference-rewrite pass, paste-to-upload via the FileStorage adapter, sanitizing render, and the excerpt/summary utility used by email/inbox/feed.

### Power-floor stubs (design-for, not built in v1)

`[power-floor]` **S-P1 Query/View builder** (saved filters → table/board/calendar); **S-P2 Custom fields admin**; **S-P3 Types/statuses/workflow admin**; **S-P4 Gantt** (dependency timeline + the scheduling engine); **S-P5 Backlog/Sprint board**; **S-P6 Time & cost logging** (v1 shows imported time read-only); **S-P7 Operator console** (Phase 7 — workspace inspect/suspend, site messages, transparent support impersonation); **S-P8 Billing** (behind `BILLING_ENABLED`). Each is specified only enough that v1 data models do not block it.

## 7. Accessibility standard (WCAG 2.1 AA)

- Semantic landmarks; one `h1` per page; visible focus; focus trapped in overlays and returned on close.
- All interactive elements keyboard-operable including drag alternatives (move-via-menu on cards/map nodes: "Move to…", "Set dates…").
- Contrast ≥ 4.5:1 text, ≥ 3:1 UI; status/health colors never the sole signal (icon + label accompany).
- Live regions for toasts, realtime list/feed changes, the notification and review badges.
- Virtualized lists expose `aria-rowcount`/`aria-rowindex`; tables have header associations.
- Forms: label + description + error via `aria-describedby`; Zod errors announced.
- Automated axe checks in Playwright on every screen spec (P6 formal audit).

## 8. i18n & localization

- ICU MessageFormat catalogs (`en` source, `ms` at launch); no concatenated strings; all dates/numbers/times via `Intl` with the workspace timezone + the user's locale (never hard-coded `en-US`).
- Language: per-user setting + pre-auth switcher; instance default in workspace settings.
- Pseudo-locale build check catches hardcoded strings in CI; keys namespaced per module.
- RTL not required for v1; use logical CSS properties anyway.

## 9. UX quality gates (added to every UI task's QA)

- [ ] Matches the cited screen spec (or the spec is updated in the same PR).
- [ ] Loading, empty, error and permission-denied states implemented and visually checked.
- [ ] Dark mode + compact density verified.
- [ ] `prefers-reduced-motion` honored; no content gated on an animation; no entrance animation on virtualized rows.
- [ ] Keyboard path for every action; shortcuts in the `?` overlay.
- [ ] Optimistic update + conflict path exercised (where mutating).
- [ ] Staleness/accountability chips render correctly where the entity has a cadence/champion/reviewer.
- [ ] Mobile breakpoint behaves per §3.
- [ ] axe scan clean on the changed screens.
- [ ] Strings in catalogs, none hardcoded; `ms` keys stubbed.
- [ ] Meets the §13 performance budget relevant to the surface (spot-check on seeded data).
- [ ] Any AI affordance is hidden/disabled when the provider is `off`; no AI value commits without preview→apply; AI values carry provenance.
