# Langflow (https://www.langflow.org/)

Captured 2026-11-01. Text comes from the server-rendered HTML (curl, extracted in document order). I opened the homepage in a browser to see the hero visual, the logo strip (the logos are images with no text) and the Resources dropdown. WebFetch was not usable for verbatim text (it summarises).

Pages read: homepage, `/desktop` (where both "Get Started for Free" and "Download" go), `/contact-us` (where "Professional Services" and "Premier Support" go), `/use-cases`, and the landing page `/build-an-ai-powered-agent-in-minutes` (found in the sitemap).

**There is no pricing page and no enterprise page.** `/pricing/`, `/enterprise/` and `/cloud/` all return 404, and the sitemap lists none of them. The site is a community and download site. It now runs under IBM: the cookie banner is IBM's, the newsletter link goes to ibm.com, and the download form asks for consent to IBM marketing. The only commercial offers are two nav links, "Professional Services" and "Premier Support", both to a contact form.

Page title: "Langflow | Low-code AI builder for agentic and RAG applications"
Meta description: "Welcome to Langflow - Build AI applications with ease"

---

## Top navigation

| Item | Kind | Children (verbatim) |
|---|---|---|
| Docs | link | |
| Resources | dropdown | Use Cases, Changelog, Blog, Newsletter, Events, Podcast, Brand Kit |
| Community | dropdown | GitHub, Discord, X, YouTube, LinkedIn |
| Get Help | dropdown | Contact Us, Community Help, Professional Services, Premier Support |
| Download | link | (to /desktop) |

Right side: **no CTA button.** Instead, four social counters with icons: GitHub **"156k"** in the live page (the server HTML said "153k"), Discord **"25k"**, X **"10k"**, YouTube **"16k"**.

## Announcement bar

A thin bar at the very top: **"Langflow 1.13 just released!"** (links to the release blog post).

## Hero

- Eyebrow / badge: none.
- H1: **"Stop fighting your tools"**
- Subheadline: **"Langflow is a powerful tool to build and deploy AI agents and MCP servers. It comes with batteries included and supports all major LLMs, vector databases and a growing library of AI tools."**
- Primary CTA: **"Get Started for Free"** (green gradient button, goes to the form-gated desktop download)
- Secondary CTA: **"Star on GitHub"** (dark button with GitHub icon)
- Visual: a glowing flow node on the right, a component card with fields "Input" ("Type something..."), "Model" (llama-3.2), "API Key", "Temperature" 0.5 with a slider from "Precise" to "Creative", joined to other nodes by curved connector lines. Dark theme with purple and pink glows.

## Homepage sections, in order

### 1. Logo strip
- Caption under the logos: **"Used by leading AI development teams"**
- Layout: a single row of greyed-out logos (images, no alt text). Visible: Fyxt, SurveyHub.AI, Athena Intelligence, ecclesiastical, a "WK" mark, Foqum, PAP, IntimeGDT. These are small or little-known companies, not big brands.

### 2. "Ditch the Black Boxes"
- Heading (large, not marked up as a heading): **"Ditch the Black Boxes"**
- Layout: three tall glowing cards with interactive mini UIs.
  - **"Control the complexity"**: Model picker, Temperature slider (Precise / Creative), "Response Length" Short / Medium / Long.
  - **"Swap and compare"**: a vertical carousel of node types (Chat, Model, Agent) with up and down arrows; the browser showed "Chat Input".
  - **"Python under the hood"**: a slider that wipes between the visual node and its Python class source.
- No body copy beyond the three labels.

