# okrgoal.com: the site for OKRGoal and OpenOKR

The structure and the full copy of okrgoal.com: the home of OKRGoal, OKR Institute's cloud OKR product, and the commercial home of OpenOKR, its open source edition. Written for whoever designs and builds the site, and for the maintainers who must approve what it promises.

**Status:** draft copy, 1 November 2026, written against release v0.4.0. Nothing here is published.

## What is in this folder

| File | What it holds | Read it when |
|---|---|---|
| [reference/](reference/README.md) | Seven reference sites studied: structure, headlines, calls to action, pricing and tone, with what we borrow from each | You want to know why a page is shaped the way it is |
| [messaging.md](messaging.md) | The two names, positioning, the three pillars, the voice, a headline bank, the words we use and avoid, objections | Before writing or editing any copy |
| [claims.md](claims.md) | Every number and promise the site makes, with its source in the specification. And the list of things never to claim | Before publishing anything, and whenever the product changes |
| [sitemap.md](sitemap.md) | The page tree, each page's job and CTA, the navigation, the footer, the button vocabulary, visitor paths | Before building the site |
| [pages/](pages/) | Full copy for 21 pages, section by section, with layout and image notes | When building each page |

## The pages

| Group | Page | File |
|---|---|---|
| Core | Home | [home.md](pages/home.md) |
| | Product tour | [product.md](pages/product.md) |
| Product | The method | [product-method.md](pages/product-method.md) |
| | The agents | [product-agents.md](pages/product-agents.md) |
| | The rhythm | [product-rhythm.md](pages/product-rhythm.md) |
| | KPIs and recovery OKRs | [product-kpis.md](pages/product-kpis.md) |
| | Integrations | [product-integrations.md](pages/product-integrations.md) |
| Run it | OKRGoal in the cloud | [cloud.md](pages/cloud.md) |
| | Self-host | [open-source.md](pages/open-source.md) |
| | Pricing | [pricing.md](pages/pricing.md) |
| | Enterprise | [enterprise.md](pages/enterprise.md) |
| | Security | [security.md](pages/security.md) |
| Solutions | Growing companies | [solutions-growing-companies.md](pages/solutions-growing-companies.md) |
| | Universities and public sector | [solutions-public-sector.md](pages/solutions-public-sector.md) |
| | Consultancies and OKR coaches | [solutions-consultancies.md](pages/solutions-consultancies.md) |
| | Why OKRGoal | [why-okrgoal.md](pages/why-okrgoal.md) |
| Explore | Live demo | [demo.md](pages/demo.md) |
| | Resources | [resources.md](pages/resources.md) |
| | Community | [community.md](pages/community.md) |
| Company | About | [about.md](pages/about.md) |
| | Contact | [contact.md](pages/contact.md) |

## How a page file is laid out

Every page file has the same four parts, so a designer can work from any of them without reading the others.

1. **A header table:** the URL, the audience, the page's one job, the primary and secondary CTA, the page title and the meta description.
2. **Section structure:** a table of the sections in order, with the layout of each and, where it came from a reference site, which one.
3. **The copy,** section by section: eyebrow, headline, body, buttons, captions and image notes. Headlines are written exactly as they should appear.
4. **Notes in quote blocks,** marked **Decision needed**, **Check before publishing** or **Claim check**. These are for us, never for the site.

## Decisions the copy is waiting for

The copy is final around these. Each one is a human decision, and several are already recorded as open in the specification.

