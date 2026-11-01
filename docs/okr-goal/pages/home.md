# Home

| | |
|---|---|
| URL | `/` |
| Audience | Everyone. Most first visits come from search, GitHub and word of mouth |
| The page's one job | Say what OKRGoal is and why it is different, then get a click to the demo or to sign-up |
| Primary CTA | Start free |
| Secondary CTA | Try the live demo |
| Page title | OKRGoal: run your OKRs, don't just store them. From OKR Institute, built on open source |
| Meta description | OKRGoal runs your organisation's OKRs, from the annual plan to the quarterly close. An AI Coach checks every objective as you write it, and an AI Champion keeps the weekly rhythm in Slack, Teams and WhatsApp. From OKR Institute, built on open source OpenOKR. Free to start. |

## Section structure

| # | Section | Purpose | Layout | Borrowed from |
|---|---|---|---|---|
| 0 | Announcement bar | The latest release, so the site looks alive | One line, linked | Langflow, Firecrawl, Mastra |
| 1 | Hero | The promise in six words, the product in one sentence | H1, subhead, two buttons, install command, product image | Firecrawl, browser-use |
| 2 | Proof strip | Proof without customer logos we do not have | Four product numbers, a GitHub badge, then OKR Institute's record as who built it, and a line of sources | n8n's proof row |
| 3 | The problem | Name the failure everyone recognises | Headline, short paragraph, three cards | Our README |
| 4 | Pillar 1: the method | Show a check firing, not describe it | Split: a draft being coached on the left, the list on the right | Firecrawl's live query box, Langflow's interactive mini UIs |
| 5 | Pillar 2: the agents | Make the two agents concrete | Two cards, each with a real message and its rule key | Mastra's tabbed primitives |
| 6 | Reach | Show it working where people already are | Logo row and a chat mock | n8n integrations |
| 7 | A week in the rhythm | The product being active, in time order | Horizontal timeline, five stops | Our own. The step-by-step idea is RAGFlow's industry workflows |
| 8 | AI off | The difference no competitor has | Two columns: what is code, what the AI adds. Six governance chips | Our own |
| 9 | Your own agent | Speak to developers and agent users | Code block with a copy button | Mastra's "Copy agent prompt" |
| 10 | Run it your way | Cloud, one server, Kubernetes | Three cards | OpenHands' "Start on your laptop. Scale to the cloud." |
| 11 | Every seat at the table | Every reader finds their row | Tabs by role | n8n's persona tabs |
| 12 | Built in the open | Community and the method as public text | Text, GitHub card | OpenHands' "Open source at the core" |
| 13 | FAQ | Objections, and search | Accordion, nine questions | Mastra, n8n |
| 14 | Final CTA | One more chance to act | Headline, three actions | Firecrawl |

---

## 0. Announcement bar

> **New in OKRGoal and OpenOKR 0.4:** connect Claude, ChatGPT or your own agent by pasting one prompt. **Read the release →**

Links to the v0.4.0 release on GitHub. Update with every minor release.

## 1. Hero

**Eyebrow:** From OKR Institute · Built on open source

# Stop storing OKRs. Start running them.

**Subhead:**
OKRGoal is where your organisation's OKRs live and run, with the method built in. The OKR Coach checks every objective as you write it. The OKR Champion keeps the weekly rhythm in Slack, Teams, WhatsApp and email. It runs on OpenOKR, which is open source, so you can also host it yourself, free.

**Buttons:** `[ Start free ]` `[ Try the live demo ]`

**Under the buttons, small:** Every feature on every plan. No credit card.

**Install line**, a copyable code chip below:

```sh
git clone https://github.com/open-okr/open-okr && cd open-okr/deploy/docker && ./openokr up
```

Caption beside the chip: **Or self-host OpenOKR in about half an hour →**

**Beside the install chip, a small menu:** `Connect your agent ▾` with the Claude, ChatGPT and Hermes icons. It opens: **Claude Code** · **ChatGPT** · **Hermes Agent** · **Copy setup prompt**. Each item copies the matching step from the product's own setup prompt, pointed at the cloud. Browser-use and Firecrawl both put this beside their main button; OpenOKR already generates the prompt (`apps/web/lib/agent-setup-prompt.ts`).

