# n8n (n8n.io)

Captured 2026-11-01. Method: `curl` of the server-rendered HTML (Nuxt site with Strapi as the CMS), text extracted in document order. Dropdown menus, logo-wall names, section types and monthly prices were decoded from the page's own `__NUXT_DATA__` payload. Pages read: `/`, `/pricing/`, `/enterprise/`, `/features/` (the "Product overview" page). n8n has no marketing page for self-hosting; the nav sends "Self-host n8n" to the docs.

Page `<title>`: "AI Workflow Automation Platform - n8n"
Meta description: "n8n is a workflow automation platform that uniquely combines AI capabilities with business process automation, giving technical teams the flexibility of code with the speed of no-code."

**Notable detail:** right after the header there is a screen-reader-only line, hidden from sighted visitors: "See llms.txt for all machine-readable content." `/llms.txt` exists and begins: "This file points AI tools at machine-readable versions of key content." It lists markdown versions of their reports.

---

## Top navigation

Left to right: logo, then four dropdowns, two links and two CTAs. Every dropdown item has a one-line description.

- **Product ▾** (panel label "Discover n8n")
  - Product overview: "See inside every agent and workflow you run"
  - Agents: "Build agents, set their tools, review every step"
  - MCP: "Create n8n workflows from inside your AI app"
  - Integrations: "Connect 500+ apps or call any API over HTTP"
  - Templates: "Start from one of 13k+ community workflows"
- **Use cases ▾** (panel label "Explore case study")
  - IT operations: "Connect siloed IT systems in processes anyone can read"
  - Security operations: "Close routine security work, with every step on record"
  - RAG: "Build RAG pipelines and inspect every retrieval"
  - Lead automation: "Enrich, score, and route leads without manual triage"
  - Supercharge your CRM: "Keep your CRM in sync with the tools your team uses"
  - Embedding n8n: "Let your customers build workflows inside your product"
  - Case studies: "See what teams build and run with n8n in production"
- **Docs ▾**
  - Choose how to use n8n: "Compare n8n Cloud and self-hosting, plans and licenses"
  - Self-host n8n: "Install and run n8n on your own infrastructure"
  - Connect to n8n MCP server: "Set up MCP so your AI app can build and run workflows"
  - Build your first workflow: "Go from a blank page to your first running workflow"
  - Build and manage agents: "Build agents next to your workflows and publish them"
  - Our license: "What you can and can't do under n8n's fair-code license"
  - Changelog: "The most important new n8n features, as they ship"
- **Community ▾**
  - Forum: "Ask questions and swap solutions with n8n builders"
  - Learn: "Self-paced courses on workflows and agents"
  - Careers: "See open roles and help build how the world works"
  - Blog: "Guides, product news, and stories from the n8n team"
  - Creators: "Templates from verified n8n community creators"
  - Partners: "Find a partner to build with, or become one"
  - Hire an expert: "Find an n8n expert to build or review your workflows"
  - Events: "Meetups and online events run by the n8n community"
  - Support: "Get help from the forum, docs, or n8n's support team"
- **Enterprise**
- **Pricing**
- Right side: **"Sign in"** (text link), **"Get started"** (primary button)

## Announcement bar

None.

## Hero

- Eyebrow / badge: none.
- **H1:** "Build the agent. Understand its *workflow*." The word "workflow" is styled as an accent and animates letter by letter.
- **Subheadline:** "n8n is the platform for agents and workflows you can follow. Open any step, see what it does, and explain to anyone who runs it."
- **Primary CTA:** "Get Started" (to cloud sign-up)
- **Secondary CTA:** "Talk to sales" (to a Typeform)
- **Visual:** an animated, interactive workflow canvas. A plain-language prompt sits above it: "When a refund request comes in, look up the order. Then ask me in Slack whether to refund it or open a ticket." Tabs switch between example workflows: "Refund request", "Process invoice", "Knowledge assistant", "Daily News Digest". The refund canvas has nodes such as "Refund requested", "Lookup the order", "Ask for approval on Slack", "Approved?", "Process refund", "Open ticket", "Confirm to customer", "Record refund in database", "Classify reason for refund", "Route by reason", "Email win-back discount", "Queue a return pickup", "File QA ticket", "Merge paths", "Add to the refunds report", "Publish refund-closed event". A button (aria-label "Reveal more of the workflow", visible text "Click here") expands the canvas.

