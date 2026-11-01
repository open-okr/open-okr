# Firecrawl (https://www.firecrawl.dev/)

Captured 2026-11-01. Text comes from the server-rendered HTML (curl, extracted in document order). I opened the homepage in a browser to read the two nav mega-menus, the hero visual and the "Connect Firecrawl" menu. WebFetch was not usable for verbatim text (it summarises).

Pages read: homepage, `/pricing`, `/enterprise`, `/alexandria` (their newest flagship product, promoted in the announcement bar).

Page title: "Firecrawl | Web Data API for AI Agents"
Meta description: "Supercharge your AI agents with data from the web and beyond. Building the library for superintelligence. 🔥"

Design signature worth knowing: every section has a mono "// Label //" eyebrow and a numbered marker such as "[ 01 / 07 ] · Main Features", like a document's table of contents. Their numbering repeats "[ 02 / 07 ]" twice on the live page.

---

## Top navigation

| Item | Kind | Children (verbatim, with the one-line description under each) |
|---|---|---|
| Products | mega-menu, 3 columns | **Endpoints**: Search "Web search and get page content" (chips: Web, Developer Index); Scrape "Turn any url into clean data" (chips: URLs, Parse documents); Interact "Have agents interact with the web"; Crawl "Crawl entire websites or get all links" (chips: Crawl, Map); Monitor "Get notified when the web changes"; Agent "Gather deep data from the web". **Data sources**: Alexandria [New] "400+ data providers and indexes". **Surfaces**: MCP "Connect your AI agents to the web"; CLI "Use Firecrawl from your terminal"; API "REST API for all our endpoints"; SDKs "Python, Node, Go, and Rust SDKs"; Workflow Skills "Drop-in skills for your agent flows". **Featured**: an orange card "Alexandria [New] The knowledge library for superintelligence."; a "Customer story" card "How Replit uses Firecrawl to power Replit Agent"; "Customer stories" "Browse Firecrawl success stories" |
| Resources | mega-menu | **Resources**: Changelog "Latest API updates for Firecrawl"; Prompts "Real AI runs you can copy"; Customer Stories "See how teams use Firecrawl"; Startups "Double your annual plan's credits for a year"; Ambassadors "Create content with Firecrawl"; Careers "Join our team, we're hiring!"; Benchmarks "Compare quality and speed"; API Status "See maintenance, uptime and more"; Discord "Connect with other developers"; Student Program "Get free credits for your projects"; Affiliates "Earn by referring developers". **Open Source** panel: "Firecrawl is open source. Star us to show your support!" with "See Github" / "View the repository" |
| Pricing | link | |
| Docs | link | |
| Blog | link | |
| Playground | link | |

Right side: a GitHub button showing **"197.4K"** stars, and **"Sign up"**.

Note: "Surfaces" (MCP, CLI, API, SDKs, Skills) is a neat way to group "the many ways to reach one product".

## Announcement bar

Full-width orange bar: **"Introducing Alexandria and our $75M Series B. Read the announcement →"** ("Alexandria" is a link to the product page.)

## Hero

- Badge above the H1, linking to pricing: **"2 Months Free - Annually"**
- H1: **"Give your AI agents web data and beyond"** (line break before "web data and beyond")
- Subheadline: **"The web data API to search and scrape with access to more sources through Alexandria. It's also open source."** ("Alexandria" and "It's also open source." are links; the second goes to GitHub.)
- Primary CTA: **"Start for free"** (orange)
- Secondary CTA: **"Connect Firecrawl"** (grey button with ChatGPT, Claude and Cursor icons and a caret). The menu lists **ChatGPT, Claude, Cursor, Grok Bot, Muse,** and **"Setup for agents"**.
- Visual: a live-looking query box (animated placeholder, for example "Latest model from Kimi, A...") with mode tabs **Search / Scrape / Map / Crawl** and an orange arrow button. Below it, a wireframe of a web page (boxes labelled Logo, Navigation, Button, H1 Title, Description, CTA Button) turning into a JSON panel labelled "[ .JSON ]" with `url`, `markdown`, `json`, `screenshot` keys, a "Scraping..." state and a **"Scrape Completed"** badge. ASCII-art texture behind the hero.

