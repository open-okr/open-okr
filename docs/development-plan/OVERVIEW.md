# OpenOKR — Product Overview

*An open source operating system for running a company on goals: OKRs, KPIs and check-ins joined to the work that delivers them, driven by a built-in weekly rhythm, real accountability, and AI teammates. Self-host it. Own it.*

This document is for the people who will use OpenOKR: team members, champions and reviewers, PMO and operations managers, and the admins who run it. It explains what OpenOKR is, who it is for, every module and its benefit. For the engineering plan behind it, see the other documents in this folder.

---

## 1. What OpenOKR is

Most organizations have two problems at once. Their **strategy** lives in one tool and their **work** in another, so nobody can answer "is the work we are doing actually moving the goals we set?" And their work tools give them **infinite flexibility with zero guidance** — endless custom fields, statuses and views, but no opinion about how to actually run a company.

OpenOKR fixes both, on purpose:

- It is **one place for strategy and execution.** Objectives and key results (OKRs), the KPIs that measure them, and the projects and work items that deliver them all live together. Link a work item to a key result and progress flows upward automatically.
- It is **opinionated.** OpenOKR ships with an operating rhythm built in: every goal and project gets a check-in cadence, a named accountable owner and a named reviewer, and a personal "what do I owe this week" inbox. A goal you stop updating goes visibly **stale** — it cannot quietly stay green. You can tune the rhythm; you cannot turn accountability off.
- It is **AI-native, on your terms.** AI drafts your overdue check-in from what actually happened, decomposes goals into work, summarizes threads, and answers questions about your own data. You can hire **AI teammates** — agent members with a persona and a schedule that plan and do work on the same rhythm as people, safely (they propose, you approve in batch — or you scope them tightly and let them act). And you choose the brain: your own API key, or a fully local model so nothing ever leaves your servers.
- It is **yours.** Open source, self-hosted in half an hour on a cheap server (or on your own Kubernetes), with your whole workspace exportable to an encrypted archive you can import anywhere. No lock-in, no per-seat rent, air-gap friendly.

### In one paragraph

OpenOKR connects goals to the work that delivers them, imposes a light weekly rhythm that keeps both honest, uses AI to remove the busywork of goal-setting and reporting — including AI teammates that work the rhythm themselves — and lets you own the entire thing.

---

## 2. Who it is for

| You are… | OpenOKR gives you… |
|---|---|
| **A team member** | One place to see what you owe this week (check-ins, tasks, reviews), update it fast, and see how your work connects to the company's goals. |
| **A champion (goal or project owner)** | A clear cadence: a check-in composer that pre-fills what changed, milestones that keep the plan honest, and a Work Map view of everything you own. |
| **A reviewer / manager** | Every check-in from your people lands in your Review inbox for a one-click acknowledgement — with stale or at-risk work impossible to miss. |
| **A PMO / operations manager** | OKR cycles, a real KPI module with calculated metrics, the company-wide Work Map, scorecards and exports. |
| **An org / IT admin** | Member and access management, SSO, passkeys, backups with tested restores, a tamper-evident audit log, AI governance with hard cost caps, and a system built to pass a security review. |
| **A team migrating** | A FlowyTeam importer (everything: OKRs, KPIs, check-ins, tasks) and CSV/XLSX importers with a dry-run preview, so you switch without losing data. |
| **An AI teammate** | Yes, really: a seat at the table. An agent member with a name, instructions, scoped permissions and a schedule — accountable like everyone else. |

**Organizations it fits:** startups and scale-ups that want strategy and execution in one place; universities and institutions that must self-host and prove compliance; consultancies running many workstreams; and any privacy- or budget-minded team that would rather own its tools than rent them.

---

## 3. Why OpenOKR — the benefits at a glance

