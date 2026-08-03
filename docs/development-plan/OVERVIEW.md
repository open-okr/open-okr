# OpenOKR: product overview

*Your OKR coach, built in. Open source, AI-native, self-hosted or in our cloud.*

This document is for the people who will use OpenOKR: team members, champions and reviewers, coordinators and facilitators, executives, and the admins who run it. It explains what OpenOKR is, who it is for, and what every part of it does. For the engineering plan behind it, see the other documents in this folder.

---

## 1. What OpenOKR is

Most organisations do not fail at OKRs because their tool was bad. They fail because the practice never happened. Somebody wrote objectives in a spreadsheet in January, nobody checked in by March, and the quarterly review was a meeting where everyone agreed things had gone reasonably well.

The practice that makes OKRs work is well understood. Run a proper planning cycle. Refuse to draft without evidence. Check every objective and key result against a quality bar before you commit a quarter to it. Align by contribution, not by copying. Hold a fifteen-minute weekly check-in that produces decisions, not status. Give every blocker an owner and twenty-four hours. Close the quarter with evidence and learn from it.

None of that lives in most software. It lives in a consultant's slide deck, and it stops when the consultant leaves.

**OpenOKR puts the practice in the product, and makes the product active.**

- **The method is built in.** A guided eight-phase cycle. Twenty quality rules that check every draft as you type. An alignment score that names its gaps. KPI health corridors that trigger recovery objectives. Two timed session formats. A diagnostic at the close that tells you whether a missed quarter was a cadence problem or a strategy problem.
- **The coach is active.** Two AI teammates work the practice alongside you. The **OKR Coach** guards quality. The **OKR Champion** guards the rhythm. They initiate. They nudge the champion whose check-in is due, escalate the blocker that aged past its clock, tell leadership their not-doing list is empty, and draft the recovery objective when a KPI drops out of its corridor.
- **They reach you where you work.** In the browser, in Slack, Microsoft Teams, WhatsApp or Telegram, by email, and through your own AI agent.
- **You own it.** Open source. Self-host it on your servers in about half an hour, or run it in our cloud. Same release, same behaviour. Export your whole workspace whenever you want.

### In one paragraph

OpenOKR runs the entire OKR practice, from the annual frame to the quarterly close, with an AI coach that checks your quality as you write and an AI champion that keeps your rhythm honest. Both work in the browser and in your chat app. Both cite the rule behind every message, so you can argue with them. Turn the AI off and the practice still runs, because the rules are real code, not a prompt.

---

## 2. Who it is for

| You are | OpenOKR gives you |
|---|---|
| **A team member** | One place, or one chat message, that says what you owe this week and lets you do it in under a minute |
| **A champion** | A composer that tells you why your key result is weak while you write it, a check-in the coach has already drafted from what actually happened, and a clear view of what is blocking you |
| **A reviewer** | Every check-in from your people in one queue for a one-click acknowledgement, with stale and at-risk work impossible to miss |
| **A coordinator** | A weekly session the product runs for you: confidence, blockers with owners and clocks, commitments, a digest, and a streak that makes the habit visible |
| **A facilitator** | A guided cycle that knows which phase it is in and what is blocking it, and a sixty-minute quarterly review with a timer, a scoring reveal and exportable minutes |
| **An executive or sponsor** | The whole company on one map, escalations that reach you before things are unrecoverable, and a diagnostic at the close that tells you what to actually fix |
| **An OKR lead or PMO** | Cycles across the organisation, KPI driver trees with recovery objectives, alignment health with named gaps, and everything exportable |
| **An admin** | Members, access, single sign-on, backups with tested restores, a tamper-evident audit log, AI governance with hard cost caps, and a system built to pass a security review |
| **An AI teammate** | A seat at the table: a name, a scope, a schedule and accountability like everyone else |
| **Your own AI agent** | A proper sign-in, so Claude, ChatGPT, Cursor or your custom agent works as you, within your permissions, fully audited |

**Organisations it fits:** companies of any size that want the OKR practice and not just an OKR database; universities and institutions that must self-host and prove compliance; consultancies running the method for clients; and any team that would rather own its tools than rent them.

---

## 3. The practice, built in

### 3.1 The guided cycle

Eight phases, from the annual frame to the close. The product knows which one you are in, what is missing, and how many weeks remain before your publication deadline.

