# Pricing

| | |
|---|---|
| URL | `/pricing` |
| Audience | Buyers, finance, procurement, and the champion inside a company making the case |
| The page's one job | Make the price clear and make "nothing is gated" impossible to miss |
| Primary CTA | Start free |
| Secondary CTA | Talk to us |
| Page title | Pricing: every feature on every plan · OKRGoal |
| Meta description | OpenOKR is free to self-host with every feature and no seat limit. OKRGoal has a free plan and per-person plans that differ only in seats, AI allowance and support. Never in features. |

> **The numbers on this page are not decided.** PLAN.md §10 #1 records the position "per seat with a free tier, no feature gating" and leaves the prices to a maintainer decision. Every `[bracket]` below is a decision, listed in full at the end of this file. The copy around the brackets is final.

## Section structure

| # | Section | Layout |
|---|---|---|
| 1 | Hero | H1, subhead, a two-way switch: Cloud / Self-hosted |
| 2 | Plans | Three cards on the Cloud side, two on the Self-hosted side |
| 3 | The promise | One bold line, centred |
| 4 | Who counts as a seat | Five icons, two columns |
| 5 | Included on every plan | Long checklist in six groups |
| 6 | Support by plan | Small table |
| 7 | FAQ | Ten questions |
| 8 | Final CTA | |

---

## 1. Hero

**Eyebrow:** Pricing

# Every feature, on every plan.

Pay for people, not for features. Self-host OpenOKR free with no limit on people, or let us run it in OKRGoal, free to start.

**Switch:** `( OKRGoal, in the cloud | OpenOKR, self-hosted )`, the cloud selected. Under the Cloud side, a second switch: `( Monthly | Yearly, save [x]% )`.

## 2. Plans

### OKRGoal

| | **Free** | **Team** | **Enterprise** |
|---|---|---|---|
| Line under the name | For a team getting started | For an organisation running OKRs every quarter | For large organisations, with terms to match |
| Price | **US$0** | **US$[price]** per person a month, billed yearly. US$[price] billed monthly | **Talk to us** |
| People | Up to [N] | As many as you need | As many as you need |
| Every feature | ✓ | ✓ | ✓ |
| The OKR Coach and the OKR Champion | ✓ | ✓ | ✓ |
| Slack, Teams, WhatsApp, Telegram, email | ✓ | ✓ | ✓ |
| Single sign-on and directory sync | ✓ | ✓ | ✓ |
| AI allowance, hard-capped | [US$[n] a month, or bring your own key] | US$[n] per person a month | Agreed with you |
| Bring your own AI key | ✓ | ✓ | ✓ |
| Support | Community | Email, [response time] | A named contact, response times in your contract |
| Button | `[ Start free ]` | `[ Start free, upgrade any time ]` | `[ Talk to us ]` |

### OpenOKR, self-hosted

| | **Community** | **Self-hosted with support** |
|---|---|---|
| Line under the name | Open source under AGPL-3.0 | The same software, with us behind it |
| Price | **Free, for good** | **Talk to us**, priced per year |
| People | Unlimited | Unlimited |
| Every feature | ✓ | ✓ |
| Runs on | Your server, your Kubernetes, offline if you like | The same |
| Support | GitHub issues and discussions | A named contact, response times in a contract, upgrade and security-review help |
| Button | `[ Install it ]` | `[ Talk to us ]` |

## 3. The promise

**Centred, large:**

> A plan is a number of seats, an AI allowance and a level of support. Nothing else. There is no feature on any plan that another plan does not have.

**Small, under it:** That is not a launch offer. The plan definitions in the product have no field that could switch a feature off, so there is nowhere to put one.

**Three chips under the promise:** `Single sign-on on the free plan` `Directory sync on the free plan` `The audit log on the free plan`

**Caption:** Many tools keep these for their enterprise tier. Security should not cost extra.

## 4. Who counts as a seat

## You pay for people who work in it. Nobody else.

| Counts as a seat | Free, always |
|---|---|
| **Active members.** People who can sign in and work | **The OKR Coach and the OKR Champion.** Charging for them would charge for the product's whole idea |
| **Invited members.** So a full plan refuses the invitation, not the person clicking the link | **Guests.** Someone you share one space with. Sharing should never be a money decision |
| | **People who have left.** Suspend a leaver and their seat is free that day. Their work and their name on it stay |

**Line under the table:** Want a smaller plan than the people you have? We will not pick who loses access. The product tells you how many people are over the new number, and you decide.

## 5. Included on every plan