1. **Goals and work in one place.** A work item links to a key result; closing it moves the goal. No more reconciling a strategy spreadsheet against a project tool.
2. **A rhythm with teeth.** Weekly check-ins are scheduled for you, reviewed by a named person, and a missed check-in makes the goal visibly *stale*. Accountability is a product feature, not a meeting.
3. **Honest progress.** Key results are real numbers (from → to, up or down), scored automatically, with the full value history — and a trend forecast that flags "this will miss" before anyone admits it.
4. **A real KPI module.** Track the recurring metrics that matter on a period grid, build calculated KPIs from formulas over other KPIs, and measure a key result directly by a live metric.
5. **AI that works your way.** Assists everywhere (draft, improve, summarize, answer), a copilot that acts with your approval, AI teammates that run on the cadence — powered by your own key or a local model, metered, and hard-capped so there are no surprise bills.
6. **Connect your own agent.** A built-in agent connection (MCP) with a proper sign-in flow lets Claude, ChatGPT, Cursor or your custom agent manage your goals and projects as you, within your permissions.
7. **Own your data — provably.** Self-host anywhere, export your whole workspace to an encrypted archive, restore it anywhere, verify the audit log hasn't been touched. Air-gap capable end to end.
8. **Fast and modern.** Inline editing, a command palette (⌘K), dark mode, full keyboard control, live updates, a responsive shell. The network is invisible.
9. **Simple by default, powerful later.** You start working in minutes with zero configuration. Advanced machinery (custom fields, custom workflows, Gantt, time tracking) arrives as an optional power layer after launch — it will never be a prerequisite.

---

## 4. The operating rhythm (the heart of the product)

Everything else hangs off five ideas:

### 4.1 Cadence
Every goal and every project has a check-in frequency — **weekly by default**, anchored to a day your company picks (say, Friday). OpenOKR schedules the next check-in for you, reminds the right person, and rolls the schedule forward each time you post. Change the frequency per goal; there is no "never" setting.

### 4.2 Champion & reviewer
Every goal and project names exactly one **champion** (the accountable owner) and one **reviewer**. The champion posts the check-in; the reviewer **acknowledges** it (with a comment if they like). Until they do, it sits in their Review inbox. Two people are always on the hook — that is the whole trick.

### 4.3 The Review inbox
One page answers "what do I owe right now": check-ins due (you're the champion), acknowledgements owed (you're the reviewer), work items and milestones due — ranked overdue-first, with one-click actions. Notifications tell you what happened; Review tells you what's yours to do.

### 4.4 Check-ins that mean something
A check-in is not a status dropdown. It is a short ritual: pick a status (*on track / caution / off track*), optionally a 0–10 confidence, write a few honest sentences, and OpenOKR snapshots every key result value at that moment — so every check-in shows exactly what moved since the last one. Drafts are private; publishing notifies subscribers and starts the review clock. A goal's health is always *derived from its latest check-in* — nobody can hand-paint it green.

### 4.5 Staleness ("outdated")
Miss your check-in past a small grace window and the goal or project flips to **outdated** — everywhere: lists, the Work Map, dashboards. It overrides whatever the last check-in said. Neglect is visible by design, which is why it stays rare.

### And one map of everything: the Work Map
The home screen is a single company-wide tree — goals → sub-goals → projects → work items — with health, progress, champion and next step rolled up at every level. It is the answer to "what is the whole company working on, and is it healthy?", one click deep, live.

---

## 5. Strategy: set and measure your goals

### 5.1 Goals & key results (OKRs)
Create goals owned by the **company**, a **space** (team), or a **person**, inside a cycle — or with their own timeframe ("Q3 2026", "July", a custom range). Add **key results** as numeric ranges with a unit and direction (grow signups ↑, cut response time ↓ — both score correctly), weight the important ones, and **align** goals under a parent goal or key result to build the company cascade. Discuss in titled threads; watch, react, comment. Close a goal explicitly as **achieved or missed** — with a short retrospective — and reopen it if the world changes. Every key result keeps its full value history, drawn as a sparkline with a **trend forecast** that flags drift early.

### 5.2 Cycles
Quarters, halves, months or years — generated forward automatically, switched from one control, archived when done. Rename the terminology to your house language ("objective", "rock", "bet" — your call).

### 5.3 KPIs
The recurring numbers you watch every period — revenue, uptime, NPS — on a grid of KPIs × periods with targets, actuals and health colors. Build **calculated KPIs** from formulas over other KPIs (daily numbers roll into monthly ones automatically; change a source and everything downstream recomputes). Link a KPI to a key result so the KR is measured by the live metric. Organize KPIs in a tree by category.

### 5.4 Scorecard *(fast-follow within v1)*
When a cycle closes, archive it: per owner, the result and how many goals/KRs landed in each health bucket, with trends across cycles and exports. An optional points layer exists for organizations that want it — **off by default**.

---

## 6. Execution: deliver the work

### 6.1 Projects
A project has a champion, a reviewer, contributors with stated responsibilities, and the same check-in rhythm as goals — status, narrative, milestone snapshot, acknowledgement, staleness. Pause a project and the rhythm pauses with it; resume and it reschedules. **Closing requires a retrospective** and an achieved/missed outcome. A project can link to the goal it serves.

