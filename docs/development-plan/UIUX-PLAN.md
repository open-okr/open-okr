# UIUX-PLAN.md

Design authority for OpenOKR's interface. Every UI task in IMPLEMENTATION-PLAN.md cites a screen specification (S-xx) and the §4 interaction patterns. If a screen or a pattern is not specified here, ask rather than invent. When implementation deviates, update this document in the same change.

The stance: the product's edge is **installed opinion and an active coach**, not configurability. So the interface leads with the guided path. The cycle knows what phase it is in. The composer tells you why your key result is weak while you type. The map shows what is stale. The inbox tells you what you owe. None of it needs setting up first. It must feel like a modern tool while carrying real accountability.

---

## 1. Design principles

1. **The method is visible, and it is arguable.** Every rule the product enforces is shown with its reason and a way to see the rule itself. Coaching is never a mysterious red dot.
2. **The system speaks first.** Due, overdue, blocked, stale, drifting and off-corridor states announce themselves. The user should rarely have to go looking.
3. **Fast is a feature.** Every interaction obeys the budgets in TECHNICAL-PLAN.md §13. Optimistic updates by default. The Draft Coach never blocks a keystroke.
4. **Inline over modal.** Edit in place. Modals only for create-with-context, destructive confirmation, and pickers that need room.
5. **Keyboard-first, mouse-friendly.** Everything reachable through ⌘K and shortcuts. Nothing reachable only by keyboard.
6. **Accountability is on the surface.** Staleness, champion, reviewer, confidence, blocker age and what you owe appear everywhere they are relevant, not buried in a detail page.
7. **Never lose work.** Drafts persist and are fingerprinted against their base content so a stale draft never resurrects wrongly. Reversible destruction gets an undo toast, not a confirmation dialog.
8. **States are designed.** Every view ships loading, empty, error and permission-denied states.
9. **One design system.** Only `packages/ui`. No one-off styles.

## 2. Foundations

- **Component base.** shadcn/ui on Tailwind, extended in `packages/ui`, configured against the Base UI registry. All accessibility behaviour (focus, dismissal, ARIA, keyboard) comes from Base UI. A missing primitive is raised, never swapped for another library.
- **Animation.** SmoothUI on Motion, vendored into `packages/ui`. It runs under the strict content security policy. Where a SmoothUI component carries behaviour, back it with the matching Base UI primitive so accessibility is never lost.
- **Adding components.** Pulled from the registries into `packages/ui` at build time and adapted to tokens. No runtime dependency, no network call, safe for an air-gapped install.
- **Typography.** Inter, self-hosted. Scale 12, 13, 14 (base), 16, 18, 24, 30. Tabular numerals in every grid and score display.
- **Spacing.** A 4 pixel grid. Comfortable and compact densities, per user.
- **Colour.** A neutral grey ramp plus one workspace-themeable brand hue. Semantic tokens for success, warning, danger and info. Health, confidence and corridor colours are token-driven and never the only signal: an icon and a label always accompany them.
- **Dark mode.** First class. Every component ships both. Light, dark or system.
- **Icons.** Lucide. Fixed entity iconography: cycle, goal, key result, KPI, initiative, task, blocker, session, space, document, agent.
- **Motion.** 120 to 200 millisecond ease-out micro-transitions on hover, focus, selection and state change. A surface may stagger its content in on first paint, settling within half a second, and progress bars, corridor bars, dials and score rings may grow to their value at the same moment. Neither applies to virtualised rows or data-heavy re-renders: a row that mounts on scroll appears instantly. Ambient motion is reserved for live meaning, such as a session timer, an unconfirmed dependency or the caret in an actively edited field, and stays slow and quiet. Respects reduced-motion. Never gates content on an animation. Two deliberate exceptions, both meaningful: the score reveal in the quarterly review and the vote reveal in the weekly session, both of which respect reduced-motion by appearing instantly.
- **Rich text editor.** A TipTap editor over the canonical schema, with its own design document (S-30): slash commands, mentions, entity autolink by short identifier, inline attachments with optimistic placeholders, code blocks and tables. Draft autosave keyed per entity and user.

