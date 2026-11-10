# AI credits: an allowance on the provider's own key

Status: approved on 7 November 2026. The expiry of purchased credits in §4, §6, §9,
§10 and §11 was added and approved on 8 November 2026, and built in migration 0147.
Authority: AI-NATIVE-PLAN
§1 rule 7 and §4, `plans-and-seats.md` §9, `billing.md`.

## 1. What a credit is

**A credit is a unit of AI model cost, at the model provider's price.** OKRGoal's is
one US cent. A provider sets its own, with `cloud.creditValueUsd`, default `0.01`.

| Rule | Consequence |
|---|---|
| A credit is spent only on the provider's key | AI on a workspace's own key, or a person's, spends none |
| Every rule works with AI off | Out of credits pauses AI features and nothing else. Deterministic nudges, gates and scores carry on |
| Self-hosting is never limited | No plan with credits means no credit check at all |
| Model cost is measured in US dollars | The price list is. A provider sells in any currency it likes (`billing.md`) |

### Why cost-based

From the benchmark of 7 November 2026, at list prices and with token counts assumed
rather than measured (§8).

| | Cost-based (chosen) | Flat per action |
|---|---|---|
| Your exposure | Capped exactly | Depends on the model |
| Copilot margin on a mid model, at $0.012 a credit | Holds | **-158%** |
| A provider's price rise | Passes through | Eats margin |
| Compared with a customer's own key | Directly | Not comparable |
| Weakness | Harder to predict a month | Easy to predict |

The weakness is answered by publishing typical credits per action once measured (§8),
as Notion does, and by showing a usage log.

## 2. What was wrong before this change

| Finding | Effect |
|---|---|
| A deployment key alone gives a new workspace no AI. Routing needs a provider enabled inside the workspace | "100 credits, no card" cannot work |
| The plan's allowance is written to `ai_budgets`, which an administrator can edit with `ai.setBudget` | An administrator could raise their own allowance, on your key |
| Usage does not say whose key paid | Own-key calls would spend credits, against the page's promise |
| No plan means no budget row, and no row means no limit | A free workspace on your key would be unlimited |
| An administrator's own model row sets its price | They could price your key's model at zero |
| One agent run may spend $2, and Free holds $1 | One run could empty a free workspace |

## 3. Who can use the provider's key

| The workspace's plan | The provider's key |
|---|---|
| An empty catalogue (self-hosted, group) | Available with no credit check, as the deployer's own choice |
| A plan with `aiCredits` above zero | Available, spending credits |
| A plan with `aiCredits` at zero or absent, or no plan when there is a catalogue | Not available. The workspace brings its own key. A workspace adopted from before the flag has no plan, and must not spend a provider's key without limit |

What the operator console shows about a workspace with no plan, and its one move onto the default plan, is [workspaces-without-a-plan.md](workspaces-without-a-plan.md) (plan 0.8.0 O2).

**Routing changes for everybody:** a workspace with no provider of its own routes to
the deployment's provider, with the catalogue's default model for each tier. This
fixes the first finding, and it fixes a group wanting one key for all its companies.
It only changes anything on an instance where somebody set `OPENOKR_AI_PROVIDER`.

**A workspace that adds its own key stops spending credits immediately**, because its
own key comes first in the existing order.

**On the provider's key, prices come from the catalogue only**, never from a
workspace's own row.

## 4. Schema

Two migrations, 0146 and 0147, each with row-level security in the same file. No legacy source.

| Change | Notes |
|---|---|
| `ai_usage_events.key_source` | `user`, `workspace` or `deployment`. Nullable, because earlier rows do not know and spend nothing |
| `ai_credit_balances` | One row per workspace: `period_start`, `used_usd`, `agent_used_usd` |
| `ai_credit_packs` | One row per purchase: `workspace_id`, `credits`, `purchased_usd`, `remaining_usd`, `purchase_ref`, `purchased_at`, `expires_at`. `purchase_ref` is the checkout session, unique per workspace, so one checkout is one pack whichever of its events arrives |

**A balance row rather than summing the usage table.** The check runs before every AI
call, and one locked row is both faster and safe under concurrency. The events stay
as the record, and the row can be rebuilt from them.

**One row per purchase rather than one total**, because two packs bought months apart
expire on different days, and one number cannot say how much of it lapses when.

Each call on the provider's key updates the balance in the same transaction as its
usage row. A new month resets `used_usd` and `agent_used_usd`.

```
allowance  = plan credits x credit value
live packs = packs whose expires_at is after now
available  = (allowance - used) + the remaining_usd of every live pack
overflow   = what this call took past the allowance
```