## Homepage sections, in order

### 1. Logo wall
- Copy: "Trusted by Fortune 500 companies to build smarter workflows."
- Layout: rotating logo strip. Logos: Meta, Zendesk, Mistral AI, Vodafone, Microsoft, Deutsche Telekom, Mercedes-Benz.

### 2. Persona use-case widget
- No heading.
- Layout: tabs named after people and their team, each with a short video, the tool icons involved, a headline, one sentence and a link.
  - Tabs: "MARK, IT", "DEBORAH, Security", "Olu, Devops", "Alix, Sales"
  - "How Mark automated new user onboarding": "New hires get instant access to Slack, Jira, Notion, and more, all in one workflow." / "See how Mark did it"
  - "How Deborah automated threat investigation": "Suspicious indicators are checked against multiple security tools, combined into one report, and summarized by AI, all in one workflow." / "See how Deborah did it"
  - "How Olu automated alert triage": "When an alert comes in, an AI agent investigates it, then routes it by severity to the right people and tools, all in one workflow." / "See how Olu did it"
  - "How Alix automated lead qualification": "New messages are answered and qualified by an AI agent, the lead record is kept up to date, and a reply goes out, all in one workflow." / "See how Alix did it"
- Pattern: every body ends with "all in one workflow."

### 3. Achievements / stats row
- Three items with icons (GitHub, G2, community):
  - "Top 50 Github project with 209.1k stars" (the star count is filled in live from a `[[GITHUB_STARS]]` placeholder)
  - "Rated 4.7/5 from real users on G2"
  - "Join 250k+ developers in our community"

### 4. Integrations
- **H2:** "The USB-C for your AI stack"
- Sub: "Connect n8n to just about any tool you can think of. 500+ native integrations. Any API via HTTP. Any agent or coding assistant via MCP."
- Layout: grid of about 25 integration logos (no alt text), heading left-aligned.

### 5. Sticky feature showcase (AI trust)
- **H2:** "See + understand + trust your agents"
- Sub: "Connect any model, see every decision, and add human approval when needed."
- Layout: sticky media on one side; three expandable items (accordion on desktop, stacked on mobile):
  - "Full visibility across agents": "Watch agents work live, or open any past run, all inside the same workflow."
  - "Put rules around AI actions": "Use structured inputs and outputs for AI actions. Add human-in-the-loop approvals and rule-based automation."
  - "Self-host your AI stack": "Deploy on-prem or with Docker to keep your data in your own environment. Access the source code on GitHub, or use the hosted version."

### 6. Sticky feature showcase (readability)
- **H2:** "Built by you + readable by anyone"
- Sub: "Create workflows anyone can follow with a visual builder and drop into code whenever you need it."
- Items:
  - "Documentation, built in": "The workflow is the documentation. No separate docs. No handover write-ups."
  - "Recover in one step": "Spot errors at a glance, Re-run just the step that broke."
  - "Every change, tracked": "Version history shows who changed what, and when."

### 7. Expressive section (big headline, image)
- **H2:** "Move fast + break nothing" (the "dotted" headline style)
- Body: "Shipped months ago. Still in control. Feels good, doesn't it?"
  - "**Move fast.** Replay a past run or mock the data. Skip waiting on external systems."
  - "**Break nothing.** See exactly what happened in the logs. No digging required."
- Closing line: "Now imagine that across your whole company."