## 3. Shell and navigation

```
┌────────────┬──────────────────────────────────────────────┐
│  Sidebar   │  Topbar: breadcrumb · search(⌘K) · + New ·   │
│            │          Ask AI(⌘J) · notifications · avatar │
│  Home      ├──────────────────────────────────────────────┤
│  Review ●  │                                              │
│  Inbox     │                Content area                  │
│  ────────  │      (Work Map / list / detail / session)    │
│  Cycle     │                                              │
│  Goals     │                                              │
│  KPIs      │                                              │
│  Work      │                                              │
│  ────────  │                                              │
│  Spaces    │                                              │
│   ▸ Space  │                                              │
│  ────────  │                                              │
│  Admin     │                                              │
└────────────┴──────────────────────────────────────────────┘
```

- **Sidebar.** Home (the Work Map), Review (what I owe, with a live overdue badge), Inbox (notifications), then Cycle (the guided workflow and its phase), Goals, KPIs, Work, then Spaces, then Admin. A workspace switcher sits at the top for members of more than one workspace.
- **Topbar.** Breadcrumb, global search (`/` focuses, ⌘K opens the palette), `+ New`, Ask AI (⌘J), the live notification bell, the avatar menu.
- **The cycle strip.** When a cycle is in planning, a slim persistent strip sits under the topbar: the phase name, what is blocking it, and the days until the publication deadline. It disappears once the cycle is published and running.
- **Command palette.** Actions, entity jump by short identifier or title, recent items, all permission-filtered.
- **Responsive.** 1280 and above is full. 768 to 1279 collapses the sidebar to icons. Below 768 uses a bottom tab bar (Home, Review, Inbox, Search) and a drawer; the Work Map and lists become card lists, boards get horizontal snap-scrolling with touch drag, and sessions run in a single-column stepped layout.
- **Shareable URLs.** Every view state that matters lives in the URL and restores exactly. A version mismatch after a deployment triggers one reload with a clear message.

## 4. Interaction patterns

| Pattern | Rule |
|---|---|
| Optimistic updates | Change the interface immediately, roll back with a toast on rejection. A stale-version conflict refetches and reapplies when clean, otherwise shows an inline comparison |
| Inline edit | Click to edit titles, status, owner, dates, champion, reviewer, confidence and key result values, in lists, detail and cards. Escape cancels, Enter or blur commits |
| Undo | Deletes, bulk edits and drag moves show a six second undo toast, not a confirmation. Hard confirmation only for irreversible destruction |
| Drafts | Comment, description and check-in editors autosave locally per entity and user, fingerprinted against the base content with an expiry, restored on return, cleared on submit |
| Empty states | Icon, one sentence, primary action, documentation link. First-run empties may carry a three-step checklist |
| Loading | Skeletons matching the final layout. Stale content stays visible while revalidating, with a subtle refresh indicator |
| Errors | Inline field errors, a surface-level error card with retry, never a blank screen, an error boundary per route segment |
| Keyboard | Global: ⌘K palette, `/` search, ⌘J Ask AI, `c` create. Lists: `j`/`k` move, `x` select, `e` edit, `⌘⏎` save. Detail: `[` and `]` previous and next. `?` opens the shortcut overlay |
| Presence | A realtime avatar stack on detail, board, map and session surfaces. A typing indicator on comments |
| **Coaching inline** | A rule's verdict appears beside the field it judges: a coloured dot, a short label, and on click the coaching prompt, the reason, and the weak-versus-strong example. Never a bare error string. Warnings never block typing |
| **Strength meter** | The OKR strength score sits in the header of any composer that edits an objective set, updating live, with the failing rules listed underneath |
| **Gates** | The publish control shows the six gates as a checklist. Each unmet gate links to the thing that would fix it. The control is disabled with a reason, never silently inert |
| **Staleness** | An outdated badge, amber with an icon and a label, renders on any goal past its check-in due date, overriding the last reported health colour, everywhere |
| **Accountability chips** | Champion and reviewer avatars on goal rows and headers. A "needs your review" chip on a check-in awaiting the viewer |
| **Confidence** | A dial for a single key result, a band chip in lists, a sparkline for history. High, medium and low always carry a label as well as a colour |
| **Blocker clock** | A blocker chip shows its type and its remaining time. Past due it turns red and shows the escalation step |
| **Nudge provenance** | Every proactive message in the product shows which rule sent it and offers snooze, change my channel, and see the rule |
| Notifications | Live bell badge. The inbox groups by entity with reason chips. A compose-time preview of who will be notified. Email and chat respect per-member settings and quiet hours |
| Dates | Workspace timezone aware, with contextual granularity so a goal can say "Q3 2027". Pickers show relative labels |
| **AI affordance** | A ✨ action beside the value it helps. It runs, streams and returns a proposal the user applies or dismisses. Shown only where a provider is configured and the feature is on |
| **AI preview before apply** | Every AI write renders as a preview or difference with apply and dismiss. Applying goes through the normal mutation layer, so optimistic updates, undo and audit all work. Never auto-committed |
| **AI provenance** | AI-generated or AI-edited values carry an AI chip. The source and model are recorded |
| **Agent presence** | The Coach and the Champion appear as members with an agent badge, in feeds, mentions and assignments. Their proposals surface in the review inbox |
| **Cost transparency** | When a quota or cap is near or reached, the affordance shows the remaining budget and, on reaching it, disables with a clear message while every manual path continues |
| **AI degradation** | With AI off or the provider unreachable, every ✨, copilot and agent-language affordance is hidden or disabled, while the deterministic coaching, nudges and escalations continue unchanged. No dead buttons, no errors |

