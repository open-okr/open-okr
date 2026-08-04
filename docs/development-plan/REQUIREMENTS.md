# REQUIREMENTS.md

Product authority for **OpenOKR**: an open source, AI-agentic-native OKR platform that coaches an organisation through the whole OKR practice instead of merely storing its goals.

Feature scope is priced **P0** (must ship in v1), **P1** (fast follow inside v1), **P2** (designed for, built after launch). Everything deferred past v1 is in §9.

---

## 1. The product

- **Name:** OpenOKR.
- **One line:** Your OKR coach, built in. Open source, AI-native, self-hosted or in our cloud.
- **The problem.** Most organisations treat OKRs as a form to fill in. A tool stores the objectives, nobody updates them, and by week six the quarter is running on memory. The practice that makes OKRs work (a real planning cycle, honest quality review of every draft, alignment that means contribution, a weekly rhythm with teeth, an evidence-based quarterly close) lives in a consultant's slide deck, not in the software. Meanwhile the software is passive. It waits to be visited.
- **The answer.** OpenOKR encodes the practice and makes the software active. The full OKR method is built in as guided cycles, live quality checks, alignment diagnostics, KPI health corridors and timed sessions. Two AI agents work the practice alongside the organisation: an **OKR Coach** that guards quality, and an **OKR Champion** that guards the rhythm. They initiate. They nudge the champion whose check-in is due, escalate the blocker that aged past its 24-hour clock, tell leadership their not-doing list is empty, and propose a recovery OKR when a KPI drops out of its corridor. They do it in the browser, in Slack, Teams, WhatsApp or Telegram, by email, and through any AI agent the user already runs.
- **The stance.** Active, not passive. Opinionated, not configurable. Agent-native to the core: everything a human can do, an agent can do, through one permission-checked contract.
- **Ownership.** Self-host it on your own servers or use our cloud. Same release, same behaviour. Export the whole workspace whenever you like.

## 2. Who uses it

| Persona | What they need to get done | Tech comfort |
|---|---|---|
| Team member | See what they owe this week, update it in one place or from their chat app, and understand how their work connects upward | Low |
| Champion (goal owner) | Draft a good OKR, post honest check-ins, name blockers, keep their goals out of the stale pile | Medium |
| Reviewer / manager | Acknowledge check-ins, spot at-risk and stale work early, coach their people | Medium |
| Coordinator | Run the weekly session for a space, chase blockers, publish the digest | Medium |
| Facilitator | Run the planning cycle and the quarterly review, guard the quality bar | Medium |
| Sponsor / executive | See the whole company on one map, get told the truth early, decide with evidence at the close | Low |
| PMO / OKR lead | Run cycles across the org, maintain KPI trees, read alignment health, report and export | High |
| Admin | Members, SSO, backups, audit, AI governance and cost caps, pass a security review | High |
| AI teammate | An agent member with a persona, a scope and a schedule that works the practice like a person | n/a |
| External agent | The user's own Claude, ChatGPT, Cursor or custom agent, acting as that user, within their permissions | n/a |

## 3. The operating model (P0, the spine)

Not modules a user assembles. Defaults the product imposes. Each is tunable. None can be switched off.

### 3.1 The guided cycle

Every OKR cycle runs the eight phases in METHOD.md §2 with computed completion, not self-reported ticks. Annual cycles set the frame and the annual OKRs. Quarterly cycles revalidate the frame in 30 to 60 minutes and set the quarter's OKRs inside it. The product knows which phase a cycle is in, what is missing, who owes what, and how many weeks remain before the publication deadline.

*Acceptance:* Given a quarterly cycle three weeks from its start with the input pack incomplete, when the facilitator opens the cycle, then Phase 1 is shown as blocked with the exact missing items, and drafting in Phase 4 is refused with the reason.

### 3.2 Quality at the point of writing

Every objective and key result is checked live against the twenty rules in METHOD.md §4 as it is typed. Each check returns pass, warn or fail with a specific coaching prompt, a reason, and a weak-versus-strong example. The set carries a strength score. The six publish gates in METHOD.md §4.5 are hard: an OKR set that fails one cannot be published.

