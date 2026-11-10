# Support access, and who is allowed to say yes

Part four of the Phase 8 design gate. Authority: REQUIREMENTS.md §5,
TECHNICAL-PLAN.md §4.13 (the `operator_sessions` columns), §8.2.
Implemented at P8-T04. Depends on `operator-console.md`, which
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

**What did not exist before P8-T04.** No `operator_sessions` table, no grant
flow, no expiry, and no way for an operator to read a single goal.

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
| `ended_reason` | `text`, nullable | `expired`, `revoked`, `finished` or `refused`. Set with `ended_at` and only with it |
| `member_id` | `uuid`, nullable | The guest member the grant provisioned |
| `level` | `integer`, not null | An `ACCESS_LEVELS` value: 10, 40 or 70. Section 4 |

**A partial unique index allows one live session per workspace per
operator**, on `(workspace_id, operator_user_id) where ended_at is null and
deleted_at is null`.
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
- A `guest` does not count as a seat (`plans-and-seats.md`), so
  support does not cost the customer money.

**The operator sees what a member sees, capped at the granted level**
(UAT BUG-021). A binding on the workspace context alone reaches nothing
below it, because every goal and space has a context of its own, so a
view-level operator once opened an empty workspace. So the guest is given
a built-in role, `viewer` for a view or comment grant and `member` for an
edit grant, and `can()` treats a guest with a live session like a person
for the role and the two blanket tiers. Then it caps the answer at the
session's own level, in the three places that decide access: the getter's
level, the list filter and the visible-ids set.

| Granted | Role given | Reads | Writes |
|---|---|---|---|
| view | `viewer` | Every goal, KPI and space a member sees | None |
| comment | `viewer` | The same | Comments |
| edit | `member` | The same | What a member edits |

**A later session reuses the guest an ended one left** (UAT BUG-029).
Ending a session suspends its guest, and that row used to make every later
request and grant answer "already a member", so an operator could be let in
once per workspace for good. A request now ignores a suspended guest, and the
grant wakes it with the new level's role and binding: one member, so every
session's actions keep one author.

**Given** an owner who granted view, **when** the operator lists the goals
of a space, **then** they see what a member sees, and an edit to any of
them is refused.

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
| At use | Every read and every action, inside `resolveMemberAccessLevel`, which `resolveActor` also calls | A member whose operator session is past `expires_at` reaches nothing. This is the enforcement |
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

## 10. Inbox items for the request and the end (release 0.7.0, P2)

Status: proposed 9 November 2026 for release 0.7.0 (plan P2). Approved by Akmal on 9 November 2026 ("design approved"). Q1: agreed, D12 as written. Q2: refuse, with the freeze sentence. It widens a check constraint, so it is designed first (CLAUDE.md).

§6 promises two inbox items: one when support asks, one when a session ends. Neither is written.

### 10.1 What exists

| Piece | Where | Today |
|---|---|---|
| The request | `packages/core/src/operator/sessions.ts:100-165` | Inserts the `operator_sessions` row under the operator's own key (`:144-156`). **Not an Operation**, by its own comment (`:92-99`): no activity, no audit row, no outbox row. The operator console's rule, "every operator action is recorded twice" (`operator-console.md` §6), is not met |
| The end | `sessions.ts:418-497` | An Operation, `support.end`: stamps the row, suspends the guest, writes the `support.ended` activity and audit row. Called for `refused` (`apps/web/app/admin/support/grant-decision.tsx:35-40`), `revoked` (`apps/web/lib/support-banner.tsx:38-42`) and `expired` (the sweep). Nothing calls it with `finished` |
| The sweep (B2) | `sessions.ts:536-549`; `apps/web/lib/scheduler.ts:240-248`, `:489-495` | Every five minutes, ends each expired session through `support.end` as the `system` actor. One loop with no `try`, so one failure stops the rest, against the scheduler's own rule (`scheduler.ts:27`) |
| The freeze overlay | `packages/core/src/operations/operation.ts:582-603`; `operations/freeze.ts:20-38` | Refuses every write in a `read_only` or `frozen` workspace unless the action is on the recovery list. **`support.end` is not**, so in a suspended workspace the owner's revoke fails silently and the sweep throws on that session |
| Who may answer | `grant-decision.tsx:29` | `requireAccessLevel(full)`: `full` on the workspace context. This settles §9 question 2 in code |
| Who that is, as a list | `packages/core/src/people/lifecycle.ts:90-126` | `workspaceAdministratorIds`: active human members whose resolved level on the workspace context is `full`. Guests are excluded, so the operator's own guest is never one |
| The operator actor | `operation.ts:420-433` | `{ kind: "operator", userId }` resolves to no member and `full`, and the audit row carries `actor_operator_user_id`. Used by `operator/lifecycle.ts:81` |
| The reasons | `packages/db/src/schema/notifications.ts:4-11`; `packages/db/migrations/0023_check_ins.sql:176-192` | Six values, enforced by `notifications_reason_check` and `subscriptions_reason_check` |
| Writing rows inside an Operation | `packages/core/src/notifications/create.ts` | `notifyRecipients(tx, ...)` inserts the rows and one `inbox.added` outbox row each, in the caller's transaction. Routed by `settings.routing[reason]`, else the member's primary channel (`:132`), and batched into the member's window |
| What a row says | `apps/web/app/inbox/subject-link.ts:55-73`; `packages/core/src/notifications/digest.ts:197-204`; DATABASE.md §14 | A row written inside `execute` has no activity id, because the pipeline writes the activity after `execute` returns. Its line in the inbox and the mailed digest comes from its **reason** alone |

