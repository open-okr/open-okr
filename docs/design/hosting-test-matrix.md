# Hosting setups: the test matrix

Status: written 8 November 2026. Authority: PLAN §5.2. Companion to
`hosting-profiles.md`, `plans-and-seats.md`, `billing.md`, `ai-credits.md`,
`tenant-lifecycle.md` and `workspace-erasure.md`.

This page says, for each of the four hosted setups and each person who uses
one, what the product does and which test proves it. A cell with no test
behind it is a gap, and the gaps are listed in section 6, not hidden.

## 1. The setups

| # | Setup | Cloud flag | Plans | Billing | Sign-up | Browser journey |
|---|---|---|---|---|---|---|
| 1 | OKRGoal, run by OKR Institute | On | OKRGoal's, with a free default | Stripe | Open | [`hosting-okrgoal.spec.ts`](../../e2e/hosting-okrgoal.spec.ts) |
| 2 | Another provider's cloud, on its own servers | On | Its own, with a default | None: it invoices | Company email, its choice | [`hosting-provider.spec.ts`](../../e2e/hosting-provider.spec.ts) |
| 3 | A group of companies, one workspace per company | On | None | None | Company email | [`hosting-group.spec.ts`](../../e2e/hosting-group.spec.ts) |
| 4 | One company with several workspaces | On | None | None | Invitation only | [`hosting-one-company.spec.ts`](../../e2e/hosting-one-company.spec.ts) |

The fifth row of PLAN §5.2, one organisation with one workspace and every
switch at its default, is the setup the rest of the browser suite runs on.
Every other spec proves it, and the first section of
[`hosting-profiles.spec.ts`](../../e2e/hosting-profiles.spec.ts) proves that
no cloud screen appears on it.

**The OKR practice itself is the same in every setup.** The switches decide
tenancy, plans, billing and sign-up. None of them reaches `packages/method` or
the OKR domain, so cycles, check-ins, reviews, the Coach and the Champion are
proved once, by the rest of the suite. Each journey still has a member write an
objective, to show the path to the work is open in that setup.

## 2. The people

| Person | Role in the product | Setup 1 | Setup 2 | Setup 3 | Setup 4 |
|---|---|---|---|---|---|
| **Operator** | An instance operator, outside every workspace | OKR Institute's staff | The provider's staff | The group's IT | The company's IT |
| **Company administrator** | Owner of the company's workspace or workspaces | The customer who signed up and pays | The customer who signed up | Each company's head, invited by the operator | Owns every division's workspace |
| **Workspace administrator** | Admin role, appointed by an owner | Appointed by the customer | Appointed by the customer | Appointed by Trading's head | Admin of Sales, ordinary member of Engineering |
| **Member** | Member role | Works for the customer | Works for the customer | Works at Trading | Works in Sales only |

An administrator holds full access to their workspace, as its owner does. What
only an owner has is being the workspace's first administrator, the one who
cannot be stepped down.

## 3. How to read a cell

| Mark | Meaning |
|---|---|
| **B** | Proved in a browser by that setup's journey spec, against the server the Docker image runs |
| **B\*** | Proved in a browser by another spec on a cloud set up the same way: `hosting-profiles.spec.ts`, `s45-operator-console.spec.ts` or `s48-support-access.spec.ts` |
| **U** | Proved by a unit or integration test against a real Postgres (section 5 names it) |
| **L** | Proved by the Stripe test-mode run against the real Stripe API, by hand on 8 November 2026, 15 of 15 |
| **n/a** | Does not exist in this setup, and the cell says what happens instead |
| **Defect** | The product does not do what its design says. Section 6 lists any found, open or fixed |

## 4. The matrix

### 4.1 Operator

