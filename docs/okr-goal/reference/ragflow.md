# RAGFlow (ragflow.io)

Captured 2026-11-01. Method: `curl` of the statically built HTML (a Docusaurus site with custom React pages), text extracted in document order. Navbar config and the GitHub star widget were read from the site's main JS bundle. Pages read: `/`, `/solutions/financial-services`, `/contact-us`, `/about-service`, `/docs` (Quickstart).

**There is no separate pricing page and no enterprise page.** `https://ragflow.io/pricing` and `https://ragflow.io/enterprise` both return 404. The nav "Pricing" link jumps to a section on the homepage (`/#pricing-plan`). Enterprise appears only as the fourth pricing card. `/llms.txt` also returns 404.

Page `<title>`: "RAGFlow"
Meta description: "Build a superior context layer for AI agents - Empower your AI agents through the leading open-source RAG engine, delivering reliable context and an integrated agent platform, built for enterprise."

---

## Top navigation

Left to right:

- Logo + "RAGFlow"
- **Docs**
- **Solutions ▾**: Financial services, Legal & compliance, Manufacturing, Education
- **Resources ▾**: Blog, Basics (to `/basics/what-is-rag`), Changelog
- **Community ▾**: Github, Discord, X, YouTube, LinkedIn
- **Pricing** (anchor to the homepage section, styled in a muted colour)
- Right side: a GitHub icon with a **live star count** fetched from the GitHub API in the browser and shown as e.g. "93.3k" (the API reported 93,269 stars at capture time; the static HTML has an empty slot). Then **"Contact us"** (text link).
- No "Get started" or "Sign up" button in the nav.

## Announcement bar

None.

## Hero

