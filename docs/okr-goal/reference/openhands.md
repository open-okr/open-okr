# OpenHands (www.openhands.dev)

Captured 2026-11-01. Method: `curl` of the server-rendered HTML (a React app whose markup and asset paths still carry Webflow names), text extracted in document order. Dropdown contents and the hero install menu were read from the site's own JS bundles (`site-shell-*.js`, `hero-get-openhands-dropdown-*.js`). Pages read: `/`, `/pricing`, `/enterprise`, `/product`, `/community`.

**Notable finding:** WebFetch (and `curl -H "Accept: text/markdown"`) gets a different, agent-facing markdown page instead of the marketing site. It reads, in full:

> # OpenHands
> OpenHands is an open source platform for software engineering agents. It gives developers a GUI, CLI, SDK, and enterprise control plane for running coding agents across real engineering workflows.
> ## Build and run agents
> - Use the OpenHands GUI for interactive agent sessions.
> - Use the CLI for terminal-native workflows.
> - Use the SDK to embed agentic development in your own tools and products.
> - Use enterprise deployment options to keep control over models, data, access, and auditability.
> ## Learn more
> - Documentation / OpenHands Cloud / GitHub / API catalog: `https://www.openhands.dev/.well-known/api-catalog`

So the site negotiates content: browsers get the marketing page, AI agents get a short markdown brief. (`/llms.txt` returns 404.)

Page `<title>`: "OpenHands | Open Source AI Coding Agent Platform"
Meta description: "Build and run AI coding agents with OpenHands. Start locally, automate engineering workflows, use any model, and scale with enterprise controls."

---

## Top navigation

Left to right:

- Logo
- **Product ▾** (dropdown, each item has a one-line description)
  - Agent Canvas: "One workspace to manage all your agents."
  - Cloud: "Agents that don't stop when you do."
  - Agent Control Plane: "From agents to systems."
  - SDK: "An open SDK for building custom agents and workflows."
- **Enterprise**
- **Pricing**
- **Community**
- **Resources ▾** (two groups)
  - *Learn*: Docs, Manifesto, Blog, Benchmarks, Trust Center (links to a Vanta trust page)
  - *Company*: Press, Careers, About, Contact
- Right side: GitHub button showing the star count **"92.4K"**, then **"Access Cloud"** (secondary), then **"Get OpenHands"** (primary).

## Announcement bar

"How mature is your agentic SDLC?" with link **"Take the 2-minute quiz"** (to `/agentic-sdlc-maturity`).

## Hero

- Eyebrow / badge: none.
- **H1:** "The open platform for agentic software development"
- Subheadline: none in the markup. The H1 stands alone.
- **Primary CTA:** "Get OpenHands". This is a dropdown menu (aria-label "Install OpenHands") with five options:
  - "Try it now" / "OpenHands Cloud" (link)
  - "npm" / copy button: `npm install -g @openhands/agent-canvas && agent-canvas`
  - "npx" / copy button: `npx @openhands/agent-canvas`
  - "Docker" / "Sandboxed local container" / copy button:
    ```
    docker run -it --rm \
      -p 8000:8000 \
      -v ~/.openhands:/home/openhands/.openhands \
      -v ~/projects:/projects \
      ghcr.io/openhands/agent-canvas:latest
    ```
  - "All setup options" / "Docs for VM, source, and more" (link)
- **Secondary CTA:** "Talk to us" (to `/contact`).
- Under the buttons: **"Bring your own agent"** next to a row of icons (aria-label "Claude Code, Codex, Gemini CLI, OpenHands").
- **Visual:** a large, live-looking product mock labelled "Agent Canvas preview: Home". It shows the real UI copy: tabs "New Chat / Customize / Automate", a "Conversations" sidebar ("My New Project just now", "Repo Testing 2d ago", "Automation: PR review", "Automation: Nightly Security Pass"), a prompt "Let's Start Building! What do you want to build?", a "Model" picker, "Open Workspace Plugins", "Recommended automations" (Slack channel monitor, Slack standup digest, PR Review on Open, each with a one-line description), "Pinned automations" (e.g. "PR Triage Digest", "acme/frontend-app Weekdays at 09:00 triage-fast", "Successful just now"; "Nightly Security Pass", "Running just now") and "Recent Automation Activity".

