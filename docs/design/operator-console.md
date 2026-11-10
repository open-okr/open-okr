# The operator, and the wall between them and the content

Part three of the Phase 8 design gate. Authority: REQUIREMENTS.md §5,
PLAN.md §2, TECHNICAL-PLAN.md §2 (the tenant floor), §4.1 (access), §4.13,
§8.2 (the controls). Implemented at P8-T03. Depends on
`tenant-lifecycle.md`, which defines the `tenants` row and the
cloud flag.

The support-access contract is `support-access.md`. Plans and
seats are `plans-and-seats.md`.

## 0. What already exists

| Component | Where | Ships at | What it already does |
|---|---|---|---|
| The tenant floor | `packages/db/src/tenant.ts` | P1-T03, P1-T04 | `app.workspace_id`, applied with `SET LOCAL` inside a transaction. Every row-level policy keys on it. The application role cannot bypass it and does not own the tables |
| Two second policy keys | `packages/db/src/tenant.ts` | P2-T02, P5-T02a | `app.user_id` admits a member's own rows for the workspace switcher; `app.channel_team_id` admits one installation row before a tenant is known. Both read-only, both narrow |
| `app.instance_admin` | `packages/db/src/tenant.ts` | P1-T09 | Permits writes to `system_settings` for one transaction. A request handler never sets it, so a stray write is refused by Postgres rather than caught in review |
| `instance_audit_events` and its chain | `packages/core/src/audit/instance-chain.ts` | P2 hardening | A hash-chained audit trail for events that belong to no workspace. Built because `audit_events.workspace_id` is not null and a failed sign-in has no workspace |
| `audit_events` and its chain | `packages/core/src/audit` | P1-T07, P7-T02a | The workspace's own append-only trail, chained off the write path since P7-T02a |
| The freeze overlay | `packages/core/src/operations/freeze.ts` | P2-T09 | Suspension's enforcement, reused by the lifecycle rather than duplicated |
| `can()` and the access getter | `packages/core/src/access` | P2-T02 | One enforcement point. Not-found on forbidden, suspended members excluded |

**What did not exist before P8-T03.** No operator identity of any kind, no route that
serves more than one workspace, no instance feature flags, no site
messages, and no screen in UIUX-PLAN past S-40.

## 1. The decision this document exists to make

CLAUDE.md states the rule this design has to survive:

> Least privilege. An agent gets bindings on named spaces, goals and KPI
> trees only. Never a workspace-wide grant. There is no service account
> with ambient authority.

That rule is written about agents. An operator is a far bigger version of
the same risk: a human with a login that, done carelessly, reads every
customer's objectives, check-ins and private comments across the whole
instance, forever, with nothing recorded.

**The decision: an operator sees metadata by default and content never,
and content requires a separate, time-boxed, customer-visible grant.**

The wall is not a permission check in application code. It is the absence
of a row-level policy. Content tables get **no operator policy at all**, so
an operator's connection cannot read a goal even if every line of
application code above it were wrong. The support session in
`support-access.md` is the only thing that changes that, and it
changes it by being a member of the workspace for a while rather than by
lifting the floor.

**Given** an operator signed in to the console with no support session,
**when** any query is issued on their connection against `goals`,
`check_ins`, `comments` or any other content table,
**then** it returns zero rows, because no policy on those tables names the
operator setting.

## 2. Who an operator is

An operator is a `users` row with a grant. Not a `workspace_members` row,
because they are not a member of anything, and giving them one in every
workspace would be the ambient authority the rule forbids.

**`instance_operators`**, a table above the tenant floor, alongside
`system_settings`:

| Column | Type | Notes |
|---|---|---|
| `user_id` | `text`, primary key, references `users.id` | One grant per person |
| `granted_by_user_id` | `text`, not null | Never null, never self. The first operator is created by the deployment, not by a screen |
| `granted_at` | `timestamptz`, not null | |
| `revoked_at` | `timestamptz`, nullable | Revocation is a stamp, not a delete, so the trail survives |
| `note` | `text`, nullable | Why this person has it |

It carries no `workspace_id`, so it takes no tenant policy. It is written
only under `app.instance_admin`, the same setting `system_settings` uses,
and read through one function.

**There is no operator role inside a workspace.** `ACCESS_LEVELS` gains
nothing. The four graded levels describe a member's relationship to
objects in one workspace, and an operator has no relationship to any
object. Adding a fifth level above `full` would put operator authority
into the same comparison every ordinary permission check makes, which is
how ambient authority arrives.