Overflow comes off the live pack that expires soonest, then the next. A charge already
holds the balance row's lock, so the packs need no lock of their own.

**The balance's `purchased_usd` goes in the migration that adds the packs.** No release
has shipped that column: migration 0146 is in no release yet. So the two-release
rule has nothing to protect, and no purchase needs carrying over.

## 5. Limits

| Limit | Value | Why |
|---|---|---|
| The month's allowance | The plan's `aiCredits` | The page's numbers: 100, 2,000, 10,000 |
| Agents' share | `cloud.agentCreditShare`, default 50% of the allowance | Background agents must not pause the copilot |
| One agent run | The smaller of the run cap and what is left | One run cannot empty a free workspace |
| A month | UTC calendar month | What budgets already use. "Resets on the 1st" is simple to say |
| Overshoot | At most one call, which you absorb | The check is before the call, and the cost is known after. The customer is never charged for it |

The plan's existing `aiMonthlyUsd` goes: no cloud runs on it, and it is what wrote to
the editable budget. An administrator's `ai.setBudget` keeps working and can only
lower spend further, including on their own key.

## 6. Top-ups

| Item | Detail |
|---|---|
| Who | A plan with `aiTopUps: true`. The page says paid plans |
| Price | A Stripe price the provider chose, in its own currency, named by `billing.creditPack`: `{ "priceId": "price_1Xyz", "credits": 1000, "months": 12 }`. OKRGoal's is US$20 |
| How | **Buy {count} credits** on S-49, through hosted checkout |
| When it lands | The webhook adds one pack row, once per checkout session. The checkout carries `months`, so a pack keeps the length it was sold with even if the setting changes before the payment clears |
| Spent | After the month's allowance, soonest to expire first, so nobody loses credits they could have spent |
| Expiry | **Twelve months after purchase**, which is what Terms §5.2 and the pricing page promise. `months` in `billing.creditPack` sets another length, default 12, so the release does not decide this for another provider |
| Fixed at purchase | `expires_at` is written when the pack lands. A provider changing `months` later does not touch a pack already sold |
| The moment it lapses | A pack stops counting as soon as `expires_at` passes, because every read compares the date. **No job runs**, so none can fail or run late, and the row stays as the record of what lapsed |
| Refunds | None, per Terms §4.8, which names unused AI credits |
| Moving to a plan with no credits | The pack waits, unusable, because that plan has no provider key (§3). Its clock keeps running |

## 7. Default models on the provider's key

From the benchmark, on assumed token counts. **Small models buy about twenty times as
many calls.** Weekly agent runs on 50 goals are 87 credits on Haiku 5.5 and 1,733 on
Sonnet 5.5, which is 87% of Team.

| Setting | Does |
|---|---|
| `ai.deployment.tierModels` | Maps a tier to a catalogue model, on the provider's key only. For example every tier to Haiku 5.5 |
| `ai.deployment.prices` | Overrides a catalogue price without a release, because prices move: Gemini 3.8 Flash doubles on 1 January 2027 |

## 8. Measure before go-live

`pnpm ai:measure`: real calls for the five AI features people use most, over the Northwind drafts, on the
models you choose, reporting tokens and credits per action. The benchmark's token
counts are assumptions. **This needs an AI key from you, and it is what fills in the
typical credits on the pricing page.** It costs a few dollars.

**Measured on 8 November 2026**, one run each, at list prices and one US cent a credit:

| Action | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| Rewrite a key result the Coach flagged | 0.01 | 0.52 |
| Draft an objective from a sentence | 0.05 | 1.69 |
| Word a check-in the Champion is chasing | 0.01 | 0.23 |
| Summarise a comment thread | 0.01 | 0.23 |
| Answer a copilot question | 0.03 | 0.30 |

Haiku 5.5 is thirty to fifty times cheaper per action, which is more than the
benchmark's twenty, because Sonnet 5.5 thinks before it answers by default. Both runs'
answers read as usable; Sonnet's drafts are a little fuller. The measured figures are
what the pricing page's typical credits come from.

**The measurement found a defect.** Sonnet 5.5, Opus 5.5 and Fable 5.1 refuse a forced
tool call with a 400, and the Anthropic driver forced one for every structured answer.
So on those models every rewrite, draft, check-in and summary failed, and the drafters,
which treat a model error as no draft, said nothing. The driver now asks for structured
output, which every current model has, and keeps the forced tool only for the older
models without it.

## 9. Screens