| ID | Scenario | 1 OKRGoal | 2 Provider | 3 Group | 4 One company |
|---|---|---|---|---|---|
| O-1 | The console opens for a granted operator, and is not found for anybody else | B | B | B | B |
| O-2 | Creates a workspace for an address with no account: one invitation goes by email, accepting it makes that person owner, the operator never becomes a member | B\* (created), U | U | B | B |
| O-3 | Creates a workspace for an address with an account: that person owns it straight away | U | U | U | B |
| O-4 | Lists the tenants with counts only, and cannot open what a member wrote | B (the list), U | B (the list), U | B | B |
| O-5 | Sets a customer's plan after an invoice, and the customer sees the new seat limit | B | B | n/a: only Free is offered, and no limit applies | n/a: as setup 3 |
| O-6 | Suspends with a reason: members are told, the owner cannot lift it, the operator lifts it | B | U | B | U |
| O-7 | A closed workspace shows its deletion date; one past retention is flagged; one being erased offers nothing to change | B, B\* | B\* | U | U |
| O-8 | A site message aimed at named workspaces reaches only their people | U | B | U | U |
| O-9 | Support access: asks, the customer grants, it ends on time | U, B\* | U, B\* | U, B\* | U, B\* |
| O-10 | Erases closed workspaces once retention has passed (`pnpm cloud:erase`) | U | U | U | U |
| O-11 | Operators are granted by the deployment and never by themselves | U | U | U | U |

### 4.2 Company administrator

| ID | Scenario | 1 OKRGoal | 2 Provider | 3 Group | 4 One company |
|---|---|---|---|---|---|
| C-1 | Meets the provider's own name and legal pages before signing up | B | B | n/a: no provider identity is set | n/a: as setup 3 |
| C-2 | Who may sign up | Anybody: B | Company address only, free mail refused with the reason: B | Company address only: B | Nobody: "Registration is closed": B |
| C-3 | Arrives by the operator's email and owns the workspace | U | U | B | B |
| C-4 | Starts on the provider's default plan, with its seat limit | Free, 1 of 3: B | Starter, 1 of 5: B | n/a: no plan, no limit (U) | n/a: as setup 3 |
| C-5 | Reads the plans | Stripe's panel, current plan marked: B | The provider's plans, "contact the provider", nothing sold: B | Not found: B | Not found: B |
| C-6 | Buys or changes a plan through Stripe: checkout, up now, down at the period, the portal | U, L | n/a: no billing | n/a | n/a |
| C-7 | Cannot move their own workspace onto a plan for nothing | U | U | n/a | n/a |
| C-8 | Starts a second workspace | Refused, naming the free limit: B | Refused the same way: U | Offered, with no free limit: B, U | Not found: only the operator creates workspaces: B |
| C-9 | Moves between the company's workspaces in the switcher | U (once the first is paid) | U | U | B |
| C-10 | Invites people within the seat limit, and the next is refused naming both numbers | B | Seats counted, 3 of 5: B | No limit: U | No limit: U |
| C-11 | A pending invitation holds a seat, and is named on the plan screen | B | U | n/a | n/a |
| C-12 | Makes a member an administrator | B | B | B | B |
| C-13 | Meets none of the instance's own settings: its name, registration, update check | B | B | B | B |
| C-14 | Sees the plan's AI credits, and a credit pack paid at Stripe with when it expires | B | n/a: no credits in this catalogue (U for a catalogue with them) | n/a: no catalogue, never limited (U) | n/a: as setup 3 |
| C-15 | Is told of a provider's suspension and cannot lift it | B | U | B | U |
| C-16 | Closes the workspace by typing its address, owners and administrators get the email, the date shows, and it reopens | B | B\*, U | U | U |
| C-17 | Cannot open another company's objective | U | U | B | n/a: owns every workspace |

### 4.3 Workspace administrator

| ID | Scenario | 1 OKRGoal | 2 Provider | 3 Group | 4 One company |
|---|---|---|---|---|---|
| A-1 | Joins by the owner's invitation and is made an administrator | B | B | B | B |
| A-2 | Runs the workspace's invitations | B | B | B | B |
| A-3 | Reads the plan and seats | B | B | Not found: B | Not found for anybody: B (for the owner) |
| A-4 | Has no operator console | B | B | B | B |
| A-5 | Is an administrator in one workspace and an ordinary member in another | n/a: one workspace each | n/a: one workspace each | n/a: one workspace each | B |
| A-6 | Gets the email when the workspace is closed | B | U | U | U |