## Homepage sections, in order

### 1. Logo wall
- Heading: "Trusted by engineers at"
- Layout: logo strip, no alt text. Files are TikTok, VMware, Roche, Amazon, C3 AI, Netflix, Mastercard, Red Hat, MongoDB, Apple, NVIDIA, Google, plus two unlabelled marks.

### 2. Automation templates
- **H2:** "Build it once. Let agents keep it running."
- Sub: "Start with a template or build your own. Trigger workflows from GitHub, Slack, Jira, Linear, schedules, and supported integrations so engineering work keeps moving without someone manually starting every task."
- CTA link: "Explore automation templates"
- Layout: auto-scrolling marquee of template cards (the list is duplicated for the loop). Each card has an H3, one sentence, and a category tag:
  - "Handle engineering requests in Slack": "Watch Slack channels for @openhands mentions, open a conversation with the message context, and reply when the agent finishes." *Team communication*
  - "Triage every new Linear issue": "Classify new Linear issues, suggest labels, find duplicates, and ask clarifying questions before work starts." *Project management*
  - "Triage incoming Jira incidents": "Watch for new bugs or incidents, gather logs and recent changes, suggest severity, and route the issue to the right owner." *Incident response*
  - "Review every pull request": "Watch for a configurable label on pull requests, inspect full PR context, and post an AI review comment once per label event." *Code review*
  - "Draft every incident retrospective": "Pull incident notes from Notion and Jira into a shared timeline with owners, decisions, and follow-up tasks." *Reliability*
  - "Remediate security findings": "Review security alerts, validate the finding, update affected code, and open a pull request with the remediation." *Security*
  - "Fix CI failures automatically": "Detect failed workflows, inspect logs, identify the likely cause, and open a pull request with a proposed fix." *CI/CD*

### 3. Automations pipeline
- Eyebrow: "Automations"
- **H2:** "From signal to shipped change."
- Sub: "Turn events from your engineering stack into end-to-end agent workflows. Trigger the work, let agents plan and execute, validate the result, ship the change, and monitor every step."
- Layout: a six-step animated pipeline: "Signal / Plan / Execute / Validate / Ship / Monitor".

### 4. Use cases
- Eyebrow: "Use cases"
- **H2:** "Put the repetitive parts of the SDLC on autopilot."
- Sub: "Use agents for the repetitive, high-volume work across the software lifecycle, while keeping engineers in control of review, approval, and merge."
- Layout: six numbered cards (01 to 06), each linking to the docs:
  - 01 "Review PRs & fix CI failures": "Review changes, catch issues, fix failed checks, and open follow-up PRs automatically."
  - 02 "Triage issues & open draft PRs": "Turn incoming requests into scoped work, gather context, and open a draft PR with the right details attached."
  - 03 "Automate QA across the release cycle": "Use agents to run repeatable checks, investigate failures, and keep quality work moving from code change through release."
  - 04 "Investigate incidents & propose fixes": "Pull together alerts, logs, and recent changes, then investigate the issue and propose a patch while humans handle judgment calls."
  - 05 "Keep docs & codebase maps current": "Update documentation and system context as the code changes so knowledge doesn't drift out of date."
  - 06 "Automate recurring engineering chores": "Handle dependency updates, QA sweeps, release notes, and other scheduled work even when laptops are closed."

### 5. Integrations
- **H2:** "Integrate with the apps you rely upon"
- Sub: "Trigger work from GitHub, Slack, Jira, Linear, and more. Use MCP to connect internal tools, APIs, and data sources so agents can act across the full engineering workflow."
- Layout: icon cloud / grid. Labelled icons: Slack, GitHub, Linear, Notion, Atlassian, Figma, Supabase, Stripe, Sentry, PostHog, Datadog, Airtable, Asana, Miro, MongoDB (plus Jira, Snyk, GitHub Actions icons).