## 5. Component inventory

Beyond stock components: `WorkMapTree`, `ReviewInboxList`, `CycleStrip`, `PhaseStepper`, `InputPackChecklist`, `GateChecklist`, `StrengthMeter`, `RuleVerdict`, `CoachPanel`, `ExamplePair`, `CheckInComposer`, `CheckInCard`, `ConfidenceDial`, `VoteReveal`, `HealthBadge`, `StalenessBadge`, `ConfidenceBand`, `BlockerChip`, `BlockerBoard`, `CommitmentList`, `StreakRibbon`, `TrendChart`, `KeyResultRow`, `KpiGrid`, `KpiTreeCanvas`, `CorridorGauge`, `RecoveryCard`, `FormulaBuilder`, `AlignmentCanvas`, `FindingCard`, `DependencyRegister`, `CapacityTable`, `SessionStage`, `SessionTimer`, `LapBar`, `ScoreSlider`, `ScoreReveal`, `RetroColumn`, `PulsePicker`, `KudosCard`, `DiagnosticCard`, `DecisionPicker`, `MinutesPreview`, `TaskBoard`, `InitiativeRow`, `DataTable`, `EntityPicker`, `AvatarStack`, `RichTextEditor`, `NudgeProvenance`, `ChannelBadge`, `AiProposalCard`, `AgentRunLog`, `ConsentScreen`, `EmptyState`, `Toast+Undo`, `SidePanel`, `CommandPalette`.

Each gets a preview page covering light and dark and every state, and is tested for keyboard and screen-reader behaviour.

## 6. Screen specifications

Format: purpose, layout, primary actions, states.

### Home and rhythm

**S-01 Work Map (Home).** The front door. One virtualised tree: goals, sub-goals, key results, initiatives, with KPI tiles for the trees that measure them. Each row shows title, champion avatar, health and staleness badge, confidence band, progress bar, next step and timeframe. Scope tabs (company, my spaces, one space), a cycle switcher and filters. Collapse and expand, deep-link every node, open any node in a side panel without losing scroll. States: skeleton tree, empty with a create action and a template link, error retry. **Mockup:** [01-work-map](../stakeholder/mockups/png/01-work-map.png).

**S-02 Review (what I owe).** The accountability surface. A server-computed, overdue-first list of check-ins due as champion, acknowledgements owed as reviewer, blockers owned, commitments due, sessions to run, and agent proposals awaiting a decision. Grouped as overdue, due today, this week, upcoming. Each row carries an action label, a due status such as "overdue by 3 days", and a one-click action that opens the composer inline. Drives the sidebar badge. Empty: "you are all caught up." **Mockup:** [10-review-inbox](../stakeholder/mockups/png/10-review-inbox.png).