## 3. The operator setting, and why it is a third narrow key

Reading across workspaces needs a way past the floor. There are three ways
to do it and two of them are wrong.

| Way | Verdict |
|---|---|
| A superuser or table-owner connection for the console | Refused. It bypasses row-level security entirely, so the wall in section 1 would be application code again, and TECHNICAL-PLAN §8.2's control 1 says the application role cannot bypass the floor |
| No cross-workspace read at all, one connection per workspace | Refused. The console's whole job is a list of workspaces, and a list built by looping a thousand transactions is not a list |
| **A third narrow policy key**, `app.operator_user_id`, admitting rows on named tables only | Taken |

This is the pattern `app.user_id` and `app.channel_team_id` already
established, and `tenant.ts` already describes the argument for it:

> Answering it with a policy keyed on the user keeps the answer inside
> row-level security; the alternative is a privileged query stepping
> around the floor, which is a cross-tenant read in the place a mistake is
> least likely to be spotted.

**The named tables, and nothing else:**

| Table | Operator policy | What it gives |
|---|---|---|
| `tenants` | Read. Lifecycle writes go through the Operation pipeline under the workspace's own setting, not through this key | Plan, seats, state, region, closure |
| `workspaces` | Read of the row. The console selects name, slug and state | Name, slug, state. **Not** `settings`, which holds branding and trusted domains and is the customer's own |
| `instance_operators` | Read | So the console can show who else holds a grant |
| `operator_sessions` | Read and write | The support-access contract |
| Aggregate counts | Read, from the snapshot table | Section 5. Corrected at P8-T03b: this said "through named views", and a view cannot count a table the floor protects |
| `billing_accounts` | Read | The billing status and customer reference S-46 shows (`billing.md`, migration 0145) |
| **Everything else** | **None** | A goal, a check-in, a comment, a document, a message, a nudge, an AI usage row. All unreachable |

The policy is written to check that the operator's grant is live:
`revoked_at is null`. A revoked operator's setting admits nothing, so
revocation takes effect at the database rather than at the next sign-in.

**Given** an operator whose grant was revoked one second ago,
**when** their open console page refreshes its list,
**then** it is empty, because the policy reads `revoked_at` on every
query rather than trusting a session issued before the revocation.

## 4. What the console can do without entering a workspace

P8-T03's card names five things. Each maps onto the table list above.

| Capability | Reads | Writes |
|---|---|---|
| List workspaces | `tenants` joined to `workspaces` | |
| Inspect one | The same row, plus the aggregate counts | |
| Suspend or reactivate | | `tenants.state` and `workspaces.state`, in one transaction |
| Instance feature flags | `system_settings` | `system_settings`, under `app.instance_admin` |
| Site messages | `site_messages` | `site_messages` |
| Per-tenant health and usage | The usage snapshot, section 5 | |

**Suspension is the lifecycle document's transition**, not a second
mechanism. The operator's write sets both states in one transaction and
the existing freeze overlay does the rest.

**Site messages** need one small table above the floor, because a message
targeted at every workspace has no `workspace_id`:

| Column | Notes |
|---|---|
| `id`, `body`, `level` | The message. Plain text, corrected at P8-T03c (migration 0088). `level` is `info`, `warn` or `bad` |
| `starts_at`, `ends_at` | Expiring is not optional. A site message with no end is a banner somebody forgets, and every reader learns to ignore the banner |
| `target_workspace_ids` | Null for everybody, or a list of workspace ids. Targeted, per the card |
| `dismissible` | Per the card. A dismissal is per user, across every workspace they are in, in `site_message_dismissals` (corrected at P8-T03c) |

## 5. Health and usage, without reading content

"Per-tenant health and usage" is the capability most likely to leak
content by accident, because the natural way to build it is to count rows
in content tables, and the natural way to debug it is to look at one.

**Counts come from a snapshot table, never from a policy on a content
table.** `operator_workspace_usage` holds `workspace_id`, member count,
goal count, check-in count, storage bytes, last activity and the instant the
numbers were taken. The operator policy names that table. No policy is added
to `goals` to make the count work, so the count is reachable and the rows
behind it are not.

