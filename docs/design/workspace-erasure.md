# Closing and erasing a workspace

Status: approved on 8 November 2026, every decision in §12 as recommended, including the
reminder seven days before deletion. One rule in §3 was narrowed while building. Authority:
`tenant-lifecycle.md` §6, `billing.md`, and what OKRGoal's published Terms promise.

## 1. What this has to be true of

| Promise or rule | Where it comes from | Consequence |
|---|---|---|
| Keep a closed workspace's content 30 days, so a mistake can be undone, then delete it | Terms §12.3 | A window, and a way to undo inside it |
| Backups are clean within a further 30 days | Terms §12.3 | Backups must expire inside 30 days, which is the deployment's job (§9) |
| Account details go when a workspace closes, after 30 days | Privacy notice | The accounts of people with nowhere else to go, not only the rows |
| Confirm the deletion in writing if asked | Data processing agreement §9 | A record that outlives the workspace and holds nothing personal |
| Owners and admins decide when a workspace closes | Terms, "your workspace" | A screen. There is none today |
| Not configured must never mean delete | `tenant-lifecycle.md` §6 | `cloud.closureRetentionDays` stays 0, meaning never. OKRGoal sets 30 |
| Every setup keeps working | PLAN §5.2 | Self-hosted, group and single company never erase anything unless somebody chooses to |

## 2. What was wrong before this change

| Finding | Effect |
|---|---|
| `workspace.setState` never looks at the tenant | **An admin can set their own workspace back to active from Admin, General.** That lifts an operator's suspension and unpaid read-only mode. It also reactivates a closed workspace whose record still says closed, which erasure would then delete while people are using it |
| `workspace.setLifecycle` is open to full access, over REST and the external agent's admin tools | The same, through another door |
| No screen lets an owner close | The Terms say they can |
| Closing never tells Stripe | A closed workspace keeps being charged |
| A closed workspace reads "frozen", with no date, and nobody is told | Nobody knows when their data goes |
| A webhook naming a workspace that is gone is refused by the pipeline's "No such workspace" check, rather than acknowledged | Stripe retries for days |

**Why deleting the `workspaces` row is not enough.** Checked against the real schema:
149 tables, 133 with `workspace_id`, 130 foreign keys that cascade.

| What a cascade misses | Why |
|---|---|
| `search_documents`, `outbox` | They have `workspace_id` and no foreign key. Both hold content |
| `audit_events` | The one foreign key that does not cascade, plus a trigger refusing every delete |
| Stored files and export archives | Not in Postgres. All live under the prefix `<workspaceId>/` |
| `sso_providers` | A Better Auth table with SSO configuration and no `workspace_id` |
| `users`, `sessions`, `accounts`, `passkeys`, `two_factors` | Instance tables. People can belong to several workspaces |

## 3. Closing

| Move | Owner or admin | Operator | Billing webhook |
|---|---|---|---|
| Active to closed | Yes, typing the workspace's slug | Yes, with a reason | No |
| Suspended by billing to closed | Yes, typing the slug | Yes, with a reason | No |
| Suspended by an operator to closed | No: it may be a legal hold | Yes, with a reason | No |
| Closed to active, before erasure starts | Only if they closed it while it was active | Yes | No |
| Active to suspended | No | Yes | Yes |
| Suspended to active | No | Yes | Only its own suspension |
| Anything, once erasure has started | Nobody | Nobody | Nobody |

**Why reopening depends on how it closed.** Closing a workspace that is read-only for
non-payment and then reopening it must not become the way out of paying. So
`tenants.owner_may_reopen` is true only when an owner closed an active workspace.

| Change | Detail |
|---|---|
| `workspace.setState` | Refuses while the tenant is suspended or closed, naming why. With no tenant row, which is every self-hosted instance, nothing changes |
| `workspace.setLifecycle` | A person may ask only for the moves above. Closing needs `confirmSlug`, checked on the server. Leaves the external agent's tools and needs the destructive scope on a token |
| Stopping the bill | The closing Operation adds an outbox row. The relay asks Stripe to end the subscription at the period's end, releasing any scheduled downgrade first, and retries until it answers. Both the owner's and the operator's path do this. Nothing is refunded (Terms §4.8) |
| Reopening | The subscription stays set to end, and S-49 says so with **Manage billing**. The product does not restart a charge nobody just confirmed |
| Telling people | One email to every owner and admin, sent through the outbox at closing: who closed it, the date it will be deleted, how to export, how to undo |

