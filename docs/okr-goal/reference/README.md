# Reference: seven sites

Seven commercial sites for open source and AI products, studied for structure, headlines, calls to action, pricing and tone. Captured on 1 November 2026, mostly from each site's server-rendered HTML, so the quotations are verbatim. Sites change often: treat every quote as true on that date only.

**Inspiration, not a template.** Quotations here are short, for study. None of their copy goes on okrgoal.com.

| Site | What it sells | Notes |
|---|---|---|
| [Mastra](mastra.md) | A TypeScript agent framework, plus a hosted platform | No enterprise page |
| [Browser Use](browser-use.md) | Browser agents and cloud browsers | Pay as you go, no tiers |
| [Firecrawl](firecrawl.md) | A web data API for agents | Open source, but pricing never mentions it |
| [Langflow](langflow.md) | A visual builder for agents | No pricing or enterprise page. Now runs under IBM |
| [OpenHands](openhands.md) | A platform for coding agents | The closest model for "open source, then cloud, then enterprise" |
| [n8n](n8n.md) | Workflow automation with agents | Source-available ("fair-code"), not open source |
| [RAGFlow](ragflow.md) | A retrieval engine for agents | Thin site. Mostly a list of things to avoid |

## 1. The hero, side by side

| Site | H1 | Subheadline | Primary CTA | Secondary CTA | Visual |
|---|---|---|---|---|---|
| Mastra | Build AI agents | Build, observe, and improve agents that run for days with Mastra, the leading TypeScript agent framework | Get a demo | Quickstart | Mock IDE beside an observability panel |
| Browser Use | Agents that use the browser. And browsers for your own. | Browser Use Agents finish the task. Browser Infrastructure is the simple cloud browser for your own agents. | Run an agent ↗ | Connect your agent ▾ (Claude Code, Codex, Cursor, Copy setup prompt) | None. Type only |
| Firecrawl | Give your AI agents web data and beyond | The web data API to search and scrape... It's also open source. | Start for free | Connect Firecrawl ▾ (ChatGPT, Claude, Cursor, Setup for agents) | A live query box turning a page into JSON |
| Langflow | Stop fighting your tools | Langflow is a powerful tool to build and deploy AI agents and MCP servers... | Get Started for Free | Star on GitHub | A glowing flow node |
| OpenHands | The open platform for agentic software development | None | Get OpenHands ▾ (copyable npm, npx and docker commands, plus the cloud) | Talk to us | A live-looking product mock |
| n8n | Build the agent. Understand its workflow. | n8n is the platform for agents and workflows you can follow. Open any step, see what it does, and explain to anyone who runs it. | Get Started | Talk to sales | An interactive workflow canvas under a plain-language prompt |
| RAGFlow | Build a superior context layer for AI agents | Empower your AI agents through the leading open-source RAG engine... | Get Started | None | A gradient orb |

**Patterns:**

- **The H1 is short:** three to eight words. Four of seven name the reader's goal ("Build", "Give your AI agents"), not the product.
- **Two buttons:** one to start (cloud sign-up or install), one to a person or to the reader's own agent.
- **Two of seven put "connect your agent" in the hero** (Browser Use, Firecrawl), and OpenHands has a "Bring your own agent" row under its buttons. This is now a standard move for agent products.
- **Install commands live inside a button** (OpenHands) or in the final CTA (Mastra), not as bare text.
- **The best visuals show the product working,** with realistic names and states, not a stock illustration (OpenHands, n8n, Firecrawl).

## 2. Navigation

| Site | Menus | Right side |
|---|---|---|
| Mastra | Product ▾, Solutions ▾, Resources ▾, Pricing, Customers, Docs | GitHub 29K · **Get Demo** |
| Browser Use | Agents, Browsers, Showcase ▾, Resources ▾, Pricing | Talk to sales · Log in · **Start for free** |
| Firecrawl | Products ▾ (mega-menu), Resources ▾, Pricing, Docs, Blog, Playground | GitHub 197.4K · **Sign up** |
| Langflow | Docs, Resources ▾, Community ▾, Get Help ▾, Download | GitHub, Discord, X and YouTube counters. No button |
| OpenHands | Product ▾, Enterprise, Pricing, Community, Resources ▾ | GitHub 92.4K · Access Cloud · **Get OpenHands** |
| n8n | Product ▾, Use cases ▾, Docs ▾, Community ▾, plus two links | Sign in · **Get started** |
| RAGFlow | Docs, Solutions ▾, Resources ▾, Community ▾, Pricing | GitHub 93.3k · Contact us |

**Patterns:** four to six menus. Every dropdown item has a one-line description under it. A live GitHub star count sits in the nav of five of seven. One solid button at the far right.