### 8. Enterprise teaser (dark cards)
- **H2:** "Enterprise-ready for teams of any size"
- Sub: "Scale AI without losing control. Security, governance, and handoff built in."
- CTAs: **"Explore enterprise"**, **"Talk to Sales"**
- Four dark cards with illustrations:
  - "Security + control": "Fully on-prem option, SSO SAML, and LDAP, encrypted secret stores, version control, RBAC permissions."
  - "Observability + transparency": "Audit logs and log streaming to your SIEM, workflow history, real-time alerts, usage dashboards."
  - "Developer experience": "Git-based control, isolated environments, multi-user workflows, workflow diffs."
  - "AI governance": "Human-in-the-loop, guardrails, evaluations."

### 9. Compliance badges
- Three badge images: AICPA SOC, GDPR, a security badge. No text.

### 10. Promoted case studies (two large cards)
- Eyebrow "Case study / Huel". **H2:** "Huel saved 1,000 hours with an AI-first culture". Quote: "n8n was the big unlock. Tools like ChatGPT and Claude are great, but n8n is the thing that allows you to integrate AI into your work and your processes in a safe and controlled way." Ollie Scheers, Chief Technology Officer. CTA "Read Case Study".
- Eyebrow "Case study / Vodafone". **H2:** "Vodafone delivers £2.2M security operations win". Quote: "n8n provides SOAR capability and workflows in a low-code model, as well as the ability to code for more complex workflows and integrations. It did everything that we wanted, all in one tool." Claire Van Hinsbergh, Cyber Operations Engineering Manager. CTA "Read Case Study".
- Pattern: the case-study headline *is the number*.

### 11. Testimonial wall
- No heading. A grid of short quotes, first name and surname only, some with avatars. Verbatim examples:
  - "n8n makes complex workflows easy to build, and versatile enough for me to add my own 'secret sauce.'" Danny Melamed
  - "I have found the holy grail of automation." Luisa Vidal
  - "n8n's integration with third-party services is absolutely mind-blowing. It's like a Swiss army knife for automation." Felix Leber
  - "n8n is the tool that turns 'I have an idea' into 'it's running in production' faster than anything else." Ric Neves
  - "Thank you to the n8n community. I did the beginners course and promptly took an automation WAY beyond my skill level." Charley Mann
  - "n8n is the glue that holds many of our systems together." Paul Cook
  - "I can move fast, go deep when things get complex, and never feel boxed in." Ali Mazloum
  - Also Robyn Tindall, Nanbing, Ray Fourie.

## Final CTA section

- **H2:** "Build workflows the way you actually think" (dotted headline style, with an image)
- CTA: **"Start building"**

## Footer

Logo, then three unlabelled link columns (no column headings):

- Column 1: Careers ("Hiring" badge), Contact, Press, Brand guidelines, Merch, Legal
- Column 2: Events, In The Loop ("Oct 2026" badge), Partners, Hire an expert, Affiliate program, Join user tests
- Column 3: Case Studies, AI agent report, n8n alternatives, Education, n8n on SAP

Bottom row: Imprint · Security · Privacy · Report a vulnerability. Social: Twitter/X, GitHub, Discord, Linkedin, youtube. "© 2026 n8n All rights reserved."

---

## Pricing page (`/pricing/`)

- **H1:** "Pricing"
- Sub: "All plans include unlimited users & workflows and every integration. Pricing is based on monthly workflow executions, regardless of complexity."
- Toggle: "Monthly" / "Annually (Save 17%)". Annual is shown by default.
- Prices were served in euros to this request; the currency may depend on location.

