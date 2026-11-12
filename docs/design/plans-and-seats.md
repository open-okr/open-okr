# Plans and seats, and the flag that makes them absent

Part five of the Phase 8 design gate. Authority: REQUIREMENTS.md §5,
PLAN.md §4 and §13 rows 1 and 2, TECHNICAL-PLAN.md §4.1, §4.14.
Implemented at P8-T05. Depends on `tenant-lifecycle.md`, which
defines `tenants.plan_key`, `tenants.seats` and the cloud flag.

**PLAN.md §10 #1 (the pricing model) closed on 7 November 2026: per
workspace, a flat price with a seat limit and a free plan, with each provider
setting its own prices and currency. PLAN.md §10 #2 stands: nothing is
gated.** A plan is still a seat count and an AI allowance held as data, so
the decision did not change the shape of this design. Section 9 records what
was decided.

## 0. What already exists

| Component | Where | Ships at | What it already does |
|---|---|---|---|
| `provisionMemberForInvite` | `packages/core/src/invitations/provisioning.ts` | P2-T04 | The one member-provisioning funnel. A reusable workspace link, a single-use personal link and trusted-domain joining all land here, and nothing else inserts into `workspace_members` |
| `workspace_members.kind` | `packages/db` | P1-T04 | `human`, `guest`, `agent`, `placeholder` |
| `workspace_members.status` | `packages/db` | P1-T04 | `active`, `invited`, `suspended` |
| `ai_budgets` | `packages/db` | P2-T14 | The workspace spend cap a plan writes into. TECHNICAL-PLAN §4.14 already says the cloud uses it |
| The §4.14 settings map and registry | `packages/core/src/settings` | P2-T13 | Every setting with a default a fresh workspace resolves without configuration |
| `tenants` | This gate | P8-T02 | `plan_key` nullable, `seats` nullable |

**What did not exist before P8-T05.** No plan, no catalogue, no seat count, no billing
surface, and no code anywhere that asks how many people are in a
workspace.

## 1. The decision this document exists to make

REQUIREMENTS §5 states the constraint flatly:

> Self-host is never seat-limited and never feature-gated.

And PLAN §4:

> Nothing is feature-gated. The managed cloud sells operation, not
> features.

That removes the usual shape of this design. There is no matrix of what
each plan unlocks, because every plan unlocks everything. A plan is a
number of seats and a spend cap, and that is the whole of it.

So the question that is left is narrower and more interesting:

**How does a seat limit exist in the cloud without leaving a trace in the
product that self-host has to carry?**

The answer this design takes: **a seat limit is one check in one function,
and its absence is the default value of a nullable column.**

`tenants.seats` null means unlimited. On a self-hosted instance there is
no `tenants` row at all, so the resolver returns null without a query and
the check compares against unlimited. There is no second code path, no
flag threaded through the funnel, and no billing concept inside
`packages/core`'s member logic.

**Given** a self-hosted instance,
**when** the thousandth member joins,
**then** the funnel behaves exactly as it did for the first, because the
seat resolver returned null.

## 2. What a seat is

| Member kind | Status | Counts as a seat | Why |
|---|---|---|---|
| `human` | `active` | Yes | The person using the product |
| `human` | `invited` | **Yes** | Section 3 |
| `human` | `suspended` | No | A leaver frees their seat on the day they leave, not at the next billing cycle. Their rows stay for authorship |
| `guest` | any | No | A guest sees one space. Charging for a guest would make sharing a decision about money |
| `agent` | any | No | The Coach and the Champion ship with every workspace. Charging for them would gate the product's whole premise behind a plan |
| `placeholder` | any | No | Nobody has claimed it |

**An invited member counts, and that is the load-bearing choice.** If only
active members counted, a workspace at its limit could invite a hundred
people, every invitation would succeed, and every one of those people
would hit a refusal at the moment they clicked the link. The refusal would
land on the person with the least context and the least power to fix it.
Counting the invitation moves the refusal to the admin who caused it.

An invitation that expires or is revoked releases its seat.

**How an invitation is counted.** A personal invitation writes a link and no
member until it is accepted, so the seat is held by the link. This was missing
until 8 November 2026: the count read only member rows, nothing ever wrote the
`invited` status, and with seats free any number of invitations succeeded
(`hosting-test-matrix.md`, D-1).

| Counts as a held seat | Does not |
|---|---|
| A human member, `active` or `invited` | A guest, an agent or a placeholder |
| A personal member invitation that is not accepted, revoked or expired, once per address | A guest's invitation, or a reusable workspace link, which is checked at the funnel instead |
| | An invitation to an address somebody here already has |
| | At the invitation and the funnel, invitations to the address being admitted: their seat is the one they are taking |

A placeholder, an import's waiting row or the owner an operator's new workspace
waits for, is not a seat itself, so its invitation is the seat.