> **Decision needed:** ships only once the cloud agent endpoint exists (README decision 3). Until then, leave the menu out and keep section 9.

**Visual:** the Work Map ([01-work-map.png](../../mockups/png/01-work-map.png)), slightly tilted, with two cards floating over it:

1. A Coach card over a key result reading "Hold twelve customer interviews":
   > **OKR Coach** · `KR-5 Impact, not effort`
   > This measures activity volume. Ask why. If you can measure that impact, make it the key result and keep the activity as a leading indicator.
2. A Slack message in the corner:
   > **OKR Champion** · `checkin.due`
   > Your check-in for *Cut time to first value* is due today. It takes a minute. **Check in**

> **Rule keys on the site are real.** Every key shown in a mock on this site (`KR-5`, `OBJ-1`, `checkin.due`) exists in METHOD.md and `packages/method`, and the quoted coaching text is the rule's own. Keep it that way: the product's whole claim is that every message resolves to a rule.

## 2. Proof strip

**First, four product numbers in a row:**

| 26 | 8 | 7 | 0 |
|---|---|---|---|
| quality checks run as you type | guided phases, from annual plan to quarterly close | places it reaches you, from Slack to your own AI agent | features behind a paywall |

**Beside the numbers:** the live GitHub star badge. `★ Star on GitHub {stars}`

**Then one line in small caps:**
Built by OKR Institute · Coaching organisations through OKRs since 2017 · 1,000+ organisations · 50+ countries

**Line under it, small caps, muted:**
Built on published sources: Doerr · Grove · Wodtke · Castro · Lamorte · Cagan · Google's OKR playbook

> **Design note:** this is where the reference sites put a customer logo wall. OKRGoal has no customers to name yet, and inventing them is not an option. OKR Institute's record does the job honestly, the way Mastra's case-study numbers do: the people behind the product have done this before. It comes after the product numbers and says "Built by", because it is the maker's record, not what the product does: right under the hero, "people trained" made OKRGoal read as a training product. The sources line says the method is not made up. OKR Institute's training clients are not OKRGoal customers, so their names and logos never appear here. Replace this strip with OKRGoal customer logos only with written permission.

## 3. The problem

## OKRs rarely fail in January. They fail in week six.

Somebody writes the objectives in a spreadsheet. Nobody checks in by March. The quarterly review is a meeting where everyone agrees things went reasonably well.

The method that makes OKRs work has been understood for twenty years. It just never lived in the software.

**Three cards:**

| Spreadsheets | OKR trackers | Consultants |
|---|---|---|
| No rhythm, no owner, no quality bar. Nobody is ever told anything. | A database with a progress bar. They store your objectives faithfully, then wait to be visited. | The method is real. Then it walks out of the door with the consultant, and nothing keeps it going on a wet Tuesday in week six. |

**Closing line, centred:**
OKRGoal fixes this two ways at once. **The method is in the product. And the product is active.**

## 4. Pillar 1: the method

**Eyebrow:** The method

## Rules that run, not a template.

The whole OKR method ships as rules that run on your real OKRs: a guided eight-phase cycle, twenty-six quality checks that judge every line as you type, six publish gates, an alignment score that names its gaps, and a diagnostic at the close. It is all written down in one public document, and a test fails our build when the code and the document disagree.

**Left: a live coaching mock.** An objective field and two key results, with verdicts appearing beside them:

```
Objective   Launch the new mobile app
            ⚠ OBJ-1  Your objective starts with a deliverable.
                     If we do it and nothing changes, did we succeed?

KR 1        Hold 12 customer interviews
            ⚠ KR-5   This measures activity volume. Ask why.

KR 2        Weekly active users to 5,000
            ⚠ KR-3   A target but no baseline. Without the from,
                     you cannot prove movement.

Strength    ████░░░░░░  41
```

A toggle above it reads **Before / After the coach**. "After" shows:

```
Objective   Make mobile the way our customers prefer to reach us
            ✓ OBJ-1  This names the state you want to be in.

KR 1        Weekly active mobile users from 1,200 to 5,000
            ✓ Baseline and target
KR 2        Share of check-ins made on mobile from 8% to 30%
            ✓ Leading indicator

Strength    █████████░  88
```

**Right: what is in the method**, a short list with icons:

- **A guided cycle.** Eight phases. It knows what is missing and how many weeks you have left.
- **Quality as you write.** Twenty-six checks, each with a coaching prompt and a weak-versus-strong example.
- **Publish gates.** Owners named, key results passing, alignment stated, capacity checked.
- **Alignment that means something.** Contribution, not copying. A score that names every gap.
- **An honest close.** Was the miss a strategy problem or a rhythm problem? It tells you.
- **Your way of doing it.** Twenty-five settings and five profiles. Every rule can block, warn or be off.

**Link:** See the method →

## 5. Pillar 2: the agents

**Eyebrow:** The agents

## Two teammates who never forget a Friday.

Every workspace comes with two AI members. They have names, they show up in the feed, and you can mention them. They start the conversation. You do not have to remember to ask.

**Two cards, side by side:**

### The OKR Coach guards quality

Reviews every draft against the rules. Runs a nightly sweep for duplicated metrics and hidden dependencies. Speaks up when it matters: when the not-doing list is empty, when nothing was cut at the capacity check, when a goal says "on track" but its numbers have not moved in a month.

> **OKR Coach** · `AL-1 Supports a bigger priority`
> *Grow enterprise pipeline* has no parent and no stated reason to stand alone. Which priority does this move forward?

### The OKR Champion guards the rhythm

Reminds the goal's champion before a check-in is due. Escalates, visibly, when it is late. Holds every blocker to the next check-in. Opens the weekly session, writes the digest, keeps the streak, and drafts a recovery OKR when a KPI drops out of its band.

> **OKR Champion** · `blocker.overdue`
> The blocker on *Support cost per account* passed its check-in without its next action. Daniel owns it. I have told Sara, who coordinates this space.

**Line under both cards:**
Every message cites the rule behind it. Open the rule. Disagree with it. That is the point.

**Link:** Meet the agents →

## 6. Reach

**Eyebrow:** Where it reaches you

## It comes to you.

People do not open an OKR tool on a Thursday afternoon. So the Coach and the Champion go where people already are. Every channel works both ways: the nudge goes out, a real check-in comes back.

**Logo row:** Browser · Email · Slack · Microsoft Teams · WhatsApp · Telegram · Claude · ChatGPT · Cursor

**Chat mock**, styled as WhatsApp:

> **OKR Champion:** Hi Jonas. Your check-in for *New enterprise pipeline* is due today. What is the number this week?
> **Jonas:** 1.4m, up from 1.1m
> **OKR Champion:** Got it. How confident are you about the quarter, out of 10?
> **Jonas:** 6
> **OKR Champion:** Anything blocking you?
> **Jonas:** Legal review on the new contract template
> **OKR Champion:** Logged as a blocker, due by your next check-in. Your check-in is published. Sara will see it in Review.

**Caption:** A check-in typed into WhatsApp runs the same permission checks as a click in the browser. No chat app connected? Email and the browser cover everything.

**Link:** See every integration →

## 7. A week in the rhythm

**Eyebrow:** The rhythm

## The meeting runs itself. Your team does the thinking.

**Timeline, five stops:**

| Thursday | Friday morning | Friday, 20 minutes | Friday afternoon | A week later |
|---|---|---|---|---|
| **The reminder.** The Champion tells each goal's champion their check-in is due tomorrow, on the channel they chose. | **The inbox fills.** Everyone's Review page shows what they owe, overdue first. Most check-ins arrive from chat. | **The session.** A private confidence round revealed together. What dropped. A next action for every low score. Commitments and wins. | **The digest.** Blockers, commitments and wins, written for you, posted to the team channel. The streak ticks up. | **The escalation.** One check-in is still missing. The reviewer has heard. Now the coordinator does. The champion can see every step. |

**Line under it:**
At most one nudge per subject per day, and five per person per week. Quiet hours in your own time zone. A snooze never hides what you owe.