| Tier | Line under name | Annual price shown | Monthly-billing price (from the page data) | Volume | CTA | Hosting line |
|---|---|---|---|---|---|---|
| **Starter** | "Build and run your first workflows and agents." | "20€ /mo, billed annually" | 24€ | "2.5K workflow executions with unlimited steps" | "Start free trial" + "No credit card required" | "Hosted by n8n" |
| **Pro** | "For solo builders and small teams running automations in production." | "50€ /mo, billed annually" | 60€ (10K tier) | "10K workflow executions with unlimited steps" (a dropdown for higher tiers) | "Start free trial" + "No credit card required" | "Hosted by n8n" |
| **Business** | "For companies with < 100 employees needing collaboration and scale." | "667€ /mo, billed annually" | 800€ | "40K workflow executions with unlimited steps" (dropdown) | "Start free trial" | "Self-hosted only" + a link "Hosted by n8n?" to a waitlist |
| **Enterprise** | "For organizations with strict compliance and governance needs." | "Contact Sales" | n/a | "Custom workflow executions" | "Contact sales" | "Hosted by n8n or Self-hosted" |

- Feature bullets are cumulative: "This plan includes:" then "Everything in Starter plan, plus:", "Everything in Pro plan, plus:", "Everything in Business plan, plus:".
  - Starter: "1 shared project", "5 concurrent executions", "Agents, MCP and AI nodes", "1,600 Assistant credits/month", "AI models without API keys", "Forum support"
  - Business: "6 shared projects", "SSO and LDAP", "30 days of insights", "Assistant (preview)", "Multiple environments", "Queue mode for scaling", "Version control using Git", "Forum support"
  - Enterprise: "Unlimited shared projects", "200+ concurrent executions", "365 days of insights", "External secret store integration", "End-user credentials (preview)", "Log streaming", "Extended data retention", "Dedicated support with SLA", "Assistant preview on request"
- Section after the cards: **H2 "If it doesn't run, you don't pay"**: "Unlike other tools that charge per step or user, n8n lets you build freely and only pay when a workflow runs from start to finish." CTAs "Get Started" / "Talk to sales".
- **H2 "Need something a bit different?"** Two cards:
  - "Startup plan": "Under 20 employees? Check if you qualify for our Startup plan and get 50% off Business." / "Learn more"
  - "Community Edition": "A standard, self-hosted version of n8n is available on GitHub." Shows the live GitHub star count "209,105" as a link, plus "Learn more" (to the docs).
- Logo strip: "Trusted by teams building smarter workflows."
- **H2 "What's included?"**: a long comparison table with a "Cloud" / "Self-hosted" switch. Groups: Core features, Agents, Test and monitor AI, Developer tools, Environments and version control, Executions and limits, Security and credentials, Debugging, Collaboration, Enterprise Scaling, Insights, Support, Billing and contract. Some rows say "Available in self-hosted" (for example "Run bash scripts", "Custom nodes", "LangSmith tracing").
- **How open source, self-hosted, cloud and enterprise are framed:** the free, self-hosted edition is not a tier card. It sits in a side card called "Community Edition", next to the startup discount. The paid cards are mostly cloud, and the Business tier is *self-hosted only*. Self-hosting is a switch on the comparison table, not a separate product. The licence is called "fair-code" in the nav ("Our license") and "source-available" on the enterprise page. The pricing page never says "open source".
- **FAQ.** Heading: **"See your work working"**. Questions, verbatim:
  - "What's included in the n8n free trial?"
  - "What are executions (and why are they more powerful than on other products)?"
  - "How do Assistant credits work?"
  - "How can I assess how many production executions I need?"
  - "How will I see how many production executions I've used?"
  - "How many executions does n8n keep, and for how long?"
  - "How does n8n monitor my usage on a self-hosted instance?"
  - "Is the Business plan available on n8n Cloud?"
  - "Does the Business plan include support?"
  - "What is the difference between forum and dedicated support?"
  - "What does 'collaborate on workflows' mean?"
  - "What happens after I subscribe? How does the upgrade from Community to Business work?"
  - "On how many instances can I apply my Business or Enterprise plan license key?"
  - "I subscribed to the Business or Enterprise plan. What happens when I hit my quota?"
  - "Can I cancel my Business plan subscription?"
  - "Can I pay by wire transfer?"
  - "Is n8n secure? Where is my data stored?"
  - "Do you have an affiliate program?"
  - "Do you offer a discount for startups?"
  - "If I'm self-hosting, why would I pay based on execution usage?"
