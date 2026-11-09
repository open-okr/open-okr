# The tenant, and what happens to it over time

Part one of the Phase 8 design gate. Authority: REQUIREMENTS.md §5,
PLAN.md §2 and §5.1, TECHNICAL-PLAN.md §4.1, §4.2, §4.13 and §4.14.
Implemented at P8-T02 (provisioning, signup, onboarding) and read by
P8-T03 (operator console), P8-T04 (support access) and P8-T05 (plans and
seats).

Part two is `tenant-limits.md`. The operator console, the support
access contract and the plan model are P8-T01b.

## 0. What already exists

Nothing in this document is a new mechanism. Every piece of it is an
existing one given a cloud-shaped job.

| Component | Package | Ships at | What it already does |
|---|---|---|---|
| `workspaces` with `state` (`active` / `read_only` / `frozen`) | `packages/db` | P1-T04 | The tenant root. One row per customer |
| The freeze overlay | `packages/core/src/operations/freeze.ts` | P2-T09 | A workspace that is not `active` refuses every write except member and settings management, checked before the actor is even resolved |
| `workspace.provision` | `packages/core/src/workspaces/provisioning.ts` | P1-T06, extended since | One transaction that leaves a complete workspace: first member, access context, standard group, default space, rhythm settings, current cycle, the Coach and the Champion |
| The §4.14 settings map | `packages/core/src/settings/registry.ts` | P2-T13 | Every setting with a default that a fresh workspace resolves without configuration |
| `system_settings` | `packages/db` | P1-T09 | Instance scope, above every workspace. A request handler cannot write it; Postgres refuses unless `app.instance_admin` is set for the transaction |
| `ai_budgets` | `packages/db` | P2-T14 | A workspace-scoped spend cap that disables AI when crossed. The cap the cloud needs is already this table |
| The portability archive | `packages/core/src/portability` | P6-T04 | A whole-workspace export with a manifest and a checksum |
| Personal export and erasure | `packages/core/src/people` | P7-T08b | Per-member, across every table that holds a member reference |

**What did not exist before Phase 8.** No `tenants` table, no `operator_sessions` table,
no cloud flag, no signup that creates a workspace for somebody who has no
account yet, no lifecycle beyond the three `workspaces.state` values, and
no `deploy/cloud` directory at all.

## 1. The decision this document exists to make

REQUIREMENTS.md §5 and PLAN.md risk row R8 say the same thing in different
words:

> The cloud is the same container release under vendor operation, plus a
> tenant lifecycle surface. It is not a different product and not a
> different runtime.

> The cloud is the same image plus a thin overlay. No second runtime, no
> forked code path.

That is a constraint with teeth, and it decides the shape of everything
below. The question it forces:

**Where does vendor knowledge live, so that no product code ever reads
it?**

The answer this design takes: **the tenant is a sidecar, not a column.**

A plan key, a seat count, a trial end date and a region are facts the
vendor knows about a customer. They are not facts the product needs in
order to run an OKR practice. A self-hosted university has no plan and no
region and the product works identically. So none of it goes into
`workspaces`, and no code in `packages/core` that serves a product feature
may read the `tenants` row.

The moment a goal list, a check-in or a nudge reads `tenants.plan_key`,
self-host and cloud have forked, R8 is broken, and the fork stays
invisible until a self-hosted instance hits the null.

**Given** any read or write on the product path,
**when** it runs on a self-hosted instance where `tenants` holds no row,
**then** it behaves identically to the same call in the cloud, because it
never asked.

The enforcement is `pnpm check:boundaries`, extended at P8-T02 with one
rule: `tenants` may be imported by `packages/core/src/tenancy`, by the
operator console's own actions (`packages/core/src/operator`), by
`packages/core/src/billing` since `billing.md`, and by nothing else.

## 2. The `tenants` table

TECHNICAL-PLAN §4.13 already fixes the columns. This design adds the
types, the constraints and the reasons.

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | `uuid`, primary key, references `workspaces.id` | The primary key **is** the workspace id. One tenant per workspace, enforced by the key rather than by a unique index on a second id nobody needs |
| `state` | `text`, `active` / `suspended` / `closed`, default `active` | Section 3 |
| `plan_key` | `text`, nullable | Null means the free tier. Not a database enum: a plan is a row in a catalogue, and an enum turns adding a plan into a migration. P8-T01b owns the catalogue |
| `seats` | `integer`, nullable | Null means unlimited. P8-T01b owns the counting |
| `trial_ends_at` | `timestamptz`, nullable | Null means no trial. A past value is not itself a state; a sweep moves the state |
| `region` | `text`, not null | Section 5 |
| `closed_at` | `timestamptz`, nullable | Set when `state` becomes `closed`. Section 6 |
| `owner_may_reopen` | `boolean`, not null, default false | True only when the owner closed it while active. `workspace-erasure.md` §3, migration 0148 |
| `erasing_at` | `timestamptz`, nullable | Set when erasure claims the workspace. `workspace-erasure.md` §4, migration 0149 |
| `erasure_reminded_at` | `timestamptz`, nullable | When the seven-day reminder went out. `workspace-erasure.md` §12, migration 0150 |
| `created_at`, `updated_at`, `deleted_at` | `timestamptz` | The repository's standard three. Soft delete is the default scope |