### 10.2 Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Two new reasons, `support_request` and `support_ended`** | §10.1's last row: the reason is the only thing that can tell a request from an end. Two reasons also let an administrator route requests to email and ends to the inbox only |
| D2 | **One migration widens both checks to eight values**, drop then add, as 0023 did for these and 0131 did for `nudges`. Forward-only and additive: no row changes. `subscriptions` is widened only so the one enum in the schema matches both tables; nothing writes a `support_*` subscription | Expand only. During a rolling upgrade the old release shows the raw reason word, because the inbox falls back to it (`subject-link.ts`) and no action output is parsed at run time. Nothing refuses |
| D3 | **Recipients: `workspaceAdministratorIds`**, the members who can answer. Not every member, who sees the banner while a session is live. Not only the built-in Owner role, which would miss a founder holding `full` through a binding | The set that receives the question is the set that may answer it, by the same rule |
| D4 | **The request becomes an Operation, `support.request`**, with the operator actor, after the `isLiveOperator` check it has today. One transaction: the `operator_sessions` row, a `support.requested` activity (on the feed, like `support.granted`, without the reason), an audit row naming the operator with the reason, the administrators' rows and their outbox rows. Then an instance audit row, `operator.support_requested`, as `operator/workspaces.ts:72` writes `operator.workspace_created` | Every write through the pipeline. Closes the missing record too: a request is the moment an outsider asked |
| D5 | **The end writes its rows inside `support.end`**, for a session that was granted, to every administrator except the member who ended it. A refusal writes none | Somebody was inside, so everybody who answers for the workspace hears. After a refusal nobody entered, and the request's own row already links to the answer |
| D6 | **The sweep is the path most end rows take.** It already ends through `support.end`, so the rows ride its transaction, to every administrator, since the `system` actor is nobody | No second producer. Access ended at its expiry anyway (§5); the row arrives within five minutes |
| D7 | **`support.end` joins the freeze recovery list.** `support.request` and `support.grant` stay off it, so a request into a suspended workspace is now refused | Ending somebody's access is recovery. A request that can never be granted is worse than a refusal (`sessions.ts:114-118`). See Q2 |
| D8 | **The sweep ends each session in its own `try`** and reports what failed | One stuck session must not keep the others open on the owner's screen |
| D9 | **The rows' subject is `support_session` with the session id.** `subjectPath` maps it to `/admin/support`. The inbox groups a session's request and end under one heading, "Support access" | One place to answer and to read the outcome |
| D10 | **The reason text is never in an inbox line, the feed or a mail.** It is on Admin, Support and in the audit row | §9 question 5: it may name an internal ticket, and mail leaves the instance |
| D11 | **No grant or refuse buttons in the inbox.** The row links to Admin, Support, which holds the level and hours choice. Admin, Support gives each ended session a "What was done" link to `/admin/audit?actorMemberId=<guest>` | One place decides. The audit filter already exists, and the guest is one member across every session (§4) |
| D12 | **No nudge.** No `nudges` row, no rule key, no Coach or Champion. The rows follow each member's routing like the other six reasons, which by default means the inbox and a batched email | It is a notice that one person's action caused, sent once, not an agent's proactive message. See Q1 |