- Two answers worth noting, verbatim:
  - Self-host telemetry: "To access Business or Enterprise features on your self-hosted instance, you receive a license key that must ping our license server daily to stay active. ... We also collect telemetry data by default, though you can choose to disable it."
  - Value pricing: "Our pricing is not tied to how much it cost us to run n8n but the value it brings to you and your organisation."

## Enterprise page (`/enterprise/`)

- **H1:** "AI you can trust at scale"
- Sub: "Turn your teams' expertise into AI they build and trust, and stay in control as it scales."
- CTA: **"Contact Sales"** (one CTA only)
- Under the hero: "Trusted by millions of technical users and more than a third of F500 companies." Logo rotator: Mistral AI, Microsoft, Meta, Mercedes-Benz, Deutsche Telekom, Dell, Cummins, Zendesk, Vodafone, SEAT, Paddle, NVIDIA, Novo Nordisk.
- The page is told as a story, with eyebrows "The Problem", "The Platform", "Governance", "Observability", "Support & partnership":
  1. **"The Problem"**: H2 "AI costs are scaling but the value is not". "Enterprises are overspending on AI that either never ships, runs unsupervised, or didn't need to be AI in the first place." Three cards: "Budgets are burned on tasks that don't need autonomous AI"; "Pilots are not reliable enough to reach production"; "Shadow AI risks are skyrocketing" ("One in three employees uses AI without their employer knowing. Breaches tied to shadow AI have more than doubled in a year." Source: IBM, Cost of a Data Breach Report 2026).
  2. **"The Platform"**: H2 "Build workflows and agents you can trust". "With n8n you can turn complex processes into reliable production systems that combine deterministic logic, AI agents, and human decisions." Cards: "Connect your whole stack without friction", "Choose how your automation runs" ("Set each process to run deterministically, autonomously, or anywhere in between."), "Use any AI model", "Make agents reliable".
  3. H2 "Let domain experts and engineers build together". "With n8n, non-technical teams can safely turn their expertise into systems, and engineers get a tool they won't outgrow." Six items, including "Co-build with AI and ship in minutes" ("...using n8n Assistant or Claude + MCP."), "No black box, your team understands what they build", "Keep development and production apart", "Review changes before they go live".
  4. **"Governance"**: H2 "Scale AI adoption safely". Cards: "Give every team its own perimeter", "Tailor roles for every project", "Apply least privilege to agents" ("Agents only use the tools and actions you've defined, within the guardrails you set."), "Store secrets in your vault".
  5. H2 "Choose how and where you deploy". Three tiles: "Managed Cloud / Use n8n Cloud.", "Self-hosted / Run n8n in your own infrastructure.", "Air-gapped / Run n8n in isolated environments." Badges: "GDPR", "SOC 2 Type 2", "SOC 2 Type 3" (the last label is exactly as published).
  6. **"Observability"**: H2 "Nothing happens without a record you can audit". Cards: "See how n8n is used across the business", "Full audit trail, tied to identity", "Step-by-step execution history" ("For agents, see which tools they used and when a human stepped in."), "Logs and metrics in your stack".
  7. H2 "See how enterprises use n8n" with the Huel and Vodafone case-study cards (same as the homepage).
  8. **"Support & partnership"**: H2 "We're by your side". "Enterprise AI takes more than the right technology. It takes the right support to put it into production." CTA "Contact Sales". Cards: "Learn from engineers who've done it before" (forward-deployed engineers), "Get a technical contact who knows your setup", "Get the right support when it matters", "Get hands-on best-practice guidance".
  9. Closing: H2 "Stay in control as AI evolves". "With n8n, you stay in control of which models you use, which tools you connect, and where you run your workflows. Change your approach as the technology evolves, without starting from scratch." CTA **"Contact Sales"**. Tiles: "Adapt as things change", "Own what you build" ("Workflows are plain JSON, so you can export them at any time."), "Review and extend the code" ("n8n is source-available, so your security team can inspect the code and your engineers can build on it.").