**Row-level security.** `tenants` carries `workspace_id` and gets a policy
in the same migration, like every other business table. It is not exempt
for being cloud-only. A tenant reading its own row is how a seat count
reaches the customer's own billing screen at P8-T05, and the tenant floor
is what keeps it from reading anybody else's.

**The operator reads past the floor**, and that is P8-T01b's problem
rather than this document's. It is named here so nobody designs the policy
twice.

## 3. The lifecycle, and why it is not a fourth state

`workspaces.state` already has three values and an enforcement point that
runs before every write. The cloud lifecycle does not add a second
enforcement point. It **projects onto the one that exists.**

| Tenant state | `workspaces.state` | What a member sees | Who can set it |
|---|---|---|---|
| `active` | `active` | Everything | Provisioning, and an operator lifting a suspension |
| `suspended` | `read_only` | A banner saying why, and every write refused except member and settings management | An operator (P8-T03), or the trial sweep |
| `closed` | `frozen` | A banner saying the workspace is closed, and how to export before the retention window ends | An operator, or the workspace owner asking to close |

Two consequences, both deliberate.

**The freeze overlay's recovery list is what a suspended workspace keeps.**
That list is `workspace.setState`, `workspace.setLifecycle`,
`sso.setConnectionEnabled`, `workspace.remindErasure`,
`workspace.exportArchive` (from 0.7.0, §10, once approved), and everything under
`people.`, `settings.` and `billing.`. A suspended customer can still remove a
member and still fix their billing email. That is the right list for a
suspension, and it is the list that already exists, so no new one is
written.

**Being on the list does not let the customer lift what the provider set.**
Corrected on 8 November 2026 (`workspace-erasure.md` §2): `workspace.setState`
writes the same column, and until then an administrator could lift an
operator's suspension, unpaid read-only mode or a closure with it. It now
refuses while the tenant is suspended or closed, and `workspace.setLifecycle`
lets a workspace's own administrator do one thing only, close it.

**`read_only` and `frozen` are treated identically by the overlay today**,
and `freeze.ts` says so in its own comment, leaving the difference "to
whichever task actually needs that difference." This is that task, and the
answer is that the difference is not in the permission layer at all. Both
refuse the same writes. What separates them is the sentence the member
reads and what the retention clock does, and neither of those belongs in
`freeze.ts`.

**Given** an operator suspending a tenant,
**when** a member of that workspace publishes a check-in,
**then** the write is refused by the existing overlay with the read-only
message, the member sees the suspension banner with its reason, and a
`workspace.lifecycle_changed` activity row, audited as
`workspace.setLifecycle`, records the actor and the transition.

**Given** the same member editing their own notification settings,
**when** they save,
**then** it succeeds, because `settings.` is on the recovery list.

## 4. Provisioning gains a row, not a path

TECHNICAL-PLAN §4.14 already sets the rule:

> The workspace-provisioning and member-provisioning Operations write
> these without asking. Each module contributes its rows to those
> Operations as it lands.

The tenancy module contributes exactly one statement to the existing
`workspace.provision` transaction, in the same shape the agents, the
default space and the rhythm settings already use.

```
runOperation({ action: "workspace.provision", ... }, async (tx) => {
  ...                            // everything that exists today
  await seedTenantInTx(tx, {     // added at P8-T02
    workspaceId,
    cloud,                       // the resolved flag and cloud.region
  })                             // plan_key and seats left null
})
```

`seedTenantInTx` returns immediately when the cloud flag is off, so the
self-hosted path executes one function call and writes nothing.

**The cloud flag is one instance setting.** `cloud.enabled` in
`system_settings`, default `false`, with `source` set to `environment`
when a deployment sets it at boot (`OPENOKR_CLOUD`). It is the only thing
separating a cloud instance from a self-hosted one, and it is read where a
cloud behaves differently: provisioning, the operator console's route guard,
the seat check, the registration default, the scheduler's cloud jobs and the
cards Admin, General hides on a cloud.
Everywhere else, its absence is what makes the product identical.

A self-hosted instance that flips it on gets the tenant row and the
operator console. That is not a supported configuration, and it is not
refused either, because refusing it would mean a second code path built to
enforce the absence of a second code path.