**Held seats and headcount are two numbers.** The invitation check, the funnel
and S-49 use held seats. A move to a smaller plan, a checkout and the end of a
subscription are judged by the people already here, because the rule they
apply is that nobody loses access. A plan smaller than the held seats but not
the people is allowed, and whoever arrives without a seat is refused at the
funnel.

## 3. Two enforcement points, because one is not enough

P8-T05's card asks for "enforcement at the member-provisioning funnel".
Its acceptance criterion asks for "seat limits apply at invitation". Both
are needed and they catch different things.

| Point | Catches | Message |
|---|---|---|
| **At invitation** | The ordinary case. An admin adding the eleventh person to a ten-seat plan | "This workspace has 10 of 10 seats in use. Free one, or add seats, before inviting anybody else." Named numbers, and a link to the billing screen |
| **At the funnel** | The reusable link. One workspace invite link admits everybody who holds it, so checking only at invite time lets a single link overflow the plan by any amount | The same numbers, phrased for the person arriving: "This workspace is full: 10 of 10 seats are in use. Ask an administrator to free one or add seats." |

The funnel check is the one that must be right, because it is the one
place a row is actually inserted. The invitation check is the one that
must be kind, because it is the one a person can act on.

**Both read the same resolver and the same count.** Two checks with two
implementations is two answers that can disagree, and the disagreement
would show up as a link that says it worked and a join that says it did
not.

**Given** a ten-seat workspace with ten seats used and a live reusable
invite link,
**when** an eleventh person opens the link,
**then** the funnel refuses, no `workspace_members` row is written, and the
person is told to ask an administrator.

## 4. The plan catalogue

A plan is data, not a type. `tenants.plan_key` is `text` and not a
database enum for the reason the lifecycle document already gives: an enum
turns adding a plan into a migration.