## Extra page glanced at: `/features/` (Product overview)

- **H1:** "Think it + build it + run it"
- Sub: "AI automation that's more than just a black box. Build workflows that you can trust, and understand every step."
- CTAs: "Get Started" / "Explore templates"
- Sections: "Build any automation" ("Start with an agent, a workflow, or both."; items "Create with AI", "Choose from thousands of templates", "Edit visually", "Integrate with everything", "Add agents", "Keep humans in the loop"); "See your work working" ("Watch workflows run", "Trace what happened", "Turn back time", "Get the numbers", "Control deployment", "Manage versions"); eyebrow "Govern", H2 "Maintain control + security" (includes "Self-host AI": "RunAI with no external data transfer using a self-hosted stack with Ollama, Quadrant and PostgreSQL.", sic); "Connect with us online + offline" (Community forum, "the 200,000-strong n8n community"; Community events, "Less URL, more IRL."; Dedicated Discord); "Blog".
- Final CTA: H2 "Automation with nothing to hide" / "See every step. Stay in control." / "Get started" / "Talk to sales".

---

## Tone of voice notes

- **The "+" device is the house style.** "See + understand + trust your agents", "Built by you + readable by anyone", "Security + control", "Think it + build it + run it", "Move fast + break nothing". Headlines are short, often split over two lines, with a dotted or animated treatment.
- **Plain, concrete, almost conversational.** "Connect n8n to just about any tool you can think of." / "Feels good, doesn't it?" / "Less URL, more IRL." Humour is light and confident, never wacky.
- **Second person with named people.** The use-case widget uses first names and teams ("How Mark automated new user onboarding"), and every story ends "all in one workflow." This makes the product feel human-sized.
- **Transparency is the theme of the AI pitch.** They sell being able to see and follow the AI, not its intelligence: "agents and workflows you can follow", "Open any step, see what it does", "AI automation that's more than just a black box", "Nothing happens without a record you can audit". Human-in-the-loop is named again and again.
- **Self-hosting is a feature, not an ideology.** "Self-host your AI stack: Deploy on-prem or with Docker to keep your data in your own environment. Access the source code on GitHub, or use the hosted version." They avoid the word "open source" and say "fair-code" and "source-available" instead.
- **Enterprise copy switches to problem-agitate-solve, with outside statistics** ("AI costs are scaling but the value is not", an IBM citation), while the homepage stays upbeat.
- **Pricing copy argues against competitors' billing models**: "If it doesn't run, you don't pay", "Unlike other tools that charge per step or user", "would take 10,000 operations in other tools."
- **Metaphor used sparingly and once each**: "The USB-C for your AI stack", "the glue that holds many of our systems together" (from a customer).

## What is worth borrowing

1. **A hero that is the product, with a plain-language prompt above a live canvas** ("When a refund request comes in, look up the order. Then ask me in Slack..."), plus tabs for several example jobs. Here the AI promise and the deterministic workflow are one picture.
2. **The persona tabs** ("MARK, IT", "DEBORAH, Security"...), each with a one-line outcome and a repeated closing phrase. This maps well to role-based stories such as "How the Head of Sales ran the Q3 check-in".
3. **A small three-item proof row** right after the use cases: GitHub stars (live), a G2 rating, community size. Short, factual, with icons.
4. **"Enterprise-ready for teams of any size"** as a dark four-card block on the homepage (Security + control, Observability + transparency, Developer experience, AI governance), followed by compliance badges. The enterprise case is made before anyone clicks Enterprise.
5. **Pricing honesty in the FAQ**: they say plainly how self-hosted licence keys phone home and that telemetry is on by default, and they explain the unit of billing in plain words. The "Community Edition" side card is a quiet but clear way to say "the free self-hosted version exists".