**S-03 Inbox (notifications).** Two panes: grouped by entity with reason chips and unread dots on the left, a preview of the target on the right. Mark read, filter by reason, mute an entity, snooze. Live insert. Every proactive message shows its rule and offers snooze or a channel change.

### The cycle

**S-04 Cycle workspace.** The guided planning workflow. A left rail lists the eight phases with a completion mark, the output each produces and a progress bar. The centre shows the current phase's work. A right rail shows the facilitator guidance for this phase (METHOD.md §9), the phase's key output, and the mode note for annual versus quarterly. A header carries the cycle name, the mode toggle, and the countdown to the publication deadline. Actions: load an example cycle, copy the plan as text, start the next cycle. **Mockup:** [02-cycle-workspace](../stakeholder/mockups/png/02-cycle-workspace.png).

**S-05 Phase 0, annual strategy.** The frame (mission, vision, mid-term strategy, year, horizon), the 2 to 5 annual strategies with what each means in practice, the annual OKRs with their serving strategy, and the year's not-doing list. Each annual objective can be sent forward into drafting. The Coach flags a frame with unresolved disagreement.

**S-06 Phase 1, prepare.** Scope and cadence (start date, which levels set OKRs, which units contribute instead), roles and timeline (sponsor, facilitator, session dates, publication deadline), the seven-item input pack checklist with a distribution confirmation, and the suggested timeline table for the current mode. Drafting is blocked while the pack is incomplete, with the block explained. **Mockup:** [02-cycle-workspace](../stakeholder/mockups/png/02-cycle-workspace.png).

**S-07 Phase 2, diagnose.** Prior-cycle scoring (each key result with a 0.0 to 1.0 input, a per-score note, a portfolio average and its verdict), baseline health in three columns (stable, declining, fine as business as usual), and the ranked strategic issue list with an impact selector that reorders live. A first-cycle switch hides scoring and expands baseline health.

**S-08 Phase 3, set direction.** Annual: confirm the frame with an explicit agreement control and an open-issues field, then 3 to 5 priorities each with a "measurably different in twelve months" statement and a promote-to-objective action, then the not-doing list. Quarterly: revalidate the annual frame (holds or documented change), tick the annual key results this quarter must move, and note the focus areas.

**S-09 Phase 4, draft OKRs.** The drafting surface, and the most coached screen in the product. Each objective card carries the objective (inline, with live rule verdicts), the champion and reviewer, and its key results. Each key result row carries direction, measure, baseline, target, date, owner and indicator type, and renders the generated sentence beneath with either its failing rules or a passing badge. The header holds the strength meter. A quality panel lists every open issue across the set, grouped by objective. A ✨ action beside each failing rule offers a rewrite. **Mockup:** [03-draft-coach](../stakeholder/mockups/png/03-draft-coach.png).

**S-10 Phase 5, align and commit.** Four blocks: alignment mapping (each objective states what it contributes to), the dependency register (key result, providing team, confirmed, risk owner), the capacity check (per key result, its main initiatives and a fits/tight/exceeds verdict, plus the mandatory "what did you cut?"), and the commit block showing the six gates as a checklist with a publish control that stays disabled until they are all green. **Mockup:** [04-gates-capacity](../stakeholder/mockups/png/04-gates-capacity.png).

**S-11 Phase 6, run the cadence.** A live view of the running cycle: sessions held and upcoming, the streak, confidence per key result with its trend, open blockers by age, the decision log, and the mid-cycle calibration record.

**S-12 Phase 7, review and learn.** Scoring every key result with the band table highlighted at the portfolio average, carry-forward flags, the retrospective split into business and process questions, and the feed-forward action that opens the next cycle with scores and carry-forward items already placed.

### Goals and alignment

**S-13 Goals explorer.** Scope tabs, cycle switcher and filters over a virtualised list or tree: title, champion and reviewer chips, weight, progress and RAG, health and staleness badge, confidence band, key result count, strength score. Inline weight and confidence editing, a quick check-in, and a new-goal action. Tree mode shows alignment indentation.