### 6. Multi-backend
- Eyebrow: "Multi-backend"
- **H2:** "Your agents. Your models. Your runtime."
- Sub: "Standardize how agent workflows run without standardizing on one agent or model. Use Claude Code, Codex, Gemini CLI, OpenHands, or your own stack. OpenHands runs both closed models and open weights like Kimi, DeepSeek, and Qwen — locally, in the cloud, or inside your VPC."
- Layout: an interactive "Your stack" picker in a window frame, three rows of toggle buttons:
  - Agent: Claude Code (Anthropic), Codex (OpenAI), Gemini CLI (Google), OpenHands (Open source)
  - Models (change with the agent): e.g. for Claude Code "Sonnet 5 / Daily driver", "Opus 5 / Deep work", "Fable 5 / Long-running"; for Codex "GPT-5.5 / Recommended", "GPT-5.4 / Balanced", "GPT-5.4 Mini / Fast"
  - Runtime: "Local VM / Laptop / desktop", "Cloud sandbox / Always-on", "Enterprise VPC / Your network"

### 7. Infrastructure partners + partner quote
- **H2:** "Built for the infrastructure you choose."
- Sub: "OpenHands works with leading AI infrastructure providers to support agent workloads across the models, hardware, and deployment environments your organization already uses."
- Layout: two partner logos (AMD and one unlabelled mark), then a large pull quote set as an H2:
  - "The integration of Lemonade Server with OpenHands reflects AMD's commitment to open-source innovation and developer choice. This collaboration enables local coding agents that prioritize privacy, cost efficiency, and flexible model selection – while taking advantage of acceleration on Ryzen AI PCs. Together, we're supporting a range of workflows and staying true to open-source values."
  - Adrian Macias, Director, Developer Acceleration at AMD

### 8. Adoption path (three columns, like pricing tiers without prices)
- **H2:** "Start on your laptop. Scale to the cloud."
- Sub: "Start locally with the agents and models you choose. Turn what works into shared automations, then scale successful workflows into production."
- Layout: three columns, each with a label, H3, five bullets and a CTA.
  - **Individual developer** / "Start running agents your way." Bullets: "Run locally against real code", "Bring Claude Code, Codex, OpenHands, or the agent you prefer", "Run multiple agents in parallel", "Turn useful tasks into your first automation", "Move execution to a VM when your laptop becomes the limit". CTA: **"Download free"**
  - **Team** / "Turn agent wins into shared automations." Bullets: "Share automations instead of rebuilding prompts", "Trigger work from GitHub, Slack, Jira, CI, or schedules", "Keep agents running when laptops are closed", "Run workflows across repositories and teams", "Standardize the patterns that actually work". CTA: **"Create account"**
  - **Enterprise** / "Run production agents with full control." Bullets: "Deploy in your VPC or controlled environment", "Isolate agent execution in secure sandboxes", "Define who and what agents can access", "Audit every action, workflow, and user", "Manage usage, budgets, and organizational policies". CTA: **"Talk to sales"**

### 9. Agent Control Plane
- Eyebrow: "Agent Control Plane"
- **H2:** "Control how agents operate in production."
- Sub: "As agent usage spreads across teams, OpenHands gives platform and security teams centralized control over who can run agents, what they can access, where they execute, what they spend, and what they change."
- CTA: "Learn about Enterprise"