*Acceptance:* Given an objective beginning "Launch the new mobile app", when the champion types it, then the outcome-not-output check fails inline with the coaching prompt, the strength score drops, and publishing the set is blocked until it passes or the workspace overrides with a recorded reason.

### 3.3 Cadence, staleness and accountability

Every goal has a check-in frequency (weekly by default, anchored to a company-chosen day), exactly one champion and exactly one reviewer. The system computes the next due date, honours the workspace timezone and a small tolerance, and drives every reminder from it. A missed check-in past the grace window makes the goal **outdated**, which overrides the last reported health everywhere it appears. A published check-in enters `awaiting acknowledgement` until the reviewer closes the loop.

*Acceptance:* Given a weekly goal last checked in ten days ago, when any list, map or dashboard renders it, then it shows `outdated` regardless of the last check-in, its champion has been nudged three times on their chosen channel, and the sponsor has been told.

### 3.4 Check-ins as narrative snapshots

A check-in is an artifact, not a dropdown: a status (`on_track` / `caution` / `off_track`), a confidence from 0.0 to 1.0, a required written narrative, and an immutable snapshot of every key result value at that moment with its previous value. Draft then publish. Drafts are silent and do not advance the cadence. A goal's health is always derived from its latest published check-in, then overridden by staleness or a close outcome. Nobody hand-paints a goal green.

### 3.5 The review inbox

One server-computed page per person: check-ins due as champion, acknowledgements owed as reviewer, blockers they own, commitments due, sessions they must run. Ranked overdue first, with a live badge and one-click actions. Notifications say what happened. The review inbox says what you owe.

### 3.6 The weekly session

A four-step ritual the product runs, not a meeting people remember to hold: confidence round (with optional private team voting revealed together), diagnose every low score into a typed blocker with an owner and a 24-hour action, close last week's commitments and set this week's, then publish the digest. It ends with a rhythm streak that a skipped week breaks. Full specification in METHOD.md §7.

### 3.7 The quarterly review

A timed sixty-minute session in three acts across eleven stages, ending in exported minutes and an automatic feed-forward into the next cycle. It produces the rhythm diagnostic (METHOD.md §8.6), which tells leadership whether a missed quarter was a cadence problem or a strategy problem. Full specification in METHOD.md §8.

### 3.8 The active coach

Two agent members ship with every workspace, on by default where an AI provider is configured, and fully functional in a reduced deterministic form when it is not.

| Agent | Owns | Example acts |
|---|---|---|
| **OKR Coach** | Quality and practice | Reviews every draft against the canon, runs the semantic alignment review, flags reported-health-versus-data divergence, calls out sandbagging at draft and at close, delivers the rhythm diagnostic |
| **OKR Champion** | Rhythm and momentum | Reminds champions before and after a due check-in, escalates aged blockers, chases acknowledgements, opens and closes the weekly session, assembles digests, prepares the quarterly review pack, watches KPI corridors and proposes recovery OKRs |

They act under their own least-privilege principal, are metered and hard-capped, and are audited. Their default write policy is to propose; a human approves. Full design in AI-NATIVE-PLAN.md §6.

*Acceptance:* Given a champion who has not checked in by the anchor day, when the Champion agent runs, then it messages them on their chosen channel with a one-tap check-in, and on the third consecutive miss it escalates to the reviewer and then the sponsor, every step recorded and visible to the champion.

### 3.9 The Work Map

One company-wide tree: goals, sub-goals, key results, initiatives and the KPIs that measure them, with a uniform contract at every node (health including `outdated`, progress, confidence, champion, timeframe, next step). This is the home screen.

## 4. Modules

### Pillar A: The OKR core (P0, Phase 3)