**A legal hold needs nothing new.** "Unless the law requires us to keep it": an operator
moves the workspace to suspended, which is audited, stays readable and is never due.
**Changed while building, on 8 November 2026:** this design first let an owner close any
suspended workspace, which would have let a customer close one under a legal hold and so
start its erasure. An owner may close a suspended workspace only when billing suspended it.

## 4. Erasing

It runs as a data-change script named `erase-workspace-<id>`, so the existing runner
gives it batches, a resumable cursor and a ledger. One workspace at a time, oldest first.

| # | Phase | Commits | What happens |
|---|---|---|---|
| 0 | Check | | Refuses unless the connection can delete audit rows (§5), the flag is on, retention is above zero, the tenant is closed, and the window has passed. **The first test runs before anything changes**, so a wrong role cannot strand a half-erased workspace |
| 1 | Claim | One | `tenants.erasing_at` and `workspaces.deleted_at` are set. Every member and every job loses it at once through the existing soft-delete scope, and reopening is refused from here on. Instance audit: `workspace.erasure_started`. Two outbox rows ask the server for phases 2 and 3 |
| 2 | Provider | | The server's relay calls the billing port's new `deleteCustomer`, which removes the Stripe customer and any subscription still running. An already-gone customer counts as done. **Stripe keeps the invoices**, as tax law requires |
| 3 | Files | | The server's relay calls the storage port's new `deletePrefix("<id>/")`, which removes files, thumbnails and export archives. Deleting what is already gone is fine |
| 3a | Wait | One per check | The command waits until both rows are delivered, up to five minutes a run. A row that dead-lettered is asked again, and still failing stops the run with the reason |
| 4 | Accounts | One per person | Each member with no membership anywhere else and no operator grant loses their account, which takes their sessions and sign-in methods with it. Other people keep theirs. The workspace's `sso_providers` go too |
| 5 | Rows | One per 1,000 rows | Every table with `workspace_id`, children first. **The list comes from the schema at run time, so a table added next year is erased without anybody remembering.** Each batch sets the tenant setting, so the row-level floor stops a bug reaching another workspace. `outbox` has no floor, so its query names the workspace |
| 6 | Last | One | Records the audit chain's head, deletes `audit_events`, deletes the `workspaces` row and lets the cascade take what remains. **Then counts every table, and rolls back if any row is left** |
| 7 | Receipt | One | Instance audit: `workspace.erased` |

**The receipt holds nothing personal:** the workspace id, a SHA-256 digest of its slug so a
customer quoting it can be matched, closed and erased dates, the window, how many rows and
accounts went, and the audit chain's last position and hash.

**What stays after erasure:**

| What | Why | Until |
|---|---|---|
| The receipt on the instance audit chain | It is the written confirmation, and the chain is append-only | For good |
| The runner's ledger row | An id and counts | For good |
| Stripe's invoices | Tax law | Stripe's retention |
| Backups, logs and queue rows | They expire on their own. Queue rows hold ids | Backups within 30 days (§9) |

A failed step stops that workspace and keeps its progress. The next run resumes it from
the ledger, even after its tenant row is gone, and exits 1 so the failure reaches the log.

**Changed while building, on 8 November 2026: the server does phases 2 and 3.** The
image's maintenance layer, where the command runs, holds core and no vendor SDK, and
core may not import the Stripe or S3 drivers. So the claim enqueues them, the server's
relay runs them with the drivers it already has, and the command waits. The property §5
chose is unchanged: the server still cannot delete an audit row. The relay never skips
either row, only fails it, so a receipt can never claim files gone that are still there.

## 5. Where it runs, and the change to the audit trail

**`openokr_app`, the role the server uses, has only `INSERT` and `SELECT` on `audit_events`.**
So the server cannot delete an audit row even if it is compromised, and the entrypoint
removes `DATABASE_ADMIN_URL` before the server starts. That is worth keeping. Backups already
set the pattern: a separate process on the deployment's schedule.