### 10. Testimonials
- **H2:** "Developers love OpenHands"
- Sub: "Join millions of developers building for the agentic SDLC"
- Layout: two rows of auto-scrolling tweet-style cards with avatar, name, handle or job title. Mostly X/Twitter posts, kept raw (including slang and a typo). Examples, verbatim:
  - Nacho Martínez Rincón, Data Scientist Advocate at Oracle: "The OpenHands SDK is one of the most complete SDKs for agent harness and agentic AI development - including enabling vibecoding with opensource models. Great reliability for tool calling through the Tool System - very dev friendly!"
  - Dan Kempe, @danielkempe: "OpenHands raised $18.8M to build cloud coding agents that solve 87% of bug tickets same day. This is what AI coding tools should be. Not another chat interface. Actual autonomous problem solving that ships to production."
  - Jingyi Zhao, Software Engineer at Walmart Global Tech: "I love this project because it is the first of its kind in coding agent space and you have the freedom to configure your own way. ..."
  - Christian Genco, @cgenco: "I haven't tried Devin yet but I freakin' love OpenHands. I prefer having more control over how it's working. ..."
  - Wil - e/acc, @wilfullyapt: "I fvkn love vibe coding with OpenHands. ..."
  - Also: Esteban Puerta, Fisherman (@Rybens92), Leonardo Gonzalez (@archimagos).

### 11. FAQ
- **H2:** "FAQs"
- Sub: "Common questions about OpenHands, security, and how teams put agents to work."
- CTA: "Contact us"
- Layout: accordion. Questions, verbatim:
  - "What is OpenHands?"
  - "How is OpenHands different from AI coding tools like GitHub Copilot or ChatGPT?"
  - "Can OpenHands work with large or legacy codebases?"
  - "Is OpenHands secure for enterprise use?"
  - "What types of teams use OpenHands?"
- Sample answer (the first): "OpenHands is an AI agent platform for software development that can execute real engineering work, not just suggest code. It runs autonomous agents that plan, write, and apply changes across your codebase, helping teams complete complex tasks end-to-end. Built on an open source foundation, it's designed for enterprise software development at scale."
- Second answer opens with: "Instead of helping you write code faster, OpenHands helps you ship changes end-to-end."

### 12. Open source block (the closing section)
- **H2:** "Open source at the core."
- Sub: "Models change. Agents change. Requirements change. OpenHands gives you an inspectable, extensible foundation you can run locally, self-host, and carry into production without rebuilding around a proprietary platform."
- Three CTAs: **"Star on GitHub"**, **"Deploy self-hosted"**, **"Join the community"**
- Stats row: **"92.4K / GitHub stars"**, **"590 / Contributors"**, **"MIT / Core license"**

## Final CTA (pre-footer band, same on every page)

"Building the open standard for autonomous software development."
"OpenHands is the foundation for secure, transparent, model-agnostic coding agents - empowering every software team to build faster with full control."
CTA: **"Join The Community"**

## Footer

Minimal. No link columns. "© 2026 OpenHands - All rights reserved", "Privacy Policy", "Contact", and icon links to Slack (`/joinslack`), X, GitHub and LinkedIn. All the navigation lives in the header's Resources menu instead.

---

## Pricing page (`/pricing`)

- **H1:** "Pricing that fits your rollout"
- No subheadline, no monthly or annual toggle.
- Three cards:

| Tier | Price | Line under price | CTA |
|---|---|---|---|
| **Agent Canvas** | "Free" | "Open source and free to self-host." | "Download" |
| **Teams** | "$500/month" | "Up to 10 users (+$50/mo per seat)" | "Start 30 Day Trial" |
| **Enterprise** | "Custom pricing" | "Built for secure, governed AI at enterprise scale." | "Contact Us" |

- Card bullets:
  - Agent Canvas: "Open source (MIT)", "Runs on your laptop or shared VM", "Single user / shared identity", "Bring your own LLM key", "Use any agent (Codex, Claude, etc.)", "Automations"
  - Teams: "Up to 10 users", "Self-hosted", "Multi-user identity & RBAC", "Bring your own LLM key", "Use any agent (Codex, Claude, etc.)", "Built-in Integrations", "Automations", "Budgeting controls", "SSO / SAML"
  - Enterprise: "Everything in Teams", "Unlimited seats", "Unlimited users", "Enterprise agreement", "Standard or Premium Support", "Customer success manager"