- **Cycles and the planning workflow (P0).** Annual and quarterly cycles, the eight guided phases, sponsor and facilitator, session dates, publication deadline, the seven-item input pack with distribution tracking, prior-cycle scoring, baseline health, ranked strategic issues, priorities with 12-month success statements, the not-doing list, the six publish gates, and the automatic feed-forward at close.
- **Goals and key results (P0).** Objectives owned by the workspace, a space or a person, in a cycle or with their own timeframe. Key results as direction-aware numeric ranges (baseline to target, increase / reduce / maintain / move) with unit, weight, type (leading / lagging), owner, due date, confidence, full value history and a trend forecast. Alignment under a parent goal or parent key result with cycle detection. Explicit close with an outcome and a retrospective, reopenable.
- **Alignment (P0).** The vertical cascade across company, department, team and individual levels, plus horizontal dependency links between goals in different teams. The alignment health score (METHOD.md §5.2) with linked gaps. The dependency register with confirmation and named risk owners. The capacity check with a mandatory record of what was cut.
- **KPIs and KPI trees (P0).** Categories, per-KPI frequency, unit, direction, type, tier, targets and health corridors. A keyboard-first grid of periods by KPIs. Parent and child driver trees. Calculated KPIs from a typed formula over other KPIs with cross-frequency aggregation and cascade recompute. KPI-backed key results. **Recovery OKRs** drafted from an unhealthy KPI's leading drivers, and the cross-tree recovery board (METHOD.md §6).
- **Check-ins (P0).** §3.4, plus optional private team confidence voting revealed together.
- **Scorecard (P1).** Per owner and per cycle rollup on archive, score bands and portfolio verdicts, trends across cycles, export.

### Pillar B: The rhythm (P0, Phase 4)

- **Weekly check-in session (P0).** METHOD.md §7.2, run in the product: the confidence round with the dial and bands, team voting, blocker diagnosis, commitments, the generated digest, the rhythm streak, the twelve-week confidence trend, and the open-blocker board with ages.
- **Blockers (P0).** The five-type taxonomy, an owner, a next action, a 24-hour clock, escalation at 0.3 and below, and an aging board.
- **Commitments (P0).** Weekly, owned, linked to a key result, closed as delivered or not with no negotiation.
- **Monthly review (P0).** Trend per objective, dependency and risk log, resource shifts, and the decision log where every decision names the key result it affects.
- **Quarterly review session (P0).** METHOD.md §8 in full: eleven timed stages, room pulse, hidden-then-revealed scoring, round-robin narratives, kudos, dot-voted retro, the four management-retro questions, the eight-cause root-cause picker, the five-statement anonymous process health, the rhythm diagnostic, keep / modify / abandon, learnings and next-cycle drafts, decisions and actions, and exported minutes.
- **Mid-cycle calibration (P0).** Once per cycle, only for a verifiable external change, with a written reason.
- **Review inbox and digests (P0).** §3.5, plus daily and weekly digests in the member's own timezone and channel.

### Pillar C: The work (P0/P1, Phase 5)

Deliberately OKR-shaped. Enough to answer "what is actually moving this key result", not a project management suite.

- **Initiatives (P0).** The work that moves a key result: title, description, owner, dates, status (`planned` / `active` / `done` / `dropped`), confidence, capacity verdict (fits / tight / exceeds), and a link to one or more key results. Progress on an initiative feeds the key result's linked-work view and the forecast.
- **Tasks and the OKR board (P0).** Tasks with title, description, assignees, status (`backlog` / `todo` / `in_progress` / `done`), due date and checklist, each optionally linked to a key result. A kanban board across a space, an initiative or a key result, with drag, live presence and concurrency-safe ordering. The sidebar shows objectives and key results with progress derived from linked completed tasks.
- **Documents (P0).** Rich documents attached to a goal, a key result, an initiative, a session or a space. Draft then publish, version history with a visual diff, comments and reactions. No separate wiki, no folder tree.
- **Files (P0).** Attachments on any of the above, with previews, quotas and an optional scan hook.

### Pillar D: Coaching and AI (P0, Phases 2 and 4)