| Screen | Change |
|---|---|
| S-49 | Credits used of the allowance, purchased credits left and when the soonest of them expire ("300 of these expire on 3 March 2027"), when the allowance resets, **Buy {count} credits**, and credits used by where they went (the copilot, assists, the Coach and the Champion, chat channels, the API, your own agent) |
| Admin, AI | Says plainly that a key added here spends no credits |
| Any AI affordance, out of credits | Hidden, as it is with a provider off, and a banner across the product says AI is paused until the 1st or until somebody buys more, and that nothing else stopped. A disabled control on each of some twenty screens would say the same thing twenty times |
| Admin, AI, a plan with no credits | With no key of the workspace's own, says the plan includes no AI credits, so AI is off here, and links to the Plan page (plan 0.8.0 O1). It used to say only "not configured" |

### 9.1 Why AI is off, in words (plan 0.8.0 O1)

The copilot said "No AI provider is configured" whenever no drafter could be built, including on a cloud whose provider's key worked for every workspace with a plan. The host now names the step of the provider chain that stopped it (`apps/web/lib/ai-provider.ts`, `resolveProviderForTier`), passes it to core on the action context as `aiOff`, and every copilot surface turns it into one sentence (`packages/core/src/ai/off-reason.ts`).

| Step that stopped it | What the reader is told |
|---|---|
| Nothing routes the tier, or no key answers the routed provider | No AI provider is configured |
| The provider's key, and the workspace's plan has no AI credits | The plan includes no AI credits; an administrator can choose a plan with credits on the Plan page or add the workspace's own key on the AI page |
| The month's credits are spent | The paused sentence above, unchanged |
| The workspace's egress controls let nothing reach the provider | Its AI privacy settings let nothing reach the provider; an administrator can change that on the AI page |
| The routed model has no price | The model has no price, so it is not used; an administrator can price it or choose another |

A background copilot run gets no reason from the relay and reads as no provider, which only happens when AI went off between the question and the run.

**No new proactive message.** A warning at 80% would be a new kind of nudge, which
needs your decision and a rule key, so it is left out.

## 10. Acceptance criteria

1. **Given** a fresh workspace on a plan with 100 credits and a deployment key, **when** a member asks the copilot, **then** it answers and credits go down by its cost.
2. **Given** that workspace with its own key added, **when** a member asks, **then** no credit is spent.
3. **Given** an administrator calling `ai.setBudget` with any number, **when** the allowance is spent, **then** AI on the provider's key still pauses.
4. **Given** no credits left, **when** a member opens a screen, **then** AI affordances say why, and every nudge, gate and score still works.
5. **Given** agents that have used their share, **when** a member asks the copilot, **then** it still answers, and the agents fall back to their deterministic form.
6. **Given** a free workspace and an agent run, **when** the run would exceed what is left, **then** it stops at what is left.
7. **Given** a checkout for a credit pack delivered twice, **then** the credits are added once.
8. **Given** 500 purchased credits and a new month, **then** the allowance resets and the purchased credits remain.
9. **Given** a plan with `aiCredits` absent, **when** a workspace has no key of its own, **then** AI is off, and adding a key turns it on.
10. **Given** an administrator's own model row at zero cost, **when** a call runs on the provider's key, **then** it is priced from the catalogue.
11. **Given** a self-hosted instance with `OPENOKR_AI_PROVIDER` set, **when** a member uses AI, **then** it works with no credit check.
12. **Given** ten concurrent calls near the limit, **then** the balance is exact across every pack and the overshoot is at most the calls in flight.
13. **Given** a pack bought on 8 November 2026, **when** S-49 shows it, **then** it says those credits expire on 8 November 2027.
14. **Given** a pack expiring in March and one in June, and an allowance already spent, **when** a call runs, **then** the March pack pays first and the June pack is untouched until March's is empty.
15. **Given** a pack whose `expires_at` has just passed and no allowance left, **when** a member asks the copilot, **then** AI on the provider's key is paused, with no job having run.
16. **Given** a pack already sold, **when** the provider changes `months`, **then** that pack's expiry does not move, and the next pack bought uses the new length.

## 11. Decisions for you

| # | Question | My recommendation |
|---|---|---|
| 1 | Which model runs on your key by default? | Haiku 5.5 for every tier on OKRGoal, then decide from `pnpm ai:measure` and reading its output. Credits go twenty times further, and I have not yet compared the quality |
| 2 | Do you want agents held to half the allowance? | Yes. Change it after real use |
| 3 | May a provider set its own credit value? | Yes, one setting. You asked that providers set their own pricing |
| 4 | Do purchased credits never expire? | **Closed on 8 November 2026: they expire after twelve months**, matching Terms §5.2 and the pricing page |
| 5 | Should anybody be warned before a pack lapses? | **Closed on 8 November 2026: no for now.** S-49 shows the date. A warning would be a new kind of proactive message, so it waits for its own decision |