**Corrected at P8-T03b. This section first said the counts come from a named
read-only view, and that is not possible.** `force row level security`
applies to the table owner too, which is the whole point of it, and
migrations run as the owner rather than as a superuser. So a
`security_invoker = off` view and a `security definer` function over one are
both still filtered, and a count taken either way is always zero. P8-T03a
wrote that view, measured zero, and cut it rather than ship a usage panel
that silently reported nothing.

Three ways out, and the third is what shipped:

| Way | Verdict |
|---|---|
| Give the owner role BYPASSRLS | Refused. It disables the floor for every table to make one count work, and it is the privileged connection §3 of this document already refused |
| Maintain counters on every domain write | Refused. A counter touched by every write is a second source of truth, and its drift is invisible |
| **Snapshot them on a schedule** | Taken. A job enumerates workspaces under instance administration, opens each one properly through the tenant setting, counts what a member of it would count, and writes one row |

The cost is that the numbers are as of the last sweep rather than live, and
the row carries `measured_at` so nobody can mistake one for the other. For an
operator deciding whether a workspace is active enough to matter, a figure
from this morning is the same answer as a figure from this second.

**A second finding came out of the same work.** Enumerating workspaces at all
needs a way past the floor, and the scheduler's `listWorkspaces` and
`pnpm audit:chain` have both been working around that by asking for a
database role that can see past it. Migration 0086 gives `workspaces` a
select-only instance-admin policy, which `tenants` already had from 0083.
That is a smaller privilege than BYPASSRLS on a whole connection, and both
existing callers could use it.

**No titles, no names, no content of any kind crosses into the console.**
A workspace's own name and slug do, because they are how a support request
is matched to a customer, and the customer chose them as an identifier.

**Given** an operator inspecting a workspace with 412 goals,
**when** the usage panel renders,
**then** it says 412 and cannot say what any of them is called.

## 6. Every operator action is recorded twice

An operator action is a fact about the instance and a fact about one
customer's workspace, and only one of those two audiences can read an
instance chain.

| Chain | Why the row goes there |
|---|---|
| `instance_audit_events` | The operator's own trail. Hash-chained, verifiable with `pnpm audit:verify`, and it is where a regulator or an internal review looks |
| The workspace's `audit_events` | So the customer can see it in their own audit log without asking anybody. A suspension the customer cannot see recorded is a suspension they have to take on trust |

Writing the workspace row needs the tenant setting for that workspace, and
the operator has it: the action already opens a transaction against that
one workspace to change its state. Both rows commit together with the
change, which is the Operation pipeline's own rule applied to a caller who
is not a member.

**The actor is the operator's user id and it is never mapped onto a
member.** `audit_events.actor_member_id` is not null today, which is the
same obstacle `instance_audit_events` was built for. P8-T03 adds a
nullable `actor_operator_user_id` beside it and relaxes the member column,
expand-then-contract, with P7-T09a's linter watching. Recorded here so
P8-T03 meets it as a known migration rather than a surprise.

## 7. Absent on self-host, and absent means absent

`cloud.enabled` false removes the console. Not hidden, not permission-
denied: the routes return not-found, the same answer the access getter
gives for anything forbidden, so the instance does not advertise a door it
will not open.

The `instance_operators` table still exists on a self-hosted instance and
holds no rows, because a table that exists and is empty is one migration
path for everybody. An instance administrator is a different thing and
already exists; nothing about this design changes what they can do.

**Given** a self-hosted instance,
**when** anybody navigates to an operator route,
**then** they get not-found, whether or not they are an instance
administrator.

## 8. The screens, and why they start at S-45

UIUX-PLAN §6 stops at S-40. The operator console needs its own screens so
P8-T03 cites one like every other interface task.

**They are numbered from S-45, and S-41 to S-44 are deliberately skipped.**
The end-to-end suite already uses those four prefixes for specs that are
not screens: `s41-mcp-transport`, `s42-route-coverage`, `s43-accessibility`
and `s44-web-vitals`. The `sNN` prefix started out screen-derived and
drifted at s41. Numbering a screen S-43 now would put
`s43-accessibility.spec.ts` next to a screen it has nothing to do with.
The gap costs nothing and the collision would cost somebody an hour.

| Screen | What it is |
|---|---|
| S-45 Operator workspaces | The list. Name, slug, plan, state, seats used, last activity, region. Filter by state and plan, search by name or slug |
| S-46 Operator workspace detail | One workspace: the metadata, the usage panel from section 5, the lifecycle actions, the support-session history, and its own audit extract |
| S-47 Operator instance | Feature flags and site messages, each with its window and its target |
| S-48 Support session | Requesting one, and the banner that runs while it is live. Specified in `support-access.md` |