| | A: a command on the deployment's schedule (recommended) | B: the server's own scheduler |
|---|---|---|
| Who can delete audit rows | Only the owner role, which the server never holds | The server's role gains `DELETE` |
| "A deleted audit row shows" on the security page | Stays true of the running server | Weakened |
| Setting it up | One cron line, or one Helm value | Nothing |
| If somebody forgets | Nothing is deleted, and S-45 says how many are overdue | Cannot be forgotten |

**The trigger changes in one way.** `audit_events_append_only` permits a delete only when
that row's tenant has `erasing_at` set. It reads the tenant under the row-level floor, so it
also needs the tenant setting for that workspace. On a live workspace a delete is still
refused for every role, and an instance with no tenant rows can never delete one.

## 6. Schema

Forward-only, with no legacy source (TECHNICAL-PLAN §7.2). No new table. Built as two
migrations, one per change: 0148 adds `owner_may_reopen` with closing, and 0149 adds
`erasing_at` and the trigger with erasure. 0150 adds `erasure_reminded_at` for the reminder: the scheduler's hourly `cloud.remindErasure` job sets it and enqueues the mail once seven days are left, and every lifecycle move clears it, so each closure is reminded once. With retention of seven days or fewer there is no reminder, because the notice at closing already gave a date that close.

| Change | Notes |
|---|---|
| `tenants.erasing_at` | `timestamptz`, null. Once set, nothing reopens the workspace |
| `tenants.owner_may_reopen` | `boolean`, default false (§3) |
| `audit_events_append_only()` | Replaced (§5). The server's grants do not change |

## 7. Commands and settings

No new setting. `cloud.closureRetentionDays` is the only switch.

| Command | Does |
|---|---|
| `pnpm cloud:erase` | Lists what a real run would erase, with the reason for anything refused. **A dry run unless `--write` is given**, like the importers |
| `pnpm cloud:erase --write` | Erases what is due, and resumes anything unfinished |
| `pnpm cloud:erase --id <id> --now --write` | Erases one closed workspace before its window ends, for a customer asking for that or after a restore (§9). Refused unless the tenant is closed. The receipt says the window was skipped |
| `pnpm cloud:sweep --erased` | Lists the receipts, which is what a written confirmation is written from |
| `./openokr erase --write` | `pnpm cloud:erase --write` in the container, for a host cron beside the backup's. Without `--write` it is the dry run, like the command |
| Helm `cloud.erasure.schedule` | A CronJob with the same owner secret as the migration job, and the server's `BETTER_AUTH_SECRET` by reference, because the command loads the server's whole environment and in production that refuses to start without it. Before 0.8.0 the job had no auth secret and every run stopped before it read anything (plan 0.8.0 O3). Empty by default |

## 8. Screens

| Screen | Change |
|---|---|
| S-36 Admin, General | **Close this workspace**: what happens, the deletion date, a link to export, that the subscription will not renew and nothing is refunded, and the slug to type. While closed: **Reopen**, when allowed. The state card explains itself rather than offering a choice the server refuses |
| Banner in a closed workspace | "This workspace was closed on 8 November and will be deleted on 8 December. Export it before then." With retention off, it gives no date. Read through the tenancy module, like the credits banner |
| S-45 Operator console | How many closed workspaces are past their window, so a cron that never ran shows |
| S-46 Operator workspace | The date it will be deleted, and "being erased" once claimed, with reopening gone |

Self-hosted with the flag off shows none of this.

## 9. Backups and restore

| Item | Detail |
|---|---|
| Backup expiry | **Yours to set before go-live.** OKRGoal's backups must be gone within 30 days. `OPENOKR_BACKUP_RETENTION` counts backups rather than days: its default of 7 is a week only if they are daily |
| **Known limit: a restore brings back what the backup held** | A workspace closed when the backup was taken is erased again by the next run. One still active in that backup comes back active |
| The runbook's answer | The cron's log, kept outside the database, names each erased id. After a restore, close each one that came back on S-46, then `pnpm cloud:erase --id <id> --now --write` |

## 10. Testing

