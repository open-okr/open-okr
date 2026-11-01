# Mastra (https://mastra.ai/)

Captured 2026-11-01 by fetching the server-rendered HTML with curl and extracting the text in document order. WebFetch only returned a summary, so every quote below comes from the HTML. I also opened the homepage in a browser to check the hero and the nav; other visual descriptions are inferred from the markup (class names, tab lists, mock UI text).

Pages read: homepage, `/pricing`, `/ai-agent-deployment` (Mastra Server, their hosted "cloud" page), `/fde-support` (the nearest thing to an enterprise page). **`/enterprise` returns a 404.** There is no enterprise page; enterprise is covered by a tier on the pricing page, a "Enterprise Support" section there, and the FDE / Support product page.

Page title: "TypeScript AI Framework for Agents and Apps | Mastra"
Meta description: "Ship AI agents that reason, remember, and act in TypeScript. Mastra provides memory, tools, MCP, and observability to go from prototype to production."

---

## Top navigation

| Item | Kind | Children (verbatim) |
|---|---|---|
| Product | dropdown | Framework ("Build agents" shown under it), Deployment, Observability, FDE / Support |
| Solutions | dropdown | Sales agents, Marketing agents, Company Brain, Financial Services, Healthcare, Customer-facing agents, Developer Infra |
| Resources | dropdown | Blog, Templates, Principles book, Workshops, Research |
| Pricing | link | |
| Customers | link | |
| Docs | link | |

Right side, in this order: a GitHub link showing the star count **"29K"**, a text link **"Get Demo"**, **"Log in"**, and a pill button **"Sign Up"** (the last two are added client-side, so they are not in the server HTML).

## Announcement bar

An orange tab hanging under the nav on the left, linking to a Luma event page: **"5 Nov • Observability and Evals Masterclass →"**

## Hero

- Eyebrow / badge: none seen.
- H1: **"Build AI agents"**
- Subheadline: **"Build, observe, and improve agents that run for days with Mastra, the leading TypeScript agent framework"**. One of the three verbs is lit green at a time and the highlight cycles (Build, then observe, then improve).
- Primary CTA: **"Get a demo"** (light pill, to /contact)
- Secondary CTA: **"Quickstart ↗"** (dark pill, opens the docs quickstart in a new tab)
- Visual (right half, dark theme): an animated product UI. The markup holds a file tree (`mastra-project` with `agents`, `tools`, `workflows`, `scorers`, `index.ts`) and an observability menu (Traces, Metrics, Logs, Evals, Experiments, Scorers, Datasets). In the browser it showed an "Evals" popover (Experiments, Scorers, Datasets) over a scored table: "Correct tool selected 100%", "Ignored user instructions 62%" (highlighted red), "Successful HITL 100%", "Correct answer 100%", "Workflow activation 100%", "Incorrect tool used 62%" (red). The hero sells observability and evals, not just building.
- Note: the sales CTA ("Get a demo") is the primary button, not the install. The install command appears only in the final CTA, inside a copyable "agent prompt".

## Homepage sections, in order

### 1. Customer logo marquee (no heading)
- Layout: scrolling logo strip directly under the hero, repeated three times for an infinite marquee. Each logo has a small grey **"Read →"** under it and links to a case study.
- Logos (from aria labels): Salesforce, Marsh McLennan, Sanity, SoftBank, WorkOS, Range, MongoDB, Factorial, Elastic, Replit, plus PayPal and Brex (not linked).
- Hover label pattern: "See how Salesforce uses Mastra".

### 2. Framework primitives
- H2: **"Workflows. Memory. Harness. Mastra agents have the tools you need to ship fast."** (Heading pattern: three short nouns, then a sentence.)
- Layout: a tab list (Agents, Workflows, Harness, Memory, Server, Factory). Each tab shows a short TypeScript file (`agent.ts`, `workflow.ts`, `harness.ts`, `memory.ts`, `server.ts`, `factory.ts`) and a title plus one-line description.
- Cards (verbatim):
  - **Agents**: "Define typed agents with instructions, models, tools, and runtime behavior in one place."
  - **Workflows**: "Compose typed steps, retries, and branches into production workflows your team can inspect and ship."
  - **Harness**: "Coordinate multi-mode agents with shared state, threads, and storage — the same harness that runs Mastra Code."
  - **Memory**: "Give agents durable context with observational memory, semantic recall, and thread-aware storage."
  - **Server**: "Register agents and workflows on one Mastra server, run it locally, and deploy the same app to Mastra Cloud."
  - **Factory**: "A system of specialized AI agents that takes software from issue to production."