**S-45's search and filters were built at release 0.7.0 (P3), and seats used
with them, after §11's design.**

| Part | What was built |
|---|---|
| Search, state, plan | In the address (`?q=&state=&plan=`), narrowing the list the operator's own read returned. A filtered list is a link to paste into a ticket, and nothing new is read |
| Plan options | Free (no plan), each catalogue plan by name, and any key a tenant still carries that the catalogue has dropped |
| Last activity | The snapshot's `last_activity_at`, so it is as of the last measurement like the counts beside it |
| Seats used | Built after §11: the snapshot's `seat_count` (migration 0157) against the plan's seats, counted by the limit's own `seatsHeldInTx`, in the warning tone at or over the limit, and "not measured" until the next hourly measure. S-46's usage panel shows members and seats used side by side |

The customer-side billing screen is S-49 and belongs to
`plans-and-seats.md`, because it is a workspace admin's screen
rather than an operator's.

## 9. Acceptance criteria

Written as the test plan P8-T03 inherits.

1. **Given** an operator connection with `app.operator_user_id` set and no
   support session, **when** it selects from `goals`, `check_ins`,
   `comments`, `documents`, `channel_messages` or `nudges`, **then** each
   returns zero rows. Run as a property test over every content table, the
   way P7-T03a already runs one over all 116.
2. **Given** an operator suspending a workspace, **when** a member of it
   signs in, **then** they see a message naming the reason, the workspace is
   read-only, and the suspension is recorded with its actor and reason.
   This is P8-T03's own acceptance criterion.
3. **Given** the same suspension, **when** the workspace's owner opens their
   own audit log, **then** the row is there, attributed to the operator,
   without anybody in the vendor having to send it to them.
4. **Given** an operator whose grant is revoked, **when** any query runs on
   their connection, **then** it returns nothing, proved without signing
   them out first.
5. **Given** a self-hosted instance, **when** any operator route is
   requested by an instance administrator, **then** it is not-found.
6. **Given** the usage snapshot, **when** an operator reads it, **then** it
   carries counts and timestamps and no title, name or body from any
   content table. Asserted on the table's column list, so adding a leaky
   column fails the test rather than passing review.
7. **Given** `pnpm audit:verify`, **when** it runs after a batch of operator
   actions, **then** both chains verify and the instance chain holds one row
   per action.

## 10. Open, and not decided here

| # | Question | Why it is not answered here |
|---|---|---|
| 1 | How the first operator is created | Written here as "by the deployment", which in practice means a seeded row or a command. The mechanism is P8-T03's, and it should not be a screen, because a screen that creates the first operator can be reached by whoever gets there first. **Answered at completeness review H-21: a command**, `pnpm cloud:operator --email <address> --granted-by <address>`. Never self; once one operator exists only an operator grants another; every grant and revocation goes to the instance audit chain |
| 2 | Whether an operator may read a workspace's own audit log without a support session | Written here as yes, on S-46, because investigating an incident is what the trail is for and the trail holds no content. An argument exists that the trail names people and is therefore personal data, which would put it behind a session |
| 3 | Whether site messages are rich text or plain | Written here as rich text through the shared module, for consistency. Plain text would remove a sanitising surface that has an instance-wide audience. **Answered at P8-T03c: plain text** (migration 0088) |
| 4 | The P1-T09 follow-up carried on the P8-T03 row | Instance settings writes sit outside the Operation pipeline behind an escape hatch. This design adds two more writers to `system_settings` (flags and site messages), so the follow-up gets larger rather than smaller and wants closing before or during P8-T03 |
| 5 | Renaming the four e2e specs that took S-41 to S-44 | Skipped rather than renamed, because renaming specs is a change with no behaviour behind it. If the prefix is ever reclaimed, the gap is where it goes |

## 11. Seats used on the snapshot (release 0.7.0, P3)

Status: approved by Akmal on 9 November 2026 ("design approved") and built at release 0.7.0 (plan P3, seats used), as written. Migration 0157.

### 11.1 What exists