## Homepage sections, in order

### 1. Logo wall
- Heading line: **"Trusted by 150,000+ companies of all sizes"**
- Layout: logo marquee; some logos carry a "Read story" link.
- Logos: Shopify, Lovable (story), Canva, Zapier (story), Apple, Replit (story), Alibaba, PHMG, DoorDash, Gamma (story), You.com, Sprinklr, Cognism, Ada, 11x (story), Botpress (story), Aleph Alpha, Sierra.

### 2. [ 01 / 07 ] Main Features
- Eyebrow: "// Developer First //"
- H2: **"Start searching today"**
- Sub: **"The infrastructure layer that helps AI find, read, and act on the live web."**
- Layout: three selectable feature rows on the left, a code panel on the right with language tabs **Python / Node.js / cURL / CLI** and "Copy code", plus output previews tagged "[ .MD ]" and "[ .JSON ]".
- Rows (verbatim): **Search** "Search the web and get full content from results." / **Scrape** "Get llm-ready data from websites. Markdown, JSON, screenshot, etc." / **Interact** [NEW] "Scrape a page, then interact with it using AI prompts or code." Each has "Learn more".
- Code sample (verbatim, Python): `# pip install firecrawl-py` / `from firecrawl import Firecrawl` / `app = Firecrawl(api_key="fc-YOUR_API_KEY")` / `# Scrape a website:` / `app.scrape('firecrawl.dev')`

### 3. [ 02 / 07 ] Power your agent
- Eyebrow: "// Agent Ready //"
- H2: **"Easily connect with your AI agents"**
- Sub: **"Connect Firecrawl to any AI agent or MCP client in minutes."**
- Line: **"One command. Connect your agent to Firecrawl through MCP or the CLI and skills."**
- Tabs: **Prompt / MCP / CLI**. The Prompt tab: "Copy and paste this into your AI agent." then the prompt: **"Run npx -y firecrawl-cli@latest init --all --browser. Use my existing Firecrawl login or help me log in. Read the installed skills before running queries."** Link "View the docs".
- A second box speaks to agents directly: **"Agent onboarding. Are you an AI agent? Fetch this skill to get an API key and start building."** with `curl -s https://firecrawl.dev/agent-onboarding/SKILL.md` and "View the skill".

### 4. [ 02 / 07 ] Core
- Eyebrow: "// Built for Performance //"
- H2: **"Fast, reliable, token-efficient. And it's open source"**
- Sub: **"Web data infrastructure built from the ground up"**
- Layout: four-card bento grid, each with a small animated proof.
  - **Reliable on any page**: "Industry-leading reliability. 96% coverage on our 1,000-URL firecrawl/scrape-content-dataset-v1 benchmark, run Jan 13, 2026. Every query and URL comes back as clean data." Bar chart: Firecrawl 96%, Puppeteer 79%, cURL 75%. Link "See benchmarks".
  - **Speed that feels invisible**: "Blazingly fast. P95 latency of 3,387 ms on the same 1,000-URL benchmark, run Jan 13, 2026, built for real-time agents and dynamic apps." Link "See comparisons".
  - **Token-efficient**: "Only the content that matters. No navs, footers, or ads. Just clean markdown, with 93% fewer input tokens for your model." Visual strips `<nav>`, `<ads>`, `<footer>` from a "38,381 tokens" page. Link "Calculate your savings".
  - **Open Source**: "Code you can trust. Developed transparently and collaboratively. Join our community of contributors." Visual: a mock GitHub repo card "firecrawl/firecrawl Public Star 197.4K" listing real merged pull requests with contributor names and "+90" avatars. Link "Check out our repo".