- Code example (agent.ts tab, verbatim): `import { Agent } from "@mastra/core/agent"; export const weatherAgent = new Agent({ id: "weather-agent", name: "Weather Agent", instructions: \`You are a helpful weather assistant.\`, model: "openai/gpt-5.5", tools: { weatherTool }, });`

### 3. Observability
- H2: **"Best-in-class, built-in observability. You can always see exactly what your Mastra agents are doing."**
- CTAs repeated: "Get a demo", "Quickstart".
- Layout: tab list (Evals, Metrics, Datasets, Traces, Signals) with a title and one line each.
- Cards (verbatim):
  - **Evals**: "Score agent runs against repeatable checks before changes reach production."
  - **Metrics**: "Track latency, cost, model calls, and tool usage across every production agent run."
  - **Datasets**: "Capture traces and user feedback into versioned datasets for repeatable evaluation."
  - **Traces**: "Inspect every model call, tool call, and handoff from one searchable timeline."
  - **Signals**: "Subscribe agent threads to external resources and route webhook or polling events into notification signals."

### 4. Customer stories
- H2: **"Great AI teams move fast. From fast-scaling startups to large global organizations, you're in good company."**
- Layout: row of case-study cards, each with a logo, a headline carrying a number, and "Read story →".
- Cards (verbatim):
  - "How Range Built an AI-Native Investment Adviser Managing $17B"
  - "How Salesforce Built Their Harness for 100k Developers on Mastra"
  - "How Sanity Built a Content Agent for a CMS Used by 1M+ Users"
  - "How WorkOS Went From Evaluating Mastra to Using It in Prod in ~1 Month"
  - "How MongoDB Built Sage, Its Internal Agent Platform for 20+ Eng Teams"
- Social proof device: every case-study title contains a hard number ($17B, 100k developers, 1M+ users, ~1 month, 20+ teams).

### 5. Use cases
- H2: **"Empower your customers, turbo-charge your company. Mastra agents can do it all."**
- CTAs repeated: "Get a demo", "Quickstart".
- Layout: three large linked cards, each with an animated mock UI.
  - **Real-world agents**: "Build a company brain, Slack/Teams agents, or automate important business processes". Mock: a Slack thread "# Thread in #feedback" where Damien and Alex discuss missing copy, then "@agent Writing missing copy for the new webpage".
  - **Customer-facing agents**: "Answer users, complete tasks, hand off to your product flows". Mock: a chat box "How can I help you?".
  - **Developer Infra**: "Build AI SREs or give product teams shared agent primitives". Mock: a log stream of WARN / INFO / ERROR / DEBUG lines, "Warning • 3 Errors", and a "Prepare Report" button.

### 6. Resources
- H2: **"Resources"**, with sub-labels "Agent Books" and "Latest Releases".
- Layout: two book covers plus four dated blog cards.
  - "Principles of Building AI Agents" with **"240K+ copies distributed"**
  - "Patterns of Building AI Agents" with **"100K+ copies distributed"**
  - Blog cards (title, one line, date): "Introducing Span Queries" / "Find the most common failures for your coding agent to fix." / Oct 28. 2026; "Introducing MCP Events in Mastra" / "Send real-time events from MCP servers to agents, workflows, and apps." / Oct 23. 2026; "Introducing MCP 2.0 Support in Mastra" / "Upgraded support for MCP 2026-07-28." / Oct 21. 2026; "Introducing Mastra Studio-scoped SSO" / "Sign in to Mastra Studio with WorkOS, Okta, Auth0, Clerk, or Google." / Oct 19. 2026.
- Social proof device: the book distribution counts.

### 7. FAQ
- H2: **"Frequently asked questions"**. Accordion. Answers are long and written in third person, clearly for search engines and LLMs ("Mastra is...", "Mastra supports...").
- Questions (verbatim):
  1. What is Mastra?
  2. Is Mastra an agent builder?
  3. What can you build with Mastra?
  4. What AI models and providers does Mastra support?
  5. What are Mastra workflows?
  6. How does Mastra handle agent memory and context?
  7. Does Mastra support MCP servers?
  8. How does Mastra handle testing and observability?
  9. How do you deploy Mastra applications?
  10. Why use Mastra instead of a Python AI framework?
  11. Is Mastra open source?
- The open source answer (verbatim): "Mastra's core framework is open source under the Apache 2.0 license. Enterprise features are source-available under the Mastra Enterprise License. Mastra is free to start with no seats or usage tiers."
- Provider answer: "Mastra's model routing connects to 90+ providers through one standard interface."

## Final CTA section