**Link:** See the weekly and quarterly sessions →

## 8. AI off

**Eyebrow:** AI-native, never AI-dependent

## Turn the AI off. It still coaches.

Every rule, nudge, escalation, gate, score and diagnostic in OKRGoal is code, not a prompt. Switch the AI provider off and every rule still runs. That is why it fits regulated, air-gapped and AI-sceptical organisations that would turn away a product that depends on a model.

**Two columns:**

| Always on, because it is code | Added when you connect an AI provider |
|---|---|
| Twenty-six quality checks and six publish gates | Rewrites a failing objective to pass the rule it broke |
| Scores, confidence and health | Drafts the overdue check-in from what actually moved |
| Every nudge and every escalation | Finds duplicated metrics and hidden dependencies across teams |
| The alignment score and its gaps | Drafts the digest, the minutes and the retrospective |
| KPI bands and the recovery draft | Answers questions about your workspace, with citations |
| The closing diagnostic | Puts all of it in plain language |

**Six chips under the table:**

`Proposes, you approve` `Sees only what it is given` `Hard cost cap` `Quiet by design` `Bring your own model` `Local models, zero egress`

**Line:** Anthropic, OpenAI, Google, OpenRouter, Ollama, or any OpenAI-compatible endpoint. Your key, your bill, your choice.

## 9. Your own agent

**Eyebrow:** Agent-native

## Bring your own agent.

Everything a person can do in OKRGoal, an agent can do, through one permission-checked contract. Connect Claude, ChatGPT, Cursor or your own agent. It signs in as you, through a consent screen, and works only within your permissions. Every call is audited.

**Code block, with a "Copy" button.** Tabs: **Claude Code** · **Hermes Agent** · **ChatGPT**

```sh
claude mcp add --transport http openokr https://app.okrgoal.com/api/mcp
# Then run /mcp, choose openokr and sign in.
```

**Beside it, three example requests:**

- "What do I owe this week?"
- "Draft my check-in for the onboarding objective from what changed since Monday."
- "Review this quarter's OKRs against the method and tell me the three weakest key results."

**Small print:** In the product, one button copies a setup prompt you paste into your agent. No token to copy, and nothing secret in your clipboard.

> **Decision needed:** the cloud agent endpoint. `app.okrgoal.com/api/mcp` is a placeholder until the cloud address is chosen.

## 10. Run it your way

**Eyebrow:** Deploy

## Same product. Your choice of where it runs.

**Three cards:**

| OKRGoal | OpenOKR on one server | OpenOKR on Kubernetes |
|---|---|---|
| **We run it.** Sign up and start. Backups, upgrades and monitoring are ours. Your OKRs are yours. | **Free, on your own machine.** Docker Compose and a setup wizard. About half an hour. PostgreSQL is the only thing it needs. | **For universities and large organisations.** A Helm chart with your database, your single sign-on and your backups. |
| `[ Start free ]` | `./openokr up` | `helm install openokr oci://ghcr.io/open-okr/charts/openokr` |

**Line under the cards:**
The same release everywhere. Export your whole workspace from one and import it into another, in either direction, whenever you like.

## 11. Every seat at the table

**Eyebrow:** Who it is for

## One product. Every seat at the table.

**Tabs.** Each tab has one sentence and a screenshot.

| Tab | Copy | Image |
|---|---|---|
| **Team member** | One place, or one chat message, that says what you owe this week and lets you do it in under a minute. | Review inbox ([10-review-inbox.png](../../mockups/png/10-review-inbox.png)) |
| **Goal champion** | A composer that tells you why your key result is weak while you write it, and a check-in already drafted from what actually happened. | Draft coach ([03-draft-coach.png](../../mockups/png/03-draft-coach.png)) |
| **Coordinator** | A weekly session the product runs for you: confidence, blockers with owners, commitments, a digest, and a streak. | Weekly session ([07-weekly-session.png](../../mockups/png/07-weekly-session.png)) |
| **Executive** | The whole company on one map, escalations that reach you before things are unrecoverable, and a close that names what to fix. | Quarterly review ([08-quarterly-review.png](../../mockups/png/08-quarterly-review.png)) |
| **OKR lead** | Cycles across the organisation, KPI driver trees with recovery OKRs, alignment health with named gaps, and everything exportable. | Alignment ([05-alignment-studio.png](../../mockups/png/05-alignment-studio.png)) |
| **Admin** | Single sign-on, directory sync, backups with tested restores, a tamper-evident audit log and hard AI cost caps. | Security page illustration |