## Everything, on every plan.

**Six groups, each a checklist:**

**The method**
- The guided eight-phase cycle, annual and quarterly
- Twenty-six quality checks as you type, with a strength score
- Six publish gates, each set to block, warn or off
- Committed and aspirational objectives, four kinds of key result
- Alignment with dependencies, and an alignment health score
- Twenty-five practice settings and five profiles

**The rhythm**
- The four-step weekly session, with private confidence voting
- Blockers with owners and a clock, commitments and wins
- The monthly review and decision log
- The ninety-minute quarterly review, minutes and the closing diagnostic
- The review inbox, digests, streaks, holidays and leave

**KPIs and the work**
- KPI driver trees, calculated KPIs and health bands
- Recovery OKRs and the recovery board
- Initiatives, a board linked to key results, documents and files

**AI and agents**
- The OKR Coach and the OKR Champion
- Propose-and-approve, sandbox mode and hard cost caps
- The copilot, with citations
- Your own agent over MCP, a REST API and a command line
- Bring your own model: Anthropic, OpenAI, Google, OpenRouter, Ollama or any compatible endpoint

**Reach**
- Browser, email, Slack, Microsoft Teams, WhatsApp and Telegram

**Security and admin**
- Single sign-on with OIDC and SAML 2.0, directory sync with SCIM 2.0
- Passkeys, authenticator codes and an enforced second factor
- An append-only, hash-chained audit log with one-click verification
- Full workspace export and import
- Importers, with a dry run before anything is written
- English and Bahasa Melayu

## 6. Support by plan

| | Free and Community | Team | Enterprise and Self-hosted with support |
|---|---|---|---|
| Channel | GitHub discussions | Email | Email and a shared channel |
| Response time | Best effort | [n business days] | [Agreed in contract] |
| Rollout help | Documentation and the OKR handbook | Documentation and the OKR handbook | A rollout plan with us |
| Security review | The security page | The security page | We answer your questionnaire |

## 7. FAQ

**Is the free plan really every feature?**
Yes. The free plan has a limit on people, not on features.

**Why is self-hosting free?**
Because OpenOKR is open source, and we think organisations should be able to own the tools they run their strategy on. We earn money by running it for people who would rather not, and by supporting organisations that run it themselves.

**What does the AGPL licence mean for us?**
If you run OpenOKR for your own staff, nothing. You owe no fee and no source code. The licence only asks something of people who change the code and offer it to others as a service: they must publish their changes.

**Do the AI features cost extra?**
Paid cloud plans include an AI allowance, with a hard cap so a bill can never surprise you. Or bring your own key and pay your provider directly. And every rule works with AI switched off.

**Do the AI agents count as seats?**
No, on any plan.

**Can we switch between cloud and self-hosted?**
Yes, in both directions. Export the workspace, import it on the other side, after a dry run.

**Is there a discount for non-profits, schools and universities?**
[Decision needed. Suggested: yes, with a stated percentage.]

**What currency do you bill in?**
[Decision needed. US dollars by default, and Malaysian ringgit if you invoice locally.]

**Can we pay by invoice?**
On Enterprise, yes. [Decision needed for Team.]

**What happens when we add people mid-year?**
[Decision needed: prorated, or trued up at renewal.]

## 8. Final CTA

## Start free. Grow into it.

**Buttons:** `[ Start free ]` `[ Talk to us ]`
**Text link:** Or self-host it, free →

---

## Decisions this page is waiting for

| # | Decision | Recorded position | Where it is held |
|---|---|---|---|
| 1 | Per-person price for Team, monthly and yearly | Per seat with a free tier | PLAN.md §10 #1 |
| 2 | The free plan's limit on people | Open. Today a free tenant is unlimited, which "is almost certainly not what a real free tier does" | [plans-and-seats.md §8 #3](../../design/plans-and-seats.md) |
| 3 | The AI allowance per plan, in US dollars a month | A plan writes its cap into the workspace AI budget | plans-and-seats.md §4 |
| 4 | Whether there is a trial of Team, and how long | The tenant model holds a trial end date | [tenant-lifecycle.md](../../design/tenant-lifecycle.md) |
| 5 | Support response times per plan | Not recorded | |
| 6 | Self-hosted support pricing | Not recorded | |
| 7 | Discounts for education and non-profits | Not recorded | |
| 8 | Billing currency, invoicing, proration | Billing is outside the repository today | plans-and-seats.md §8 #4 |
| 9 | The yearly discount | Not recorded | |