Firecrawl's mega-menu groups its ways in as **"Surfaces"**: MCP, CLI, API, SDKs. That is a good word for OpenOKR's browser, chat, agent, API and command line.

## 3. Homepage order

The common spine, in the order most of them use it:

1. Announcement bar (Mastra, Firecrawl, Langflow, OpenHands): an event, a release, a funding round
2. Hero
3. Proof: a logo wall (Mastra, n8n, Firecrawl) or a star count (all)
4. What it does: tabs or cards, each with a short code or UI sample (Mastra, n8n)
5. How it works: a live demo, a canvas or a step diagram (Firecrawl, n8n, RAGFlow)
6. Use cases or roles (n8n's persona tabs, Mastra's use-case cards, RAGFlow's industry workflows)
7. Enterprise in brief: governance, security, deployment, on the homepage itself (n8n, OpenHands)
8. Open source: stars, contributors, licence (OpenHands, Browser Use)
9. FAQ, written for search and AI summaries (Mastra, n8n)
10. Final CTA

## 4. Proof

| Device | Who uses it | Lesson for OKRGoal |
|---|---|---|
| Logo wall of customers | Mastra, n8n, Firecrawl, OpenHands | We have no customers to show. Never fake one |
| Case studies with a number in the title | Mastra ("~1 Month", "20+ Eng Teams") | The strongest form. Collect them from the first real customers |
| Live GitHub star count | Five of seven | Cheap and always current. Use it |
| Sourced benchmark numbers | Browser Use, Firecrawl ("run Jan 13, 2026") | Honest numbers with the method shown beat adjectives |
| Raw tweets and testimonials | Firecrawl, OpenHands | Signals a real crowd. Needs a real crowd |
| Book distribution counts | Mastra ("240K+ copies") | Expertise as proof. Our parallel is METHOD.md and its sources |

## 5. How they price open source

| Site | Free self-hosted on the pricing page? | Cloud tiers | Enterprise |
|---|---|---|---|
| Mastra | **Yes**, behind a Platform / Self-Hosted toggle | Starter $0, Teams $250 a month | Custom, on both sides |
| OpenHands | **Yes**, as the first tier: "Open source and free to self-host" | Teams $500 a month for up to 10 users, then $50 a seat | Custom |
| n8n | As a side card, "Community Edition" | Starter €20, Pro €50 (billed per workflow run) | Contact sales |
| Firecrawl | **No.** Never mentioned | Free, Hobby $16, Standard $83, Growth $333, Scale $599, by credits | SSO and SCIM are enterprise only |
| RAGFlow | **No** | Free, Starter $29, Pro $129 | Contact |
| Browser Use | Not a tier. Pay as you go | Usage rates, in full | Separate page |
| Langflow | No pricing page | None stated | None |

**Lessons:**

- **Mastra's toggle and OpenHands' first tier** are the honest models: the free open source edition is on the pricing page, by name. OKRGoal's pricing page uses the toggle.
- **Firecrawl keeps single sign-on and directory sync for enterprise.** Many tools do. OpenOKR includes both everywhere, and the pricing page says so.
- **n8n argues against competitors' billing** ("If it doesn't run, you don't pay"). Our version is "pay for people, not for features".
- **Langflow's one line kills the "is the open source version crippled?" worry:** "Same Langflow whether you're using OSS or Cloud." OpenOKR can say it more strongly, because it is enforced: there is no field in a plan to switch a feature off.

## 6. Enterprise pages

| Site | Shape |
|---|---|
| n8n | **A story in five parts:** The Problem, The Platform, Governance, Observability, Support. Three deployments: managed cloud, self-hosted, air-gapped |
| OpenHands | "From agents to systems": governance, deployment on your terms, "Open by design", one named customer quote |
| Browser Use | **Written for the security reviewer:** a qualifying form, then Compliance, Data control, Commercial terms |
| Firecrawl | Plain, procurement-friendly register, and it admits limits ("no EU data residency option") |
| Mastra | No enterprise page. A "forward-deployed engineer" support page instead: a shared Slack channel, a monthly roadmap, a 4-hour SLA |
| Langflow, RAGFlow | None. Both are weaker for it |

OKRGoal's enterprise page follows n8n's story order and Browser Use's reviewer-first sections, and borrows Firecrawl's habit of saying the limits out loud.

## 7. Final CTA

| Site | Headline | Buttons |
|---|---|---|
| Mastra | Start building with Mastra today | **Copy agent prompt** · Quickstart |
| Firecrawl | Ready to build? | Start for free · See our plans · *Are you an AI agent? See setup options* |
| Langflow | Create your first flow | Get Started for Free · Star on GitHub |
| OpenHands | Building the open standard for autonomous software development. | Join The Community |
| n8n | Build workflows the way you actually think | Start building |
| RAGFlow | Start building | Get Started · Github |
| Browser Use | No separate band. The open source section closes the page | Start for free · Read the source |

**The standout:** Mastra's "Copy agent prompt" hands the visitor's coding agent a setup script. Firecrawl's "Are you an AI agent?" does the same job as a link. OpenOKR already generates a setup prompt for external agents, so this is a natural fit.

## 8. Tone of voice

| Site | In one line | Example |
|---|---|---|
| Mastra | Short, declarative, claims the category | "Workflows. Memory. Harness." |
| Browser Use | Claim, then proof, with honest small print | "The cloud browser that gets past bot walls. $0.02 an hour." |
| Firecrawl | Energetic and casual, with dated benchmarks | "No cost, no card, no hassle." |
| Langflow | Three-word slogans, visuals carry the page | "Drag. Drop. Deploy." |
| OpenHands | Headlines in threes, engineers as readers | "Your agents. Your models. Your runtime." |
| n8n | Plain and transparent, the "+" device | "Move fast + break nothing" |
| RAGFlow | Impersonal, superlatives without proof | "unmatched answer accuracy" |

**What they share:** short sentences, second person, verbs first, confident without exclamation marks. **What the best ones add:** a number or a fact after the claim, and a caveat that makes the claim believable.

**How AI is sold:** the strongest sites sell AI you can *follow*, not AI that is clever. n8n: "agents and workflows you can follow". OpenHands: "Automation doesn't mean unsupervised." That is exactly OpenOKR's position: every message cites a rule, agents propose, and the practice runs with AI off.

**How open source is sold:** calmly, near the end, and as protection against lock-in rather than as a value statement. OpenHands: "an inspectable, extensible foundation you can run locally, self-host, and carry into production without rebuilding around a proprietary platform."

## 9. What OKRGoal takes, and where

| Borrowed | From | Where it is in our copy |
|---|---|---|
| Live product demo in the hero area, not a stock image | OpenHands, n8n, Firecrawl | [home.md §1 and §4](../pages/home.md): the Work Map with live Coach cards, and the before-and-after draft |
| "Connect your agent" menu beside the main button | Browser Use, Firecrawl | [home.md §1](../pages/home.md), waiting on the cloud endpoint |
| "Copy agent prompt" as a closing CTA | Mastra, Firecrawl | [home.md §14](../pages/home.md), [open-source.md §13](../pages/open-source.md) |
| Cloud / self-hosted switch on pricing | Mastra | [pricing.md §1](../pages/pricing.md) |
| The free open source edition as a named plan | OpenHands | [pricing.md §2](../pages/pricing.md) |
| "Start on your laptop. Scale to the cloud." three-step path | OpenHands | [home.md §10](../pages/home.md) |
| Persona tabs | n8n | [home.md §11](../pages/home.md) |
| A three-item proof row with the live star count | n8n | [home.md §2](../pages/home.md) |
| Enterprise page as a story, written for the reviewer | n8n, Browser Use | [enterprise.md](../pages/enterprise.md) |
| Honest small print and stated limits | Browser Use, Firecrawl | [product.md §5](../pages/product.md), [why-okrgoal.md §5](../pages/why-okrgoal.md), [claims.md](../claims.md) |
| "Same product, OSS or cloud" in one line | Langflow | [home.md §10](../pages/home.md), [cloud.md §6](../pages/cloud.md) |
| One-line descriptions under every menu item | All of them | [sitemap.md §3](../sitemap.md) |
| `llms.txt` and agent-readable pages | Mastra, Browser Use, Firecrawl, OpenHands | [resources.md §6](../pages/resources.md) |

## 10. What OKRGoal avoids

| Avoid | Seen at | Why |
|---|---|---|
| Superlatives with nothing behind them | RAGFlow | "Leading" and "unmatched" persuade nobody who is checking |
| Leaving open source off the pricing page | Firecrawl, RAGFlow | It makes the free edition look like a secret, or a trap |
| No pricing and no enterprise page | Langflow, RAGFlow | A buyer cannot find the commercial path |
| A "free" button that leads to a lead-capture form | Langflow | It spends trust to collect an email address |
| "Book a demo" as the primary CTA | Mastra | Our demo is open. Nobody needs to book it |
| Logos and testimonials we do not have | Everyone uses them | We have none yet, so the proof is product facts and the method's sources until we do |
| Jargon left unexplained | OpenHands, RAGFlow | Our buyers include executives and HR, not only engineers |