### 4.4 Member

| ID | Scenario | 1 OKRGoal | 2 Provider | 3 Group | 4 One company |
|---|---|---|---|---|---|
| M-1 | Joins by invitation and lands on "My week" | B | B | B | B |
| M-2 | Writes an objective | B | B | B | B |
| M-3 | Meets no admin, no plan and no console | B | B | B | B |
| M-4 | Cannot open another workspace's objective by its address | U | U | B | B |
| M-5 | A hand-edited workspace cookie picks nothing they could not already reach | As setup 4 | As setup 4 | As setup 4 | B |
| M-6 | The switcher offers only their own workspaces | n/a: one workspace each | n/a: one workspace each | B | B |
| M-7 | Is told when the provider suspends, and when the workspace is closed and will be deleted | B | U | Another company's suspension leaves theirs alone: B | U |
| M-8 | Is offered the provider's own source | B\* | B | U | U |
| M-9 | Sees a site message aimed at their workspace | U | B | U | U |

### 4.5 The instance itself

| ID | Scenario | 1 | 2 | 3 | 4 |
|---|---|---|---|---|---|
| I-1 | The billing webhook exists only with billing configured | Exists; a forged signature is refused and a repeated event changes nothing: B | Not found: B | Not found: B\* | Not found: B\* |
| I-2 | Turning the cloud flag on later gives every workspace a tenant record, once | U | U | U | U |
| I-3 | A private AI server is refused unless the deployment allows it | U | U | U | U |
| I-4 | Usage counts are a snapshot with the time it was taken | U | U | U | U |
| I-5 | A self-hosted install with every switch at its default behaves as before | The rest of the suite, and B\* | | | |

## 5. Where each proof lives

