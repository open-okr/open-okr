# OKRGoal

| | |
|---|---|
| URL | `/cloud` |
| Audience | Teams that want the product and none of the operations |
| The page's one job | Sell operation, not features, and remove the fear of lock-in |
| Primary CTA | Start free |
| Secondary CTA | See pricing |
| Page title | OKRGoal: OpenOKR, run for you · Free to start |
| Meta description | OKRGoal is OpenOKR, run for you by OKR Institute, the team that builds it. Every feature, a free plan, backups and upgrades handled, and your whole workspace exportable at any time. |

## Section structure

| # | Section | Layout |
|---|---|---|
| 1 | Hero | H1, subhead, buttons, product image |
| 2 | Who does what | Two columns |
| 3 | Start in three steps | Numbered |
| 4 | What operation means | Six cards |
| 5 | You can leave | Short text, three facts |
| 6 | Cloud or self-host | Comparison table |
| 7 | FAQ | |
| 8 | Final CTA | |

---

## 1. Hero

**Eyebrow:** OKRGoal

# We run it. You run your OKRs.

OKRGoal is OpenOKR, run for you by OKR Institute, the people who build it. The same release as the open source edition, with every feature on every plan. Sign up, name your workspace, and the Coach is checking your first draft a few minutes later.

**Buttons:** `[ Start free ]` `[ See pricing ]`

**Small, under the buttons:** Free plan. No credit card. Export everything, any time.

**Image:** the Work Map ([01-work-map.png](../../mockups/png/01-work-map.png)) inside a browser frame showing the cloud address.

## 2. Who does what

| We do | You do |
|---|---|
| Servers, the database, backups and restores | Decide what matters this quarter |
| Upgrades to every new release | Write the OKRs, with the Coach watching |
| Monitoring, and a public status page | Check in, honestly |
| Mail delivery, so nudges and digests arrive | Hold the weekly session |
| Security patches | Close the quarter and learn from it |
| Support, by people who wrote the code | |

## 3. Start in three steps

## Registering is the whole of setup.

**1. Sign up.** Your name, your email, a password or a passkey.

**2. Name your workspace.** That is the last required choice. Every setting already has a working default, so the rhythm runs, the Coach checks drafts and the agents work from the first minute.

**3. Invite your team, or look around first.** Invite by email or with a link limited to your company's domain. Or fill the workspace with demo data and explore a realistic company before you bring your own.

**Line under the steps:** Onboarding suggests. It never demands. Every step can be skipped.

## 4. What operation means

**Six cards:**

| Card | Copy |
|---|---|
| **Backups, tested** | Encrypted backups, and restores that are rehearsed, not assumed. |
| **Upgrades, handled** | Every release, applied for you, with release notes that say what changed. |
| **A stated region** | Your workspace lives in the region we name, and we say which. |
| **AI, included** | Every paid plan includes an AI allowance with a hard cap. Or bring your own key and pay your provider directly. |
| **Chat, connected** | Slack, Teams, WhatsApp and Telegram connect from the admin screen. Email works from day one. |
| **Support that cannot see your data** | Our team cannot open your workspace unless an owner grants a session. It lasts four hours by default and twenty-four at most, and a banner on every screen says who is in and for how long. There is no back door. |

> **Decisions needed before this section ships:**
> 1. **Region.** Which region, or regions, the cloud runs in. The tenant model records a region per workspace, but nothing routes on it yet, so a residency promise is a contract term, not a setting.
> 2. **Backup schedule and retention**, stated as numbers.
> 3. **Uptime commitment**, if any, and on which plans.
> 4. **The AI allowance per plan**, in US dollars a month. See [pricing.md](pricing.md).
> 5. **The status page** at `status.okrgoal.com`, which must exist before this page promises one.

## 5. You can leave

## No lock-in. We checked.

The cloud runs the same open source release you could run yourself. Export the whole workspace whenever you like, to a signed, encrypted, checksummed archive, and import it into your own OpenOKR instance after a dry run. Your goals, check-ins, KPIs, documents and history come with you.

| Same code | Full export | Any time |
|---|---|---|
| AGPL-3.0, on GitHub | Every object and its history, in one archive | No notice period, no request, no fee |

## 6. Cloud or self-host

## Same product. Different job for you.

| | OKRGoal | Self-hosted |
|---|---|---|
| Features | Every feature | Every feature |
| People | Priced per person, with a free plan | Unlimited, free |
| Who runs it | We do | You do |
| Backups and upgrades | Ours | Yours, with the lifecycle helper |
| Where the data lives | Our stated region | Your servers, your country, offline if you like |
| AI | An allowance included, or your own key | Your own key, or a local model, or none |
| Support | By plan, see pricing | Community, or a support contract |
| Move between them | Export and import, both directions | Export and import, both directions |

## 7. FAQ

**Is the cloud a different product?**
No. It is the same tagged release as the open source edition, operated by us. There is no cloud-only feature and no self-host-only feature.

**What counts as a seat?**
People who are active or invited. Guests, the two AI agents and people who have left do not count. A leaver stops costing money the day you suspend them.

**What happens if we go over our seats?**
Inviting one more person is refused, with the numbers, until you free a seat or add one. Nobody already in the workspace loses access.

**Can our own AI key be used instead of yours?**
Yes. Bring a key for Anthropic, OpenAI, Google, OpenRouter or any compatible endpoint, at the workspace or for individual people.

**Can OKR Institute staff read our OKRs?**
Only if a workspace owner grants a support session, for a set time, with a banner on every screen while it lasts. Otherwise no, and the product offers us no way to.

**What if OKRGoal stops existing?**
You keep the code, the signed images and your exported workspace. Run it yourself, on the same release, with nothing lost.

## 8. Final CTA

## Your workspace is a minute away.

**Buttons:** `[ Start free ]` `[ Try the live demo ]`
