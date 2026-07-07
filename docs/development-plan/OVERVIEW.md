# OpenOKR — Product Overview

*An open source platform where teams set their goals, plan the work that moves them, and track both in one place. Self-hosted or in the cloud, AI-native, and yours to own.*

This document is for the people who will use OpenOKR: team members, team leads, PMO and operations managers, and the admins who run it. It explains what OpenOKR is, who it is for, every module and what it does, and the benefit you get from each. For the engineering plan behind it, see the other documents in this folder.

---

## 1. What OpenOKR is

Most organizations run their **strategy** in one tool and their **work** in another. Objectives and KPIs live in a spreadsheet or a dedicated OKR app, while the actual work runs in a separate project tool. The two drift apart. Nobody can answer the simple question: *is the work we are doing actually moving the goals we set?*

OpenOKR closes that gap. It is two products in one:

- A **strategy platform** — objectives and key results (OKRs), key performance indicators (KPIs), and check-ins, cascaded across the whole organization.
- A **work and project management platform** — work packages, boards, Gantt timelines, wikis, meetings, and time tracking.

They meet at the level where work happens: a task can be linked to the key result it advances, so progress on the ground rolls up into progress on the goal. When a team closes work, the objective moves. That single connection is the heart of the product.

On top of both pillars sits an **AI layer** that is built in from day one, not bolted on: AI helps you write and improve OKRs, break goals into work, summarize threads and meetings, and answer questions about your own data. You can also drive OpenOKR from your own AI agent through a built-in agent connection (MCP), and point the AI at your own provider key or a local model.

And it is **open source**. You can run it on a shared cloud, on a single cheap server, or on your own enterprise infrastructure. Your data stays where you put it.

### In one paragraph

OpenOKR connects goals to the work that delivers them, gives every team a fast modern interface to run both, uses AI to remove the busywork of goal-setting and reporting, migrates your existing data in, and lets you own the whole thing.

---

## 2. Who it is for

| You are… | OpenOKR gives you… |
|---|---|
| **A team member** | A clear view of what is assigned to you, one place to update status, log time, comment, and get notified — plus visibility of how your work connects to team goals. |
| **A team or project lead** | Planning tools (boards, Gantt, backlogs), the ability to assign people and track progress, and objectives your team can rally around. |
| **A PMO or operations manager** | OKR cycles and KPI reviews, a portfolio view across projects, dashboards, scorecards, and exports for reporting. |
| **An org or IT admin** | User and role management, single sign-on, audit trails, backups, and a system that can pass a security review at scale. |
| **A team migrating from another tool** | A one-time importer that moves your existing OKRs, KPIs, projects, and work across without losing data. |

**Organizations it fits:** universities and institutions that need to self-host and prove compliance; companies that want strategy and execution in one place; agencies and consultancies running many client projects; and any privacy-minded or budget-minded team that would rather own its tools than rent them.

---

## 3. Why OpenOKR — the benefits at a glance

1. **Goals and work in one place.** Link a task to a key result and progress flows upward automatically. No more reconciling a strategy spreadsheet against a project tool by hand.
2. **AI-native, everywhere.** AI drafts and critiques OKRs, decomposes goals into work, summarizes threads and meetings, and answers plain-language questions about your data. It is an accelerator over everything you can already do by hand, never a black box you are forced to trust.
3. **Use your own AI agent.** OpenOKR ships an agent connection (MCP), so you can manage your OKRs and projects from Claude, Cursor, or any AI agent you prefer — acting as you, within your permissions.
4. **Own your data.** Open source under AGPL. Self-host it. Run it fully offline (air-gapped) if you must. Point AI at a local model or turn it off. No lock-in.
5. **Fast and modern.** A Linear- or Notion-class interface: edit in place, jump anywhere with a command palette, dark mode, full keyboard control, a responsive mobile shell, and live updates. The network is invisible.
6. **Migrate without losing data.** Importers bring your existing goals, KPIs, projects, and work across in a single maintenance window, with a full report and a rollback path.
7. **Enterprise-ready by construction.** Database-level tenant isolation, single sign-on, an append-only audit log, scoped access tokens, and accessibility to WCAG 2.1 AA.
8. **Deploy anywhere, same product.** A cloud deploy button, one Docker Compose file on a VPS, or a Helm chart on Kubernetes — all run the same release with the same behavior.
9. **Works the way you work.** Ready-made templates and guides for PM², PMflex, PRINCE2, SAFe, Scrum, and OKR, without forcing any one method on you.

