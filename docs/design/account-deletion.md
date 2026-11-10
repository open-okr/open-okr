# Deleting your own account

Plan 0.8.0 row Y7. A person deletes their own account from the foot of Your
account. It touches security, access and stored user data, adds a table, and
cannot be undone once it runs, so it needs "design approved" before any code.
Akmal answered the six questions that shape it on 10 November 2026 (plan
section 2.5, Y7-1 to Y7-6); this note writes them down and designs the rest.

## 1. What exists

| Piece | Where | What it gives this |
|---|---|---|
| `people.erase` | `packages/core/src/actions/people.ts` | An administrator's erasure of one member in one workspace, in one Operation: the member row anonymised and suspended, `sweepPersonalData` (channel identities, link codes, message payloads, tokens, OAuth grants, copilot threads, agent tool calls), the avatar unshared, the feed's names removed, the audit row with counts |
| `eraseAccountIfAlone` | `packages/core/src/people/erasure.ts` | Anonymises the `users` row, revokes sessions and removes credentials and passkeys once the person belongs to no other workspace |
| `isLastFullAccessHolder` | `packages/core/src/people/lifecycle.ts` | Whether a member is the only one holding `full` on a workspace |
| `people.exportMine` | `packages/core/src/actions/people.ts`, offered on `/account/security` | The person's own data export |
| The closed-workspace erasure | `packages/core/src/tenancy/erasure.ts`, `pnpm cloud:erase` | The pattern for a long erasure: a ledger, resumed by the next run |
| Who an account belongs to | `apps/web/lib/app-shell.tsx` (`accountBadge`): a demo persona's address; `packages/core/src/directory-sync/users.ts`: a member joined `via: "directory_sync"` | The two refusals below |

**The rule erasure follows is unchanged** (Agung, 11 September 2026): what the
person wrote stays, attributed to the placeholder identity, and what identifies
them goes. The audit chain still verifies.

## 2. The decisions already made

| # | Decided |
|---|---|
| Y7-1 | **A 14-day wait.** Signed out everywhere at once; signing in again within the 14 days cancels it; a mail when it starts and the day before it runs |
| Y7-2 | **Refused for a member a directory manages**: "Your organisation's directory manages this account. Ask your administrator." |
| Y7-3 | **Refused while they are the last full-access holder of any workspace.** The refusal names the workspace and links to the handover and, on a cloud, to closing it. Deleting an account never closes a workspace |
| Y7-4 | **Resumed from a ledger** by the next scheduled run if one workspace's erasure fails. Meanwhile "Your account is being deleted" if they come back, and a mail when it is done |
| Y7-5 | **Nothing is handed to anybody by itself.** Each workspace's administrators and the person's manager get one inbox notice listing the goals, key results and reviews that now need an owner |
| Y7-6 | **That notice is how an administrator is told**, one message, a new kind of inbox notice approved by this decision |

## 3. The flow

```
Your account ── Delete your account ──▶ confirm ──▶ requested (signed out everywhere)
                                                     │
                     signs in within 14 days ◀───────┤──▶ cancelled, mail "your account is kept"
                                                     │
                                         day 13 ─────┤──▶ mail "deleted tomorrow"
                                                     │
                                         day 14 ─────┴──▶ running ──▶ deleted, mail "done"
                                                          (per workspace, ledger)
```

### 3.1 Asking

| Step | Rule |
|---|---|
| Where | The foot of Your account (`/account`, S-51), a danger card "Delete your account" |
| Before | The card offers the data export first, linking the one on Security |
| Checks, in this order | A demo account; a directory-managed member in any workspace; the last full-access holder of any workspace. Each refuses with its sentence (§4) before anything is asked |
| Confirmation | The account's password. An account with no password (single sign-on or passkey only) confirms with a sign-in in the last 10 minutes instead, the same recent-sign-in rule Y3's "Set a password" uses (`docs/design/account-self-service.md`). A wrong password counts toward the account hold (`docs/design/account-lockout.md`) |
| On confirming | One transaction: the request row, every session of the account revoked, the instance audit row `account.deletion_requested`, and an outbox row for the first mail. Then the browser is sent to sign-in with "Your account will be deleted on {date}. Sign in before then to keep it." |