| ID | Browser | Unit and integration |
|---|---|---|
| O-1 | each journey's operator steps; `s45`: "a member without a grant is told the console does not exist" | `operator-wall.test.ts` |
| O-2 | `hosting-group`, `hosting-one-company`: the operator steps and "follows the email"; `s45`: "an operator creates a workspace for somebody with no account yet" | `create-workspace.test.ts`: "names somebody with no account, who gets one invitation and then owns it", "never becomes a member of what they create" |
| O-3 | `hosting-one-company`: "a second workspace for the same person is theirs straight away" | `create-workspace.test.ts`: "names somebody with an account, who owns it straight away" |
| O-4 | every journey's operator steps | `operator-wall.test.ts`: "returns zero rows from every content table, on a real operator connection" |
| O-5 | `hosting-okrgoal`, `hosting-provider`: "moves the customer to …" | `plan-change.test.ts`: "takes the seats from the plan, so the limit now applies", "refuses a plan with fewer seats than are in use, naming both numbers" |
| O-6, C-15 | `hosting-okrgoal`, `hosting-group`: "suspends …"; `hosting-profiles`: "a suspension the provider set offers the administrator nothing to lift" | `tenant-lifecycle.test.ts`: "cannot lift a suspension through the workspace state either"; `operator-wall.test.ts`: "suspends through the same lifecycle path a member would use" |
| O-7 | `hosting-okrgoal`: "closes the workspace"; `s45`: "an operator is told what is overdue for erasure, and sees one being erased" | `workspace-erasure.test.ts` |
| O-8, M-9 | `hosting-provider`: "a site message for one customer reaches its people and nobody else" | `site-messages.test.ts`: "reaches only the workspaces it names" |
| O-9 | `s48-support-access.spec.ts` | `support-sessions.test.ts` |
| O-10 | `deploy/docker/smoke-test.sh` runs the command inside the image | `workspace-erasure.test.ts`, all fifteen criteria |
| O-11 | | `plan-change.test.ts`: "grants the first operator on anybody's word but their own", "lets only an operator grant the next one" |
| C-1 | `hosting-okrgoal`, `hosting-provider`: "a visitor meets …"; `hosting-profiles`: "a sign-up names the provider's own legal pages" | |
| C-2 | every journey's visitor step | `registration-policy.test.ts`, `create-workspace.test.ts`: "is judged by address under a company-address policy" |
| C-3 | `hosting-group`, `hosting-one-company`: "follows the email" | `create-workspace.test.ts` |
| C-4, C-5 | `hosting-okrgoal`, `hosting-provider`: "signs up …"; `hosting-group`, `hosting-one-company`: "no plan …" | `hosting-profiles.test.ts`: "starts a new workspace on the plan the provider names", "has no plan screen, because there are no plans" |
| C-6 | | `billing-service.test.ts`, `billing-webhook.test.ts`, `packages/adapters/test/billing.test.ts`, and the test-mode run |
| C-7 | | `hosting-profiles.test.ts`: "does not let an administrator take a plan for nothing" |
| C-8 | `hosting-okrgoal`: "a second free workspace is refused"; `hosting-group`: "a company address is offered a workspace"; `hosting-one-company`: "no plan, no seat limit, no way to start a workspace" | `create-workspace.test.ts`: "may own one free workspace, and is told the limit past it", "is refused under an invitation-only policy, by any surface", "is limited by the setting, and zero means unlimited" |
| C-9 | `hosting-one-company`: "moves between the company's workspaces" | `create-workspace.test.ts`: "does not count a workspace on a paid plan, or one they only belong to" |
| C-10 | `hosting-okrgoal`: "two people join …", "the next invitation is refused, naming the seats" | `seats.test.ts`: "refuses the invitation, naming both numbers"; `hosting-profiles.test.ts`: "never limits seats, because self-hosting never does" |
| C-11 | `hosting-okrgoal`: "a pending invitation holds a seat, and is named on the plan screen" | `seats.test.ts`: the block "a pending invitation holds a seat" |
| C-12, A-1 | every journey: "appoints …" or "makes one of them an administrator" | `administrator-handover.test.ts`: "makes a member an administrator, and lets the founder then step down" |
| C-13 | every journey: "meets none of the instance's own settings" or "no instance settings" | |
| C-14 | `hosting-okrgoal`: "sees Team, its seats and its credits", "a credit pack paid at Stripe …"; `hosting-profiles`: "the plan screen says when purchased credits expire" | `ai-credits.test.ts`, `ai-credit-packs.test.ts`, `billing-webhook-route.test.ts` (apps/web) |
| C-16, A-6 | `hosting-okrgoal`: "closes the workspace …", "reopens it …"; `hosting-profiles`: "an owner closes the workspace by typing its address" | `tenant-lifecycle.test.ts`: "closes it by typing its address", "reopens what it closed while it was active", "cannot close one the provider suspended", "tells every owner the date it will be deleted, who closed it, and how to undo it" |
| C-17, M-4 | `hosting-group`: "cannot open another company's objective"; `hosting-one-company`: "Engineering's objective is not found" | `tenant-fuzz.test.ts`, `tenant-scoped-writes.test.ts` |
| A-5, M-5, M-6 | `hosting-one-company`: "holds no admin in Engineering", "forged workspace cookie"; `hosting-group`: "the switcher offers nothing" | |
| M-8 | `hosting-provider`: "is offered the provider's own source"; `hosting-profiles`: "every member is offered the provider's own source" | `instance-identity.test.ts`: "points upstream until somebody says otherwise", "takes the provider's own, from the environment" |
| I-1 | `hosting-okrgoal`: "a credit pack paid at Stripe …"; `hosting-provider`; `hosting-profiles`: "/api/billing/webhook does not exist with billing off" | `billing-webhook-route.test.ts` (apps/web) |
| I-2, I-3 | | `hosting-profiles.test.ts`: "gives workspaces from before it a tenant record, once", "guards an AI address unless the deployment says it trusts its administrators" |
| I-4 | | `operator-wall.test.ts`: "replaces the snapshot rather than appending to it" |

