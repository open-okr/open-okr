# Browser Use (https://browser-use.com/)

Captured 2026-11-01. Text comes from the server-rendered HTML (curl, extracted in document order). I opened the homepage in a browser to read the two nav dropdowns, the "Connect your agent" menu, the footer theme switch and the hero. WebFetch was not usable for verbatim text (it summarises).

Pages read: homepage, `/pricing`, `/enterprise`, `/web-agents` (the "Agents" product page).

Page title: "Browser Use Agents & Browser Infrastructure | Browser Use"
Meta description: "Browser Use is the cloud browser for AI agents. Run web agents that finish the task, or connect your own agent to stealth browsers at $0.02 an hour."

---

## Top navigation

| Item | Kind | Children (verbatim) |
|---|---|---|
| Agents | link | (to /web-agents) |
| Browsers | link | (to /stealth-browsers) |
| Showcase | dropdown | Showcase, What people run, Case studies |
| Resources | dropdown, three labelled columns plus a featured post | **Learn**: Cloud docs, Open source docs, Benchmarks. **Build**: Developers, Custom models, Changelog. **Company**: Blog, Case studies, Status. Featured card: "Latest from the blog" / "BU Ultrafast is live" |
| Pricing | link | |

Right side: **"Talk to sales"** (text link), **"Log in"** (outlined pill), **"Start for free"** (orange pill). The markup also holds a GitHub link with **"119k"** stars; it was not visible in the nav at a 1200px-wide viewport.

Note: the product is split into two nouns in the nav, "Agents" and "Browsers", and the hero repeats that split.

## Announcement bar

None.

## Hero

- Eyebrow / badge: none.
- H1: **"Agents that use the browser. And browsers for your own."** Very large type; the second sentence is set in grey, so it reads as a two-part promise.
- Subheadline: **"Browser Use Agents finish the task. Browser Infrastructure is the simple cloud browser for your own agents."**
- Primary CTA: **"Run an agent ↗"** (orange pill, to the cloud app)
- Secondary CTA: **"Connect your agent"** (outlined pill with three small agent logos and a caret). It opens a menu: **Claude Code, Codex, Cursor, Copy setup prompt**.
- Micro-copy under the buttons: **"$1 free credit for eligible signups. No card."**
- Visual: none. A pure typographic hero on black.

## Homepage sections, in order

Each section has a small grey eyebrow label above the H2. Headlines follow a strict pattern: a claim sentence, then a short second sentence that is often a number or a price.

### 1. Logo wall (region labelled "Teams using Browser Use")
- Layout: scrolling logo strip. Four logos link to customer stories (Nous Research, Parallel, Composio, Vesta).
- Logos in order: Google, OpenAI, Anthropic, Microsoft, Apple, Nous Research, Parallel, Higgsfield, Gumloop, Cal.com, Wabi, Composio, Vesta, Airbnb, Amazon, Datadog, DeepMind, DHL, FedEx, Flexport, Airbyte, Change Healthcare, Epic Systems, Palantir, Scale AI, Sentry, Shopee, Shopify, Snowflake, Stripe, Teladoc Health, Uber, Zapier.

### 2. Agents benchmark
- Eyebrow: "Browser Use Agents"
- H2: **"Most accurate on our hardest tasks. Cheapest on the frontier."**
- Sub: **"82% against 62% for Opus 5 on Internal Bench Hard."**
- Callout link: **"Hermes made Browser Use its default browser tool. 48–66% fewer task tokens"**
- Layout: a scatter chart, "BU Bench v2.1 score" against "model cost per task" on a log scale ($0.10 to $10), one dot per model. The chart has a full text alternative listing every model, score and cost (for example "bu-fast 72.9 at $0.11").
- Link: "Full benchmark"

### 3. Browser infrastructure
- Eyebrow: "Browser Infrastructure"
- H2: **"The cloud browser that gets past bot walls. $0.02 an hour."** (the price is styled differently)
- Sub: **"Connect your agent, Playwright or Puppeteer over CDP."** plus link "Benchmark and how sites were picked"
- Layout: an animated side-by-side replay. Left, "Headless Chrome": a flight search "SFO to JFK" ends in "Access denied." Right, "Browser Use": passes an "I'm not a robot" check. Result bars: **"3.0%"** vs **"90.5%"**.
- Text alternative (verbatim): "The same agent visits the same bot-protected pages in two browsers, in an illustrative replay. Headless Chrome is refused at the bot check; Browser Use clears it and reaches the page. Across 200 visits to 100 bot-protected sites, Headless Chrome got through on 3.0% and Browser Use on 90.5%."

