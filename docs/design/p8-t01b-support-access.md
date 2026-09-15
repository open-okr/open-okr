# P8-T01b: support access, and who is allowed to say yes

Part four of the Phase 8 design gate. Authority: REQUIREMENTS.md §5,
TECHNICAL-PLAN.md §4.13 (the `operator_sessions` columns), §8.2.
Implemented at P8-T04. Depends on `p8-t01b-operator-console.md`, which
defines the operator identity and the wall this document is the one door
through.

## 0. What already exists

| Component | Where | Ships at | What it already does |
|---|---|---|---|
| `provisionMemberForInvite` | `packages/core/src/invitations/provisioning.ts` | P2-T04 | The one member-provisioning funnel every joining path lands in. Idempotent. Nothing else inserts into `workspace_members` |
| `can()` and the access getter | `packages/core/src/access` | P2-T02 | One enforcement point, not-found on forbidden, suspended members excluded |
| Access contexts, groups and bindings | `packages/core/src/access/contexts.ts` | P2-T01 | A member gets a group and a binding on a context at a graded level |
| `audit_events`, hash-chained | `packages/core/src/audit` | P1-T07, P7-T02a | Append-only, and migration 0080's trigger permits exactly one update: an unchained row gaining its chain columns |
| The in-app inbox | `packages/core/src/notifications` | P2-T10 | Always on, needs no mail, and carries what a member must not miss |
| `pnpm cadence:sweep`, the scheduler host | `packages/core`, P6-G01a | P6 | A place a recurring expiry sweep already belongs |

**What does not exist.** No `operator_sessions` table, no grant flow, no
expiry, and no way for an operator to read a single goal.

## 1. The decision this document exists to make

P8-T04's card says the access requires "an explicit grant". That phrase
has two readings and they are opposite products.

| Reading | Who says yes | What it is good at | What it is bad at |
|---|---|---|---|
| **Consent** | The workspace owner | The customer is never surprised. The promise is simple enough to put in a contract | A customer who cannot sign in cannot grant access to fix why they cannot sign in |
| **Break-glass** | The operator, with a recorded reason | An incident at 3am gets fixed | The promise becomes "we could, but we log it", which is a much weaker thing to sell |

**The decision: consent is the only path in v1, and break-glass is not
built.**

Two reasons, and the second is the one that settles it.

The customer-can-be-locked-out case is real and it is also the case with
the least content in it. Somebody who cannot sign in needs their account
fixed, and an account is not workspace content: it is `users`, sessions
and `workspace_members.status`, none of which needs a support session,
because a locked-out member's own row is reachable from the operator's
`people.` surface rather than from their goals.

And an unbuilt break-glass cannot be quietly widened. A break-glass path
built "just in case" becomes the normal path within a year, because it is
faster and nobody has to wait for a customer to answer an email. The
honest version of that product is one where the operator can read
everything and it is logged, and that is a different promise from the one
REQUIREMENTS §5 makes.

**Given** an operator who needs to see a customer's goal,
**when** no owner has granted a session,
**then** they cannot, and the product offers them no way to, and the
answer to the support ticket is to ask the customer.

## 2. The `operator_sessions` table

TECHNICAL-PLAN §4.13 fixes the columns. This adds the constraints.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | |
| `workspace_id` | `uuid`, not null | Carries the tenant floor policy like every business table, so the workspace reads its own sessions and no others |
| `operator_user_id` | `text`, not null | The person, from `instance_operators` |
| `reason` | `text`, not null | Written by the operator when requesting, shown to the owner before they decide. Not optional and not defaulted |
| `requested_at` | `timestamptz`, not null | |
| `granted_at` | `timestamptz`, nullable | Null means requested and not answered |
| `granted_by_member_id` | `uuid`, nullable | The owner who said yes. Null until they do |
| `expires_at` | `timestamptz`, nullable | Set when granted. Section 3 |
| `ended_at` | `timestamptz`, nullable | Set by expiry, by the owner revoking, or by the operator finishing |
| `level` | `integer`, not null | An `ACCESS_LEVELS` value. Section 4 |

**A partial unique index allows one live session per workspace per
operator**, on `(workspace_id, operator_user_id) where ended_at is null`.
Two live sessions for the same person is a bug that would make the audit
trail ambiguous about which one an action belonged to.

**`requested_at` is separate from `granted_at` on purpose.** The gap
between them is the customer's decision, and it is the thing an auditor
looks at. A single `granted_at` would lose the fact that a request was
ever made and refused.

## 3. The time box

| Property | Value | Why |
|---|---|---|
| Default duration | 4 hours | Long enough for a working session, short enough that forgetting to end one is not a standing grant. The owner picks from a small set when granting and 4 hours is preselected |
| Maximum | 24 hours | A grant that outlives the working day outlives the reason it was given |
| Expiry | Automatic, and enforced at use rather than by a sweep | Section 5 |
| Extension | Not built. A new request instead | An extendable session has no real expiry. A second request is one more thing the owner sees, which is the point |
| Owner revocation | At any time, one control, no reason required | The customer should never have to explain why they want their own workspace back |

**Given** a session granted for four hours,
**when** four hours pass with the operator still on the page,
**then** their next action is refused, they are returned to the console,
and `ended_at` is stamped with the reason `expired`.

## 4. What an operator can do inside a session

**The session is a binding, not a bypass.** Granting one creates a real
`workspace_members` row of kind `guest` through
`provisionMemberForInvite`, the one funnel, with a group and a binding on
the workspace context at the level the owner chose. Ending the session
suspends that member.

This is the single most important choice in the document, and it is what
makes everything else honest:

- `can()` answers for the operator exactly as it answers for anybody else,
  so there is no second authorisation path that can disagree with the
  first.
- Every read goes through the access getter, so a space the owner never
  gave the operator a binding on is not-found, not merely hidden.
- Every write goes through the Operation pipeline, so it writes an
  activity row, an audit row and an outbox row like any other write.
- The freeze overlay still applies, so an operator cannot write into a
  suspended workspace either.
- A `guest` does not count as a seat (`p8-t01b-plans-and-seats.md`), so
  support does not cost the customer money.

**The level is the owner's choice and it can never exceed their own.** The
grant screen offers view, comment and edit. `full` is not offered, because
`full` includes changing who else has access, and an operator who can
grant themselves a longer session has no time box.

**Given** an operator with a view-level session,
**when** they attempt any write,
**then** `can()` refuses it, with no code in the operator path having
checked anything.

## 5. Expiry is enforced at use, and swept as well

A sweep alone is wrong: between two sweeps the session is expired on paper
and live in fact. A check at use alone is also wrong: the row would sit
open forever and the owner's screen would show a live session that is not.

So both, with the check at use being the one that matters.

| Mechanism | When | What it does |
|---|---|---|
| At use | Every action, inside `resolveActor` | A member whose operator session is past `expires_at` resolves as suspended. This is the enforcement |
| The sweep | On the scheduler host, alongside the cadence sweep | Stamps `ended_at`, suspends the member row, notifies the owner that it ended. This is the tidying |

The at-use check costs one join on a path that already loads the member
row, and only for members of kind `guest` that have a session. An ordinary
member's resolve is unchanged.

## 6. What the owner sees, which is the acceptance criterion

P8-T04's acceptance is written about the customer, not the operator:

> Given a support session, when it expires, then access ends automatically
> and the owner can see who was in their workspace, when, and what they
> did.

Four surfaces, and the first three are not optional.

| Surface | When | What |
|---|---|---|
| The inbox | On request | "Name, from OpenOKR support, asks to enter this workspace for 4 hours. Reason: ..." with grant and refuse. The in-app inbox is always on and needs no mail configured |
| A persistent banner | While live | Named, with the remaining time and a revoke control, on every screen. Not dismissible. A customer must never have to remember to check |
| The audit log | Always | Every action the operator took, attributed to them by name, in the workspace's own chain, filterable to the session |
| The inbox again | On end | "The session ended" with how it ended and a link to what was done |

**The banner is not dismissible and that is deliberate.** Every other
banner in the product can be dismissed. This one cannot, because the cost
of forgetting is that somebody outside the organisation is reading its
objectives and nobody in the room knows.

**Given** an operator in a live session,
**when** any member of the workspace opens any screen,
**then** they see the banner, whether or not they are the owner who
granted it.

## 7. What this design refuses

| Refused | Why |
|---|---|
| Break-glass access | Section 1. An unbuilt path cannot be widened |
| An operator reading content without a session | The operator console document's wall. No policy on content tables names the operator setting |
| A session at `full` | It would include granting access, which defeats the time box |
| Extension of a live session | A second request is one more thing the customer sees |
| A dismissible banner | The cost of forgetting is borne by somebody who did not dismiss it |
| A session that survives the workspace being frozen | The freeze overlay applies to the operator like anybody else |
| Attributing an operator's action to a member | The audit row names the operator. A support action that reads as the customer's own is a falsified record |

## 8. Acceptance criteria

Written as the test plan P8-T04 inherits.

1. **Given** an operator with no granted session, **when** they request any
   workspace read, **then** it is not-found, and the content-table property
   test from the console document covers the database layer underneath.
2. **Given** a granted session, **when** it expires, **then** the next action
   is refused by `resolveActor` without waiting for a sweep, and the sweep
   later stamps `ended_at` and notifies the owner.
3. **Given** a completed session, **when** the owner opens their audit log,
   **then** they see who entered, when, why, and every action taken,
   attributed to the operator by name.
4. **Given** a live session, **when** any member opens any screen, **then**
   the banner is present and cannot be dismissed.
5. **Given** an owner granting at view level, **when** the operator attempts
   a write, **then** `can()` refuses it.
6. **Given** two grant requests from the same operator to the same
   workspace, **when** the second is granted while the first is live,
   **then** the unique index refuses it.
7. **Given** a session in a workspace that is then suspended, **when** the
   operator writes, **then** the freeze overlay refuses it, before the
   actor is resolved.
8. **Given** the seat count, **when** a support session is live, **then**
   the count is unchanged, because a `guest` is not a seat.

## 9. Open, and not decided here

| # | Question | Why it is not answered here |
|---|---|---|
| 1 | Whether break-glass is ever needed for a real incident class | Written here as not built. The argument for consent-only is in section 1 and it is a product promise rather than a technical choice, so it belongs to Agung. If it is ever built, it should be a separate table and a separate screen, never a flag on this one |
| 2 | Who counts as an owner for granting | Written here as a member who can manage access. The workspace's access model is graded rather than role-named, so "owner" resolves to `full` on the workspace context. Whether every `full` member may grant, or only one nominated person, is a policy question |
| 3 | The default duration | 4 hours, chosen here. It is the kind of number a real support organisation revises after a month of use |
| 4 | Whether the account-recovery case really never needs content | Section 1 asserts it does not, on the grounds that accounts are not content. Worth testing against a real support ticket before P8-T04 rather than after |
| 5 | Whether the operator's own reason text should be visible to every member or only the granting owner | Written here as the owner sees it on the request and every member sees the banner without it. The reason may name an internal ticket |