## 6. Findings and gaps

### Defect D-1, fixed: a pending invitation held no seat

| | |
|---|---|
| What the design says | `plans-and-seats.md` §2: an invited person counts as a seat, "the load-bearing choice", so a full workspace refuses the administrator rather than the person clicking the link |
| What the screen says | S-49: "Somebody invited holds a seat before they accept" |
| What happened | A personal invitation writes no member row until it is accepted, and seats counted member rows. With two of three seats free, an administrator could invite any number of people. Each one past the limit was refused at the link, the outcome the design set out to avoid |
| Why no test caught it | `seats.test.ts` proved the counter counts a member with status `invited`, but inserted that member by hand. No product path writes that status |
| Found by | `hosting-okrgoal.spec.ts`, inviting a fourth person to a three-seat plan |
| Affects | Setups 1 and 2, any provider with seat limits |
| Fix | The pending invitation itself holds the seat, once per address, until it is accepted, revoked or expires. A move to a smaller plan is still judged by the people. `plans-and-seats.md` §2 has the rule |
| Status | Fixed on 8 November 2026, approved by Akmal. The browser test that found it is now an ordinary test |

### What a browser cannot prove here, and what does

| Gap | Why | What proves it instead |
|---|---|---|
| A Stripe checkout, a subscription, the portal, a failed renewal | They need the real Stripe API, and continuous integration holds no Stripe keys | The unit suites with a fake gateway, and the test-mode run (L) |
| Erasure | It is a command run on the deployment's schedule, as the database owner, not a screen | `workspace-erasure.test.ts`, the Docker smoke test, the Helm checks |
| Spending AI credits | It needs a model | `ai-credits.test.ts` with the provider port faked; `pnpm ai:measure` for the real cost |
| A private AI server for a group | It needs a server on a private address | `hosting-profiles.test.ts` |
| One identity provider for a whole group | Not built: each workspace connects its own (`hosting-profiles.md` §6) | Nothing. Recorded as future work |
| Joining by a trusted email domain | Setup-independent | `s35b-trusted-domain.spec.ts` on the default setup |
| Several workspaces for one OKRGoal customer in a browser | A second workspace is only allowed once the first is on a paid plan, which needs Stripe | `create-workspace.test.ts`, and C-9 in setup 4 for the switcher itself |

## 7. Running it

```
pnpm build
pnpm test:e2e e2e/hosting-okrgoal.spec.ts
pnpm test:e2e e2e/hosting-provider.spec.ts
pnpm test:e2e e2e/hosting-group.spec.ts
pnpm test:e2e e2e/hosting-one-company.spec.ts
```

Each file needs only the suite's claim, so it runs on its own and on any shard.
Continuous integration runs all four with the rest of the suite.

| How the specs work | Why |
|---|---|
| Each file writes the instance settings for its setup in `beforeAll` and deletes them in `afterAll` | Settings are read per request, so the same server becomes each setup with no restart, and every later spec on the shard meets the default again |
| Every address carries the run, `RUN` in `e2e/hosting.ts` | A retry gets a fresh worker and must meet new people, not an address that already signed up |
| Setups 3 and 4 point the instance's mail at a small SMTP listener inside the spec (`MailCatcher`) | The suite has no mailbox, and the relay strips an invitation's token once the mail is sent, so the email is the only place the link exists |
| Setup 1 seals a Stripe secret key and webhook secret under the suite's root key (`e2e/root-key.ts`) | The server opens them as it opens an operator's. The key is never sent: no screen in the journey asks Stripe for anything |
| A webhook is signed as Stripe signs it, `t=…,v1=…` over the body | Signature checking runs offline, so the real route is exercised with no network |

## 8. Keeping it current

- A new switch, setting or screen that differs by setup adds a row here and a step to the journeys it changes.
- A row marked U or n/a that becomes reachable in a browser moves to B in the same change.