---

## 4. The modules in detail

OpenOKR is organized into four groups: the **Strategy** modules (your goals), the **Work & project management** modules (your execution), the **AI & agents** layer, and the **Platform** capabilities that everything shares.

A note on availability: OpenOKR is delivered in stages. Most of what follows is core to the first release. A few modules are fast-follow or planned; these are marked *(fast-follow)* or *(planned)* so the picture is honest. Everything is designed for from the start.

---

### Part A — Strategy: set and track your goals

#### 4.1 OKRs (Objectives & Key Results)

**What it is for.** Turn ambition into something measurable and shared. An **objective** is what you want to achieve; **key results** are the numbers that prove you achieved it.

**What you can do:**

- Create objectives owned by the **whole company**, a **team or department**, or an **individual** — personal, team, and company OKRs all live together.
- Add **key results** as a numeric range (from a starting value to a target) with a unit, so progress is a real percentage, not a guess. Key results can go **up** (grow signups) or **down** (cut response time); OpenOKR scores both correctly.
- **Weight** objectives and key results so the important ones count for more.
- Set a **confidence** level (how likely you are to hit it) that drives an at-a-glance status.
- **Align** objectives: roll a team objective up under a company objective, or under a specific key result. This builds the cascade that connects the whole organization.
- **Check in** on progress (update the value, confidence, a remark, and a category like "blocker" or "risk").
- View the **alignment tree** — company to team to individual — and click any node to open it.
- **Link work** (tasks and work packages) to a key result, so execution and strategy stay connected.
- Move an OKR between cycles or owners, copy an OKR, and discuss it in a threaded conversation.

**The benefit.** Everyone can see how their goals ladder up to the organization's goals, and progress is computed from real numbers instead of status-meeting optimism. A scoring engine recalculates progress, a red/amber/green health color, and a status (on track / at risk / and so on) automatically, and cascades changes upward the moment you check in.

#### 4.2 OKR cycles

**What it is for.** Time-box your goals. OKRs live inside a **cycle** (a quarter, half, month, or year).

**What you can do:** run cycles on a cadence you choose; OpenOKR generates upcoming cycles automatically. Switch the active cycle from a single control shared across all your strategy screens. Archive a cycle when it closes and open the next one. Set limits (maximum objectives per owner), red/amber/green thresholds, and even rename the terminology ("OKR", "objective", "vision") to match your house language.

**The benefit.** A predictable rhythm for goal-setting and review, without manual cycle admin every quarter.

#### 4.3 KPIs (Key Performance Indicators)

**What it is for.** Track the recurring metrics that matter — independent of any single objective. Revenue, uptime, NPS, tickets closed: the numbers you watch every period.

**What you can do:**

- Define KPIs inside a **category**, each with a **frequency** (daily, weekly, monthly, quarterly, yearly), a unit, a direction (higher-is-better or lower-is-better), a default target, and health thresholds.
- Record **target vs actual** for each period, on a grid where KPIs are rows and periods are columns.
- Build **calculated KPIs** from a formula over other KPIs — including rolling finer periods up into coarser ones (sum daily numbers into a monthly total). Change a source number and everything that depends on it recomputes.
- Organize KPIs in a **parent/child tree**.
- **Link a KPI to a key result**, so a key result is measured directly by a live metric.

**The benefit.** One living scorecard of your operational health, with automatic achievement percentages and health colors, and metrics that feed straight into your OKRs.

#### 4.4 Check-ins *(fast-follow)*

**What it is for.** A light, regular ritual — usually weekly — to update goals and surface problems early.

**What you can do:** open a check-in session for the period, optionally note your mood, then for each objective and key result update your confidence, the latest value, a remark, and a category (challenge, blocker, risk, suggestion, solution, resource request). Submit it; a manager can review it. Every check-in is kept as a dated snapshot, so you have a history of how confidence moved over time.

**The benefit.** Blockers get raised while they are still small, and you get an honest, time-stamped record of momentum instead of a scramble at cycle-end.

#### 4.5 Scorecard & performance snapshots *(fast-follow)*

**What it is for.** A per-owner, per-cycle summary of how the OKRs and KPIs actually turned out.