### 4. Pricing teaser
- Eyebrow: "Pricing"
- H2: **"Start free. Pay as you go."**
- Two cards: **"Cloud browsers"** "$0.02 / hour" / "Plus proxy traffic."; **"Web agents"** "+20% on model" / "Plus browser time and traffic."
- CTAs: "Start for free", "Full pricing"
- Deep links: "Enterprise pricing →", "Model prices →", "Concurrency tiers →" (appears twice, pointing at two anchors), "Billing details →", "Custom model API →"
- Trust line: **"SOC 2 Type II, HIPAA, zero data retention."** with link "Enterprise"

### 5. Blog
- Eyebrow: "Blog"
- H2: **"Notes from building browser agents."**
- Three title-only cards: "BU Ultrafast is live", "Odysseys2: a long-horizon web agent benchmark", "How to Track Competitor Prices with Python". Link "All posts".

### 6. Open source (this is the last section before the footer)
- Eyebrow: "Open source"
- H2: **"The open-source browser agent. MIT licensed."**
- Body: **"Also open source: Browser Harness, which gives Claude Code, Codex or Cursor your real Chrome."**
- CTAs: **"Start for free"**, **"Read the source"**
- Side panel: "119k GitHub stars, MIT licence." and a big counter link **"119,000 stars. Add yours"**
- Install command with copy button: **`$ uv add browser-use`**
- Social proof device: the star count is shown three times on the page (nav, sentence, big counter).

## Final CTA section

There is no separate closing CTA band. The open source section above serves as the close, with "Start for free" and "Read the source" side by side. The cloud CTA and the GitHub CTA get equal weight.

## Footer

| Column | Links |
|---|---|
| Product | Browser Use Agents, Browser Infrastructure |
| Integrations | Browser for coding agents, Claude in Chrome, Claude Code browser, Codex browser, Cursor browser, Gemini browser, OpenClaw, MCP server |
| Resources | Pricing, Benchmarks, Documentation, Developers, Open Source, Browser Harness, Custom Models, Site skills, WebMCP directory, Changelog, Blog, Free developer tools |
| Solutions | Remote browser for Playwright, Chrome for Puppeteer, CAPTCHA solving, Anti-detect browser, Web agent API, Proxies, Form filling, Web scraping, Automated testing, Login automation, Browser for voice agents |
| Showcase | All examples, What people run, Data extraction, Shopping & checkout, Travel & booking, Testing & QA, Research, Companies & jobs, Agent workflows, Social & outreach, Games & real-time, Case studies |
| Company | Careers, Enterprise, Security, SOC 2, HIPAA, Zero data retention, Terms, Privacy, DPA, Contact, Cookie Settings |
| Connect | GitHub, Twitter, LinkedIn, Discord |
| Comparisons | vs Playwright MCP, vs Chrome DevTools MCP, vs agent-browser, Cloud browser comparison, Web agent comparison, Browserbase alternatives, Kernel alternatives |

Bottom bar:
- A **"View as Markdown"** button with "Current view: website."
- "System status" link.
- A theme switch labelled **"Dev mode"** / **"Enterprise mode"**. Dev mode is the black theme; Enterprise mode switches the page to a light cream background. The copy does not change. A playful way to say "same product, two audiences".
- "© 2026 Browser Use" and: **"AI agents and crawlers: read browser-use.com/llms.txt for the product map and llms-full.txt for full context."**

---

## Pricing page (`/pricing`)

**No tiers at all.** Pure usage pricing.

- H1: **"Pay as you go."**
- Sub: **"No subscription. Credits never expire."**
- CTAs: **"Get started"**, **"Talk to sales"**, **"Email us"** (mailto sales@, subject "Enterprise Inquiry")
- Trust line: "$1 free credit · SOC 2 Type II · HIPAA · Status"