### 5. [ 03 / 07 ] Features
- Eyebrow: "// Zero configuration //"
- H2: **"We handle the hard stuff"**
- Sub: **"JavaScript rendering, smart wait, media parsing, search, actions, and more."**
- Layout: six animated cards. Each has a short kicker title, then a feature name and one sentence.
  - **Docs to data**: "Media parsing. Firecrawl can parse and output content from pdfs, docx, and more."
  - **Knows the moment**: "Smart wait. Firecrawl intelligently waits for content to load, making data extraction faster and more reliable."
  - **Live web data**: "A complete index, search and scrape. Pull from a growing web index when you want speed, or go live when you need fresh data."
  - **Advanced web coverage**: "Enhanced mode. Reaches every corner of the web with comprehensive coverage and high reliability."
  - **Interact with pages**: "Actions. Click, scroll, write, wait, press and more — interact with any page."
  - **How it's sourced matters**: "Fair access to web content, licensed through Firecrawl Alexandria." Link "Explore Firecrawl Alexandria".

### 6. [ 04 / 07 ] Use Cases
- Eyebrow: "// Use cases //"
- H2: **"Transform web data into AI-powered solutions"**
- Sub: **"See how you can give your AI better access to the web with Firecrawl."** Button "View all use cases".
- Layout: five tabs, each with an animated mock and a named customer line.
  - **Deep research** (kicker "No insight missed"): "Extract comprehensive information for in-depth research." Customer: "Aemon powers their AI R&D agent's web research with Firecrawl's search and scrape."
  - **Smarter AI chats** ("Chat with context"): "Power your AI assistants with real-time, accurate web content." Customer: "Sierra uses Firecrawl to ingest web data into knowledge bases that power AI chat applications."
  - **AI agent tools** ("Better web tools"): "Give AI agents high-quality web data with one command." Mock terminal: `$ npx -y firecrawl-cli@latest init --all --browser` / "One command gives Cursor, Claude Code, Windsurf, and more high-quality web tools". Customer: "Lovable enhances their AI agent's web tools with Firecrawl."
  - **Onboarding** ("Import with ease"): "Scrape web content to pre-populate and streamline user onboarding." Customer: "Gamma supercharges onboarding, letting users create artifacts from web data with Firecrawl."
  - **Lead enrichment** ("Know your leads"): "Enhance your sales data with web information." Customer: "Cognism enriches lead profiles from across the web with Firecrawl."

### 7. [ 05 / 07 ] Alexandria
- Eyebrow: "Introducing Firecrawl Alexandria"
- H2: **"The knowledge library for superintelligence."**
- Sub: **"Give your agents the tools to go further. The live web, official providers, specialized indexes."**
- CTAs: "Explore Alexandria", "Become a provider". Large ASCII-art illustration.
- Stats row: **113M+** "Indexed sources" / "Papers, READMEs, issues, docs"; **93** "Providers" / "Official APIs, registries, publishers"; **640** "Capabilities" / "Defined inputs, outputs, pricing"; **20** "Categories" / "From procurement to podcasts". (The Alexandria page itself says 428 providers and 2,450 capabilities, and the nav says "400+". The homepage figures are stale.)

### 8. [ 06 / 07 ] Testimonials
- Eyebrow: "// Community //"
- H2: **"People love building with Firecrawl"**
- Sub: **"Discover why developers choose Firecrawl every day."**
- Layout: two-row scrolling wall of linked X (Twitter) posts with name and handle, informal and unedited. Examples (verbatim):
  - Morgan Linton @morganlinton: "If you're coding with AI, and haven't discovered @firecrawl yet, prepare to have your mind blown 🤯"
  - Alex Reibman @AlexReibman: "Moved our internal agent's web scraping tool from Apify to Firecrawl because it benchmarked 50x faster with AgentOps."
  - Bardia @thepericulum: "The Firecrawl team ships. I wanted types for their node SDK, and less than an hour later, I got them."
  - Mirza @b1rkh0ff: "I've no idea why people don't self-host Firecrawl. There's no crawl job I haven't done with it."
  - Shaan Ali @kshaaneali: "quietly swapped the scraping layer to firecrawl today and the difference is wild: clean markdown instead of raw html soup."
  - Also Peter Steinberger, Ole Lehmann, Chris DeWeese, Alejandro AO, Pranav Pai Vernekar, Tom - Morpho ("I found gold today. Thank you @firecrawl"), Kim Vault, Matt Busigin ("Firecrawl is dope. Congrats guys 👏"), Nick DeJesus, Sumanth, Steven Tey, Matthew Marley.