| # | Decision | Affects | Recorded as open in |
|---|---|---|---|
| 1 | **Settled on 1 November 2026.** OKR Institute is the company, OKRGoal the cloud product, OpenOKR the open source product | Every page | [messaging.md §1](messaging.md) |
| 2 | **Cloud prices:** per-person price, free plan limit, AI allowance per plan, yearly discount, trial | Pricing, Cloud, Home FAQ | [PLAN.md §10 #1](../specification/PLAN.md), [plans-and-seats.md §8](../design/plans-and-seats.md) |
| 3 | **The cloud's addresses:** sign-up (`app.okrgoal.com` is a placeholder) and the agent endpoint | Every "Start free" button, Integrations, Home | |
| 4 | **Cloud operation:** region, backup schedule, uptime commitment, status page | Cloud, Security, Enterprise | [tenant-lifecycle.md §5](../design/tenant-lifecycle.md) |
| 5 | **What OKR Institute sells with OKRGoal:** coaching, certification, a named contact, migration, security review, self-hosted support, the response times for each, and whether existing programmes such as the 90-Day OKR Program apply to OKRGoal | Enterprise, Pricing, Self-host | |
| 6 | **A partner programme** for OKR consultants, or not | Consultancies | |
| 7 | **Certifications:** what to say while none is held | Security | |
| 8 | **Documents buyers will ask for:** security overview, DPA, subprocessors, terms, privacy policy | Security, Enterprise, footer | |
| 9 | **Security contact**, response time, bug bounty | Security | |
| 10 | **A community venue:** GitHub Discussions, Discord or a forum | Community, footer | |
| 11 | **The people:** names, roles and photos of the people at OKR Institute behind OKRGoal and OpenOKR, with their permission, and the legal entity for the footer | About, footer | |
| 12 | **Whether to say the demo has AI on**, within a daily cap | Demo | |
| 13 | **Where the documentation lives:** `okrgoal.com/docs` or a subdomain | Sitemap, Resources | |
| 14 | **A Bahasa Melayu version of the site** | Footer, every page | |
| 15 | **Discounts and billing:** education and non-profit, currency, invoices, proration | Pricing | |
| 16 | **okri.io and OKRGoal side by side:** OKR Institute now offers two OKR platforms. What the site tells an okri.io customer, and whether okri.io is named beyond the "built on its lessons" line | About, FAQ | |
| 17 | **OKR Institute's figures:** the copy quotes 2017, 12,000+ courses, 70,000+ participants, 1,000+ organisations and 50+ countries from okrinstitute.org. The same site also says "900+ organizations" and "certified 70,000+ professionals". Confirm one set and keep it current | Home, About, Enterprise | [claims.md](claims.md) |

## What this draft assumes

- **Three names, settled on 1 November 2026:** OKR Institute is the company and the "we" in the copy, OKRGoal is the cloud product, OpenOKR is the open source product. OKRGoal and OpenOKR are one release (PLAN.md §1 and §4).
- **The site promises nothing the product does not do today.** Every claim is in [claims.md](claims.md) with its source. Where a page needs a fact that is not decided, it says **Decision needed** instead of guessing.
- **No customer logos, testimonials or user numbers.** None exist for OKRGoal yet. The proof is OKR Institute's own record, product facts and the method's published sources. OKR Institute's training clients are not OKRGoal customers, so their names never appear as logos.
- **British spelling and the repository's writing rules,** including no em dashes. See [messaging.md §5](messaging.md).

## Worth doing after launch

| Idea | Why | Before doing it |
|---|---|---|
| A page per named competitor | Search traffic from people comparing tools | Check every claim about the other product against its current documentation, date it, and review it |
| Case studies with a number in the title | The strongest proof every reference site uses | Real customers, with permission |
| The handbook as search pages, `/handbook/<page>` | "How to write OKRs" is what buyers search for first | Nothing: the content exists in `docs/handbook/` |
| `/llms.txt` and a Markdown view of each page | Agent-native readers, as browser-use, Mastra and OpenHands do | Nothing |
| The "Connect your agent" menu in the home hero (already written into [home.md](pages/home.md)) | browser-use's and Firecrawl's pattern, and OpenOKR already has the setup prompt | The cloud agent endpoint, decision 3 |

## A note before this is pushed

This folder is in a public repository. It holds the pricing questions above and short quotations from other companies' sites in [reference/](reference/README.md). If either should stay private until launch, move the folder out of the repository before pushing.