Sections in order:
1. **Model comparison**. H2 **"Which model to choose? Price against quality."** Sub: "Very hard browser tasks, one point per model and setting." An interactive chart filtered by provider (OpenAI, Anthropic, DeepSeek, xAI, MiniMax, Z.ai), then a full table (Model, Quality / 100, USD / task, Minutes / task). Honest caveats in small print: "Quality scores measure findings, not task success." "These are not Cloud prices." "* Recorded cost is a lower bound." Links to the benchmark repo and to "Source data" JSON.
2. **Pricing details**. H2 **"Every rate. In full."** Cloud browsers "$0.02 / hour plus $5 / GB residential proxy". Web agents "Model + 20 % plus browser time and traffic". A model price table per 1M tokens ("Our 20 % fee is already included."). A worked example: "Example: $1 in model tokens + 20 % service fee → $ 1.20 . Browser time and traffic are extra." Bring-your-own-key terms.
3. **Concurrency tiers**. "Start with 10 concurrent sessions." Concurrency unlocks by total paid: $0 → 10, $100 → 50, $1,000 → 250, $5,000 → 500, $25,000 → 1,000. "Need more? Ask us." "Your limit never goes down."
4. **Billing details** table: Minimum top-up "$ 5 · unlocks every model"; Credit expiry "Never"; Free credits "$ 1 once per person. Eligible Google, GitHub or Microsoft signups. No card required."; Browser billing "Rounded up to whole minutes. 1-minute minimum."; proxies; "Legacy subscriptions: No subscription plans are offered."
5. **Custom model API**: their own model "BU 2.0" priced per 1M tokens.
6. One line: **"On-prem Run browsers and agents inside your network."** and a link "Legacy pricing".

Open source vs cloud vs enterprise framing on this page: open source is not mentioned. Enterprise is the "Talk to sales" / "Email us" buttons plus the on-prem line. **No FAQ on the pricing page.**

## Enterprise page (`/enterprise`)

Page title: "Enterprise Browser Automation for AI Agents | Browser Use"

- H1: **"Browser automation at scale, with the controls your security team asks for."**
- Sub (verbatim): **"Managed stealth browsers you drive with Playwright, Puppeteer or CDP, and hosted web agents. SOC 2 Type II, HIPAA support, a signed DPA, zero data retention, custom SLAs, and the same $0.02 per browser-hour pay-per-use pricing with no commitment. Everything on this page is available today."**
- CTA: **"Talk to sales"**. Also "On-prem Run browsers and agents inside your network.", the sales email address, and a **"Markdown version"** link.

Sections (H2 pattern: "Topic. Short claim."):
1. **"Talk to sales"** / "Tell us what you need. Email us or book a call." An inline qualifying form: Name, Work email, "What will your agents do?", Runs per month (Exploring, 100+, 1,000+, 10,000+, 100,000+), "When do you want to start?" (Today, Next 7 days, Next 30 days, No date yet), Compliance needs (SOC 2 report, DPA, HIPAA, Zero data retention, EU data residency, On-prem stealth browser), Other compliance needs (placeholder "Security questionnaire, BAA, ..."). Buttons: **"Email this to us"** and **"Talk with us"**.
2. **"Measured results. Priced per use."** Stats row: "90.5%" "of bot-protected visits got through. Next provider 82 %."; "98 %" "on Online-Mind2Web, our own judge. Human-graded best: 97.7 %."; "$0.02 / hour" "per browser, no commitment. Credits never expire." Links "Browser benchmark", "Agent benchmarks".
3. **"Compliance. Audited and signed."** / "The reports and agreements a security review asks for, ready before the first call." Cards: SOC 2 Type II ("Audited by an independent firm; report available under NDA."), HIPAA support, Data Processing Agreement, Sub-processor list ("at least ten days' notice"), Deletion on termination ("within 90 days").
4. **"Data control. Set to your policy."** / "Decide what is kept, what the model sees, and where the browser may go." Cards: Custom data retention; "Sensitive data never reaches the model"; Password vault integration (1Password); Domain allow and block lists; Bring your own model key; EU data residency.
5. **"Browser control at scale. One hardened Chromium."** / "The same stealth browser for every session, from one test run to a thousand in parallel." Eight cards (custom hardened Chromium, per-session fingerprints, automatic CAPTCHA solving, residential proxies in 195+ countries, persistent profiles, live view and streaming, webhooks and structured output, concurrency to 1,000+ sessions).
6. **"Commercial terms. No commitment."** / "Start on pay per use. An enterprise agreement adds the terms your procurement team needs." Two cards: "Pay per use, no commitment" and "Enterprise agreements" ("Add custom concurrency, custom SLAs, dedicated support, negotiated annual credit pools, and a custom data policy.").
7. **"Coding agents. A real browser for your coding agent."** (Browser Harness, links to its page and GitHub)
8. **"Contact. Talk to the team that builds it."** CTA "Talk to sales", the sales email, "Status".