- H2: **"Start building with Mastra today"**
- Button: **"Copy agent prompt"** (changes to "Copied"). The copied text is a full prompt for a coding agent, beginning: "Create a new Mastra project. Mastra is a framework for AI applications and agents on a modern TypeScript stack. Before running the command, ask these questions one at a time and wait for each answer unless it was already provided: Project name? (default: "my-mastra-app") Provider? ..." It runs `npm create mastra@latest <project-name> -- --llm <provider>`, starts the dev server, and says "Open Mastra Studio at `http://localhost:4111`."
- Second button: **"Quickstart"**.
- Notable: the CTA is aimed at the visitor's coding agent, not the visitor.

## Footer

Newsletter: "Get weekly updates" with an email field (placeholder "you@example.com").

| Column | Links |
|---|---|
| Product | Factory, Studio, Observability, Agent Builder, Server, FDE + Support |
| Framework | Overview, Agents, RAG, Workflows, Observability |
| Developers | Docs, Changelog, Templates, Learn · MCP Course, Learn · Video Course |
| Solutions | Sales agents, Marketing agents, Company Brain, Financial Services, Healthcare, Customer-facing agents, Developer Infra, Real-world agents |
| Resources | Blog, Research, Articles, Book · Principles, Book · Patterns, Podcast · Agents Hour |
| Company | Customers, About, Careers, Contact Us, Newsletter |
| Connect | Contact Us, GitHub, Discord, YouTube, X (Twitter) |

Bottom row: Security (trust.mastra.ai), a live status link ("Checking status"), Privacy, Terms, DPA, **llms.txt**.

---

## Pricing page (`/pricing`)

- H1: **"Pricing that scales with your agents"**
- Side text: "Build your agent with our open source framework. Learn more about our open source and enterprise licenses."
- A two-way toggle: **"Mastra Platform"** | **"Self-Hosted"**. This toggle is how they separate cloud from open source.

### Mastra Platform tab (hosted)

| Tier | Line under name | Price | Key figures | CTA |
|---|---|---|---|---|
| Starter | "Free for everyone" | "$0 / month" | 100K events + $10/100K; 24 CPU hours + $0.35/hr; 15 days retention; "Unlimited users, deployments, and projects" | "Get started for free" |
| Teams | "For growing teams" | "$250 / month" | 1M events + $8/100K; 250 CPU hours + $0.25/hr; 6 months retention; "Multiple teams, SSO, and SOC 2 docs" | "Get Teams" |
| Enterprise | "For teams at scale" | "Custom pricing" | "Custom volume and retention, with RBAC, audit logs, support and uptime SLAs, and a dedicated support engineer." | "See support options" and "Get a demo" |

### Self-Hosted tab

| Tier | Line under name | Price | Features (verbatim) | CTA |
|---|---|---|---|---|
| Free | "Apache 2.0 licensed" | "$0 / month" | "Build and host agents anywhere". Agents: "Define agent behavior with models, tools, memory, and instructions." Workflows: "Build durable multi-step agent processes with typed control flow." Observational Memory: "Persist conversation context and application state across sessions." | "Get started for free" (to GitHub) |
| Enterprise | "Licensed self-hosted features" | "Custom pricing" | "Scalable enterprise features". Enterprise controls: "RBAC, SSO, IAM, and network policy integration." Data stays in your VPC: "No traces, prompts, or outputs leave your environment." Predictable cost: "One flat annual fee — no per-trace or per-seat metering." | "Get a demo" |

### Below the tiers
- The same customer logo marquee as the homepage.
- A detailed comparison table grouped by product: **Observability, Studio, Server, Gateway, Databases, Platform**. Usage-metered rows, for example "Market Rate + 5.5%" for gateway tokens, "Persistent Server (24/7 Uptime) $100/project", "Bring your own key".
- H2 **"Enterprise Support"** with "Get a demo", three columns:
  - **Agent Lifecycle Support**: Planning & discovery; Rapid prototyping; Productionizing with evals & observability; Hands-on training workshops.
  - **Collaboration & SLAs Support**: Architecture & design meetings; Shared Slack support channel; Separate service SLAs; SLA support 8-5 Monday-Friday, 8am-6pm PST.
  - **On-prem platform deployments**: Deploy Mastra Platform on-prem or in your cloud; Collaborate with your team in Mastra Studio with SSO and RBAC; SRE support 8-5 Monday-Friday, 8am-6pm PST.
- Final CTA: H2 **"Ship better agents"**, "Copy agent prompt", "Quickstart".
- **No FAQ on the pricing page.**

## Enterprise page

**Not found.** `/enterprise` returns a 404 page with a playful line: "404 Route not found, but your agent kept running. Help it complete the workflow and avoid an error trace."