- Eyebrow / badge: none.
- **H1:** "Build a superior context layer for AI agents"
- **Subheadline:** "Empower your AI agents through the leading open-source RAG engine, delivering reliable context and an integrated agent platform, built for enterprise."
- **Primary CTA:** "Get Started" (to `cloud.ragflow.io`, the hosted product)
- **Secondary CTA:** none. Under the button, in small text: "About this application · Privacy Policy" (the first link goes to an app-verification page written for Google's OAuth review).
- **Visual:** a glowing gradient orb or light effect behind the hero. No product screenshot and no install command.

## Homepage sections, in order

### 1. Features (2-column grid of cards, each with an animated diagram)
- No section heading (aria-label "Features").
- Card H2s and bodies, verbatim:
  - **"ETL for AI data"**: "Harness our built-in ingestion pipeline to cleanse and process multi-format data, structuring it into rich semantic representations for superior retrieval." Diagram labels: Images, Documents, Data sources, Dataset.
  - **"High-Precision hybrid search"**: "Combine vector search, BM25, and custom scoring with advanced re-ranking to deliver unmatched answer accuracy and context relevance." Diagram labels: Vector, Full-text, Tensor.
  - **"Unified AI agent orchestration"**: "Build powerful agents in an all-in-one platform, seamlessly integrating RAG, tools, and MCPs within visual workflows." Diagram labels: MCP, Ingestion pipeline, Models, Retrieval, Dataset, Web search, Chat.

### 2. Solutions
- **H1 (a second H1 on the page):** "Smart solutions for every industry"
- Layout: three alternating rows, text on one side and an agent-workflow diagram on the other. Each row has an H2 and two paragraphs (what it does, then how it works step by step).
  - **"Equity investment research"**: "This workflow automates company data collection and consolidates financial metrics with research insights. Enables advanced stock analysis through autonomous planning and multi-agent orchestration." Then: "It starts by identifying stock tickers from user queries, then aggregates insights from external authoritative sources and internal records. Ultimately, these qualitative insights are combined with financial metrics to yield a complete investment report." Diagram nodes: Search agent, Web search, Condition, HTTP, Code, Report, Analyze agent, MCP, Subagent, Retrieval, Report agent.
  - **"Legal precedent analysis"**: "This workflow provides structured precedent analysis by examining binding and persuasive authority across public case law and internal matter records." Then: "Upon case input, key attributes—such as jurisdiction, court level, and legal issues—are automatically extracted to formulate search queries and retrieve relevant precedents with their ratio decidendi. ..." Diagram nodes: Formulate agent, HTTP, Iteration, Agent, Retrieval agent, Retrieval, Report agent, Report.
  - **"Manufacturing maintenance support"**: "This workflow provides structured maintenance guidance by accurately sourcing content from internal manuals, with external references used as supplementary support." Then: "When a task is entered, the workflow first validates input sufficiency—ensuring essential details are present—then extracts standard protocols from internal maintenance manuals, integrates supplementary external technical data, and produces clear execution instructions." Diagram nodes: Clarify agent, Retrieval, HTTP, Reference agent, Instruct agent, Message.

### 3. Pricing (on the homepage, anchor `#pricing-plan`)
- **H1 (third H1):** "Scale Your Business"
- Layout: four cards in a row; "Pro" is marked "Most popular" and has a glow. Details are in the Pricing section below.

## Social proof

**None on the homepage.** No logo wall, no testimonials, no case studies, no download counts, no stats row. The only proof device is the live GitHub star count in the nav.

## Final CTA section

- **H1:** "Start building"
- CTAs: **"Get Started"** (cloud) and **"Github"**

## Footer

- Logo, a large spaced-out wordmark "R A G F l o w", "Copyright © 2026 InfiniFlow Inc. All rights reserved."
- **Resources**: About RAGFlow, Documentation, Changelog, Basics, Blog
- **Community**: Github, Discord, X, YouTube, LinkedIn
- **TERMS & POLICIES**: Privacy Policy, Cookie Policy, Terms of Use, Data Processing Agreement

---

## Pricing (homepage section; there is no pricing page)

| Tier | Line under name | Price shown | Limits | CTA |
|---|---|---|---|---|
| **Free** | "Start for free and explore essential features to get your project off the ground." | "$ 0 month" | "5 Apps", "1 team members", "0.1 GB dataset storage", "500 credits / month", "API key not available" | "Upgrade now" |
| **Starter** | "Ideal for individuals and small teams starting their journey with essential features." | "$ 29 month" with "$ 59" struck through | "50 Apps", "5 team members", "5 GB dataset storage", "5,000 credits / month", "API key available" | "Upgrade now" |
| **Pro** ("Most popular") | "Perfect for growing businesses requiring more advanced tools and higher limits." | "$ 129 month" with "$ 259" struck through | "Unlimited Apps", "20 team members", "50 GB dataset storage", "20,000 credits / month", "API key available" | "Upgrade now" |
| **Enterprise** | "Enterprise-grade capabilities for production workloads at scale" | none | "BYOC deployment", "On-premises deployment", "Dedicated support", "Custom SLA" | "Contact us" |

- No monthly or annual toggle, no comparison table, no FAQ.
- The struck-through prices suggest a launch discount; the page does not explain them.
- The Free card's CTA also says "Upgrade now".
- **How open source, self-hosted, cloud and enterprise are framed:** these are all cloud plans. The open-source, self-hosted edition is not on the pricing grid at all. It appears only as the hero phrase "the leading open-source RAG engine", the "Github" button in the final CTA, and the docs Quickstart (Docker Compose). Self-hosting for companies shows up as two Enterprise bullets: "BYOC deployment" (bring your own cloud) and "On-premises deployment".

## Enterprise page

**Does not exist** (`/enterprise` returns 404). The closest thing is the contact page:

- `/contact-us`: H1 "How can we help?" / "Speak to our team about plans, pricing, enterprise contracts, or request a demo." / H2 "Tell us how we can help" / form fields First Name, Last Name, Company Name, Email, "What would you like to talk to us about?" / "You can also email us at sales@ragflow.io" / button "Submit".

## Extra pages glanced at

**`/solutions/financial-services`** (one of four industry pages in the Solutions menu):
- **H1:** "Convert diverse financial data into informed decisions"
- Sub: "Tailor financial scenarios with multimodal data parsing and traceable techniques to de-risk investments, streamline business operations and enhance your competitive position."
- Four H2 blocks, each with two sentences: "Connect analysis with operations", "Decision-ready industry insights" ("Each response cites its source, enabling one-click navigation to the original paragraph or clause."), "Research and risk workflows" ("Agent execution is transparent from data retrieval through to analytical conclusions, building trust in every response."), "Granular access control" ("Real-time document-level ACLs ... Implement granular, multi-level isolation (tenant, department, role and project-level)...").
- **H1** "Use cases": "Research assistant", "Sales compliance assistant", "Post-investment tracking assistant", "Compliance and audit assistant", each one sentence.
- No CTA button on the page.

**`/about-service`** ("Application overview"): written for Google's OAuth verification, but it has the clearest plain-language product description on the site: "An agent-native data platform for enterprise knowledge. Build knowledge bases from your own documents and serve them to AI agents with citations." Cards: "Enterprise knowledge bases", "Agent-native by design", "Built-in agent harness", "Open and self-hostable" ("Use the hosted service, or deploy the open-source edition in your own environment when data residency or isolation is required."). Followed by a plain list of what they never do with Google user data.

**`/docs`** (Quickstart): opens "RAGFlow is an open-source RAG (Retrieval-Augmented Generation) engine based on deep document understanding." and goes straight to Docker prerequisites ("4 CPU cores ..., 16 GB RAM, and 50 GB free disk space") and `git clone` / `docker compose -f docker-compose.yml up -d`. This is where the self-hosted path actually lives.

---

## Tone of voice notes

- **Short site, technical claims, little narrative.** The homepage is hero, three feature cards, three industry workflows, pricing, CTA. No story, no "why us", no proof.
- **Superlatives without evidence.** "superior context layer", "the leading open-source RAG engine", "unmatched answer accuracy", "superior retrieval", "Smart solutions for every industry". Nothing on the page backs these up with a number or a name.
- **Heavy retrieval jargon, unexplained**: BM25, re-ranking, hybrid search, Tensor, ETL, MCPs, "ratio decidendi", BYOC. The audience is assumed to be AI engineers already shopping for a RAG engine.
- **Third person and impersonal.** "This workflow automates...", "Upon case input, key attributes ... are automatically extracted". Very little "you" outside the pricing card lines.
- **Open source is a single adjective in the hero**, then left to GitHub. Self-hosting is not sold on the marketing pages at all; it is a docs concern.
- **AI and agents are framed as the customer of the product**: "context layer for AI agents", "Empower your AI agents", "serve them to AI agents with citations". The product feeds agents rather than being one. This is a clear and distinct positioning line.
- **Industry pages lean on traceability and citations** as the trust argument: "Each response cites its source", "building trust in every response".
- **Some rough edges in the copy**: "1 team members", "RTrack portfolio companies'...", and three H1s on the homepage.

## What is worth borrowing

1. **A one-line positioning that names the buyer's system, not the feature**: "Build a superior context layer for AI agents". For OpenOKR the parallel would be naming what the product becomes for the organisation (for example "the operating rhythm"), rather than listing features.
2. **Industry workflows explained as step-by-step paragraphs beside a node diagram** ("It starts by... then... Ultimately..."). This is a good format for showing an agent's run in a way a buyer can follow and believe.
3. **The live GitHub star count as the only nav badge.** Cheap, always current, and it signals open source without a slogan.
4. **The "Application overview" page as a template for trust copy**: plain sections on what the app is, what data it touches, which scopes, why, what it never does, and how to revoke. Written for a reviewer, it reads better than most security pages.
5. **What to avoid (a lesson rather than something to copy):** no social proof, unbacked superlatives, open source missing from pricing, and no enterprise page. An open-source product that wants enterprise buyers needs a place that says what self-hosted, cloud and enterprise each mean.
