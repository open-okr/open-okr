# Billing: Stripe behind a port, for any provider

Status: approved on 7 November 2026. Authority: REQUIREMENTS §5, PLAN §3 and §10 #1,
`plans-and-seats.md` §9. Depends on `tenant-lifecycle.md`.

## 1. What this has to be true of

| Rule | Consequence |
|---|---|
| Any provider sets its own prices and currency | The release names no price and no currency. Stripe holds them, and the screen reads them from Stripe |
| Off until a provider turns it on | The `stripe` package is loaded only when configured. An air-gapped or self-hosted instance never reaches it |
| Nothing is feature-gated | Billing changes plan, seats and allowance. Never a feature |
| The product never chooses who loses access | A subscription that ends never suspends a person |
| Every write is the Operation pipeline | Stripe is told first, and the plan only moves when the webhook arrives |

## 2. The port

`packages/adapters/src/ports/billing.ts`, with two drivers: `none` and `stripe`.
Another payment provider is a new driver and needs no change anywhere else.

| Method | Does |
|---|---|
| `listPrices(priceIds)` | Amount, currency and interval for the plan screen, cached for a minute |
| `startCheckout(input)` | The address of a hosted checkout page, for a new subscription or a credit pack |
| `openPortal({ customerRef, returnUrl })` | The address of the hosted page for cards, invoices and cancelling |
| `changeSubscription(input)` | Upgrade now and charge the difference, or schedule a downgrade for the period's end |
| `endSubscription(ref)` | Stops renewal at the end of the period already paid for. Nothing is refunded |
| `deleteCustomer(ref)` | Deletes the customer and their saved cards, for erasure (`workspace-erasure.md` §4) |
| `readSubscription(ref)` | The subscription as it is now |
| `parseWebhook(body, signature)` | Verifies the signature first, then returns the event. A bad signature throws |

The Stripe client uses `Stripe.createFetchHttpClient`, so its requests go through
the platform `fetch`, and a new row in `docs/runbooks/air-gap.md` checks it stays off
by default.

## 3. Settings

All in TECHNICAL-PLAN §4.14. Each is optional, and with none set nothing changes.

| Setting | Variable | Default |
|---|---|---|
| `billing.provider` | `OPENOKR_BILLING_PROVIDER` | `none` |
| `billing.stripe.secretKey` (encrypted) | `OPENOKR_STRIPE_SECRET_KEY` | Empty |
| `billing.stripe.webhookSecret` (encrypted) | `OPENOKR_STRIPE_WEBHOOK_SECRET` | Empty |
| `billing.stripe.automaticTax` | `OPENOKR_STRIPE_AUTOMATIC_TAX` | Off |

**A catalogue row gains `prices`**, which holds identifiers and no amounts:

```json
{ "key": "team", "name": "Team", "seats": 50,
  "prices": { "month": "price_1Abc", "year": "price_1Def" } }
```

A plan with no `prices` cannot be bought, only set by an operator. That is what
Enterprise, and any provider invoicing by hand, uses.

## 4. Schema

One migration, with row-level security in the same file, and no legacy source
(TECHNICAL-PLAN §7.2). Both tables are vendor knowledge, so they join `tenants` under
the boundary gate, and neither leaves in a workspace export.

| `billing_accounts` | Notes |
|---|---|
| `workspace_id` | Primary key |
| `provider`, `customer_ref`, `subscription_ref` | Named for any provider. Unique on provider and customer |
| `status` | The provider's own word, stored as text |
| `current_period_end`, `cancel_at_period_end` | What the screen shows |
| `suspended_by_billing` | So a billing event never lifts a suspension an operator imposed |

| `billing_events` | Notes |
|---|---|
| `provider`, `event_ref` | Unique, which is what makes a repeated delivery do nothing |
| `workspace_id`, `received_at` | Under the tenant floor |

## 5. The webhook

`POST /api/billing/webhook`.

1. Read the raw body and verify the signature, **before anything else**. Failure is a 400 and writes nothing.
2. Find the workspace from `metadata.workspace_id`, set on every checkout. An event with none is logged and acknowledged.
3. Insert the event reference. A row already there means the event is done: answer 200.
4. **Read the subscription from Stripe rather than trusting the event's copy**, because events can arrive out of order.
5. Apply the result in one Operation, as the `system` actor, with the audit row.

## 6. What each state does

| Stripe says | The workspace |
|---|---|
| `active` | On the plan the price maps to. A suspension billing imposed is lifted |
| `past_due` | Keeps its plan. Admin, Plan and seats says the payment failed and links to the portal, while Stripe retries |
| `canceled`, `unpaid`, `incomplete_expired` | **See below** |
| A price no catalogue row holds | Nothing moves, and it is logged for the operator |