**What you can do:** when a cycle closes, archive it into a snapshot — the result value plus counts of objectives and key results in each health bucket (completed, on track, at risk, not tracked). See trends across cycles and export the scorecard. An **optional points layer** can combine OKR, KPI, task, and attendance results into a score with configurable weights; this is **off by default** and entirely opt-in.

**The benefit.** A clean, exportable record of each cycle for reviews and reporting, without hand-building slides.

---

### Part B — Work & project management: deliver the work

#### 4.6 Work packages

**What it is for.** The core unit of work. A work package is a task, a bug, a feature, a milestone — anything that needs to get done, with an owner and a due date.

**What you can do:**

- Create and edit work packages with a **type**, status, priority, assignee, responsible person, dates, target version, and parent.
- Build **hierarchies** (parent and child work packages) and **relationships** between them (blocks, precedes/follows, relates).
- **Comment**, **watch** for updates, and **attach files**.
- **Bulk-edit** many at once, and **export** to CSV, Excel, or PDF.
- Link a work package to an **objective, key result, or KPI** so your delivery is tied to your goals.
- Add a lightweight **checklist** of subtasks, and set **recurrence** for work that repeats.

**The benefit.** One flexible work item that scales from a personal to-do to a governed enterprise deliverable, and always knows which goal it serves. (OpenOKR unifies lighter "tasks" and heavier "work packages" into this single entity, so you never juggle two systems.)

#### 4.7 Projects & versions

**What it is for.** Give work a home and a hierarchy, and give releases their milestones.

**What you can do:** create projects with a short identifier, nest sub-projects, archive old ones, and mark a project as a template to copy from. Manage **versions** (milestones or sprints) with sharing scope and dates. Turn modules on or off per project, so each project shows only what it needs.

**The benefit.** A tidy structure for everything from a two-person effort to a multi-team program, with reusable templates so new projects start in seconds.

#### 4.8 Types, statuses & workflows

**What it is for.** Different kinds of work need different fields and different lifecycles. A bug is not a milestone.

**What you can do:** define **work package types** with their own form layout, define **statuses** (open, closed, read-only), and set a **workflow** — which status transitions are allowed, for which type, for which role. You control who can move what, and where it can go next.

**The benefit.** Your process is enforced by the tool, not by reminders, and each type of work behaves the way it should.

#### 4.9 Custom fields

**What it is for.** Every organization tracks a few extra attributes the standard fields do not cover.

**What you can do:** add custom fields (text, number, date, yes/no, single- or multi-select lists, user, version, link, and more) to work packages, projects, users, versions, and time entries. Group them into sections, mark them required or searchable, and switch them on per project or per type.

**The benefit.** The tool adapts to your data, not the other way around — and your custom values are carried across when you import from another system.

#### 4.10 Views & saved queries

**What it is for.** Everyone needs their own filtered, sorted slice of the work.

**What you can do:** filter, sort, group, sum, and choose columns; then save the result as a **private** or **public** view, pin it to the sidebar, or star it. Switch the same data between a **table**, **board**, **Gantt**, or **calendar** without rebuilding your filters. Every view is deep-linkable, so sharing a URL shares the exact view.

**The benefit.** One dataset, many perspectives. A new team member sees a clean task list; a PMO opens the same list with grouping and sums. Nobody re-creates the same filter twice.

#### 4.11 Boards (Kanban)

**What it is for.** Visual, drag-and-drop work management.

**What you can do:** create boards keyed by status, assignee, version, sub-project, or parent — or a free board you arrange yourself. Drag a card between columns to change the underlying attribute (drag to "Done" and the status changes). Cards update live for everyone looking, and you can see who else is on the board.

**The benefit.** The simplest way for a team to run its work day to day, with changes reflected everywhere instantly.

#### 4.12 Gantt / timeline

**What it is for.** See the schedule and the dependencies over time.

**What you can do:** view work on a timeline with dependency arrows, milestones, and zoom from days to quarters. Drag a bar to reschedule; drag between bars to create a dependency. When a change would move other work, OpenOKR shows you a preview ("this moves 3 work packages") **before** it commits, so there are no silent surprises.

**The benefit.** Classic project planning power, minus the heaviness — and honest about the ripple effects of every change.

#### 4.13 Scheduling & working days

**What it is for.** Dates that respect reality: dependencies, durations, and non-working days.

**What you can do:** schedule work automatically from its dependencies (with lag), or pin dates manually per item. Define your organization's working days and holidays. Parent items roll up their children's dates and progress. Change a holiday and the affected work reschedules itself.