- **The Draft Coach (P0).** The METHOD.md §4 rule engine, deterministic and always available with AI off, enriched by AI for rewrite suggestions and semantic judgement when a provider is configured.
- **The OKR Coach and OKR Champion agents (P0).** §3.8.
- **Assists everywhere (P0).** Propose-then-confirm accelerators over a complete manual path: draft an objective and key results from an ambition, rate and improve a draft, suggest metrics, targets, units and alignment parents, draft the overdue check-in from real activity, draft the retrospective from check-in history, suggest KPIs, thresholds and formulas from plain language, narrate a KPI trend and flag anomalies, draft the digest and the minutes, summarise a thread, decompose a key result into initiatives and tasks, answer questions grounded in workspace data, and turn a sentence into a filtered list.
- **Copilot (P0).** A side panel that answers grounded in workspace data with permission-filtered citations and proposes actions for confirmation. Long runs execute in the background and stream back.
- **MCP server (P0).** Any external agent drives OpenOKR as the authenticated user. OAuth 2.1 with PKCE is the primary authentication for hosted clients; scoped tokens remain for local and scripted use. The tool catalogue covers the whole product with read, write and destructive safety classes, plus `search` and `fetch` for research connectors, and resources and prompt templates.
- **Bring your own AI (P0).** Anthropic, OpenAI, OpenRouter, Ollama or any OpenAI-compatible endpoint. Keys at deployment, workspace or per-user level, envelope-encrypted. A validated model catalogue with capability tiers, per-feature toggles, per-token cost metering, quotas and hard caps that halt a run, versioned prompts, egress controls, and a zero-egress guarantee on local providers.

### Pillar E: Channels and reach (P0, Phase 5)

The coach is only active if it reaches people where they are.

| Channel | v1 capability |
|---|---|
| Browser | Everything |
| Email | Nudges, digests, the daily summary, invitations, one-click check-in links |
| Slack | Two-way. Nudges, blocker escalations, digests, and slash commands to check in, log a blocker, ask the coach and read a goal |
| Microsoft Teams | Two-way, same surface as Slack |
| WhatsApp | Two-way via the WhatsApp Business API. Template-based nudges out, conversational check-in and blocker capture in |
| Telegram | Two-way bot, same surface |
| MCP | Any external agent, as the user |

One channel port with one driver per provider. Every inbound message resolves to a workspace member and runs through the same permission checks as a click. Per-member channel preference and quiet hours. A workspace with no channel configured still works completely: email and the browser cover everything.

### Pillar F: Platform (P0, Phase 2)

- **Spaces (P0).** Team homes with their own goals, sessions, documents, members and access scope.
- **People and org (P0).** Per-workspace profiles (title, timezone, avatar, bio), a manager chain and org chart, a directory, suspend and restore, guests, invitations by email and reusable links with domain rules, and trusted-domain auto-join.
- **Access (P0).** Relationship-based per-object access on top of database-enforced tenant isolation, through one enforcement point shared by the browser, the API, MCP and the agents.
- **Comments, reactions, mentions, subscriptions, notifications (P0).** Everywhere, with per-reason routing, per-channel delivery, digest windows and a daily summary in the member's own timezone.
- **Activity feed (P0).** Typed, human-readable, permission-filtered, live, at workspace, space, goal and profile scope. Separate from the compliance audit log.
- **Search and command palette (P0).** ⌘K for entity jump, actions and full-text search across everything the member may see. Semantic search arrives with the AI layer.
- **Admin (P0).** Workspace settings, members and access, cycle and rhythm defaults, thresholds, terminology labels, notification and channel defaults, security, branding, the audit log with chain verification, a read-only freeze switch, backups, import and export.
- **Portability (P0).** Signed, encrypted, checksummed workspace export and dry-run import between any two OpenOKR instances, self-host and cloud in both directions.

## 5. Deployment (P0, both in v1)

One codebase, one tagged release, two ways to run it.

| Way | Who | What it takes |
|---|---|---|
| **Self-hosted** | Any organisation that wants its data on its own servers. Universities, regulated sectors, privacy-minded teams | Docker Compose on one server with a first-run web setup wizard (target: under 30 minutes), or the Helm chart on their own Kubernetes |
| **Managed cloud** | Teams that do not want to run anything | Sign up, pick a workspace name, start. Operated by us, on the same release |

The cloud is the same container release under vendor operation, plus a tenant lifecycle surface: signup and provisioning, plans and seat limits behind a flag, an operator console, per-tenant limits, and time-boxed support access that is visible to the customer. It is not a different product and not a different runtime.