**Signup is the existing registration plus a workspace name.** P1-T06's
registration already provisions a complete workspace for the first person
on a self-hosted instance. Cloud signup is that same Operation reached
from a public route with email verification in front of it, rather than a
second provisioning implementation. The registration policy setting
already distinguishes open from invitation-only, and the cloud runs open.

**Given** a new cloud signup who dismisses every onboarding step,
**when** they land,
**then** they are in a workspace with a default space, the current cycle,
the running rhythm, the Coach and the Champion active, and a `tenants` row
carrying the free tier and a region. No setting was answered.

## 5. Region is recorded, and nothing more

`region` is not null and it is a plain string, resolved at provisioning
from an instance setting (`cloud.region`, default `local`).

**This design does not route on it.** There is no region-aware connection
string, no data residency guarantee, no cross-region migration. A
multi-region cloud is one database per region with one instance in front
of each, and every instance knows only its own tenants.

The column exists now because adding it later means backfilling a value
nobody recorded at the time, and the honest value for an old row would be
a guess. Recording it costs one string and removes that guess.

**What this refuses to imply.** Until P8-T06 says otherwise, the customer
is told where their data is and is promised nothing about it staying
there. A residency claim is a contract, not a column.

## 6. Closure, and the rule that a default must never delete

P8-T02's card asks for "data retention on closure". The precedent for how
to answer it was set at P7-T08c, and it is worth quoting because it
decides this:

> A number out of the box would delete data on every instance that never
> chose one, on the first sweep after an upgrade, and nobody would have
> asked for it. So "not configured" must never mean "delete everything".

Closure follows the same rule, with one step that closure needs and a
delivery log did not.

| Step | What happens | Who triggers it |
|---|---|---|
| 1. Close | `tenants.state` becomes `closed`, `closed_at` is stamped, `workspaces.state` becomes `frozen` | The owner asking, or an operator |
| 2. Offer | The portability archive (§7.3, built at P6-T04) is offered to every workspace admin, and the banner links to it | Automatic, on close |
| 3. Hold | Nothing is deleted. The workspace stays frozen and readable to its own members | The default, and it stays the default forever unless step 4 is configured |
| 4. Erase | Only when `cloud.closureRetentionDays` holds a number, and only after that many days past `closed_at` | An operator setting the number on purpose |

**`cloud.closureRetentionDays` defaults to 0, meaning never erase.** A
cloud operator who wants a 90-day window sets 90 and the sweep starts
working. A cloud operator who never thinks about it destroys nothing.

**Who may close, reopen and erase, and how erasure works, is now
`workspace-erasure.md`.** The rule below still holds. **Erasure runs through the
data-change runner**, not through a migration and not inside the sweep. CLAUDE.md puts anything touching stored user
data in a human's hands, and a backfill runner is resumable, batched and
idempotent-by-ledger, which a cron job deleting rows is not.

**Given** a workspace closed 400 days ago on an instance where
`cloud.closureRetentionDays` is 0,
**when** the sweep runs,
**then** it reads the setting, returns without touching a row, and says so
in its log.

**Given** the same workspace where the setting is 90,
**when** `pnpm cloud:erase --write` runs,
**then** it runs the erasure data-change for that one workspace and records
`workspace.erased` on the instance audit chain with the retention number
that caused it.

## 7. What this design refuses

| Refused | Why |
|---|---|
| A `plan_key` column on `workspaces` | It would put vendor knowledge on the tenant root that self-host also uses, and every read of it would be a fork |
| A second permission check for suspension | The freeze overlay already runs before every write. Two checks is one check that can disagree with the other |
| A `tenants` read anywhere on the product path | R8. Enforced by `check:boundaries` at P8-T02 |
| A separate cloud application or image | REQUIREMENTS §5. One release, one runtime, one flag |
| Feature gating of any kind | PLAN.md §10 #2's current position, and REQUIREMENTS §5's flat statement that self-host is never feature-gated |
| A retention default that deletes | P7-T08c's precedent, applied to something much larger than a delivery log |
| Region routing | Not designed here. A column implying a guarantee the deployment cannot keep is worse than no column |

## 8. Acceptance criteria

Written as the test plan P8-T02 inherits.

1. **Given** a self-hosted instance with `cloud.enabled` false, **when** a
   workspace is provisioned, **then** no `tenants` row is written and every
   product read returns what it returned before Phase 8.
2. **Given** a cloud instance, **when** a signup completes, **then** exactly
   one `tenants` row exists for that workspace, written in the same
   transaction as the workspace itself, so a crash between the two is
   impossible because there is no between.
3. **Given** a tenant moved to `suspended`, **when** any member attempts a
   write that is not on the recovery list, **then** it is refused by
   `freeze.ts` and not by new code.