### 9. [ 07 / 07 ] Get started (the final CTA sits before the FAQ)
See "Final CTA section" below.

### 10. FAQ
- Eyebrow: "// FAQ //"
- H2: **"Frequently asked questions"** / **"Everything you need to know about Firecrawl."**
- Accordion in four labelled groups. Questions (verbatim):
  - **General**: What is Firecrawl? / What can I build with Firecrawl? / Why do AI systems need Firecrawl? / What are Search, Scrape, and Interact? / Does Firecrawl work with AI agents and MCPs? / Who uses Firecrawl? / Is Firecrawl open-source? / How is Firecrawl different from other tools in the space? / What is the difference between the open-source version and the hosted version?
  - **How It Works**: How does /search work? / How does /scrape work? / How does /interact work? / Can I extract structured data from pages? / What formats can Firecrawl convert web data into? / Does Firecrawl handle JavaScript-rendered pages? / Is Firecrawl suitable for large-scale projects? / Does Firecrawl support crawling entire sites? / Does Firecrawl handle complex websites?
  - **API Related**: What SDKs are available? / Where can I find my API key?
  - **Billing**: Is Firecrawl free? / Is there a pay-per-use plan? / Do credits roll over to the next month? / Do pay-as-you-go credits expire? / How does pay-as-you-go work? / How many credits does a 5 USD pay-as-you-go increment give me? / How many credits does each request cost? / Do you charge for failed requests? / What payment methods do you accept? / Can I buy Firecrawl through AWS Marketplace or Google Cloud Marketplace? / Why am I being charged VAT (or any local tax) even though I provided a tax ID?
- Social proof inside answers: "Over 1.25M developers and 150,000+ companies build with Firecrawl, including teams at Apple, Canva, and Lovable. We've served more than 5 billion requests..."; "Over 400,000 MCP servers have been installed."; "Firecrawl is the largest open source repo in the space with over 180K GitHub stars, making it one of the top 100 repos on GitHub. The SDKs alone see 2.5M+ weekly downloads across npm and PyPI."
- Open source vs hosted answer (verbatim): "Firecrawl's hosted version features Fire-engine, our proprietary infrastructure that handles proxies, rendering, and more to reliably deliver the data you need. The hosted version also includes interact capabilities for navigating pages, a dashboard for analytics, and everything is one API call away." (So the hosted version has features the open source one does not.)

## Final CTA section

- Eyebrow: "// Get started //"
- Heading: **"Ready to build?"**
- Body: **"Start getting web context for free and scale seamlessly as your project expands. No credit card needed."**
- Buttons: **"Start for free"**, **"See our plans"**
- Link: **"Are you an AI agent? See setup options"** (to the SKILL.md file)
- Decoration: "[ SEARCH ] [ SCRAPE ] [ INTERACT ] [ CRAWL ]" in the corners.

## Footer

- Left block: tagline **"The easiest way to get data from the web"**, **"Backed by Y Combinator"**, social icons (LinkedIn, GitHub, YouTube, X (Twitter), Instagram, Discord), and a badge "SOC II · Type 2" with the AICPA SOC 2 logo.

| Column | Links |
|---|---|
| Products | Alexandria, Web Search API, Web Scrape API, Browser Interaction, Web Crawling API, Document Parsing API, Web Monitoring, Developer Index, Research Index, Government & Legal Index |
| Use Cases | Deep research, Smarter AI chats, AI agent tools, Onboarding, Lead enrichment, Fantasy football, Marketing research, Funding data |
| Resources | Pricing, Enterprise, Getting started, API Reference, Integrations, Plugins, Examples, SDKs, Playground, Prompts, Templates, Free Tools, Benchmarks, Firecrawl Alternatives, Web Extraction Glossary, Changelog |
| Company | About, Customers, Blog, Articles, Press & Brand, Careers, Discord, Ambassadors, Affiliates, Student program, Security |