Self-host is never seat-limited and never feature-gated.

## 6. Cross-cutting requirements

- **Importers (P0).** (1) A generic CSV/XLSX importer for goals, key results, KPIs and records, initiatives and tasks, with template downloads, an AI-assisted column mapper, a dry-run preview and a per-row error report. (2) A **FlowyTeam importer**: read-only MySQL, per-company, covering org units to spaces, cycles, objectives, key results, check-ins, KPIs with records and formula translation, and tasks. Both idempotent on re-run, both producing a reconciliation report, with all derived values recomputed rather than trusted.
- **UX bar (P0).** Modern-tool feel: inline editing, optimistic updates with undo, ⌘K, dark mode, keyboard-first, responsive, live updates. Binding specification in UIUX-PLAN.md; budgets in TECHNICAL-PLAN.md §13.
- **Languages.** English (P0) and Bahasa Melayu (P1). Internationalisation-ready from day one.
- **Accessibility.** WCAG 2.1 AA target, automated checks in CI on every screen, keyboard paths for every action including drag alternatives.
- **Compliance.** PDPA and GDPR-style handling: data export, erasure as anonymisation that preserves authorship, last-owner invariants, and minimal personal data in logs.
- **Air-gapped operation (P0 for self-host).** No feature may hard-depend on an external service. AI points at a local model or is off. Channels are optional. Telemetry is opt-in. Assets are self-hosted.

## 7. Non-functional requirements

- **Scale.** Tens of thousands of members, 100,000 goals and key results and 1,000,000 tasks in one workspace. Keyset pagination, virtualisation and indexes shipped with the feature.
- **Performance.** Work Map and primary lists interactive in under two seconds on a mid-range laptop against the large seeded dataset. Saves feel instant.
- **Reliability.** Scheduled encrypted backups with restore drills verified in CI. Per-workspace logical restore through the portability engine. Forward-only migrations.
- **Data residency.** Self-hosting satisfies in-country residency. The cloud states its region.

## 8. Success metrics

**Leading**

- A new team completes setup and posts its first check-in within 15 minutes of starting the instance.
- 70% or more of due check-ins in a pilot cohort are submitted on time, driven by the review inbox and the Champion agent's nudges.
- Median OKR strength score at publication above 75%.
- Median time from a blocker being logged to its next action being taken: under 24 hours.
- Rhythm streak of six or more consecutive weeks in at least half of active spaces.

**Lagging**

- Active self-hosted instances and cloud workspaces after six months.
- Organisations that complete a full cycle end to end: plan, run, review, feed forward.
- Organisations running the Coach or Champion agent unattended every week.

## 9. Out of v1, designed for

Deferred but not blocked. Each keeps a design-for note in TECHNICAL-PLAN.md.

1. Serverless runtime profile (the cloud runs the container profile in v1).
2. Custom fields, configurable statuses and workflows, a saved-query language and view builder.
3. Gantt and automatic dependency scheduling.
4. Time and cost tracking.
5. Sprints, backlogs and story points.
6. Meetings beyond the OKR sessions, and calendar two-way sync.
7. Additional channels (Discord, Google Chat, Line), incoming email, and GitHub or GitLab work links.
8. Real-time co-editing of documents.
9. Native mobile applications. The responsive web app and the chat channels cover mobile in v1.
10. An importer for any source beyond FlowyTeam and CSV.

## 10. Open questions

- Cloud pricing model and whether any feature is ever gated. Current position: nothing is gated, the cloud sells operation.
- Whether a formal external accessibility audit is required before launch.
- Sector-specific compliance beyond PDPA and GDPR.
- Whether the scorecard points layer is built at all. It ships off by default either way.
- **Recovery OKR drafting when the unhealthy KPI has no leading children.** METHOD.md §6.5 says one key result per *leading child driver*, which yields the placeholder key result. METHOD.md §6.3 says to take the leading drivers at the *edge of the unhealthy branch*, which reaches further down and yields real key results. The two give different answers for a root KPI whose own children are all lagging, which is the common shape. Blocks P3-T14 and the `packages/method` conformance suite.