### 6.2 Milestones
Real objects, not date pins: a timeframe (as fuzzy as "Q3" or as precise as a date), a description, a comment thread — and completing one can be done straight from a comment. The earliest open milestone is always the project's visible **next step**.

### 6.3 Work items
The unit of work: title, rich description, **multiple assignees**, a simple honest status (*todo / in progress / done / canceled*), a due date, a checklist, and reminders that understand "3 days before due" or "when overdue". Link a work item to a key result and your delivery feeds the goal's score. An item can block another — and can't be completed while its blockers are open.

### 6.4 Boards
Kanban per project or per milestone: drag cards between statuses, live for everyone, safe under simultaneous edits. Add items inline. Works with touch.

### 6.5 Resource Hub
Every space, project and goal gets a browsable library: **documents** (a rich editor with drafts, publishing, and version history with visual diffs), **folders**, **files** (previews, thumbnails), and **links** (a Google Doc, Figma or Notion page shown with its real title and icon). Comment on, react to, and subscribe to any of it. This replaces the usual wiki-plus-attachments sprawl with one tree.

---

## 7. Collaboration & platform

- **Spaces** — each team's home: its goals, projects, documents, discussions and members, with its own access scope.
- **Discussions** — titled threads per space (announcements) or attached to a goal/project; drafts are silent until published.
- **Comments, mentions, reactions** — everywhere; @mentions notify immediately (your choice), and every comment is deep-linkable.
- **The feed** — a human-readable, live activity stream per company/space/goal/project ("Aisha checked in on Q3 Revenue — caution", "Milestone 'Beta' completed") — filtered to what you may see, always.
- **Notifications & digests** — an inbox with reason chips, mute and snooze; email that respects you: instant for direct mentions, otherwise batched into one digest on your schedule, plus an optional daily "your work today" summary in **your** timezone.
- **People & org** — profiles, titles, a manager chain and org chart, a people directory; suspend/restore, guests with limited access, invitation links with domain rules.
- **Search & command palette** — ⌘K to jump to anything or do anything; full-text (and later semantic) search across everything you can see.
- **Exports & portability** — any list to CSV/XLSX; the whole workspace to an encrypted, checksummed archive you can import into any other OpenOKR instance (self-host → cloud or back) after a dry-run preview.
- **Admin** — members and access (four simple levels; public/workspace/space/invite-only visibility), the rhythm's defaults and thresholds, branding, backups, a read-only freeze switch for maintenance, and a tamper-evident audit log with one-click verification.

---

## 8. AI & agents (built in, governed, optional)

Everything here is an accelerator over something you can do by hand. Turn AI off and the product is fully functional.

### 8.1 Assists, everywhere
Draft a goal and its key results from a sentence; get coached on whether it's a *good* OKR; **draft this week's check-in from what actually happened** (work closed, KR movement, comments) and just edit it; draft the retrospective from the check-in history; get KPI suggestions, thresholds, and formulas from plain language ("gross margin = revenue minus COGS, monthly"); summarize a long thread; decompose a goal into work items; draft or summarize documents; ask questions across everything you may see, with citations. Every AI write is a **preview you apply or dismiss** — never auto-committed, always labeled, always undoable.

### 8.2 The copilot
One assistant (⌘J) that answers from your workspace's actual data and can act — create the goal, post the check-in, file the work items — each action shown for your approval first. Long jobs run in the background and stream back.

### 8.3 AI teammates
Hire an agent: give it a name, a persona, instructions, a model, a schedule, and a **scope** (these spaces, those goals — nothing more). It plans its work, executes step by step, and posts updates into the same feeds and Review inbox as everyone else. Safety is layered: run it in **sandbox** (a full dry-run you can read), or the default **batch-approval** mode (it works overnight; you approve its proposed writes over coffee), or grant a narrow trusted agent direct writes. Every step is logged and metered, and a **hard cost cap halts it mid-run** — an agent can never run up an unbounded bill. Air-gapped? Teammates run on your local model.

### 8.4 Bring your own AI
Anthropic, OpenAI, OpenRouter — or **Ollama and any OpenAI-compatible local endpoint** for zero-egress installs. Keys at the deployment, workspace, or personal level (your personal agent traffic can bill to your own key), encrypted at rest. A model catalog routes cheap tasks to cheap models and hard ones to strong ones. Admins get per-feature switches, budgets, quotas, prompt versioning, and privacy controls that say exactly what may leave the building — with "nothing" a fully supported answer.