**The benefit.** Realistic plans that keep themselves consistent, instead of a wall of dates that go stale the moment anything shifts.

#### 4.14 Calendar & team planner *(fast-follow)*

**What it is for.** See work by date, and see who is doing what.

**What you can do:** view work on a month or week **calendar**, subscribe to a calendar feed, and use a **team planner** with a row per person to drag work between dates and assignees.

**The benefit.** Capacity and timing at a glance, and effortless rebalancing when someone is overloaded.

#### 4.15 Backlogs & Scrum *(fast-follow)*

**What it is for.** Run agile the proper way.

**What you can do:** manage a product backlog and sprint backlog, assign story points, rank by drag order, and track a burndown. Start and complete sprints. Sprints can be **shared across projects** for scaled-agile setups.

**The benefit.** A full Scrum toolkit built on the same work items you already use, so agile and non-agile teams share one system.

#### 4.16 Time & cost tracking *(fast-follow)*

**What it is for.** Know where the hours and money go.

**What you can do:** log time against work with an activity and a comment, start and stop a **timer**, and record costs with cost types. Define **hourly rates** with an effective-from history. Who can see whose rates is controlled by permission.

**The benefit.** Accurate effort and cost data for billing, budgeting, and retrospectives — with rate privacy respected.

#### 4.17 Budgets *(planned)*

**What it is for.** Plan spend and compare it to reality.

**What you can do:** set project budgets made of labor and material items, and track them against actual time and cost.

**The benefit.** Early warning when a project is heading over budget.

#### 4.18 Wiki *(fast-follow)*

**What it is for.** Your project's living knowledge base.

**What you can do:** write pages in a rich editor, organize them in a tree, link between them, keep a version history, and export to PDF. See which pages link to the one you are reading.

**The benefit.** Documentation that lives next to the work it describes, not in a separate silo.

#### 4.19 Meetings *(fast-follow)*

**What it is for.** Meetings that produce outcomes, not just calendar invites.

**What you can do:** build a structured agenda with timed items, link agenda items to the work they concern, invite participants, capture outcomes and minutes, and send calendar invites. Set up recurring meetings with a plain-language schedule ("every two weeks on Tuesday"). Closing a meeting locks the minutes and can email a summary.

**The benefit.** Every meeting has a clear agenda and a durable record, with action items that become real work.

---

### Part C — AI & agents (built in from day one)

OpenOKR is **AI-native**: AI shows up as helpful actions throughout the product, never as a separate gimmick. Every AI feature is an accelerator over something you can already do by hand, so nothing breaks if you turn AI off, and everything an agent does happens **inside your own permissions**.

#### 4.20 AI assists in every module

**What you can do:**

- **OKRs:** draft an objective and its key results from a plain goal, rate how clear an objective is, improve an objective or key result, suggest the next key result, suggest a metric and target, suggest which parent to align under, and coach you on whether an OKR is any good.
- **KPIs:** suggest KPIs for an objective, suggest targets and thresholds, describe a formula in words and get the calculated KPI built for you, and narrate what a trend is telling you.
- **Work & projects:** summarize a long comment thread, break an objective or epic into work packages, draft a work package from a sentence, suggest an assignee or estimate, and write a project status paragraph or release notes.
- **Meetings & wiki:** draft an agenda from linked work, turn meeting notes into outcomes and action items (created as real work packages), and draft, expand, or summarize a wiki page.
- **Anywhere:** ask a question across your OKRs, projects, and wiki and get a grounded answer; or ask in plain language ("show at-risk objectives in Marketing this quarter") and get the filtered view.

**How it stays safe.** AI **proposes**, you **confirm**. Every AI suggestion appears as a preview or a "before → after" change that you approve before anything is saved, with a normal undo afterward. AI-generated values are labeled so you always know their origin.

**The benefit.** The busywork of goal-setting, breaking down work, summarizing, and reporting largely disappears, while you stay in control of every change.

#### 4.21 The copilot

**What it is for.** A single assistant that can both answer and act.

**What you can do:** open a copilot panel from anywhere, ask about your workspace, and have it take actions for you — create an objective, check in on a key result, draft a set of tasks — each proposed for your approval. It only ever sees and cites what **you** are allowed to see.

**The benefit.** A knowledgeable helper that understands your actual data and can do the clicking, without ever exceeding your access.

#### 4.22 Use your own AI agent (MCP)

