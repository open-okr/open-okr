# Sitemap

The pages of okrgoal.com, what each one is for, and how a visitor moves between them.

## 1. The tree

```
okrgoal.com
│
├── /                              Home
│
├── /product                       Product tour
│   ├── /product/method            The method: cycle, quality checks, gates, alignment, settings
│   ├── /product/agents            The OKR Coach and the OKR Champion
│   ├── /product/rhythm            Check-ins, the weekly session, the quarterly review
│   ├── /product/kpis              KPIs, health bands and recovery OKRs
│   └── /product/integrations      Chat, AI providers, your own agent, API, import, single sign-on
│
├── /solutions
│   ├── /solutions/growing-companies    Startups and scale-ups
│   ├── /solutions/public-sector        Universities, government and regulated sectors
│   └── /solutions/consultancies        OKR coaches and consultancies
│
├── /why-okrgoal                   Compared with spreadsheets, trackers and consultants
├── /demo                          The live demo and the Northwind year
│
├── /cloud                         OKRGoal in the cloud: OpenOKR, run for you
├── /open-source                   Self-host: Docker Compose, Kubernetes, air gap
├── /pricing                       Self-host, Cloud Free, Cloud Team, Enterprise
├── /enterprise                    For large organisations, in the cloud or on your servers
├── /security                      Trust and security
│
├── /resources                     The hub
│   ├── /handbook                  The OKR handbook, rendered from docs/handbook
│   ├── /blog
│   ├── /changelog                 Rendered from the GitHub releases
│   └── docs                       Links out to the documentation
│
├── /community                     Contribute, challenge the method, get help
├── /about                         OKR Institute, and the lessons behind OKRGoal
├── /contact                       Talk to us: sales, partners, press
│
└── /legal
    ├── /legal/terms
    ├── /legal/privacy
    ├── /legal/dpa                 Data processing agreement
    ├── /legal/subprocessors
    └── /legal/trademark           Using the OpenOKR and OKRGoal names
```

Outside the marketing site:

| Address | What it is | Status |
|---|---|---|
| `demo.okrgoal.com` | The live persona demo, reset nightly, follows releases | Live |
| `app.okrgoal.com` | Cloud sign-up and sign-in | **Not live.** The address is a proposal |
| `status.okrgoal.com` | Cloud status page | **Not live.** Needed before the cloud takes paying customers |
| `github.com/open-okr/open-okr` | The code, issues and releases | Live |
| Documentation | Today it lives in the repository's `docs/` | **Decision needed:** render at `okrgoal.com/docs` or a `docs.` subdomain |

Copy for 21 pages is in [pages/](pages/). The legal pages are listed here and written by whoever writes the contracts, not by marketing.

## 2. Page purposes

| Page | Who lands here | The one job of the page | Primary CTA | Secondary CTA | Copy |
|---|---|---|---|---|---|
| Home | Everyone | Say what it is, why it is different, and get a click to the demo or sign-up | Start free | Try the live demo | [home.md](pages/home.md) |
| Product tour | Evaluators who want the whole picture | Walk the product in the order a quarter runs | Start free | Try the live demo | [product.md](pages/product.md) |
| The method | OKR leads, PMOs, practitioners | Prove the practice is real code, and adaptable | See the twenty-six checks | Read METHOD.md | [product-method.md](pages/product-method.md) |
| The agents | Everyone curious about "AI-native" | Show what the agents do, and why they are safe | Start free | Try the live demo | [product-agents.md](pages/product-agents.md) |
| The rhythm | Managers, coordinators, facilitators | Show the weekly and quarterly sessions the product runs | Start free | See a weekly session in the demo | [product-rhythm.md](pages/product-rhythm.md) |
| KPIs | Finance, operations, PMOs | Show KPIs and OKRs working as one system | Start free | Try the live demo | [product-kpis.md](pages/product-kpis.md) |
| Integrations | Admins, technical evaluators | Answer "does it work with what we use?" | Start free | Read the API docs | [product-integrations.md](pages/product-integrations.md) |
| Growing companies | Founders, chiefs of staff | First OKR rollout without hiring a consultant | Start free | Try the live demo | [solutions-growing-companies.md](pages/solutions-growing-companies.md) |
| Public sector | IT and strategy offices at universities, government, regulated firms | Self-host, residency, air gap, audit | Talk to us | Read the install guide | [solutions-public-sector.md](pages/solutions-public-sector.md) |
| Consultancies | OKR coaches and consultancies | A tool that keeps their method running after they leave | Become a partner | Read METHOD.md | [solutions-consultancies.md](pages/solutions-consultancies.md) |
| Why OKRGoal | Visitors comparing options | Name the alternatives honestly and say where we differ | Start free | Try the live demo | [why-okrgoal.md](pages/why-okrgoal.md) |
| Demo | Anyone who clicked "Try the live demo" | Get them into the demo as a named person, with a guided path | Open the demo | Start free | [demo.md](pages/demo.md) |
| Cloud | Teams that want no operations | Sell operation: backups, upgrades, uptime, support, without lock-in | Start free | See pricing | [cloud.md](pages/cloud.md) |
| Open source | Developers, IT, self-hosters | Get it running in half an hour | Install it | Star on GitHub | [open-source.md](pages/open-source.md) |
| Pricing | Buyers | Make the price and the "nothing gated" promise unmistakable | Start free | Talk to us | [pricing.md](pages/pricing.md) |
| Enterprise | Large organisations | Rollout help, support terms, security review, procurement | Talk to us | Read the security page | [enterprise.md](pages/enterprise.md) |
| Security | Security reviewers, IT | Answer the security questionnaire before it is sent | Download the security overview | Talk to us | [security.md](pages/security.md) |
| Resources | Learners | Route people to the handbook, docs, blog and changelog | Read the handbook | Join the community | [resources.md](pages/resources.md) |
| Community | Contributors, practitioners | Turn interest into a contribution or a challenge to a rule | Star on GitHub | Read CONTRIBUTING | [community.md](pages/community.md) |
| About | Buyers checking who we are | Introduce OKR Institute, its record, and how OKRGoal and OpenOKR relate | Start free | Talk to us | [about.md](pages/about.md) |
| Contact | Buyers, partners, press | Route the message to the right person | Send | Book a call | [contact.md](pages/contact.md) |