### 8.5 Use your own agent (MCP)
OpenOKR is an MCP server with a real sign-in: connect Claude, ChatGPT, Cursor or a custom agent through a proper consent screen (pick the workspace, see the scopes, revoke anytime), and it works as *you*, within *your* permissions, fully audited. Local desktop agents can connect with zero network exposure. Research connectors can search and cite your workspace.

---

## 9. How strategy and execution connect

```
Company goal
   └── Space goal (aligned under it)
         └── Key result: "cut onboarding time to 3 days"   ←— measured by a live KPI, if you like
               └── Project: "rebuild the signup flow"
                     └── Work item: "ship the new email verifier"
                           └── linked to the key result — closing it moves the KR,
                               the goal, and the company cascade, live, on the Work Map
```

Post a check-in (or just close the linked work) and progress flows all the way up. The Work Map shows the whole chain with health at every node — and a stale or off-track node glows through no matter how green its parent looks.

---

## 10. Own it: deployment, privacy, and openness

| How you run it | Who it suits | What it takes |
|---|---|---|
| **Single server** | A small company, budget- or privacy-minded | One Docker Compose file + a first-run **web setup wizard** (it generates every secret and tests your connections). ~30 minutes on a $10 VPS. |
| **Enterprise** | A university or large organisation | A Helm chart on your Kubernetes, your Postgres, SSO, backups, audit controls. |
| **Zero-ops cloud** *(planned, post-v1)* | A solo founder or tiny team | A deploy-button path once the serverless profile ships. |

**Your data, your rules.**

- **Open source (AGPL).** Free, auditable, community-owned direction. Never locked in.
- **Self-hosted = data residency.** Your country, your servers, your rules.
- **Air-gap capable.** Fully offline: local AI or no AI, self-hosted assets, no telemetry unless you opt in.
- **Secure by construction.** Tenant isolation enforced *inside the database*, passkeys and TOTP from day one, an append-only audit log with cryptographic tamper-evidence, scoped expiring API tokens, session management, strict browser protections.
- **Provably portable.** Encrypted workspace export/import, backups whose restores are tested automatically, and (for hosted setups) support access that is time-boxed and **visible to you** — you can see who from the operator was in your workspace, when, and what they did.

---

## 11. Getting started

1. **Deploy** — `docker compose up`, open the wizard, done.
2. **Set up** — name the workspace, pick a brand color and your check-in day, invite teammates (or share an invite link) — or click **"Explore with demo data"** to poke around a realistic company first.
3. **Bring your data** — run the FlowyTeam importer or upload CSVs, preview the dry run, then import for real.
4. **Set your goals** — create a cycle and your first goals with champions and reviewers (or let AI draft them from a sentence).
5. **Plan the work** and link it to key results — progress starts flowing up the Work Map from day one.
6. **Friday comes** — everyone's Review inbox fills, check-ins get posted and acknowledged, and the company knows where it stands. That's the product.

---

## 12. At a glance

| Area | What you get |
|---|---|
| **The rhythm** | Scheduled check-ins, champion + reviewer accountability, the Review inbox, visible staleness |
| **Strategy** | Weighted, direction-aware OKRs with value history + trend forecasts, alignment cascade, cycles, a full KPI module with calculated formulas, scorecards |
| **Execution** | Projects with health check-ins + retrospectives, rich milestones, multi-assignee work items, kanban boards, the Resource Hub |
| **The link** | Work items ↔ key results ↔ KPIs; progress cascades live up the Work Map |
| **AI** | Assists everywhere, a copilot, AI teammates (sandboxed, batch-approved, cost-capped), MCP for your own agent, your key or a local model |
| **Platform** | Spaces, discussions, typed live feed, smart notifications + digests, people & org chart, ⌘K search, exports, workspace portability |
| **Ownership** | Open source, self-hosted in ~30 min, air-gap capable, database-level isolation, tamper-evident audit |
| **Later (the power floor)** | Custom fields, custom workflows, saved views, Gantt/scheduling, time tracking, backlogs, meetings — added after launch, never required |

---

*Working name: the product is referred to here as **OpenOKR**. For the technical design and the build plan behind everything above, see [REQUIREMENTS.md](REQUIREMENTS.md), [TECHNICAL-PLAN.md](TECHNICAL-PLAN.md) and [AI-NATIVE-PLAN.md](AI-NATIVE-PLAN.md) in this folder. For why the plan looks this way, see [OPERATELY-COMPARISON.md](OPERATELY-COMPARISON.md).*