**What it is for.** Manage OpenOKR from the AI tools you already use.

**What you can do:** connect your preferred AI agent — Claude, Cursor, a custom agent — to OpenOKR through a built-in **agent connection (MCP)**. Your agent can then read and manage your OKRs, KPIs, and projects **as you**, limited to your permissions, with every action logged. You control the access with scoped tokens you can rotate or revoke.

**The benefit.** OpenOKR becomes a tool your own AI can operate, so you can run your goals and work from wherever you already think and type.

#### 4.23 Bring your own AI, or run it locally

**What it is for.** Control cost, privacy, and where your data goes.

**What you can do:** an admin connects OpenOKR to the AI provider of your choice — Anthropic, OpenAI, Google, or OpenRouter — or a **local model** via Ollama or any compatible endpoint, for fully offline use. Keys can be set for the whole deployment, per workspace, or by an individual user who wants their own usage billed to them. Admins control which features are on, what data may leave the instance, and hard spending caps.

**The benefit.** No forced dependency on one vendor, no surprise bills, and a genuine offline option for organizations that cannot send data outside their walls.

---

### Part D — Platform: the capabilities everything shares

#### 4.24 Notifications & Inbox

Stay informed without drowning. An in-app **Inbox** groups notifications by project and work item with reason chips (mentioned, assigned, watching, date alert); the bell badge updates live. Email and digest options are per-user and per-project, so you decide what reaches you and how.
**Benefit:** the right nudges, on your terms.

#### 4.25 Search & command palette

Press one shortcut (⌘K) to jump to any work item, project, or page, run any action, or search across everything — results respect your permissions. A dedicated search covers work packages, projects, and wikis.
**Benefit:** the whole product is a keystroke away; nothing is buried in menus.

#### 4.26 Dashboards & My Work *(fast-follow for project dashboards)*

A personal **Home** with your favorites, recent items, and "resume where you left off"; a **My Work** view of what is assigned to, created by, or watched by you; and configurable **dashboards** with widgets (assigned work, status charts, upcoming milestones, KPI tiles) for individuals and projects.
**Benefit:** every person and project gets a tailored cockpit.

#### 4.27 Favorites & quick navigation

Star the projects and views you use most; they sit in your sidebar and on Home, in the order you choose.
**Benefit:** your daily tools are always one click away.

#### 4.28 Roles & permissions

Access is role-based and configurable — roles carry permissions, and you assign roles per workspace and per project. Defaults (Owner, Project admin, Member, Reader) get you started; you can tune them precisely, including who manages goals, records KPIs, sees rates, or administers AI.
**Benefit:** people see and do exactly what they should, no more and no less.

#### 4.29 Audit log

Every sensitive action — sign-ins, permission changes, deletions, exports, imports, settings changes, and every AI action — is written to an append-only audit log.
**Benefit:** full accountability, and the evidence a security or compliance review will ask for.

#### 4.30 Reporting & exports

Export any work list to CSV, Excel, or PDF; export scorecards; and reach your data programmatically through a clean REST API with scoped access tokens. Large exports run in the background.
**Benefit:** your data is never trapped — take it into any report or system you need.

#### 4.31 Integrations *(fast-follow / planned)*

Link GitHub and GitLab pull requests, merge requests, issues, and pipelines to work packages; link files from Nextcloud or OneDrive/SharePoint; subscribe to calendar feeds; and create or update work by email.
**Benefit:** OpenOKR sits naturally in your existing toolchain.

#### 4.32 Data importers (migrate without losing data)

A guided, one-time importer moves your existing data in — from a legacy project tool and from FlowyTeam — covering projects, work, custom fields, comments, OKRs, KPIs, and more. It runs read-only against your old system, produces a full report of exactly what moved, is safe to re-run, and keeps a rollback path.
**Benefit:** you can switch to OpenOKR in a single maintenance window, with confidence and a safety net, instead of re-keying years of data.

#### 4.33 Language & accessibility

The interface is available in English and Bahasa Melayu at launch (with Indonesian as a bonus), and is built to add more. Dates, numbers, and times follow each user's locale and the workspace timezone. The product targets **WCAG 2.1 AA** accessibility: full keyboard operation, screen-reader labels, and sufficient contrast throughout.
**Benefit:** a tool your whole organization can use, in their language, however they work.

---

## 5. How strategy and execution connect

This is the single idea that sets OpenOKR apart, so it is worth stating plainly:

```
Company objective
   └── Team objective (aligned under it)
         └── Key result: "cut onboarding time to 3 days"
               └── Work package: "rebuild the signup flow"
                     └── linked, so closing the work moves the key result,
                         which moves the objective, which moves the company goal
```

Because a **work package can link to a key result** (or a KPI), the work your team does every day feeds the score of the goal it serves. Check in on a key result, or simply complete the linked work, and progress cascades all the way up the alignment tree in real time. You never again have to manually answer "are we actually moving the needle?" — the tool shows you.

---

## 6. Own it: deployment, privacy, and openness

OpenOKR is one product that runs three ways, all the same release with the same behavior:

| How you run it | Who it suits | What it takes |
|---|---|---|
| **Cloud** | A solo founder or small team | A deploy button and a few settings, up in minutes. |
| **Single server** | A small company, budget- or privacy-minded | One Docker Compose file on a cheap server or an office machine, in about half an hour. |
| **Enterprise** | A university or large organization | A Helm chart on your own Kubernetes, your own database, single sign-on, backups, and audit controls. |

**Your data, your rules.**

- **Open source (AGPL).** The code is free and auditable. You are never locked in.
- **Self-hostable.** Keep all your data in your own country and your own infrastructure — enough for most data-residency requirements.
- **Air-gap capable.** OpenOKR can run fully offline. Point AI at a local model or switch it off; nothing critical depends on an outside service.
- **Secure by construction.** Each tenant's data is isolated at the database level, sign-in supports passkeys and multi-factor and (in the enterprise tier) single sign-on, access tokens are scoped, and everything sensitive is audited.
- **Private AI.** Admins decide whether AI is on, which provider it uses, what data may leave the instance, and how much it may spend.

**Benefit:** you get a modern goals-and-work platform without renting it, without shipping your strategy to someone else's cloud, and without betting your institution on a vendor.

---

## 7. Works the way you work: methodologies

OpenOKR does not force a single method. It ships ready-made **template projects and short guides** for the ways teams actually run:

- **OKR** — a starter cycle with sample objectives and key results wired to the native strategy module.
- **Scrum** and **SAFe** — team and program projects with boards and shared sprints.
- **PM², PMflex, and PRINCE2** — governance templates with phases, gates, and standard artifacts.

Pick a template when you create a project and you start with the right structure, terminology, and guidance already in place.
**Benefit:** best-practice scaffolding on day one, with the freedom to adapt or ignore it.

---

## 8. Getting started

1. **Deploy** using whichever path fits (cloud, single server, or enterprise).
2. **Set up your workspace** in a short guided flow: name it and pick a brand color, invite teammates, and create your first project from the template gallery — or click "explore with demo data" to look around first.
3. **Bring your data** if you are coming from another tool: run the importer in preview mode to see exactly what will move, then run it for real.
4. **Set your goals** — create a cycle and your first objectives and key results (or have AI draft them from a sentence).
5. **Plan the work** and link it to your key results, so progress starts flowing upward from day one.

A short product tour points out the essentials (the sidebar, the command palette, creating work, the Inbox) the first time you sign in.

---

## 9. At a glance

| Area | What you get |
|---|---|
| **Strategy** | OKRs with alignment and automatic scoring, KPIs with calculated metrics, check-ins, scorecards |
| **Execution** | Work packages, projects, boards, Gantt, scheduling, backlogs, calendar, time & cost, wiki, meetings |
| **The link** | Work items connect to key results and KPIs; progress cascades up automatically |
| **AI** | Assists in every module, a copilot that acts for you, and your own agent via MCP — with your key or a local model |
| **Experience** | Inline editing, command palette, dark mode, keyboard control, live updates, mobile-ready |
| **Platform** | Notifications, search, dashboards, roles, audit, exports, integrations, importers, multi-language |
| **Ownership** | Open source, self-hostable, air-gap capable, database-level isolation, deploy three ways |
| **Methods** | Templates and guides for OKR, Scrum, SAFe, PM², PMflex, PRINCE2 |

---

*Working name: the product is referred to here as **OpenOKR**. For the technical design and the build plan behind everything above, see [REQUIREMENTS.md](REQUIREMENTS.md), [TECHNICAL-PLAN.md](TECHNICAL-PLAN.md), and [AI-NATIVE-PLAN.md](AI-NATIVE-PLAN.md) in this folder.*