- Comparison table, columns Agent Canvas / Teams / Enterprise. Rows: Price, Seats, Organizations ("—", "1", "Unlimited"), Deployment ("Local Self-hosted", "Self-hosted", "Self-hosted"), Automations, Bring your own LLM, Use 3rd-party agents (Claude, Codex, etc.), MCP & secrets, User identity & RBAC, SAML / SSO, Budgeting & usage, Built-in OAuth integrations ("Select MCP only" for the free tier), Enterprise agreement, Support ("Open source community", "Best effort email", "SLA-based response times"), Customer success. Ticks are icons.
- Footnote: "The Teams plan is capped at 5,000 sessions per month. Enterprise usage remains uncapped."
- **How open source, self-hosted, cloud and enterprise are framed:** the free tier *is* the open-source product, named by product name (Agent Canvas), and it says "Open source (MIT)" as its first bullet. Every paid tier is also self-hosted; the pricing page does not sell the hosted Cloud at all (Cloud is reached via "Access Cloud" in the nav). Paid tiers sell multi-user identity, RBAC, SSO, budgets and support, not features of the agent.
- FAQ: none on the pricing page.

## Enterprise page (`/enterprise`)

- **H1:** "From agents to systems"
- Sub: "Bring your coding agents, models, and workflows together on one platform. Automate work across the SDLC with the governance, visibility, and control your organization needs."
- CTAs: **"Take a tour"** (video), **"Try it"**. Under them: "Not sure where to start with agents? See how we can help." (links to `/services`)
- Sections, in order:
  1. H3 "Your agents. One control plane." / "See how OpenHands brings agent execution, automation, governance, and visibility together in one place." (product video or tour)
  2. H2 "Your stack. Your rules." / "Run your agents, models, and infrastructure on one open platform, without vendor lock-in." The same "Your stack" picker as the homepage, then four cards: "Bring your existing agents" ("Extend Claude Code, Codex, and other coding agents with automation and enterprise controls."), "Choose your models", "Deploy on your terms", "Open by design" ("Built on an open-source foundation you can inspect, customize, and extend.")
  3. H3 "Scale AI agents across your SDLC", then three feature blocks, each with four bullets:
     - "Automate engineering workflows": "Run scheduled or event-driven agents to review PRs, fix CI failures, update documentation, and more."
     - "Govern agents at scale": "Control agent access and execution with centralized policies, permissions, and audit logs." (bullets: "Role-based access control and SSO", "Policy enforcement and execution controls", "Sandboxed execution", "Centralized audit logs")
     - "Monitor and optimize operations": "Track agent activity, usage, and costs across teams from a single control plane."
  4. Eyebrow "Automations" / H2 "From event to PR, no human in the loop." / "Wire OpenHands to the tools your team already uses. When something happens, the right agent fires, does the work, and opens a pull request." / "Every automated run is fully logged and governed by the same cost and security policies as manual sessions. Automation doesn't mean unsupervised." Four-step diagram: "Trigger: Github issue opened", "Agent: OpenHands fires automatically", "Runtime: Isolated container – Kubernetes-native", "Output: PR opened. Logs captured. Done."
  5. Customer quote: "OpenHands was the only solution that let us prompt an autonomous coding agent remotely at scale — not just on a laptop or inside a narrow CI template." Sina Pakazad, VP of Data Science at C3.ai
  6. Eyebrow "OpenHands Enterprise" / H2 "Built for teams running agents at scale." Five cards: "Self-hosted in your VPC" ("Run OpenHands on AWS, Azure, or Google Cloud while keeping code, data, and execution within your security boundaries."), "Enterprise access controls", "Enterprise integrations", "Bring your own LLM", "Access to experts" ("Get deployment and integration guidance directly from the engineers building OpenHands.")
  7. H3 "Built for enterprise security." with CTA "Visit our Trust Center"
  8. H2 "Resources": three cards (Whitepaper "Modernizing Legacy Applications with AI Agents"; Documentation "OpenHands Enterprise Documentation"; Professional Services "Accelerate Your Agentic SDLC")
  9. Closing CTA: "Ready to scale AI agents across your organization?" / "Let's talk about your agent workflows, infrastructure requirements, and what it takes to run agents at scale." / **"Talk to the team"**