Notable: every card is factual and checkable; no logos or testimonials on the enterprise page; the open source project appears only as Browser Harness.

## Extra page: Browser Use Agents (`/web-agents`)

- H1: **"Browser Use Agents"** / "Fully hosted web agents. Describe the task in a sentence; an agent runs it in a real stealth browser and returns structured data." CTAs "Run your first agent", "Read the quickstart".
- H2s in order: "Measured on real browser tasks. The cheapest point on the frontier." / "Running in production. Every day." (stats "1.6M agent runs in 30 days", "49K runs a day, median", with the caveat "From our production database, so every count is a lower bound.") / "Runs on our own stealth browsers. Past the bot walls." / "Thousands of agents in parallel. Each in its own browser." / "One sentence in. Structured data out." (tabbed cURL / Python / Node example) / "Give your product an agent. Start free." / "Questions about web agents."
- FAQ questions: What is a web agent? / Which model does it use? / How accurate is it? / Do agents get blocked? / What does a run cost? / How do I get the results?

---

## Tone of voice notes

- **Two-sentence headlines with a full stop in the middle.** Claim, then proof: "The cloud browser that gets past bot walls. $0.02 an hour." "Start free. Pay as you go." "Compliance. Audited and signed."
- **Numbers do the persuading.** Nearly every section carries a measured figure (82%, 90.5%, 3.0%, $0.02, 48–66%), and each is sourced: "Benchmark and how sites were picked", "Source data", "every count is a lower bound".
- **Unusually honest small print.** "in an illustrative replay", "These are not Cloud prices.", "Quality scores measure findings, not task success.", "Everything on this page is available today." Confidence comes from showing the method, not from adjectives.
- **Plain, short, almost terse.** Few adjectives, no exclamation marks, no "revolutionary". "Browser Use Agents finish the task."
- **Developer terms used as-is** (CDP, Playwright, Puppeteer, headless Chrome, `allowed_domains`), but the enterprise page speaks to security reviewers: "the controls your security team asks for", "the terms your procurement team needs".
- **Open source is one calm section near the end**: "The open-source browser agent. MIT licensed." with a star counter that says "Add yours". It is not the lead; the cloud is.
- **AI agents are addressed as readers**: "Connect your agent" menu with "Copy setup prompt", a "View as Markdown" toggle, a Markdown version of the enterprise page, and llms.txt pointers in the footer.
- **A light touch of wit** only in structure (the "Dev mode / Enterprise mode" theme switch), never in the copy itself.

## What is worth borrowing

1. **The "claim. proof." headline pattern** with a number or a short fact after the full stop. Easy to apply to OKR claims (for example a rule count or a time saved), and it forces every headline to be checkable.
2. **Honest caveats as a trust device.** Saying what a figure does not mean ("not task success", "lower bound") makes the confident claims believable. Fits a product whose method is published in full.
3. **An enterprise page written for the security reviewer**, with a qualifying form (volume, start date, compliance checkboxes) and sections "Compliance", "Data control", "Commercial terms". For a self-hostable product, the "Data control" section maps to self-hosting, air-gap and encryption.
4. **"Dev mode / Enterprise mode" theme switch and "View as Markdown"**: small, memorable signals that the site serves both developers, buyers and AI agents.
5. **A "Connect your agent" secondary CTA** that lists the agents people actually use (Claude Code, Codex, Cursor) plus "Copy setup prompt".