| Layer | How |
|---|---|
| Completeness | Walks the schema: after erasure, every table holding `workspace_id` has no row for that workspace, and a second workspace's rows match by count and checksum, table by table. A table added tomorrow is covered tomorrow |
| Interruption | Stops the run after every phase and between batches, then resumes. Nothing is done twice and there is one receipt |
| Roles | Runs as `openokr_owner` and `openokr_app`, because the test harness has both |
| Accounts | Sole member, member elsewhere, and operator |
| Stripe | Against `fetch` stubs, and by hand in test mode with your keys |
| Scale | `pnpm db:seed:large --scale 0.01`, reporting time and the longest transaction |
| Browser | Close, the banner, reopen, and the operator's view |

## 11. Acceptance criteria

1. **Given** the flag off, or retention at 0, **when** `pnpm cloud:erase --write` runs, **then** nothing is deleted and it says why.
2. **Given** retention of 30, **when** the run finds a workspace closed 29 days ago, **then** it stays. At 30 days it goes.
3. **Given** a suspended or closed tenant, **when** an admin calls `workspace.setState`, **then** it is refused and the state does not move. **Given** no tenant row, **then** it works as it does today.
4. **Given** an operator's or billing's suspension, **when** an admin calls `workspace.setLifecycle`, **then** it is refused.
5. **Given** an owner typing the right slug, **when** they close, **then** the workspace is closed, the banner gives the date, owners and admins are emailed, and the subscription is set to end. The wrong slug changes nothing.
6. **Given** an owner who closed an active workspace, **when** they reopen before the window ends, **then** it is active and S-49 says the subscription is still set to end. **Given** an operator closed it, or it was suspended first, **then** the owner is refused.
7. **Given** erasure has been claimed, **when** a member opens the workspace, **then** it is not found, and nobody can reopen it.
8. **Given** an erased workspace, **then** every table holds no row for it, and a second workspace is unchanged by count and checksum.
9. **Given** files and export archives under the prefix, **then** they are gone, and another workspace's remain.
10. **Given** a sole member, a member of a second workspace and an operator, **then** only the sole member's account goes, and the others keep their accounts and memberships.
11. **Given** a run stopped at any phase, **when** the next run resumes, **then** it finishes with one receipt.
12. **Given** a live workspace, **when** any role deletes an audit row, **then** it is refused. **Given** `openokr_app`, **then** it is refused at all times, including during erasure.
13. **Given** a connection that cannot delete audit rows, **when** the run starts, **then** it refuses before anything changes.
14. **Given** a finished erasure, **then** the instance chain verifies, the receipt holds no name or email, and other workspaces' chains verify.
15. **Given** a signed webhook naming an erased workspace, **then** it is acknowledged and writes nothing.
16. **Given** a closed workspace inside its window, **when** `--id --now --write` runs, **then** it is erased and the receipt says the window was skipped. On a workspace that is not closed it is refused.
17. **Given** workspaces past their window and no cron, **when** an operator opens S-45, **then** it says how many.
18. **Given** a group or single-company setup, **when** anything here runs, **then** nothing is deleted and Stripe is not called.

## 12. Decisions, answered on 8 November 2026

Every one as recommended. Number 3 was left open and the answer is yes.

| # | Question | Answer |
|---|---|---|
| 1 | Where does erasure run (§5)? | A: a command on the deployment's schedule, so the server never holds the power to delete audit rows |
| 2 | Email owners and admins at closing? It is a new kind of message, so it needs your yes | Yes, one, with the date |
| 3 | Also remind them seven days before deletion? | **Yes.** It is the last chance to save something irreversible, and it costs one more column and one job. The Terms do not promise it |
| 4 | May an owner reopen their own closure (§3)? | Yes, when it was active. An operator otherwise |
| 5 | Delete the Stripe customer at erasure? | Yes. Invoices stay, and the card and address go |
| 6 | Delete the accounts of people with no other workspace? | Yes. The privacy notice says so |

## 13. Not in this design

**Closing an account.** The privacy notice says "when an account or a workspace is closed",
and no screen lets a person close their own account. This design covers the workspace half.
The account half is a separate change, and I recommend it before go-live too.