### 3. "Drag. Drop. Deploy."
- H3: **"Drag. Drop. Deploy."**
- Sub: **"Don't let boilerplate code slow you down. Visual state flows, reusable components, and rapid iteration for you. Focus on creating AI magic."**
- Layout: a long scroll-driven illustration. A code editor (`class AgentComponent(...)`) beside an "Agent" node, then a web of nodes (Anthropic, MistralAI, Cohere, Langchain, NVIDIA, OpenAI, "Basic Agent", "Basic Prompting", "Code Debugger", "Doc Assistant", "Content Search", "API Integration"), connected by lines that run between four sub-headings:
  - H4 **"Limitless Control"** / **"Use Python to customize anything and everything"**
  - H4 **"Run, Share and Collaborate."** / **"Choose from hundreds of pre-built flows and components"**
  - H4 **"Agents at your service"** / **"Run a single or fleet of agents with access to all your components as tools"**
  - H4 **"Flow as an API"** / **"Use a free, enterprise-grade cloud to deploy your app"**. Visual: tabbed code panel (cURL, Python API, Python Code, JS API) showing a Python script that calls the flow.

### 4. "From Notebook to Production"
- H2: **"From Notebook to Production"**
- Sub: **"Getting your AI in front of real users shouldn't be a headache."**
- Layout: three cards with simple illustrations (a sign-up form, cloud provider icons, a terminal):
  - **"Deploy yourself or sign up for a free cloud account"**
  - **"Deploy and scale on an enterprise-grade, secure cloud platform"**
  - **"Same Langflow whether you're using OSS or Cloud"**
- This is the only place the homepage talks about open source vs cloud, and it says they are the same product.

### 5. Integrations
- Layout: three rows of scrolling integration pills (logo plus name), then the caption **"Choose from hundreds of data sources, models, or vector stores."** and H5 **"Connect your existing tools"**.
- Names (verbatim, including their spelling): Airbyte, Anthropic, Azure, Bing, Composio, Confluence, Couchbase, Evernote, Github, Glean, Gmail, Google Cloud, Google Drive, Groq, Supa, HuggingFace, Langchain, Meta, Reddis, Milvus, Mistral, MongoDB, Notion, NVIDIA, Ollama, Perplexity, Weaviate, Serper, Qdrant, Serp API, Slack, Datastax, Amazon Bedrock, Tavily, Upstash, Vectara, Wikipedia, Wolfram Alpha, Yahoo! Finance, Zap, MeriTalk, Pinecone, Cassandra, Unstructured, OpenAI, Crew AI.

### 6. Testimonials
- No heading. Three cards with photo, name, title and company:
  - Jonathan Blomgren, Studios Director, BetterUp: "Langflow lets us take complex product ideas and quickly bring them to life through visual flows that anyone can understand."
  - Jan Schummers, Sr. Software Engineer, WinWeb: "Langflow has transformed our RAG application development, letting us focus more on creativity and less on complexity."
  - Brendon Geils, CEO, Athena Intelligence: "Langflow has completely transformed the way we iterate and deploy AI workflows."

## Final CTA section

- Heading (marked up as a second H1): **"Create your first flow"**
- Body: **"Join thousands of developers accelerating their AI workflows. Start your first Langflow project now."**
- Buttons: **"Get Started for Free"**, **"Star on GitHub"**
- Large gradient glow behind it.

## Footer

Minimal. No link columns.
- The same four social counters (GitHub 153k / 156k, Discord 25k, X 10k, YouTube 16k).
- "© 2026. All rights reserved · Manage Privacy Choices"

---

## Pricing page

**Does not exist** (`/pricing/` returns 404, and there is no pricing link anywhere in the nav or footer). Langflow is free and open source; the homepage mentions "a free cloud account" and "a free, enterprise-grade cloud" but the site never names a price, a tier, or the cloud product's URL.

## Enterprise page

**Does not exist** (`/enterprise/` returns 404). The enterprise story is reduced to:
- Nav "Get Help" items **"Professional Services"** and **"Premier Support"**, both to `/contact-us/`.
- Contact page: H1 **"We're here for you!"** / **"Have a question, need premier support, or want to learn more about our professional services? We're here to help."** / H2 "Contact Us" with a form that loads client-side.
- The landing page below lists "Enterprise-ready security and scalability." as one bullet.