| Piece | Where | Today |
|---|---|---|
| The snapshot | `packages/db/src/schema/operator-usage.ts`; migration 0086 with three policies (operator read, instance admin write, tenant read) | `member_count`, `goal_count`, `check_in_count`, `storage_bytes`, `last_activity_at`, `measured_at` |
| The measure | `measureOne`, `packages/core/src/operator/usage.ts:71-123`; run hourly by `cloud.measureUsage` and by `pnpm cloud:usage` | `member_count` is humans with status `active` |
| The seat limit | `SEAT_STATUSES` and `pendingInvitations`, `packages/core/src/tenancy/plans.ts:107-150`; `seatState` at `:215`, `seatCheckInTx` at `:392` | Humans `active` or `invited`, plus personal invitations still waiting, one per address, none for an address already here |
| The list | `apps/web/app/operator/page.tsx:327-331` | Active members against the plan's seats, so a workspace full of pending invitations looks half empty |
| The customer's plan screen | `apps/web/app/admin/plan/page.tsx:83` | Reads `seatState` live, not the snapshot. Unaffected |

### 11.2 Decisions

| # | Decision | Why |
|---|---|---|
| P1 | **`operator_workspace_usage.seat_count integer`, nullable, no default** | Null means no release that counts seats has measured this row yet, and the console says "not measured". A default of 0 would be a wrong number that looks like an answer, the failure `usage.ts` warns about |
| P2 | **One definition of a seat.** `plans.ts` exports `seatsHeldInTx(tx, workspaceId, arriving?)`: the `SEAT_STATUSES` count plus the pending invitations. `seatState`, `seatCheckInTx` and `measureOne` all call it | The console and the limit cannot then disagree about who holds a seat. Two counts would be two answers |
| P3 | `measureOne` calls it inside its existing `withWorkspace` transaction, naming the workspace explicitly as every count there does | The same floor and the same reason (`usage.ts:52-68`) |
| P4 | **`member_count` stays** and keeps meaning active people. S-45's column becomes seats used against seats (`seat_count / seats`), in the warning tone at or over the limit. S-46's usage panel shows both | They answer different questions: who works here, and what the plan counts. Removing a column spans two releases, and nothing needs this one gone |
| P5 | **Migration**: the column only, the next free number. The table's policies from 0086 already cover it | A new column needs no new policy |
| P6 | **No backfill.** The hourly measure fills every row within the hour; `pnpm cloud:usage` does it at once | The snapshot is replaced on every run (`onConflictDoUpdate`), so a data change would fill a value the next run overwrites |
| P7 | During a rolling upgrade, a replica of the previous release writes no `seat_count`: a new row stays null and an updated row keeps its last value beside a fresher `measured_at`, until the rollout ends | Acceptable for one hour at most. It cannot read as a different workspace's number |
| P8 | A count, not a list. No address, name or invitation leaves the workspace | §5 and acceptance criterion 6 in §9 |

### 11.3 Acceptance criteria

- Given a workspace with three active and one invited human, personal invitations waiting for two addresses (one sent twice), a guest invitation, an invitation to an address already a member, the Coach and the Champion, when the measure runs, then `member_count` is 3 and `seat_count` is 6.
- Given the same workspace, when `seatState` is read at the same moment, then its `used` equals `seat_count`.
- Given a snapshot row written before this change, when an operator opens S-45, then the seats cell reads "not measured", and after the next measure it reads `6 / 10`.
- Given a workspace at 10 of 10 seats, when the list renders, then the cell is in the warning tone.
- Given the operator wall's column check, when it reads the table, then `seat_count` is an integer column and nothing else was added.

### 11.4 Tests

| Kind | File | Covers |
|---|---|---|
| Integration | `packages/core/test/seats.test.ts` (existing) | `seatsHeldInTx` against the counted cases, and `seat_count` equal to `seatState.used` |
| Integration | `packages/core/test/operator-wall.test.ts` (existing) | The column list |
| Unit | `apps/web/test/operator-workspace-list.test.ts` (existing) | Seats used, not measured, at the limit |
| Browser | `e2e/s45-operator-console.spec.ts` (existing) | The column against a measured workspace |

### 11.5 Documents changed in the same change

- §8 above: "Seats used" becomes built.
- TECHNICAL-PLAN §4.13 (`operator_workspace_usage`) and DATABASE.md. §7.2 already lists the table as having no legacy source.
- UIUX-PLAN S-45 (already names seats used) and S-46's usage panel.
- `docs/runbooks/upgrade.md`, "0.6 to 0.7": one additive migration; the console shows "not measured" until the next hourly measure.

### 11.6 What this does not do

- No change to how the seat limit counts.
- No live count on the console. It still reads only the snapshot.
- No change to S-49, which reads the seat state live.