### 3.2 Waiting

| Event | What happens |
|---|---|
| They sign in | The request is cancelled in the sign-in itself (Better Auth's session-create hook): the row is stamped `cancelled_at`, the audit row `account.deletion_cancelled` is written, a mail says the account is kept, and the page says so once |
| Day 13 | The scheduler sends "Your account will be deleted tomorrow. Sign in to keep it." |
| Meanwhile | Their memberships are untouched: they still own their goals, still appear in the directory, and nothing is reassigned. Notices still reach their inbox. Nothing is mailed to them but the two mails above, because they asked to leave |

### 3.3 Running

The scheduler's hourly run picks requests whose 14 days have passed.

| Step | Rule |
|---|---|
| Check again, first | All three refusals of §3.1, across every workspace, **before** the first erasure. If one now holds (another owner left, say), nothing is erased: the request is cancelled, with the audit row and a mail naming the workspace and what to do. Nothing is ever half done because of a refusal |
| Per workspace | The erasure `people.erase` runs, in that workspace's own transaction, through one function both share (`eraseMemberInTx`, extracted from the action's body, so there is no second way to do half of it). The actor is the system on the person's behalf; the audit row says `by: "self"` and names no person |
| The notice | In the same transaction, Y7-5's inbox notice to the workspace's administrators and the person's manager, when there is anything to list |
| The ledger | Each finished workspace is recorded on the request. A failure records the error and stops; the next hourly run resumes with the workspaces not yet done |
| Last | When no membership is left, `eraseAccountIfAlone` anonymises the account, in the last workspace's transaction, as it does today. The "done" mail is queued before the address is anonymised, and the outbox row loses the address once delivered, as an invitation's does |
| Coming back meanwhile | Sign-in is refused with "Your account is being deleted. You will get a mail when it is done." |

## 4. What is refused, and the sentence

| Case | Sentence |
|---|---|
| A demo account | "Demonstration accounts cannot be deleted. Anyone can sign in to them, so anyone could delete them." |
| A directory manages the member | "Your organisation's directory manages this account. Ask your administrator." (Y7-2) |
| The last full-access holder | "You are the only owner of {workspace}. Hand it over first, or close it." with the two links; on a self-hosted instance, which has no owner's close, only the handover (Y7-3) |
| A wrong password | The sign-in form's own sentence, and it counts toward the hold |
| No password and no recent sign-in | "Sign in again to confirm it is you, then come back here." with the link |

## 5. The notice (Y7-5, Y7-6)

| Field | Value |
|---|---|
| Kind | `member.self_deleted`, new |
| To | The workspace's members holding `full`, and the person's manager when they have one. Deduplicated, so a manager who is also an administrator gets one |
| Says | "{the placeholder name} deleted their account. These now need an owner:" then the goals they championed, the key results they owned and the reviews they owed, each a link |
| Not sent | When the list is empty: an account that owned nothing tells nobody anything |
| Rule key | None. It reports what a member did, as an event's notice does, rather than an agent's proactive nudge, so the nudge rules (rule key, escalation step, quiet hours) do not apply. Whether that reading is right is Y7-Q4 |

## 6. Storage

**A schema change**, so it ships in a migration of its own, approved with this
design.

| Table | Columns |
|---|---|
| `account_deletions` | `id`, `user_id` (unique among open requests), `requested_at`, `runs_at` (`requested_at` plus 14 days), `reminded_at`, `cancelled_at`, `cancel_reason`, `started_at`, `completed_at`, `workspaces_done uuid[]`, `attempts`, `last_error` |