## 3. Top navigation

The pattern every reference site shares: four or five menus, a GitHub star count, a quiet sign-in link and one solid button.

```
[OKRGoal logo]   Product ▾   Solutions ▾   Pricing   Enterprise   Resources ▾        ★ GitHub {stars}   Sign in   [Try the demo]  [Start free]
```

### Product ▾

| Column | Item | One line under it |
|---|---|---|
| **The product** | Product tour | The whole quarter, start to close |
| | The method | Twenty-six checks and an eight-phase cycle |
| | The agents | The OKR Coach and the OKR Champion |
| | The rhythm | Check-ins and reviews the product runs |
| | KPIs | Health bands and recovery OKRs |
| | Integrations | Slack, Teams, WhatsApp, your own AI agent |
| **Run it** | Cloud | OKRGoal, run for you. Backups and upgrades are ours |
| | Self-host | OpenOKR: free, open source, about half an hour |
| | Security | Isolation, audit, and no back door |
| **Card** | Try the live demo | Sign in as a person at Northwind Labs and look around |

### Solutions ▾

| Item | One line under it |
|---|---|
| Growing companies | Your first OKR rollout, done properly |
| Universities and public sector | On your servers, in your country, offline if you need it |
| Consultancies and OKR coaches | Your method keeps running after you leave |
| Why OKRGoal | Compared with spreadsheets, trackers and consultants |

### Resources ▾

| Item | One line under it |
|---|---|
| Documentation | Install, administer, use, integrate |
| OKR handbook | How to write and run OKRs, in plain English |
| A year at Northwind | One company's year of OKRs, step by step |
| Blog | Practice, product and releases |
| Changelog | Every release and what changed |
| Community | GitHub, discussions and contributing |
| OKR courses ↗ | Training and certification from OKR Institute |
| About | OKR Institute, and why we built OKRGoal |

### Mobile

One menu button. The two buttons stay visible at the bottom of the open menu: **Start free** and **Try the demo**.

## 4. Footer

```
OKRGoal logo
Your OKR coach, built in.
From OKR Institute. OKRGoal is OpenOKR, run for you. OpenOKR is open source under AGPL-3.0.
[★ Star on GitHub]

Product          Run it            Solutions               Resources          Company
Product tour     Cloud             Growing companies       Documentation      About
The method       Self-host         Public sector           OKR handbook       Contact
The agents       Pricing           Consultancies           A year at          Community
The rhythm       Enterprise        Why OKRGoal             Northwind          Status
KPIs             Security                                  Blog               Legal
Integrations     Live demo                                 Changelog

© 2026 OKR Institute®. OKRGoal and OpenOKR are products of OKR Institute.
Terms · Privacy · DPA · Subprocessors · Trademark       [English ▾ Bahasa Melayu]
```

The language switch is a proposal: the product ships in English and Bahasa Melayu, so the site could too.

## 5. The CTA vocabulary

The same action has the same words on every page. A visitor learns them once.

| Action | Button text | Goes to | Style |
|---|---|---|---|
| Create a cloud workspace | **Start free** | `app.okrgoal.com/sign-up` | Solid, primary |
| Open the live demo | **Try the live demo** (in the nav: **Try the demo**) | `/demo`, then `demo.okrgoal.com` | Outline |
| Install it yourself | **Self-host it** | `/open-source` | Text link with arrow |
| Talk to a person | **Talk to us** | `/contact` | Outline |
| Star the repository | **Star on GitHub** | GitHub | Small, with the live count |
| Read the method | **Read METHOD.md** | METHOD.md on GitHub | Text link |

Words we do not put on buttons: "Get started" (it says nothing about what starts), "Book a demo" (the demo is open, nobody needs to book it), "Learn more" (use the name of the page instead).

## 6. Paths through the site

| Visitor | Path | Where it ends |
|---|---|---|
| Founder who heard about it | Home, Demo, Pricing | Start free |
| OKR lead comparing tools | Home, Why OKRGoal, The method, Demo | Start free, or a cloud trial for the leadership team |
| University IT office | Public sector, Self-host, Security, Enterprise | Talk to us, or a self-hosted pilot |
| Developer on GitHub | Self-host, Integrations (your own agent), Community | A running instance and a star |
| OKR consultant | Consultancies, The method, Community | Partner conversation, or a challenge to a rule |
| Security reviewer sent by a buyer | Security, Enterprise | The security overview and a call |