| Phase | What happens |
|---|---|
| 0. Annual strategy | Set the frame once a year: mission, vision, mid-term strategy, two to five annual strategies, up to five annual objectives, and the year's not-doing list |
| 1. Prepare | Name a sponsor and a facilitator, book every session, and gather the seven-item input pack. Drafting is blocked until it is complete, because a planning session without inputs produces objectives written from opinion |
| 2. Diagnose | Score the previous cycle, read the KPI baselines, and rank five to ten strategic issues by impact |
| 3. Set direction | Three to five priorities, each with a statement of what will be measurably different in twelve months. Then write the not-doing list. The product will not let you skip it |
| 4. Draft OKRs | Write the objectives and key results, with the quality rules checking every line as you type |
| 5. Align and commit | Map contribution, register dependencies, check capacity, and clear six publish gates |
| 6. Run the cadence | Weekly check-ins, monthly reviews, a decision log, and one optional mid-cycle calibration |
| 7. Review and learn | Score, retro, diagnose, and feed everything into the next cycle automatically |

### 3.2 Quality while you write

Twenty rules check every objective and key result, live. Each returns a verdict, a coaching prompt, the reason it matters, and a weak-versus-strong example. Your set carries a strength score.

Some of what it catches:

- An objective that starts with "launch". If we launch it and nothing changes, did we succeed?
- Numbers in the objective. Metrics belong in the key results.
- A key result with a target but no baseline. Without the "from", you cannot prove movement.
- "Hold twelve customer interviews". That is activity. What are the interviews for? Measure that.
- Every key result lagging. You will only find out at the end. Add a leading indicator.
- Average confidence above ninety percent at drafting. That is sandbagging, not a stretch.
- An objective aligned to nothing. Name the priority it moves forward, or rethink it.

Six gates are hard. A set that fails one cannot be published: every objective owned and reviewed, every key result passing, alignment stated, dependencies confirmed or risk-owned, capacity checked with nothing over, and a publication date before day one.

### 3.3 Alignment that means something

Vertical alignment is contribution, not copying. Horizontal alignment is the dependency between two teams that both know about it.

The product scores your alignment and names every gap: no company objective anchoring the tree, an orphan goal, an objective with no key results, a skipped level, or a department with no cross-team dependency anywhere in its branch. The coach adds the findings structure cannot see: two goals that double-count the same metric, a goal that would sit better under a different parent, a hidden dependency between two teams who have not spoken.

### 3.4 KPIs and recovery objectives

KPIs describe the health of your business. OKRs describe what you are changing about it.

Build KPI driver trees: revenue is driven by new customers and order value, which are driven by conversion and basket size, and so on down to the leading indicators a team can move this week. Every KPI has a health corridor. Above ninety percent of target is healthy. Seventy to ninety is watch. Below seventy is unhealthy.

When a KPI turns unhealthy, OpenOKR drafts a **recovery objective** from its leading drivers. Objective: bring this metric back to target. Key results: move each driver from where it is to where it needs to be. The KPI then reads "recovering", and its health rises as the recovery progresses, so you can see the fix working before the lagging number catches up. A recovery board shows every unhealthy KPI across the company in one list.

### 3.5 The weekly rhythm

Fifteen to thirty minutes, four steps, run by the product.

1. **Confidence round.** Every key result gets a score from 0.0 to 1.0. Where the team votes, everyone submits privately and the votes reveal together, so nobody anchors on the champion. The champion writes one or two lines: what changed this week. Facts, not feelings.
2. **Diagnose what is low.** High and medium confidence moves on with no discussion. Every low score gets a blocker type, a named owner and one concrete action within twenty-four hours. Anything at or below 0.3 escalates to management the same day.
3. **Commitments.** Close last week's out loud, delivered or not, no negotiation. Set this week's: two or three moves that will actually shift a key result.
4. **Digest.** Generated for you, edited by the coordinator, posted to your channel.

It ends with a streak: the number of consecutive weeks your team held the session. A skipped week breaks it. It is a light touch that reliably keeps the heartbeat.

### 3.6 The quarterly review

Sixty minutes, three acts, eleven timed stages, ending in exported minutes.

**Review** asks whether you achieved the results. A room pulse first, because steady rooms round their numbers up. Then score every key result against evidence, with the objective score hidden until the team reveals it together. Then the story behind each number, owner by owner. Then recognition.

**Retro** asks how you worked. What worked and what did not, written silently then dot-voted. The four questions leadership owes the team. One honest cause for every key result under 0.7. And an anonymous five-statement survey of the practice itself, where the lowest statement becomes next quarter's process objective.

Then the **diagnostic**, which is the most valuable output of the whole session:

| Your situation | What it means |
|---|---|
| You hit the results | The question is not effort. It is whether the ambition was set high enough to be worth the quarter |
| You missed, but the rhythm was strong | A strategy or quality problem. The team ran the rhythm and still missed. Fix the key results, not the people |
| You missed, and the rhythm was weak | A cadence problem, not an ambition problem. Restore the weekly check-in before you rewrite a single objective |

**Reset** decides the next cycle. Every objective is closed deliberately as keep, modify or abandon, with a reason. Nothing carries over by default. Learnings are captured, next-quarter drafts sketched while the evidence is warm, and every action gets a name and a date.

Then the product feeds it all forward: your scores become the next cycle's Phase 2 scoring list, your carry-forward items become ranked issues that must survive prioritisation on their merits, your learnings join the input pack, and the lowest process-health statement becomes a priority.

---

## 4. The coach

Two AI teammates ship with every workspace. They are members: they have names, they appear in feeds, and they are accountable.

### The OKR Coach guards quality

It reviews every draft against the rules, runs a nightly semantic sweep for duplicates, conflicts and drift, and speaks at the moments that matter: when the not-doing list is empty at the end of direction-setting, when nothing was cut at the capacity check, when a goal is reported on track but its key results have not moved in a month, when the forecast says a key result will miss before anyone admits it, and when the scores cluster near perfect at the close.

Every message cites the rule behind it. You can open the rule and disagree with it.

### The OKR Champion guards the rhythm

It reminds the champion before the check-in is due, on the day, and daily after. It escalates: to the reviewer at the grace boundary, to the coordinator at a week, to the sponsor at a fortnight, always visibly to the person being escalated past. It runs the blocker clock: a warning at twenty hours, an escalation at twenty-four. It opens and closes the weekly session, assembles the digest, keeps the streak, watches the KPI corridors, and prepares the pack before your quarterly review so the session starts warm.

### They are safe, cheap and honest

- **Scoped.** Each agent has explicit access to named spaces and goals only. Never a blanket grant.
- **They propose, you approve.** By default every write becomes a proposal in your review queue that you apply or dismiss. You can run one in full dry-run mode, or grant a narrow trusted agent direct writes.
- **Capped.** Every step is metered, and a hard cost cap halts a run mid-flight. An agent can never run up an unbounded bill.
- **Quiet by design.** One nudge per subject per day unless it escalates. Quiet hours in your own timezone. A snooze on any message. Snoozing never hides what you actually owe.
- **Not required.** Turn AI off entirely and the coach still nudges, escalates, scores, checks quality and computes the diagnostic. All of that is real code, not a model. You lose only the drafting and the language.

---

## 5. Where it reaches you

| Surface | What you can do |
|---|---|
| **Browser** | Everything |
| **Email** | Nudges, digests, your daily summary, one-click check-in links |
| **Slack** | Get nudged, check in from a dialog, log a blocker, acknowledge, read a goal, ask the coach |
| **Microsoft Teams** | The same, in cards |
| **WhatsApp** | Get nudged, then check in conversationally by replying |
| **Telegram** | The same, with inline buttons |
| **Your own AI agent** | Connect Claude, ChatGPT, Cursor or a custom agent through a proper consent screen. It works as you, within your permissions, fully audited. Local desktop agents connect with zero network exposure |

A workspace with no chat provider connected still works completely. Email and the browser cover everything.

---

## 6. The work

Deliberately OKR-shaped. Enough to answer "what is actually moving this key result", not a project-management suite.

- **Initiatives.** The work that moves a key result: an owner, dates, a status, a confidence and a capacity verdict. The capacity check at commit time reads from these, which is why "nothing was cut" is a gate failure.
- **Tasks and the board.** A kanban with four columns where every card can link to a key result. The sidebar shows your objectives and key results with progress derived from linked completed tasks, shown beside the measured number rather than instead of it. When all the linked work is done but the number has not moved, that is exactly the divergence the coach reports.
- **Documents.** Rich documents attached to a goal, a key result, an initiative, a cycle or a session. Drafts, publishing, version history with a visual difference, comments and reactions.

---

## 7. Platform