It is identity data about the account, beside `users` and `sessions`, rather
than a business table, so it has no `workspace_id`. Its row-level policy is the
user setting (`withUser`), so a person reads their own request and nobody
else's; the scheduler reads due rows across accounts the way the support-session
sweep reads expired sessions across workspaces (`sweepExpiredSessions`), and the
migration's policy says exactly which role may. The 14 days is a constant in core, not a
setting, because it is a promise made to the person, and an instance that
could set it to zero would break it.

## 7. Surfaces

| Surface | Change |
|---|---|
| Your account (S-51) | The danger card; the refusal or the confirmation form |
| Sign-in | The cancellation message once; the "being deleted" refusal |
| Mail | Four templates: requested, tomorrow, cancelled, done |
| The scheduler | `account.runDeletions`, hourly. `pnpm account:delete-due` for `OPENOKR_SCHEDULER=off` and for an operator who wants it now, written into CLAUDE.md's command list |
| The action registry | **None.** These are account actions taken in a browser by the person, not workspace actions, so REST, the command line, the agent tool catalogue and chat get no projection of them. An agent token can never delete its owner's account (Y7-Q2) |
| REQUIREMENTS, People and org | Names self-deletion beside suspend and restore |
| TECHNICAL-PLAN §8 | The flow and the table |

## 8. Acceptance criteria

```
Given a member of two workspaces who is not the last owner of either
When they confirm deletion with their password
Then every session of theirs ends, a request is stored for 14 days ahead,
the instance audit chain holds account.deletion_requested, and a mail says when

Given that request
When they sign in on day 5
Then the request is cancelled, account.deletion_cancelled is audited, and a mail
says the account is kept

Given the request reaches day 14
When the scheduler runs
Then each workspace erases their member as people.erase does, with by "self"
And each workspace's administrators and their manager get one notice listing
what now needs an owner
And the account is anonymised once no membership is left
And a mail says it is done

Given the erasure of the second workspace fails
Then the first stays erased, the ledger records it, and the next run finishes
the second without erasing the first again

Given they became the only owner of a workspace during the 14 days
When the scheduler runs
Then nothing is erased, the request is cancelled, and a mail names the workspace

Given a demo persona, a directory-managed member, or the only owner of a workspace
When they open the card
Then they see the refusal and no confirmation form
```

## 9. Tests

| Test | Kind |
|---|---|
| Each refusal; the request, cancel by sign-in, the reminder, the run, the resume, the late refusal | Core, against a real database, `packages/core/test/account-deletion.test.ts`, with a fake clock |
| `people.erase` and the self-deletion produce the same rows for the same member, through the one shared function | Same file |
| No session survives the request; sign-in is refused while running | Core, through Better Auth |
| The notice: recipients, deduplication, nothing when empty | Same file |
| The card, the refusals and the confirmation | End to end, `e2e/s51-account-deletion.spec.ts`, with a member made through the suite's helpers |
| Migration: the policy and its tenant check | `pnpm db:lint` |

## 10. What it does not do

- It does not delete what the person wrote. It is kept, under the placeholder.
- It does not close a workspace, or hand anything to anybody.
- It does not let an administrator delete another person's account across workspaces. `people.erase` stays one workspace's decision.
- It does not shorten the 14 days, for anybody.

## 11. Open questions

| # | Question | Options | Recommended |
|---|---|---|---|
| Y7-Q1 | A refusal that appears during the 14 days: cancel the whole request, or pause it until the person fixes it? | Cancel and mail; pause | **Cancel and mail.** Signing in to fix it would cancel it anyway, and a paused request nobody can see is worse than a clear "start again" |
| Y7-Q2 | Offer deletion to the command line or an agent token? | Screen only; also REST | **Screen only.** A token is the one credential most likely to be held by something other than the person |
| Y7-Q3 | Keep mailing them the usual notices during the 14 days? | Keep; stop | **Keep.** Stopping would hide work that is still theirs, and they can still come back |
| Y7-Q4 | Is the notice outside CLAUDE.md's rule that a proactive message carries a rule key? | Outside: it reports an event; inside: give it a rule key and a nudge row | **Outside.** It is sent once because something happened, like a mention's notice, not because an agent decided to nudge |