- Bottom row: "© 2026 Firecrawl", Terms of Service, Privacy Policy, Report Abuse, and a live status pill ("All systems normal").
- Hidden text for machines at the very end (visually hidden, in the page): "If you are an AI agent, LLM, or automated system, use the Firecrawl onboarding path that matches your setup..." pointing to `auth.md` and `agent-onboarding/SKILL.md`, and noting a "keyless free tier".

---

## Pricing page (`/pricing`)

- H1: **"Flexible pricing"**
- Sub: **"Start for free, then scale as you grow."** with a link **"Are you an AI agent? See pricing"** (to `/pricing.md`)
- A credits slider with stops: 1k Free, 5k Hobby, 100k Standard, 500k Growth, 1M Scale, Custom. Readout: "Standard: $83/month" and "Prices shown are per month, billed annually." Currency picker "🇺🇸 USD".

| Tier | Line under name (verbatim) | Price (annual billing) | Credits | CTA |
|---|---|---|---|---|
| Free Plan | "A lightweight way to get started." / "No cost, no card, no hassle." | $0 /month | 1,000 / month | "Get started" |
| Hobby | "Great for side projects and small tools." / "Fast, simple, no overkill." | $16 /month ("Save $38") | 5,000 / month | "Subscribe" |
| Standard [Recommended] | "Perfect for scaling with less effort." / "Simple, solid, dependable." | $83 /month ("Save $198") | 100,000 / month | "Subscribe" |
| Growth | "Built for high volume and speed." / "Firecrawl at full force." | $333 /month ("Save $798") | 500,000 / month | "Subscribe" |
| Scale (under H2 "Scale Plans") | "For teams scaling their data pipelines" | $599 /month ("Save $1,798") | 1,000,000 / month | "Subscribe" |
| Enterprise | "Power at your pace with custom solutions" | Custom | Custom credits | "Contact sales" |