- **Spaces** are team homes with their own goals, sessions, documents and members.
- **The Work Map** is the home screen: one company-wide tree with health, progress, confidence, champion and next step at every level, live.
- **The Review inbox** answers "what do I owe right now": check-ins due, acknowledgements owed, blockers you own, commitments due, sessions to run, agent proposals awaiting you. Overdue first.
- **Comments, mentions and reactions** everywhere, with a preview of who will be notified before you post.
- **A live activity feed** at workspace, space and goal level, filtered to what you may see.
- **Notifications** that respect you: instant for direct mentions, otherwise batched on your schedule, plus a daily summary in your timezone.
- **People and org**: profiles, a manager chain and org chart, a directory, guests, invitation links with domain rules.
- **Search and ⌘K** across everything you can see.
- **Admin**: members and access, the rhythm's defaults and thresholds, coaching strictness, branding, backups, a read-only freeze switch for maintenance, and a tamper-evident audit log with one-click verification.
- **Portability**: export your whole workspace to an encrypted, checksummed archive and import it into any other OpenOKR instance after a dry-run preview.

---

## 8. Bringing your data

- **Spreadsheets.** Upload a CSV or XLSX of goals, key results, KPIs, KPI records, initiatives or tasks. AI proposes the column mapping, you confirm it, you see a dry run, then you import.
- **FlowyTeam.** A dedicated read-only importer for one company at a time, covering teams, cycles, objectives, key results, check-ins, KPIs with their formulas, and tasks. Re-running it changes nothing. Every derived value is recomputed rather than trusted, and anything that cannot map cleanly appears in the report rather than being quietly dropped.

---

## 9. Running it

| How | Who it suits | What it takes |
|---|---|---|
| **Self-hosted, one server** | Any organisation that wants its data on its own machines | One Docker Compose file and a first-run web wizard that generates every secret and tests your connections. About 30 minutes |
| **Self-hosted, Kubernetes** | Universities and large organisations | A Helm chart, your Postgres, your single sign-on, your backups |
| **Our cloud** | Teams that want no operations | Sign up and start |

Both are the same release. Self-host is never seat-limited and never feature-gated. The cloud sells operation, not features.

**Your data, your rules.**

- **Open source** under AGPL. Free, auditable, never locked in.
- **Self-hosted means data residency.** Your country, your servers.
- **Air-gap capable.** Fully offline: a local AI model or none, self-hosted assets, no telemetry unless you opt in.
- **Secure by construction.** Tenant isolation enforced inside the database, passkeys and second factors from day one, an append-only audit log with cryptographic tamper evidence, scoped expiring tokens.
- **Provably portable.** Encrypted export and import, backups whose restores are tested automatically, and, in the cloud, support access that is time-boxed and visible to you.

---

## 10. Getting started

1. **Deploy or sign up.** Run the compose file and open the wizard, or create a cloud workspace.
2. **Set up.** Name the workspace, pick your check-in day, connect a chat provider or skip it. Or click "explore with demo data" to poke around a realistic company first.
3. **Bring your data,** or start clean.
4. **Open a cycle.** The product walks you through the eight phases. It will tell you what is missing and refuse to let you draft on a thin input pack.
5. **Draft your OKRs.** The coach checks every line as you write it, and will not let you publish a set that fails a gate.
6. **Friday comes.** Everyone's review inbox fills. The Champion nudges the people who forgot. The session runs in twenty minutes. The digest goes out. The streak ticks up.
7. **The quarter ends.** Sixty minutes, three acts, honest scores, a real diagnosis, and the next cycle already half-populated with what you learned.

That is the product.

---

## 11. At a glance

| Area | What you get |
|---|---|
| **The method** | A guided eight-phase cycle, twenty live quality rules, six hard publish gates, an alignment score, KPI health corridors, two timed session formats, and a closing diagnostic |
| **The coach** | Two AI teammates that guard quality and rhythm, initiate, escalate, cite their rules, and are scoped, capped and auditable |
| **Reach** | Browser, email, Slack, Teams, WhatsApp, Telegram, and your own AI agent |
| **OKRs** | Weighted, direction-aware key results with value history, confidence, trend forecasting, KPI-backed measurement, and full alignment with dependencies |
| **KPIs** | Driver trees, health corridors, calculated formulas, recovery objectives and a recovery board |
| **Rhythm** | Cadence with visible staleness, champion and reviewer accountability, blockers on a 24-hour clock, commitments, streaks and digests |
| **The work** | Initiatives, a key-result-linked board, and documents |
| **Platform** | Spaces, the Work Map, the review inbox, a live feed, notifications that respect you, search, admin and a tamper-evident audit log |
| **Ownership** | Open source, self-hosted in 30 minutes or in our cloud, air-gap capable, database-level isolation, full export |
| **Later** | Custom fields, custom workflows, saved views, Gantt, time tracking and sprints. Added after launch, never required |