The nearest equivalent is **`/fde-support`** (nav: Product > FDE / Support):
- H1: **"Get your agent into prod faster"**
- Sub: "FDE model with dedicated engineering support for teams accelerating deployment and capability with their Mastra agent."
- CTA: **"Contact Us"**
- Visual: a mock Slack channel, "Abhi 4:18 PM: We'll pair you with an engineer to get your agents into production, from architecture to deployment." "Sam 4:18 PM: Our team is here to help you debug, troubleshoot, and ship faster. Just ask." "@partner-mastra How do we set up a factory"
- Three cards: **Direct line to the team** ("Shared Slack channel with the Mastra founders and meet 1:1 with a Mastra FDE regularly."), **Product roadmap insights** ("We share our roadmap every month so you can adjust yours accordingly."), **4 hour SLA** ("We answer your questions quickly so you can get back to building.")
- "Get a demo" band, then H2 "Mastra is powering the best AI teams" with three case studies (Salesforce, Sanity, "How Factorial Built an Agent for 17k Customers Across 25+ Products").
- Closing: H2 **"Build your agent with Mastra engineers"**, "Tell us what you are building and we will scope the engagement with you.", **"Contact Us"**.

## Extra page: Mastra Server (`/ai-agent-deployment`, nav: Product > Deployment)

- H1: **"Mastra Server - Deploy your Mastra agents and workflows"**; CTAs "Get Started", "Documentation".
- H2: **"Ship Your Mastra Agent in One Command"** / "Push code, get a URL. Routing, scaling, and infrastructure are handled for you."
- Four cards: "The Natural Home for Mastra Agents" ("Deploy on a platform purpose-built for Mastra. Zero config for agents, workflows, memory, and telemetry."), "Deploy from the CLI" ("Stay in your terminal. One command takes your local agent to a live endpoint."), "Scalable API" ("Expose agents and workflows as API endpoints automatically. Call them from any service, at any scale."), "Connect to Any Front-End" ("Plug the standard API into React, mobile, Slack, or whatever your users already live in.").
- An embedded mini pricing table (same three hosted tiers) with "Start building with a free account, or explore our pricing for more" and "Full Pricing".
- H2 "Mastra is powering the best AI teams", three case studies, then a six-question FAQ ("What is Mastra Server?", "How do I deploy to Mastra Server?", "How does Mastra Server expose agents as API endpoints?", "Can I use Mastra Server with my existing HTTP framework?", "What authentication providers does Mastra Server support?", "How does Mastra Server handle stream data redaction?"), closing with H2 "Start building today."

---

## Tone of voice notes

- **Short, declarative, confident.** Headlines are two to four words then a sentence: "Workflows. Memory. Harness." and "Build AI agents". They claim the category outright: "the leading TypeScript agent framework", "Best-in-class, built-in observability."
- **Second person, outcome first.** "You can always see exactly what your Mastra agents are doing." "Push code, get a URL." "Stay in your terminal."
- **Developer jargon used without apology** in card bodies: "typed steps, retries, and branches", "semantic recall", "thread-aware storage", "handoff". No glossary on the homepage.
- **A little punch and play, not jokes.** "turbo-charge your company", "Mastra agents can do it all", and the 404 page: "Route not found, but your agent kept running."
- **Open source is stated plainly and once,** mostly in the FAQ and the pricing toggle: "open source under the Apache 2.0 license", "Enterprise features are source-available". It is not the headline; TypeScript and production are.
- **AI agents are treated as the user's colleague and the site's reader.** The final CTA is a prompt written for the visitor's coding agent ("ask these questions one at a time"), and the footer links `llms.txt`.
- **Proof is numeric and named.** Case-study titles always carry a number; books carry "240K+ copies distributed".
- **FAQ answers are written for search and LLM retrieval:** third person, every sentence starts "Mastra ...", which reads stiffer than the rest of the page.

## What is worth borrowing

1. **The Platform / Self-Hosted toggle on pricing.** One switch makes "the same product, two ways to run it" concrete, with Free (Apache 2.0) and Enterprise on the self-hosted side. Very close to OpenOKR's "self-hosted and managed cloud from one release, nothing feature-gated".
2. **Case-study cards whose titles carry a number** ("~1 Month", "20+ Eng Teams"). Stronger than a quote carousel.
3. **A "Copy agent prompt" final CTA** that hands the visitor's own AI agent a setup script. Fits an agent-native product and is memorable.
4. **Tabbed primitives section** with one short code or UI sample per tab and one-line descriptions. Lets six concepts sit in one screen.
5. **"FDE / Support" as the enterprise story** (direct Slack line, roadmap sharing, a stated SLA) instead of a generic "Contact sales" page; and the honest framing "One flat annual fee — no per-trace or per-seat metering."