### 10.3 What the rows say

| Reason | Inbox line and digest line | Chip |
|---|---|---|
| `support_request` | "Support asked to enter this workspace. Answer it on Admin, Support." | Support request |
| `support_ended` | "A support session in this workspace ended. See how, and what was done, on Admin, Support." | Support ended |

The `support.ended` feed renderer changes from the stored key to words: "the time ran out", "revoked by a member", "finished by support", "refused".

**Q1, for you.** D12 sends these through each administrator's routing, so by default they also reach email in the batch window (30 minutes). I do not count that as a new proactive message kind: no agent sends it, it has no rule key or escalation, and it fires once per thing a person did. If you do count it, the alternative is to route both reasons to the inbox only by default. **Proposed: D12 as written.**

**Q2, for you.** D7 changes one thing an operator can do today: ask to enter a suspended or closed workspace. The grant is already refused there, so such a request can only be refused or left. **Proposed: refuse it, with the freeze sentence.**

### 10.4 Acceptance criteria

- Given a workspace with two members at `full` and one at `edit`, when an operator requests a session, then each `full` member has one unread `support_request` row linking to `/admin/support`, the `edit` member has none, and the session row, the activity, the workspace audit row naming the operator, one instance audit row and two `inbox.added` outbox rows exist.
- Given the notification insert fails, when an operator requests a session, then no session row exists.
- Given a granted session past its expiry, when the sweep runs, then the session ends and each `full` member has a `support_ended` row.
- Given a granted session, when member A revokes it from the banner, then every other `full` member gets a `support_ended` row and A does not.
- Given a pending request, when an administrator refuses it, then no `support_ended` row is written.
- Given a `read_only` workspace with an expired session, when the sweep runs, then the session ends and its rows are written.
- Given two expired sessions where ending the first fails, when the sweep runs, then the second still ends.
- Given a `read_only` workspace, when an operator requests a session, then it is refused and nothing is written.
- Given any `support_*` row, then neither its inbox line, the feed nor the digest mail contains the request's reason.
- Given a member's channels page, then both reasons are listed with a routing choice.

### 10.5 Tests

| Kind | File | Covers |
|---|---|---|
| Integration | `packages/core/test/support-sessions.test.ts` (existing) | Recipients, atomicity, the operator audit rows, end rows per ending, no row on refusal, the reason kept out; rows from the sweep, a `read_only` workspace, one failure not stopping the rest |
| Integration | `packages/db` migration suite | Both checks accept the two values and still refuse an unknown one |
| Unit | `apps/web/test/inbox-links.test.ts` (existing) | `support_session` maps to `/admin/support` |
| Unit | `apps/web/test/inbox-fallback.test.ts` (existing) | Both lines and chips |
| Unit | `apps/web/test/scheduler.test.ts` (existing) | The sweep reports a failed session and carries on |
| End to end | `e2e/s48-support-access.spec.ts` (existing) | The request appears in the owner's inbox and links to Admin, Support |

### 10.6 Documents changed in the same change

- This document's §6: the request carries no duration, and the inbox links rather than offering grant and refuse.
- DATABASE.md §13 and §14: the reasons on `subscriptions` and `notifications`. TECHNICAL-PLAN §4.11 needs nothing: it names the column, not the values.
- UIUX-PLAN S-03 (the two chips) and S-48 (the inbox row points at Admin, Support, and the "What was done" link). S-48's operator side also lists "the duration and the level being asked for", which the request form has never had; corrected while there.
- `contract/` and `docs/api/reference.md`, regenerated: the inbox's reason enum grows.
- The English and Malay message files, and a changeset.

### 10.7 What this does not do

- No `finished` ending. An operator still cannot end their own session.
- No limit on how often an operator may ask again after a refusal. Every request is now recorded, which is the check on it.
- No mail outside the member's routing, and no chat message beyond what routing already sends.
- A row stays in the inbox of somebody who later loses `full`. Its link then answers not-found, as the rest of admin does.