**S-14 Goal detail.** Header: title inline, champion, reviewer, cycle or timeframe, progress ring, health and staleness pill, strength chip, and an overflow menu (watch, align, close with retrospective, reopen, delete with undo). Left body: description, key results (each with inline value and confidence editing, unit, direction hint, weight, indicator type, progress bar, sparkline with forecast, KPI-backed badge, linked work count, and its rule verdicts), the check-in history as cards with value differences and acknowledgement state, and a discussion. Right rail: champion and reviewer with reassignment, cycle and timeframe, weight, alignment parent, horizontal dependencies, rolled-up child goals, linked initiatives, open blockers, watchers, documents. A coach strip at the top appears when the Coach has an open finding on this goal.

**S-15 Check-in composer.** For a due goal: status, a confidence dial, a required narrative, and an auto-populated snapshot of every key result value showing previous and new. Where team voting is on, each member submits privately and the reveal happens together with the team average. Draft and publish. Publishing advances the cadence, notifies subscribers and creates the reviewer's obligation. A session mode walks the member through all their due goals in sequence. A ✨ action drafts the narrative from real activity.

**S-16 Alignment studio.** The cascade as a canvas: company, department, team and individual levels with vertical connectors, and dashed horizontal connectors for dependencies. Node cards show level, objective, owner, key result count and dependency count, with an unaligned warning. Pan and zoom, collapse and expand, keyboard traverse, virtualised off-screen nodes. A right panel with three tabs: details (edit the selected node, re-parent it, manage its dependencies), health (the alignment score, a progress bar and the gap list, each gap linking to the goal that caused it), and review (the Coach's semantic findings, each with a type, a severity, a reason, and apply or dismiss). A link mode connects two nodes into a dependency by clicking each in turn. **Mockup:** [05-alignment-studio](../stakeholder/mockups/png/05-alignment-studio.png).

**S-17 Retrospective.** Shown at close and thereafter: the outcome (achieved or missed) and a structured retrospective, AI-draftable from check-in history. Editable. Reopening keeps it.

### KPIs

**S-18 KPI tree.** The driver tree as a canvas: each node shows name, current over target, achievement percentage, a corridor bar, health label, indicator type and tier, and the recovery OKR progress where one is active. Add a driver from any node. A right panel edits the selected KPI (name, owner, current, target, unit, direction, indicator type, tier), shows its health with the corridor explained, and, when the KPI is unhealthy, offers to launch a recovery OKR. When a recovery OKR exists, the panel shows the objective, its key results with baseline, target and current, per-key-result check-in notes with dates, and controls to add a key result or complete the OKR. **Mockup:** [06-kpi-recovery](../stakeholder/mockups/png/06-kpi-recovery.png).

**S-19 Recovery board.** Every unhealthy or recovering KPI across every tree, as cards: tree name, KPI name, achievement, corridor bar, and either the recovery objective with its progress and key result summary, or a launch action. Each card opens the KPI in its tree. Empty: "all KPIs healthy." **Mockup:** [06-kpi-recovery](../stakeholder/mockups/png/06-kpi-recovery.png).

**S-20 KPI grid.** KPIs as rows and periods as columns, driven by frequency. Each cell holds actual and target with a corridor background. Keyboard entry: Enter commits, arrows move. Row headers carry title, category, owner, unit, direction and a trend sparkline. Grouped by category with subtotals, filtered by frequency, owner, category and state. Calculated cells are read-only with a formula chip, and editing a source updates dependents live.

**S-21 KPI detail and formula builder.** Header with title, category, owner and current state. Body: the period chart with corridor bands, the parent and child tree, the editable records table, and for calculated KPIs a formula builder with references and operators, per-source aggregation, live preview and inline validation. A control links the KPI to a key result.

### Sessions

**S-22 Weekly session.** A space's home before the session shows the run control, the twelve-week confidence trend, the streak ribbon, the open blockers with ages, and last week's scores. Running the session is a four-step flow with a step rail and a continue control that stays disabled with a stated reason until the step is complete. **Mockup:** [07-weekly-session](../stakeholder/mockups/png/07-weekly-session.png).

- Step 1, confidence round: a key result list on the left with score chips and state, and a focus panel on the right with the goal metadata, a draggable confidence dial with band shortcuts, the team votes revealing one by one with the average, a "what changed this week?" note, and a confirm that advances to the next unscored key result.
- Step 2, diagnose: one card per key result below the threshold, each with its confidence, a blocker type picker with the type's definition shown, a blocker owner, a next action within 24 hours, and an escalation notice at 0.3 and below.
- Step 3, commitments: last week's list with delivered and not-yet controls, then this week's with text, owner and linked key result.
- Step 4, digest: the generated digest with headline, on track, at risk, blockers and commitments, plus a coordinator note, a summary panel, and controls to copy it or post it to the space's channel.

**S-23 Monthly review.** Trend per objective, the dependency and risk log, resource and priority shifts, and the decision log where each decision carries a date, the key result it affects and its text.

**S-24 Quarterly review.** A facilitated session. The header carries a lap bar segmented by stage duration, the stage timer with pacing cues, an add-a-minute control, and export actions. A left rail lists the eleven stages grouped by act with per-stage minutes and a private facilitator notes field. The centre renders the current stage: **Mockup:** [08-quarterly-review](../stakeholder/mockups/png/08-quarterly-review.png).

- Open and check-in: a pulse picker and one word per participant, with the room pulse read back.
- Score: per objective, the key results with baseline, target, actual and evidence, a score slider and a reason, and a hidden objective score that reveals with an animated count, plus the running cycle score and a note on what a row of high scores means.
- Narratives: a speaking-now indicator with a pass-the-mic control, and a narrative field per objective with its key result summary.
- Recognition: a from, to and for-what composer and a kudos wall.
- Team retro: prompt chips, two columns for what worked and what did not, sticky notes with dot voting.
- Management retro: the four questions with answer fields.
- Root cause: the diagnostic card, then one card per key result below 0.7 with a cause picker and a detail field.
- Process health: five statements with anonymous 1 to 5 voting, live averages and response counts.
- Keep, modify, abandon: one row per objective with its score, three decision controls with the meaning of the selected one, and a why field.
- Learnings and drafts: a learning composer, the top-voted retro themes with promote actions, carry-forward toggles, and next-cycle objective drafts with the learning that motivates each.
- Decisions and actions: a what, owner and due composer, the action list, and the closing block with minutes export.

**S-25 Minutes.** The generated document: an executive summary table, the scorecard by objective, recognition, root causes, retro themes, the management retro, process health, the decisions, learnings, next-cycle drafts, actions and facilitator notes. Exportable and shareable.

### Work

**S-26 Initiatives.** A list per space or per key result: title, owner, dates, status, confidence, capacity verdict and linked key results. Inline editing. An initiative detail panel with description, linked key results, tasks and documents.

**S-27 OKR board.** A left rail of objectives and their key results, each with progress derived from linked completed tasks, a confidence chip and a task count, acting as a filter. The board itself has four columns with drag, live presence and inline creation. Cards show title, the key result they serve, due chip and assignee avatars.

**S-28 Task detail.** Title inline, status, description, checklist, comments and activity. A right rail with assignees, due date, initiative, linked key result and watchers.

### Platform

**S-29 Documents.** A rich document attached to a goal, key result, initiative, cycle, session or space: draft and publish, version history with a visual difference, comments, reactions, subscriptions and attachments.

**S-30 Rich text editor.** Its own design document and component: the schema, draft persistence and recovery, mention and attachment enablement, entity autolink, paste to upload, sanitised rendering, and the excerpt utility used by email, the inbox and the feed.

**S-31 Activity feed.** Typed, human-readable events at workspace, space, goal and profile scope, each rendered by its kind, reactable and commentable, with consecutive edits aggregated, permission-filtered and live. Distinct from the audit log.

**S-32 Search and palette.** A ⌘K overlay with scoped tabs, grouped highlighted results and key hints. `/` focuses inline search. Recents boost ranking. Semantic results blend in when available.

**S-33 People and profile.** A directory with search and filters, and a member profile with name, title, timezone, bio, manager and reports, the goals they champion, their channel identities and their nudge preferences. An org chart from the manager chain.

**S-34 Onboarding.** After the first sign-in as owner: a four-step guided setup (name the workspace and pick a brand colour, choose the check-in day and rhythm, connect a channel or skip, then create the first cycle from a template or explore with demo data). **Every step is skippable and every field arrives pre-filled with the TECHNICAL-PLAN.md §4.14 default**, so the owner can dismiss the whole flow and land in a working workspace. The flow confirms and refines defaults; it never gathers settings the product needs to function. A dismissed onboarding is resumable from admin, and no screen anywhere blocks on an unanswered setting. Per user on first visit: a five-stop tour covering the Work Map, the review inbox, a check-in, the cycle strip and ⌘K.

**S-35 Auth.** Sign in with email and password, passkeys, one-time passwords, single sign-on buttons where configured, and clear lockout messaging. Registration where enabled, invitation acceptance, forgot and reset. A single clean card with workspace branding and a pre-authentication language switcher.

**S-36 Admin and settings.** A left section navigation with cards on the right and a save per card, implementing the TECHNICAL-PLAN.md §4.14 settings map. Workspace: general, members and access, spaces, rhythm (check-in day, frequency, grace, blocker clock, escalation ladders), thresholds (the full METHOD.md §11 registry: bands, corridors, caps, boundaries and timings, each showing its canon default and any override, with a reset to canon), coaching (strictness with per-space overrides), nudges (per-rule enable, channel and ladder overrides, quiet mode, the volume chart with the noisiest rules), terminology labels, notifications and channels (provider connection, verification, identity mapping, test send), authentication and sessions, branding, the audit log with filtering, export and chain verification, the freeze switch, backups, import wizards and workspace export. The rhythm, thresholds, coaching and nudges cards are deterministic and fully available with AI off. Every destructive admin action is audit-logged with its actor.

### AI

**S-37 AI console.** The AI-NATIVE-PLAN.md §4 cards: provider and connection, models and routing, features, agents, budgets and limits, prompts, privacy and governance, connections and grants, usage and logs. Coaching, nudges and channels live in S-36, because they work with AI off.

**S-38 Agent detail.** For the Coach, the Champion or a custom agent: persona, staged instructions with versions, provider and tier, schedule, access scope, autonomy policy, sandbox toggle, cost to date against the cap, and a run history where each run expands into its readable log and the proposals it produced.

**S-39 Copilot.** A side panel opened with ⌘J, workspace-scoped or entity-scoped. A thread of turns with streaming and a stop control, inline action proposals rendered as a preview or difference with apply and dismiss, and citations only to what the viewer may see. States: empty, AI off with a link for admins, rate-limited or capped.

**S-40 Consent.** The screen an external agent's user sees when connecting: the client's identity, the workspace picker, the scopes requested in plain language, and approve or deny. Granted connections are listed in the admin console with their last use and a revoke control.

### Power-floor stubs

Specified only enough that the v1 data model does not block them: a saved query and view builder, custom fields, configurable statuses and workflows, a Gantt timeline with scheduling, sprint boards, time logging, the operator console and billing.

## 7. Accessibility

- Semantic landmarks, one top-level heading per page, visible focus, focus trapped in overlays and returned on close.
- Every interactive element keyboard-operable, including alternatives to drag: move-via-menu on board cards, map nodes and retro notes.
- Contrast of at least 4.5 to 1 for text and 3 to 1 for interface elements. Health, confidence and corridor colours are never the only signal.
- Live regions for toasts, realtime list and feed changes, session stage transitions, vote reveals, and the notification and review badges.
- Virtualised lists expose row counts and indices. Tables associate headers.
- Forms carry a label, a description and an error linked by description. Validation errors are announced.
- Automated accessibility checks run in continuous integration on every screen.

## 8. Languages

- Message catalogues with English as the source and Bahasa Melayu at launch. No concatenated strings. All dates, numbers and times formatted with the workspace timezone and the user's locale.
- Language is a per-user setting with a pre-authentication switcher and an instance default.
- A pseudo-locale build check catches hardcoded strings in continuous integration. Keys are namespaced per module.
- Coaching prompts, rule names, band labels and taxonomy labels all live in the catalogues, sourced from `packages/method`.
- Right-to-left is not required for v1, but use logical CSS properties anyway.

## 9. Quality gates for every UI task

- [ ] Matches the cited screen specification, or the specification is updated in the same change.
- [ ] Loading, empty, error and permission-denied states implemented and checked.
- [ ] Dark mode and compact density verified.
- [ ] Reduced motion honoured. No content gated on an animation. No entrance animation on virtualised rows.
- [ ] A keyboard path for every action, with shortcuts registered in the overlay.
- [ ] Optimistic update and conflict path exercised where the screen mutates.
- [ ] Staleness, accountability, confidence and blocker chips render where the entity has them.
- [ ] Any rule verdict shows its coaching prompt, its reason and a link to the rule.
- [ ] Any proactive message shows its provenance and offers snooze and a channel change.
- [ ] Mobile breakpoint behaves per §3.
- [ ] Accessibility scan clean on the changed screens.
- [ ] Strings in catalogues, none hardcoded, Bahasa Melayu keys stubbed.
- [ ] Meets the relevant performance budget on seeded data.
- [ ] Every AI affordance is hidden or disabled when the provider is off, no AI value commits without a preview and apply, and AI values carry provenance.

## 10. Reference mockups

Eleven of the screens in §6 are drawn as working HTML in `docs/stakeholder/mockups/`, rendered to PNG. Look at the mockup before starting a UI task. It shows the target: the density, the chips, the states and the composition that this document describes in words.

**They are reference, not authority.** If a mockup and this document disagree, this document wins and the mockup gets fixed. If a mockup and METHOD.md disagree on a rule, band, threshold or key, METHOD.md wins. Never cite a mockup as the reason for a behaviour, cite the specification.

Where a mockup shows a concrete detail that no document specifies, a spacing, a chip shape, a row density, treat it as a proposed default. Follow it unless there is a reason not to, and say so in the change if you deviate.

| Screen | Mockup | Task |
|---|---|---|
| S-01 | [01-work-map](../stakeholder/mockups/png/01-work-map.png) | P3-T11 |
| S-02 | [10-review-inbox](../stakeholder/mockups/png/10-review-inbox.png) | P3-T08, P4-T04 |
| S-04, S-06 | [02-cycle-workspace](../stakeholder/mockups/png/02-cycle-workspace.png) | P3-T03 |
| S-09 | [03-draft-coach](../stakeholder/mockups/png/03-draft-coach.png), [03b-rule-card](../stakeholder/mockups/png/03b-rule-card.png) | P4-T02 |
| S-10 | [04-gates-capacity](../stakeholder/mockups/png/04-gates-capacity.png) | P4-T03, P3-T09 |
| S-16 | [05-alignment-studio](../stakeholder/mockups/png/05-alignment-studio.png) | P3-T10, P3-T09, P4-T06 |
| S-18, S-19 | [06-kpi-recovery](../stakeholder/mockups/png/06-kpi-recovery.png) | P3-T14 |
| S-22 | [07-weekly-session](../stakeholder/mockups/png/07-weekly-session.png) | P4-T07 |
| S-24 | [08-quarterly-review](../stakeholder/mockups/png/08-quarterly-review.png) | P4-T10, P4-T11 |
| Channels (AI-NATIVE-PLAN.md §5) | [09-channels](../stakeholder/mockups/png/09-channels.png) | P5-T02 to P5-T05 |

The remaining screens have no mockup. Build them from the specification in §6 and the patterns in §4, and ask rather than invent.

Every value visible in a mockup is quoted from a document rather than made up, because whoever reads it will copy it. **A change to a rule, band, corridor, penalty, taxonomy or trigger key makes the mockup that shows it stale, and `pnpm method:check` cannot see these files.** Update the mockup in the same change, or record it as a follow-up. The full source map is in [the mockups README](../stakeholder/mockups/README.md).