4. **Given** a tenant moved to `closed`, **when** a workspace admin opens the
   workspace, **then** they can still read it and can still build the
   portability archive.
5. **Given** `cloud.closureRetentionDays` unset, **when** the closure sweep
   runs against a workspace closed any number of days ago, **then** zero rows
   are deleted.
6. **Given** the boundary gate, **when** any file outside
   `packages/core/src/tenancy`, `packages/core/src/operator` and
   `packages/core/src/billing` imports the `tenants` schema, **then** the
   build fails naming the file.
7. **Given** the tenant property and fuzz suite from P7-T03a, **when** it runs
   against `tenants`, **then** a cross-tenant read returns zero rows, the same
   as every other business table.

## 9. Open, and not decided here

| # | Question | Why it is not answered here |
|---|---|---|
| 1 | The cloud pricing model. PLAN.md §10 #1 | **Closed on 7 November 2026: per workspace, with a seat limit.** This design holds `plan_key` and `seats` nullable, so the decision changed a catalogue row rather than the schema. See plans-and-seats.md §9 |
| 2 | Whether any feature is ever gated. PLAN.md §10 #2, current position nothing gated | Same. The design assumes nothing gated, which is also what REQUIREMENTS §5 states outright, and the two would have to be reconciled before anything could be gated |
| 3 | The closure retention number a real cloud would run | The default is 0 and that is safe. The number is a business and legal decision: OKRGoal's is 30, because Terms §12.3 says so. Any other provider chooses its own |
| 4 | Whether a closed workspace's members keep read access, or only its admins | Written here as all members. An argument exists for admins only, and it is a policy question |
| 5 | The region list | Written here as a free string resolved from an instance setting. An enum would mean a migration every time the cloud opens a region |

## 10. A frozen workspace can export its archive (release 0.7.0, B5)

Status: proposed 9 November 2026, waiting for "design approved".

### 10.1 What is wrong

`workspace.exportArchive` is a write action, and it is not on the recovery list in `packages/core/src/operations/freeze.ts`. So a workspace that is `read_only` or `frozen` refuses it. Three places expect the opposite:

| Where | What it expects |
|---|---|
| This document, §6 step 2, and acceptance criterion 4 in §8 | A closed workspace's admins can still build the portability archive, and the banner links to it |
| `docs/runbooks/migration-cutover.md` | Phase 1 freezes the source, phase 3 exports it. Freezing first is what makes the archive consistent. The runbook carries a warning today that the export is refused |
| `deploy/docker/cutover-rehearsal.sh` (plan B9) | The same order |

### 10.2 Decision

| # | Decision | Why |
|---|---|---|
| L1 | **Add `workspace.exportArchive` to `RECOVERY_ACTIONS`** | Exporting is how a closed customer leaves (§6) and how a migration moves (the runbook). Both happen while writes are stopped, on purpose |
| L2 | Nothing else joins the list. List exports (`exports.*`) and the archive import stay refused while frozen | A closed customer is offered the archive (§6 step 2). Importing into a frozen workspace would be writing to it |
| L3 | The action's own access check is unchanged: `full` access, and the archive belongs to whoever asked for it | The freeze overlay decides whether the state allows it; `can()` still decides who |

What the export writes while the workspace is frozen, all of it bookkeeping and none of it workspace content:

| Row | Why it is safe in a frozen workspace |
|---|---|
| `export_runs`, one row, `ready` | It records that an archive was taken. It changes no goal, member or setting |
| `activities`, `export.taken` | The workspace's own record that somebody took everything out. Members should see that during a freeze too |
| `audit_events`, `workspace.exportArchive` | The audit trail is append-only and is written for every recovery action already |

### 10.3 Acceptance criteria

- Given a workspace frozen with `workspace.setState`, when an admin with `full` access calls `workspace.exportArchive`, then it returns the archive and writes one `export_runs` row, one activity and one audit row.
- Given a tenant closed by an operator, when an admin of that workspace exports, then it succeeds, as §8 criterion 4 already says.
- Given the same frozen workspace, when the admin calls `workspace.importArchive` or a list export, then it is refused with the frozen message.
- Given a frozen workspace, when a member below `full` access exports, then it is refused as not-found, as today.

### 10.4 Tests and documents

| Kind | File | Covers |
|---|---|---|
| Integration | `packages/core/test/freeze.test.ts` (existing) | The recovery list holds `workspace.exportArchive` and nothing else new |
| Integration | `packages/core/test/cutover-runbook.test.ts` (new, plan B9) | Freeze, export, dry run, import, compare, unfreeze, through the actions the runbook calls |

`docs/runbooks/migration-cutover.md` loses its warning. This section's list of recovery actions (§3) gains the export.