## Other pages glanced at

**Desktop download (`/desktop`)**, where "Get Started for Free" lands:
- H1 **"Langflow for Desktop"**, H2 **"Download the App"**, "Fill out the form below to receive access to download the desktop app for Mac or Windows."
- Form: First name, Last name, Email, Country, Company, IBM marketing consent ("I agree that IBM may use my contact information to keep me informed of products, services and offerings in accordance with the IBM Privacy Statement."), button **"Download"**.
- So the primary "free" CTA is a lead-capture form, not a download or a sign-up.

**Landing page (`/build-an-ai-powered-agent-in-minutes`)**:
- H1 **"Build an AI-Powered Agent – in Minutes"**. Body: "Langflow is a powerful tool for building and deploying AI-powered agents and workflows. It provides developers with both a visual authoring experience and built-in API and MCP servers that turn every workflow into a tool that can be integrated into applications built on any framework or stack..."
- CTA **"Download Now"**.
- H3 **"✨ Highlights"** list (verbatim): "Visual builder interface to quickly get started and iterate." / "Source code access lets you customize any component using Python." / "Interactive playground to immediately test and refine your flows with step-by-step control." / "Multi-agent orchestration with conversation management and retrieval." / "Deploy as an API or export as JSON for Python apps." / "Deploy as an MCP server and turn your flows into tools for MCP clients." / "Observability with LangSmith, LangFuse and other integrations." / "Enterprise-ready security and scalability."
- An embedded video and an embedded tweet from Santiago (@svpino): "I'm using Langflow. In my opinion, it's the best tool I've found for building agents. It's open-source, comes with a huge list of reusable components..."

**Use Cases (`/use-cases`)**: a gallery of templates under "Getting Started" (for example "Call Classification Analytics", "Chunk Classification", "CSV Query Assistant", "Data Extraction"), each card embedding a live, read-only flow diagram of the template with tags such as "Business" and "Customer Support". Ends with the same "Create your first flow" CTA.

---

## Tone of voice notes

- **Punchy imperative slogans, very few words.** "Stop fighting your tools", "Ditch the Black Boxes", "Drag. Drop. Deploy." Three-word rhythms carry the page.
- **Visual-first, copy-light.** Most sections are an interactive illustration with a four-to-eight-word label. The page shows the product more than it explains it.
- **Friendly, slightly hype-y register** in places: "batteries included", "Focus on creating AI magic.", "shouldn't be a headache."
- **Developer reassurance against low-code fears**: "Python under the hood", "Use Python to customize anything and everything", "Ditch the Black Boxes". The message is "visual, but you keep control".
- **Open source shown, not said.** The words "open source" barely appear on the homepage (only "OSS" in "Same Langflow whether you're using OSS or Cloud"). It is signalled by "Star on GitHub" as the second CTA and the GitHub counter in the nav.
- **Agents and MCP named in the first sentence** ("build and deploy AI agents and MCP servers"), then rarely again.
- **Community size is the main proof** (social counters in nav and footer), with modest logos and three short testimonials.

## What is worth borrowing

1. **"Same Langflow whether you're using OSS or Cloud."** One short sentence that kills the "is the open source version crippled?" worry. OpenOKR can say the same thing and back it ("nothing is feature-gated").
2. **Interactive mini UIs instead of screenshots** (sliders, carousels, a code/visual wipe). For OpenOKR: a live quality check that flags a weak key result as you type would show "the method is in the product" better than any paragraph.
3. **Three-word section slogans** ("Drag. Drop. Deploy.") as section openers, followed by one plain sentence.
4. **Community counters in the nav** (GitHub, Discord) as quiet, always-visible social proof.
5. **Cautionary, not to copy**: no pricing or enterprise page and a gated "free" download make the commercial path unclear. A commercial site should state plainly how self-hosted, cloud and support are offered and priced.