## 12. Built in the open

**Eyebrow:** Open source

## Built in the open. Argue with the rules.

OKRGoal runs on OpenOKR, which is open source under AGPL-3.0. The method is a public document, METHOD.md, with every rule, threshold and session agenda the product enforces and the published source each one rests on. If you think a rule is wrong, open an issue. If you are right, the product changes.

**Three links in a row:**

- **Read METHOD.md →** The whole method in one document.
- **Star on GitHub →** Follow every release.
- **Contribute →** The interesting problems here are method, coaching and agents, not forms.

**GitHub card:** repository name, live star count, latest release, licence.

## 13. FAQ

## Questions

**What is OKRGoal?**
The OKR platform your organisation runs its OKRs on, from OKR Institute. It holds your objectives, key results and KPIs, guides the planning cycle, checks every objective and key result as you write it, runs the weekly check-in and the quarterly review, and comes with two AI teammates, the OKR Coach and the OKR Champion, that guard quality and keep the rhythm.

**Is it a course, or a way to learn OKRs?**
No. OKRGoal is where your teams write, check in on and review their real OKRs. People do pick up the method along the way, because the Coach explains every rule it applies. If you want to learn OKRs before you start, OKR Institute runs courses and certification, separately from the product.

**Who is behind it, and how do OKRGoal and OpenOKR relate?**
OKR Institute, which has coached, trained and certified OKR practitioners since 2017. It built OKRGoal and OpenOKR on what it learned running its OKR platform, okri.io, and coaching organisations through OKRs. OpenOKR is the open source product, under AGPL-3.0. OKRGoal is OpenOKR in the cloud, run for you. It is the same release either way.

**Is it really free?**
Self-hosted OpenOKR is free, with every feature and no limit on people. OKRGoal has a free plan and paid plans priced per person. Plans differ in seats, AI allowance and support. Never in features.

**Do I need to use AI?**
No. Every rule, nudge, escalation, score and diagnostic works with AI switched off. AI adds drafting, rewriting and plain-language summaries. It never makes a decision.

**Will the agents change our OKRs without asking?**
Not by default. An agent proposes a change and a person approves it. You can run an agent in sandbox mode, where it commits nothing, or give one narrow agent direct writes if you trust it.

**We do OKRs our own way. Will it fight us?**
It has twenty-five practice settings and five starting profiles, including Google-style and Radical Focus. Every quality check and publish gate can block, warn or be off. By default, only structural problems block publishing. Everything else coaches.

**Can we move from a spreadsheet or another tool?**
Yes. Upload a CSV or Excel file of goals, key results, KPIs, initiatives or tasks. You confirm the column mapping, see a dry run, then import.

**Where is our data?**
On your own servers if you self-host, offline if you need it. In the cloud, in the region we state, and nobody at OKR Institute can open your workspace unless an owner grants a time-limited session.

## 14. Final CTA

## Run your next quarter on it.

Start free in the cloud, or self-host in half an hour. Either way, every feature is there from the first minute, and the Coach is already checking your first draft.

**Buttons:** `[ Start free ]` `[ Try the live demo ]`
**Text link:** Self-host it →

**Small, below:** Are you an AI agent, or is one helping you? `[ Copy install prompt ]`

The copied prompt:

```text
Install OpenOKR on this machine with Docker Compose.
1. Check that Docker and Docker Compose are installed. If not, tell me how to install them for this system and stop.
2. Run: git clone https://github.com/open-okr/open-okr.git && cd open-okr/deploy/docker && ./openokr up
3. Wait until it prints the address, then tell me to open it and create the owner account in the setup wizard.
4. Remind me to back up deploy/docker/secrets/, because it holds the root encryption key.
```