## Extra pages glanced at

**`/product`**: H1 "Build better software with autonomous cloud agent". Sub "Offload toil, ship faster. OpenHands automates real development tasks with transparency, governance, and choice." CTAs "Get OpenHands" / "See developer docs". Three blocks: "Terminal / CLI", "Web GUI", "SDK". Then a competitor table, "The only open, secure, and scalable agent platform built for real engineering work". Columns: OpenHands, Devin, Claude Code, Factory. Rows: Open-source, Model-agnostic, Sandbox runtime, Self-hosted, Coding Agent SDK.

**`/community`**: H1 "Join the OpenHands Community". Sub "Connect with developers, contribute to open source, and help build the future of AI-powered autonomous software development." CTAs "Join Slack" / "View Events". Sections: "Latest Community Call" (embedded YouTube, dated), "Upcoming Events" ("Join a community call, meetup, or working session. All are welcome."; monthly community calls on Luma), "Start contributing" ("Join our mission to build better AI development tools": "Read the docs", "Issues to fix" ("Find beginner-friendly issues in our CLI repository"), "Start Contributing"), "Community contributor spotlight" (a long named quote from Michael May, "Community contributor").

---

## Tone of voice notes

- **Short declarative headlines, often in sets of three.** "Your agents. Your models. Your runtime." / "Models change. Agents change. Requirements change." / "Your stack. Your rules." Headlines end with a full stop.
- **Second person, imperative, verb-first bodies.** Card copy starts with the verb: "Watch...", "Classify...", "Detect failed workflows, inspect logs, identify the likely cause, and open a pull request..." It reads like a job description for the agent.
- **Engineering jargon used freely, never explained.** SDLC, VPC, RBAC, MCP, CI, BYO LLM key, "agent harness". The reader is assumed to be a platform or engineering lead.
- **Confident, category-claiming lines.** "The open platform for agentic software development", "Building the open standard for autonomous software development.", "The only open, secure, and scalable agent platform built for real engineering work".
- **Open source is the closing argument and the free tier.** It is framed as protection against lock-in, not as a value statement: "an inspectable, extensible foundation you can run locally, self-host, and carry into production without rebuilding around a proprietary platform." Stars, contributors and licence are shown as hard numbers.
- **Agents are workers, and humans keep the judgement.** "while keeping engineers in control of review, approval, and merge", "while humans handle judgment calls", "Automation doesn't mean unsupervised." Then, on the enterprise page, the bolder "From event to PR, no human in the loop."
- **Neutral about vendors.** They name the competing agents (Claude Code, Codex, Gemini CLI) as things you can *bring*, which turns rivals into integrations.
- **Raw social proof.** Testimonials keep the original slang and swearing ("I fvkn love vibe coding"), which signals a real developer crowd rather than polished marketing.

## What is worth borrowing

1. **The install command lives inside the primary CTA.** "Get OpenHands" opens a menu of copyable `npm` / `npx` / `docker run` lines plus "Try it now" for cloud. One button serves self-hosters and cloud triers without a second hero CTA.
2. **The adoption-path block** ("Start on your laptop. Scale to the cloud."): Individual / Team / Enterprise, five bullets each, with CTAs that change from "Download free" to "Create account" to "Talk to sales". It does the work of a pricing teaser on the homepage without showing prices.
3. **"Open source at the core" as the last section, with three numbers** (stars, contributors, licence) and three CTAs (Star, Deploy self-hosted, Join the community). The free tier on the pricing page is the same open-source product, named by name.
4. **A live product mock as the hero**, filled with realistic workflow names, schedules and statuses ("Weekdays at 09:00", "Running just now"). It shows the product working instead of describing it.
5. **An agent-readable version of the site** (markdown via content negotiation, plus `/.well-known/api-catalog`). For an agent-native product, this is a cheap way to show the claim is real.
