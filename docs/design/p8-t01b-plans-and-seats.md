# P8-T01b: plans and seats, and the flag that makes them absent

Part five of the Phase 8 design gate. Authority: REQUIREMENTS.md §5,
PLAN.md §4 and §13 rows 1 and 2, TECHNICAL-PLAN.md §4.1, §4.14.
Implemented at P8-T05. Depends on `p8-t01a-tenant-lifecycle.md`, which
defines `tenants.plan_key`, `tenants.seats` and the cloud flag.

**PLAN.md §13 #1 (the pricing model) and #2 (whether any feature is ever
gated) are open decisions and neither is taken here.** Agung's instruction
on 14 September 2026 was to design on their recorded current position: per
seat with a free tier, nothing gated. The design holds the numbers as data
so that closing either row changes a catalogue entry rather than this
document.

## 0. What already exists

| Component | Where | Ships at | What it already does |
|---|---|---|---|
| `provisionMemberForInvite` | `packages/core/src/invitations/provisioning.ts` | P2-T04 | The one member-provisioning funnel. A reusable workspace link, a single-use personal link and trusted-domain joining all land here, and nothing else inserts into `workspace_members` |
| `workspace_members.kind` | `packages/db` | P1-T04 | `human`, `guest`, `agent`, `placeholder` |
| `workspace_members.status` | `packages/db` | P1-T04 | `active`, `invited`, `suspended` |
| `ai_budgets` | `packages/db` | P2-T14 | The workspace spend cap a plan writes into. TECHNICAL-PLAN §4.14 already says the cloud uses it |
| The §4.14 settings map and registry | `packages/core/src/settings` | P2-T13 | Every setting with a default a fresh workspace resolves without configuration |
| `tenants` | This gate | P8-T02 | `plan_key` nullable, `seats` nullable |

**What does not exist.** No plan, no catalogue, no seat count, no billing
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
| `human` | `suspended` | No | A leaver stops costing money on the day they leave, not at the next billing cycle. Their rows stay for authorship |
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

## 3. Two enforcement points, because one is not enough

P8-T05's card asks for "enforcement at the member-provisioning funnel".
Its acceptance criterion asks for "seat limits apply at invitation". Both
are needed and they catch different things.

| Point | Catches | Message |
|---|---|---|
| **At invitation** | The ordinary case. An admin adding the eleventh person to a ten-seat plan | "This workspace has 10 of 10 seats in use. Free one, or add seats." Named numbers, and a link to the billing screen |
| **At the funnel** | The reusable link. One workspace invite link admits everybody who holds it, so checking only at invite time lets a single link overflow the plan by any amount | The same numbers, phrased for the person arriving: "This workspace is full. Ask an administrator to add a seat." |

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
| `key` | What `tenants.plan_key` holds. Null means the free tier, so the free tier needs no row |
| `name` | What a customer reads |
| `seats` | The number written to `tenants.seats` at provisioning and at every change. Null means unlimited |
| `aiMonthlyUsd` | Written into the existing `ai_budgets` workspace row. No new mechanism |
| `limits` | The `cloud.limits.*` values from `p8-t01a-tenant-limits.md`, if a plan ever varies them. Absent means the instance default |

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

A downgrade that does fit applies immediately. There is no proration
model here, because there is no billing provider here: money is outside
this design and outside the repository.

## 6. The billing surface, and its absence

**S-49 Plan and seats.** A workspace admin's screen, not an operator's.
The current plan, seats used against seats available with the list of who
holds them, the AI spend against its cap, and the upgrade and downgrade
controls.

**With the cloud flag off, the screen does not exist.** Not empty, not
disabled: absent from the admin navigation and not-found at its route.
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
| 1 | The pricing model. PLAN.md §13 #1 | A human's call. The design holds seats and the AI cap as data, so closing the row edits `cloud.plans` |
| 2 | Whether any feature is ever gated. PLAN.md §13 #2 | A human's call, and this design makes the answer no harder to keep: there is no field to gate a feature with |
| 3 | The free tier's shape | Null `plan_key` and null `seats` means the free tier is currently unlimited, which is almost certainly not what a real free tier does. Named here rather than guessed, because it is a pricing decision |
| 4 | Billing, payment and invoicing | Entirely outside this design and outside the repository. Nothing here talks to a payment provider, and `tenants` holds no customer or subscription identifier. Adding one is its own task with its own decision about a dependency |
| 5 | Whether an over-limit workspace can ever exist | Section 5 refuses it at the downgrade. It can still arise if an operator lowers `tenants.seats` directly from the console. The design tolerates the state, refuses new joins in it, and shows the admin the number. Whether the console should refuse the lowering too is a small open question |
