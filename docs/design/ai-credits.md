# AI credits: an allowance on the provider's own key

Status: **waiting for approval.** Authority: AI-NATIVE-PLAN §1 rule 7 and §4,
`plans-and-seats.md` §9, `billing.md`.

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

## 2. What is wrong today

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
| No plan, or the catalogue is empty (self-hosted, group) | Available with no credit check, as the deployer's own choice |
| A plan with `aiCredits` above zero | Available, spending credits |
| A plan with `aiCredits` at zero or absent | Not available. The workspace brings its own key |

**Routing changes for everybody:** a workspace with no provider of its own routes to
the deployment's provider, with the catalogue's default model for each tier. This
fixes the first finding, and it fixes a group wanting one key for all its companies.
It only changes anything on an instance where somebody set `OPENOKR_AI_PROVIDER`.

**A workspace that adds its own key stops spending credits immediately**, because its
own key comes first in the existing order.

**On the provider's key, prices come from the catalogue only**, never from a
workspace's own row.

## 4. Schema

One migration, with row-level security in the same file. No legacy source.

| Change | Notes |
|---|---|
| `ai_usage_events.key_source` | `user`, `workspace` or `deployment`. Nullable, because earlier rows do not know and spend nothing |
| `ai_credit_balances` | One row per workspace: `period_start`, `used_usd`, `agent_used_usd`, `purchased_usd` |

**A balance row rather than summing the usage table.** The check runs before every AI
call, and one locked row is both faster and safe under concurrency. The events stay
as the record, and the row can be rebuilt from them.

Each call on the provider's key updates the balance in the same transaction as its
usage row. A new month resets `used_usd` and `agent_used_usd`.

```
allowance  = plan credits x credit value
overflow   = what this call took past the allowance
purchased  = purchased - overflow, never below zero
available  = (allowance - used) + purchased
```

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
| Price | A Stripe price the provider chose, in its own currency, named by `billing.creditPack`: `{ "priceId": "price_1Xyz", "credits": 1000 }`. OKRGoal's is US$20 |
| How | **Buy credits** on S-49, through hosted checkout |
| When it lands | The webhook adds to `purchased_usd`, once per checkout session |
| Spent | After the month's allowance |
| Expiry | **None.** They paid for them. Easy to tighten later and hard to loosen |
| Refunds | None, per your terms |

## 7. Default models on the provider's key

From the benchmark, on assumed token counts. **Small models buy about twenty times as
many calls.** Weekly agent runs on 50 goals are 87 credits on Haiku 5.5 and 1,733 on
Sonnet 5.5, which is 87% of Team.

| Setting | Does |
|---|---|
| `ai.deployment.tierModels` | Maps a tier to a catalogue model, on the provider's key only. For example every tier to Haiku 5.5 |
| `ai.deployment.prices` | Overrides a catalogue price without a release, because prices move: Gemini 3.8 Flash doubles on 1 January 2027 |

## 8. Measure before go-live

`pnpm ai:measure`: real calls for each AI feature over the Northwind drafts, on the
models you choose, reporting tokens and credits per action. The benchmark's token
counts are assumptions. **This needs an AI key from you, and it is what fills in the
typical credits on the pricing page.** It costs a few dollars.

## 9. Screens

| Screen | Change |
|---|---|
| S-49 | Credits used of the allowance, purchased credits left, when it resets, **Buy credits**, and a usage log by feature |
| Admin, AI | Says plainly that a key added here spends no credits |
| Any AI affordance, out of credits | Disabled, saying AI is paused until the 1st or until somebody buys more, and that nothing else stopped. A provider off stays hidden, as it is today |

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
12. **Given** ten concurrent calls near the limit, **then** the balance is exact and the overshoot is at most the calls in flight.

## 11. Decisions for you

| # | Question | My recommendation |
|---|---|---|
| 1 | Which model runs on your key by default? | Haiku 5.5 for every tier on OKRGoal, then decide from `pnpm ai:measure` and reading its output. Credits go twenty times further, and I have not yet compared the quality |
| 2 | Do you want agents held to half the allowance? | Yes. Change it after real use |
| 3 | May a provider set its own credit value? | Yes, one setting. You asked that providers set their own pricing |
| 4 | Do purchased credits never expire? | Yes |