**When a subscription ends:**

| Its people fit the default plan | Result |
|---|---|
| Yes | It moves to the default plan |
| No | It goes read-only through the existing `suspended` state, with `suspended_by_billing` set. Administrators can still manage members, and can move to Free once people fit, or subscribe again |

`applyPlanInTx` refuses a plan smaller than the headcount, which is right for a
choice and wrong for a subscription that has already ended. That is why this path
checks first and suspends, rather than calling it and failing.

## 7. Changing plan

| Who does what | How |
|---|---|
| First subscription | **Upgrade** on S-49, monthly or yearly, opens hosted checkout. Tax uses Stripe Tax when set |
| Upgrade | `changeSubscription` now, and Stripe charges the difference for the rest of the period |
| Downgrade | Refused below the headcount, naming both numbers, then scheduled for the period's end. No partial refund |
| Cancel, card, invoices | **Manage billing** opens Stripe's portal. **Plan switching is turned off in the portal**, because it cannot run the headcount check |
| Pay by invoice, or a contract | An operator sets the plan on S-46. No billing account is involved, and the webhook leaves it alone |
| Education discount | A Stripe coupon, applied by whoever runs the account |

Upgrades take effect when the webhook arrives, usually within seconds, and S-49 says
so while it waits.

## 8. Contract

| Action | Access | Notes |
|---|---|---|
| `billing.summary` | `full` | Plan, prices, status, period end. Absent with billing off |
| `billing.startCheckout` | `full` | Answers an address. Writes nothing |
| `billing.buyCredits` | `full` | A credit pack's checkout address (`ai-credits.md` §6). Writes nothing |
| `billing.openPortal` | `full` | Answers an address. Writes nothing |
| `billing.changePlan` | `full` | Checks the headcount, then tells Stripe. Writes nothing itself |
| `billing.settleEnded` | `full` | Moves a read-only workspace to the default plan once its people fit |

None is on the agent surface. An agent does not spend somebody's money.

## 9. Screens

**S-49** shows the current plan and status, every plan with its price as Stripe
states it, in Stripe's currency, formatted for the reader's language, a monthly or
yearly choice, **Upgrade** and **Manage billing**. It keeps every state: loading,
Stripe not answering (the plan and seats still show), payment failed, read-only. With
billing off it stays as it is today: read the plan and who to contact.

**S-46** shows the operator the billing status and the Stripe customer reference,
and never a card.

## 10. Testing

| Layer | How |
|---|---|
| Unit | The `none` driver and a fake driver. The Stripe driver against `fetch` stubs, including real signatures from Stripe's own test helper |
| Integration | Every row of §6 against a real database, including a repeated event and events out of order |
| Route | `apps/web/test/billing-webhook-route.test.ts`, with the real driver and real signatures |
| Browser | `e2e/hosting-profiles.spec.ts`: the route is absent with billing off, and the plan screen draws with no keys. Not a fake driver in the release: shipping one so a test can reach it would be a way to take a plan for nothing, so checkout itself is proved by hand in Stripe test mode |
| By hand, before go-live | Stripe test mode: needs test keys from you |

CI never reaches Stripe.

## 11. Acceptance criteria

1. **Given** `billing.provider` unset, **when** the instance runs, **then** `stripe` is never loaded, the webhook route answers not-found, and S-49 is unchanged.
2. **Given** a webhook with a bad signature, **when** it arrives, **then** it answers 400 and nothing is written.
3. **Given** a completed checkout for Team, **when** the event arrives, **then** the workspace has Team's seats, and the same event delivered again changes nothing.
4. **Given** events out of order, **when** the older one arrives last, **then** the workspace reflects the subscription as Stripe has it now.
5. **Given** a subscription that ends and people who fit the default plan, **then** the workspace moves there and nobody is suspended.
6. **Given** a subscription that ends and too many people, **then** the workspace is read-only, no member is suspended, and an administrator can still manage members.
7. **Given** that read-only workspace, **when** people now fit and an administrator settles it, or they subscribe again, **then** it is active. A suspension an operator imposed is not lifted by either.
8. **Given** a downgrade below the headcount, **when** requested, **then** it is refused naming both numbers and Stripe is not called.
9. **Given** a provider whose Stripe prices are in euros, **when** S-49 shows them, **then** they read in euros, with nothing in the release naming euros.
10. **Given** an operator-set plan with no billing account, **when** any webhook arrives for another workspace, **then** it is untouched.

## 12. Decisions for you

| # | Question | My recommendation |
|---|---|---|
| 1 | Does a downgrade wait for the period's end? | Yes. It follows your "cancel at the end of the period, no partial refunds", and they keep what they paid for |
| 2 | Is a credit pack bought through this same checkout? | Yes. `ai-credits.md` §6 |