- Each tier lists what the credits buy in plain terms, for example "500 searches or 1,000 pages scraped", then concurrency, support level and "extra credits per $5".
- Scale Plans intro (verbatim): "High-volume plans for teams that need more power and dedicated support. Get access to higher rate limits, more concurrent browsers, and priority support. Scale checks out instantly, no sales call needed." Link "Need more? Contact us". "Also on AWS Marketplace and Google Cloud Marketplace."
- Enterprise bullets: Custom concurrent requests; Dedicated support & SLA; Bulk discounts; Zero-data retention; SSO & advanced security.
- H2 **"Pay-as-you-go"**: "Keep accessing web data with search and scrape when your credits run out. We add credits in 5 USD increments, up to a monthly limit you set. Paid plans only." Button "Enable pay-as-you-go".
- H2 **"Pricing at a glance"**: a plain-text summary block (credit unit, free tier, entry plan, every plan's monthly and annual price, failed-request policy, "Effective September 4, 2026. Prices in USD."). It reads as written for LLMs and comparison shoppers.
- H2 **"API Credits"**: "Credits are consumed for each API request, varying by endpoint and feature. These rates are the same on every plan." Table: Scrape 1 / page, Crawl 1 / page, Map 1 / page, Search 2 / 10 results, Interact 2 / browser minute, Monitor 1 / page / check, Agent "5 daily runs free. Dynamic pricing".
- H2 **"Compare Plans"** / "What changes from one plan to the next." Grouped table: Limits and Performance; Team and Access (SSO and SCIM are Enterprise only); Support (Community, Basic, Standard, Priority, Priority, Dedicated); Billing and Usage; Security and Compliance. Every row has a one-sentence plain-English explanation, for example "Concurrent browsers set how many pages render at the same time."
- Testimonials wall (same as homepage).
- FAQ, **Billing** group only (verbatim): Is Firecrawl free? / Is there a pay-per-use plan? / Do credits roll over to the next month? / Do pay-as-you-go credits expire? / How does pay-as-you-go work? / How many credits does a 5 USD pay-as-you-go increment give me? / How many credits does each request cost? / Do you charge for failed requests? / What payment methods do you accept? / Can I buy Firecrawl through AWS Marketplace or Google Cloud Marketplace? / Why am I being charged VAT (or any local tax) even though I provided a tax ID?

Open source vs cloud vs enterprise framing: **the pricing page does not mention open source or self-hosting at all** (only inside a quoted tweet). Self-hosting appears on the enterprise page as one card ("Managed or self-hosted") and in the homepage FAQ.

## Enterprise page (`/enterprise`)

- Eyebrow: "// Scale with confidence //"
- H1: **"Web data for enterprise AI"**
- Sub: **"The web search and scraping API for enterprise AI teams. Zero data retention, SSO, and a DPA included."**
- CTAs: **"Contact sales"**, **"Explore docs"**
- Logo wall: "Trusted by leading enterprises worldwide" (Sierra, DoorDash, Apple, Shopify, Alibaba, Canva, Lovable, Zapier, You.com, PHMG, Gamma, Sprinklr, Cognism, Ada, Aleph Alpha).

Sections:
1. **[01/05] Platform**: H2 **"One API for web data and beyond"** / "Search, scrape, interact with and parse the web, and reach official data providers, through one API, MCP server or CLI." Six cards: Search, Scrape and crawl, Interact, Agent, Parse, Firecrawl Alexandria ("400+ official data providers plus Firecrawl's Research, Developer and Government & Legal indexes."). Then a stats row: **150,000+** "Companies trust Firecrawl"; **1.5M+** "Users build with Firecrawl"; **67%** "Of the Fortune 100 are Firecrawl users".
2. **[02/05] Enterprise features**: H2 **"Built to run Firecrawl in production"** / "Support, capacity, billing and deployment options for teams that depend on web data every day." Nine numbered cards (01 to 09): Forward-deployed engineers; Priority support; Custom and reserved concurrency; Pooled credits; Access management; Custom datasets; Flexible procurement; Uptime and support SLAs ("our live status and 90-day uptime history are public"); **Managed or self-hosted** ("Use the managed API, or run open-source Firecrawl on your own infrastructure when data must stay in your network."). Link "See the full list of enterprise features →".
3. **[03/05] Security and compliance**: H2 **"Enterprise security and compliance"** / "SOC 2 Type II, zero data retention, a DPA and SSO, for teams that need to pass a security review before they ship." Cards: SOC 2 Type II compliant ("with our annual renewal audit in progress"), Zero data retention, DPA and security reviews, SAML SSO and SCIM, PII redaction, IP and key restrictions, US data residency, Published subprocessors. Link "Visit the Trust Center →".
4. **[04/05] Use cases**: H2 **"What enterprise teams build with Firecrawl"** / "From support agents to coding agents, teams put live web data behind their products." Six cards, each titled as a full sentence with a full stop: "AI chatbots and support agents.", "Enterprise AI platforms.", "Sales and GTM research.", "Research and LLM grounding.", "Content and site generation.", "Coding agents."
5. **[05/05] Customer testimonials**: H2 **"What our enterprise customers say"** / "See how leading companies use Firecrawl to power their mission-critical applications." Three named quotes with role and company:
   - Andrew Gardner, Sr. Engineer, Zapier: "Firecrawl allows our customers to pull the web information they need directly in our product."
   - Michael Masson, Director of Engineering, Botpress: "Firecrawl is the easiest way to extract relevant content from a website."
   - Zhen Li, Staff AI Engineer, Replit: "If your agent or LLM needs web content, Firecrawl delivers the best-formatted results."
   - Link "Read all customer stories →".
6. **FAQ**: "Security, compliance, and procurement questions from enterprise teams." Questions (verbatim): What is an enterprise web search API? / What is an enterprise web scraping API? / Is Firecrawl SOC 2 compliant? / Does Firecrawl offer zero data retention, including for search? / Will Firecrawl sign a DPA? / What does Firecrawl provide for a GDPR or CCPA review? / Does Firecrawl offer an SLA? / How is Firecrawl Enterprise priced? / Will Firecrawl help us migrate from another scraping or search API? / Does Firecrawl support SAML SSO and SCIM? / How does Firecrawl handle a vendor security review? / Where is data processed? / Can Firecrawl handle millions of pages a month? / Can we restrict where and how our API keys are used? / Can I buy Firecrawl through AWS or Google Cloud Marketplace?
   - Notable candour: "Data is processed in the United States, with no EU data residency option".
7. Closing CTA: eyebrow "// Get started //", heading **"See Firecrawl on your own data"**, body **"Bring the pages and queries your pipeline needs, and we'll run them on Firecrawl with you on the call."**, buttons **"Contact sales"**, **"Explore docs"**, and "Are you an AI agent? See setup options".

## Extra page: Alexandria (`/alexandria`)

- Eyebrow "Firecrawl Alexandria". H1 **"The knowledge library for superintelligence."** / "Give your agents the tools to go further. The live web, official providers, specialized indexes."
- CTAs: "Explore Alexandria", and a copy button **"Install in your agent"**.
- A filterable directory of providers by category ("All 428", "Public records 199", "Company 90", "Retail 66", ...), each card with name, domain and one line (for example Shopify, Particle, Benzinga, Apollo, Fiscal.ai).
- H2s: "Connect your AI agent to the sources it needs." (cards "Go straight to the source", "Get richer data", "Skip the integration work", "Keep your agent focused"), "A world of data. One library." (ASCII globe, "428 PROVIDERS · 2450 CAPABILITIES"), "Explore the library. Meet the providers."
- "Become a provider" is a second audience CTA, a marketplace move.

---

## Tone of voice notes

- **Energetic, developer-casual, confident.** "Blazingly fast.", "We handle the hard stuff", "Firecrawl at full force.", "No cost, no card, no hassle." Light rhyme and alliteration in tier descriptions.
- **Short feature names, then a precise sentence with a dated, named benchmark**: "96% coverage on our 1,000-URL firecrawl/scrape-content-dataset-v1 benchmark, run Jan 13, 2026." Bold claims, sourced.
- **Big ambition in the newest product**: "The knowledge library for superintelligence." It sits beside very concrete API copy, so the grand line does not float.
- **Open source is a confident aside, not the headline**: "It's also open source." in the hero; "And it's open source" tagged onto a performance H2; a repo card with real pull requests. The FAQ boasts "the largest open source repo in the space". Pricing ignores it.
- **Agents are addressed in the second person, as a visitor class**: "Are you an AI agent? Fetch this skill to get an API key and start building." It appears in the hero menu, a section, the final CTA, the pricing page (`/pricing.md`), and hidden page text.
- **Social proof is loud and informal on the homepage** (raw tweets with emoji) and **formal on the enterprise page** (name, title, company).
- **Enterprise copy switches register** to plain, procurement-friendly sentences and admits limits ("no EU data residency option", "annual renewal audit in progress").
- **Jargon level**: high but explained where money is involved; every compare-table row carries a one-sentence explanation.

## What is worth borrowing

1. **"Are you an AI agent?" as a first-class visitor path**: a SKILL.md or Markdown version of key pages, linked from the hero, the final CTA and pricing. OpenOKR's external agent surface and CLI make this a natural fit.
2. **"Connect [product]" secondary CTA** listing the AI tools people already use, next to "Start for free".
3. **Numbered, labelled sections** ("[ 03 / 07 ] · Features") give a long homepage a sense of order. A good device for a product with many parts (method, agents, channels, self-hosting).
4. **A plain-text "Pricing at a glance" block and compare-table rows that explain themselves in one sentence.** Cheap to write, helps humans and LLM summaries.
5. **Enterprise "Managed or self-hosted" card and "See it on your own data" closing CTA.** For OpenOKR the stronger, honest version is "same release, nothing gated", which Firecrawl cannot say (its hosted version has proprietary extras).