| Field | Notes |
|---|---|
| `key` | What `tenants.plan_key` holds. Null means no plan and no seat limit, which is what every self-hosted instance and every group has. A provider's free plan is an ordinary row, and `cloud.defaultPlan` names it |
| `name` | What a customer reads |
| `seats` | The number written to `tenants.seats` at provisioning and at every change. Null means unlimited |
| `aiCredits` | AI credits a month on the provider's own key. Absent means the workspace brings its own ([ai-credits.md](ai-credits.md)) |
| `aiTopUps` | Whether this plan can buy more credits |
| `prices` | A payment provider's price identifiers, and no amounts ([billing.md](billing.md)) |
| `limits` | `actionsPerMinute` and `concurrentActions`, each optional, replacing the instance's `cloud.limits.*` for this plan's workspaces (built at 0.7.0, P5, Akmal's yes of 10 November 2026). Absent means the instance default; zero is unlimited; the instance floors apply. The outbox rate stays instance-wide, because the relay reads one rate for every workspace in one query. `planLimitsFor` reads it, and the web host caches it a minute per workspace |

**Where the catalogue lives is an instance setting, not a table.** It is
operator configuration for one deployment, it changes rarely, and it has
no per-tenant rows. `system_settings` under `cloud.plans` holds it, which
means it is editable from the operator console (S-47) and carries no
migration when a plan is added.

**There is no `features` field, and there will not be one.** A plan that
can turn a feature off is the gating REQUIREMENTS §5 forbids, and the way
that arrives is an empty list somebody adds "for later".

## 5. Upgrade, downgrade, and the one that is hard

Upgrade is arithmetic. `tenants.plan_key` and `tenants.seats` change, the
AI budget row is rewritten, and nothing else moves. Every feature was
already available.

**Downgrade below the current headcount is the real design problem**, and
it has three possible answers.

| Answer | Verdict |
|---|---|
| Refuse the downgrade until members are removed | **Taken.** The workspace says which members are over the new number and the admin decides who goes. The product never picks |
| Accept it and suspend the most recently added members | Refused. The product would be deciding who loses access to their own work, by an arbitrary rule, and the audit row would say the system did it |
| Accept it and let the workspace sit over its limit | Refused. A limit that is routinely exceeded is not a limit, and the next honest step after it is enforcement by email |

**Given** a twenty-seat workspace with eighteen members downgrading to a
ten-seat plan,
**when** the admin confirms,
**then** the change is refused, naming eighteen and ten, and the screen
links to the member list so they can suspend eight people first.

Built at completeness review H-21: `setPlanAsOperator` on S-46, through
`applyPlanInTx`. Until then nothing wrote `plan_key` or `seats` after a tenant
was created, so this section described a control that did not exist.

**An administrator's own change on S-49 was removed on 7 November 2026**
(section 9). It wrote the plan with no payment behind it, so any administrator
could take any plan for nothing, over REST and the agent tools as well as the
screen. `workspace.changePlan` stays declared, so an operator's audit row
resolves to a contract, and refuses everybody who can reach it. `billing.md` is an
administrator's own path, with a payment behind it, through `applyPlanInTx` like this
one.

A downgrade that does fit applies immediately. There is no proration
model here, because this design charges nobody. Payment belongs to the
billing design (section 9).

## 6. The billing surface, and its absence

**S-49 Plan and seats.** A workspace admin's screen, not an operator's.
The current plan, seats used against seats available with the list of who
holds them, the AI spend against its cap, and who to contact to change the
plan.

**With the cloud flag off, or no plans in the catalogue, the screen does not
exist.** Not empty, not disabled: absent from the admin navigation and not-found at its route.
P8-T05's acceptance says "no billing surface appears", and a disabled
control is an appearance.

This is the same treatment the operator console gets and for the same
reason. A self-hosted university should never see a thing that implies
there is a paid version of what they are running, because there is not.

**Given** `cloud.enabled` false,
**when** a workspace admin opens the admin navigation,
**then** there is no plan section, and the route is not-found.

## 7. Acceptance criteria

Written as the test plan P8-T05 inherits.

1. **Given** the flag off, **when** any limit is evaluated, **then** it is
   unlimited and no billing surface appears. This is P8-T05's own
   criterion, and the second half of it is a route test, not a
   screen-reads-empty test.
2. **Given** the flag on and a ten-seat plan with ten humans, **when** an
   admin invites an eleventh, **then** the invitation is refused naming both
   numbers.
3. **Given** the same workspace and a live reusable invite link, **when** an
   eleventh person opens it, **then** the funnel refuses and no member row
   is written.
4. **Given** a workspace at its seat limit, **when** a support session is
   granted, **then** it succeeds, because a `guest` is not a seat.
5. **Given** a workspace at its seat limit, **when** an agent is seeded,
   **then** it succeeds, because an `agent` is not a seat.
6. **Given** a member suspended, **when** the seat count is read, **then** it
   has fallen by one, and an invitation now succeeds.
7. **Given** a downgrade below the current headcount, **when** it is
   confirmed, **then** it is refused with both numbers and nobody is
   suspended by the product.
8. **Given** any plan in the catalogue, **when** its definition is read,
   **then** it names no feature, proved by the schema having no field to
   name one in.

## 8. Open, and not decided here

| # | Question | Why it is not answered here |
|---|---|---|
| 1 | The pricing model. PLAN.md §10 #1 | **Closed on 7 November 2026: per workspace.** Section 9. The design holds seats and the AI cap as data, so each provider's catalogue in `cloud.plans` carries the numbers |
| 2 | Whether any feature is ever gated. PLAN.md §10 #2 | A human's call, and this design makes the answer no harder to keep: there is no field to gate a feature with |
| 3 | The free tier's shape | Null `plan_key` and null `seats` means the free tier is unlimited today. **Decided on 7 November 2026: Free becomes a catalogue row with its own seat limit, and a new workspace starts on whichever plan the provider names.** With no plan named, nothing changes, so a self-hosted instance is untouched. `cloud.defaultPlan` holds the name |
| 4 | Billing, payment and invoicing | **Decided on 7 November 2026: Stripe behind a billing port, off until a provider turns it on.** Nothing here talks to a payment provider yet, and `tenants` holds no customer or subscription identifier. The billing design owns both |
| 5 | Whether an over-limit workspace can ever exist | Section 5 refuses it at the downgrade. It can still arise if an operator lowers `tenants.seats` directly from the console. The design tolerates the state, refuses new joins in it, and shows the admin the number. Whether the console should refuse the lowering too is a small open question. **Answered at completeness review H-21: yes, it refuses.** The operator's plan control and the administrator's both go through `applyPlanInTx`, which holds the headcount rule, so neither can lower seats below the people in use |

## 9. Decided on 7 November 2026

By the project owner. The later designs build on these: `billing.md` and
`ai-credits.md`. One provider's own commercial terms are not here: OKRGoal's are kept
with its website, outside this repository.

| Decision | Detail |
|---|---|
| Pricing | Per workspace: a flat price with a seat limit, and a free plan |
| Prices and currency | Each provider's own, set in its billing account and its plan catalogue. The release names no price and no currency |
| Billing provider | Stripe behind a billing port, with a `none` driver. The `stripe` package is approved and lives only in `packages/adapters` |
| Changing plan | An administrator changes plan through billing, never directly. An operator can still set a plan by hand, for a customer who pays by invoice |
| A subscription that ends | The workspace moves to Free if its people fit. If not, it goes read-only until seats are freed or payment resumes. The product never removes anybody |
| Free workspaces | One per person. AI credits only after the address is verified |
| AI credits | A credit is a unit of AI model cost. The product measures model cost in US dollars, as its model price list does, whatever currency a provider sells in. Whether a provider may set its own credit value is for the credits design |
| Reporting across workspaces | Not in v1. REQUIREMENTS §9 |
