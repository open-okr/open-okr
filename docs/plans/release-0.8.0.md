# Plan: release 0.8.0

Owner: Akmal. Started 10 November 2026, the day 0.7.0 was published, against `main` at `8058c955`.

This plan grows as changes are named for 0.8.0. So far it holds three things:

1. **Carried from 0.7.0**: the second half of a change that has to span two releases. Section 1.
2. **Your account**: a page where a person sees and changes what is theirs, and an avatar menu that says who is signed in. Section 2. Asked for by Akmal on 10 November 2026: name, email, username, password and timezone in one place, and the menu naming the person and their role. Akmal answered its five questions the same day (section 2.3). Nothing is built yet.
3. **Found running OKRGoal**: three faults found on 10 November 2026 while finding out why the copilot on OKRGoal said "AI off". Section 3. One waits on a decision (Q6).

Each row is one change in the CLAUDE.md change loop: one branch, one commit, one pull request. A row marked **design first** needs its design note written or updated, and approved with "design approved", before any code, because it touches security, access, tenant isolation, a new engine or the schema.

Sizes are rough: **S** is under a day, **M** is a few days, **L** is a week or more.

## 1. Carried from 0.7.0

| # | Change | Designed in | Size | Gate |
|---|---|---|---|---|
| C1 | `short_id` becomes not null on the seven tables that took it in 0.7.0: cycles, goals, key results, initiatives, tasks, documents and sessions. The migration refuses to run while any row is still empty, naming the table and the count | `docs/design/short-ids.md`, "The 0.8.0 step". `docs/runbooks/upgrade.md` already tells an operator to run the backfill before upgrading to 0.8.0 | S | Schema, designed in 0.7.0 |

## 2. Your account

### 2.1 What a person can see and change about themselves today

Read from the code on `main`, not tried on a running instance.

| A person wants to | Today |
|---|---|
| See who they are signed in as | The avatar menu shows no name, no email and no role. **Its circle shows the workspace's initials, not the person's**: `apps/web/lib/app-shell.tsx` passes `workspace.name` to `AvatarMenu`, and that is the workspace's name (`Membership.name`). The menu's accessible name reads those initials as the account's |
| Change their name | Nobody can change their own. On `/people/<id>` an administrator edits another member's name, title and manager, and that card is hidden on the administrator's own profile (`isAdmin && !isSelf`), so even an administrator cannot rename themselves. P2-T03 put the name with the administrator, as an organisation field |
| Change picture, bio, timezone, language, preferred channel and quiet hours | Yes, on their own `/people/<id>`. Nothing in the avatar menu links there: the way in is the people directory |
| Change theme and density | Yes, in the avatar menu and on their profile |
| See their email | Only as "Signed in as" on `/account/security` |
| Change their email | No. Better Auth's `/change-email` is off, and no screen asks |
| Change their password while signed in | No screen. "Forgot password" works when signed out. Better Auth's `/change-password` is on and the `/api/auth` catch-all passes it through, so a direct call changes the password with no audit row and no mail to the owner |
| Set a password on an account that signs in only by single sign-on | No |
| Use a username | None exists. Sign-in is by email, and a mention picks a person from the directory by name |
| Close their own account | No. An administrator suspends or erases a member. The person's own data export is on `/account/security` |

Two more facts the rows below depend on:

- **A person has two names.** `users.name` belongs to the account: Better Auth keeps it, and it is copied into a member row when the person joins a workspace. `workspace_members.name` is what each workspace shows. Somebody in two workspaces can have a different name in each.
- **Better Auth answers endpoints no screen uses.** `/update-user` lets a signed-in person change `users.name` and `users.image` with a direct call, and writes no audit row. Screens show the member name rather than `users.name`, so the effect is small, but it is a write nobody records.

### 2.2 Changes

| # | Change | Size | Gate |
|---|---|---|---|
| Y1 | **The avatar menu says who is signed in.** The circle shows the person's own picture, or their initials, and its accessible name says it is their account menu. The menu opens with a header: their name, their sign-in email, and their role in this workspace by its role's name (Owner, Admin, Member, Viewer, or one the workspace made, from `packages/core/src/access/roles.ts`), with a chip where it changes what they should expect: **Guest** for a guest, **Demo account** for an account `pnpm demo:prepare` made, **Support access** for an operator inside a support session. The header links to Your account (Y2). The workspace's name stays where it already is, at the start of the breadcrumb and in the switcher | S | None |
| Y2 | **A Your account page at `/account`**, first in the avatar menu's account rows. One card for who they are in this workspace: picture, name, bio, timezone and language, with title and manager shown read only as set by an administrator. One card for how they sign in: their email, with the change of Y4, and a link to the password change of Y3. At the foot, Delete your account (Y7). The self-edit forms move here from their own `/people/<id>` (Q5), which keeps showing the same facts to every reader and gains an Edit link for its owner. Where to reach you, Security, API tokens, Connected apps and Your AI keys stay as they are | M | None. The same actions, no new field |
| Y3 | **Change your password while signed in**, on Security: the current password, the new one twice under the existing 12-character minimum, and "Sign out my other devices", ticked by default. A wrong current password counts toward the account hold (`docs/design/account-lockout.md`). Every change, through the screen or a direct call to Better Auth's endpoint, writes an `auth.password_changed` audit row and mails the account's address that the password was changed, never what to. An account with no password, one that signs in only by single sign-on, gets "Set a password" instead, after a recent sign-in | M | Design first: security |
| Y4 | **Change your sign-in email**, through Better Auth's verified change: a link goes to the new address and a notice to the old one, and nothing changes until the link is used. **Offered only where the instance can send mail** (Q3), because the new address has to be proved by its link; where it cannot, the card says why the change is not offered. Refused, with the reason, where the change is not the person's to make: a directory (SCIM) manages the account, or the registration policy would refuse the new address at sign-up. Answered the same way whether or not another account already holds the new address, so the form cannot be used to find out who has an account. Written to the instance audit chain | M | Design first: security, and it changes stored user data |
| Y5 | **Change your own name**, on Your account. The member and an administrator may both change it (Q2) | S | Design first: access. It adds the name to the member's own field set |
| Y6 | **Turn off the Better Auth endpoints no screen uses**, through its `disabledPaths` option, starting with `/update-user`, or route one through the audited path where a screen needs it. A test lists every endpoint the catch-all answers, so a default that a Better Auth upgrade switches on shows up as a failing test rather than in production | S | Design first: security |
| Y7 | **Delete your own account** (Q4), from the foot of Your account. The person confirms with their password, or a fresh sign-in for an account with none, and is offered their data export first, the one already on Security. It runs the erasure an administrator's `people.erase` runs today (`packages/core/src/people/erasure.ts`) in every workspace they belong to: what they wrote stays, attributed to a placeholder, and what identifies them goes, from channel identities and tokens to passkeys, sessions and the text of messages addressed to them. Once no membership is left, the account goes too, as `eraseAccountIfAlone` already does. Refused, naming the workspace and the handover to do first, while they are the last full-access holder of any workspace (`isLastFullAccessHolder`). Refused on a demo account, whose password is published, so any visitor could delete Priya. A mail to the address says it is done. Written to each workspace's audit chain and to the instance chain. The design answers the questions in section 2.5 | L | Design first: security, access and stored user data |

Y3 to Y6 share one design note, `docs/design/account-self-service.md`, written once and approved once. Y7 has its own, `docs/design/account-deletion.md`, so the password and email changes do not wait on its questions.

### 2.3 Decisions

Akmal answered all five on 10 November 2026.

| # | Question | Decided |
|---|---|---|
| Q1 | Should there be a username? | **No.** Sign-in is by email and a mention picks a person by name from the directory, so nothing needs one |
| Q2 | Who may change a member's name? | **The member and an administrator.** Where the change lands is Y5's design to propose and Akmal's to confirm. The proposal: the member row in this workspace and the account's `users.name`, which a new workspace starts from; other workspaces keep the name they have, because their administrators may have set it; refused where a directory (SCIM) manages the member, because the next sync would put the old name back. Title and manager stay the administrator's |
| Q3 | Can a person change their email on an instance that cannot send mail? | **No.** The change is offered only where the instance can send mail, and it takes effect only once the new address is verified by its link. An administrator changing another member's email is a separate change, not in this plan |
| Q4 | Can a person delete their own account? | **Yes.** Added as Y7, with the questions its design must answer in section 2.5 |
| Q5 | Move the self-edit forms from `/people/<id>` to Your account? | **Yes.** The profile is edited on Your account, and `/people/<id>` becomes what other people see |

### 2.4 What the specification gains when these are built

| Row | Pages |
|---|---|
| Y1 | UIUX-PLAN §3, the avatar menu |
| Y2 | UIUX-PLAN §6, a new screen for Your account, numbered when it is written, and S-33, which loses the self-edit forms |
| Y3 to Y6 | `docs/design/account-self-service.md`; TECHNICAL-PLAN §8 for the password and email changes and the endpoints turned off |
| Y5 | TECHNICAL-PLAN §4.1 and the comment at the top of `packages/core/src/actions/people.ts`, which record the self-versus-others split |
| Y7 | `docs/design/account-deletion.md`; REQUIREMENTS, the People and org line, which names suspend and restore today; TECHNICAL-PLAN §8; the Your account screen in UIUX-PLAN §6 |

### 2.5 What Y7's design must answer

These are for the design note, not decided here. Each needs Akmal's answer before Y7's code, because each touches stored user data.

| # | Question |
|---|---|
| Y7-1 | Straight away, or after a waiting period in which signing in again cancels it? |
| Y7-2 | A member a directory (SCIM) manages: refused, because the directory would provision them again, or allowed? |
| Y7-3 | The only member of a workspace is its last full-access holder, so Y7 refuses them. Does the workspace close with them instead, or must they close it first? The owner's close (`workspace.setLifecycle`, `docs/design/tenant-lifecycle.md`) is built on the cloud's tenant records, so what a self-hosted instance offers is part of the question |
| Y7-4 | Several workspaces are several tenant transactions. If one erasure fails partway, does the deletion resume from a ledger the way `pnpm cloud:erase` does, and what does the person see meanwhile? |
| Y7-5 | Goals they champion and reviews they owe pass to the placeholder, as an administrator's erase leaves them today. Are the workspace's administrators told, and is anything handed to their manager? |
| Y7-6 | Is an administrator told when a member deletes their own account, and does the inbox carry it? |

## 3. Found running OKRGoal

OKRGoal runs 0.6.0 with a plan catalogue (Free, Team and Business) and the provider's own AI key. On 10 November 2026 its copilot said **AI off** although the key was set and worked. The cause was that its workspaces had no plan, and on an instance with a catalogue a workspace with no plan may not use the provider's key (`docs/design/ai-credits.md` §3). Looking into it found two more faults. Each row was checked against `main` at `8058c955`, so 0.7.0 has all three.

### 3.1 Changes

| # | Problem | Where | Proposed fix | Size | Gate |
|---|---|---|---|---|---|
| O1 | **"AI off" gives the wrong reason.** A workspace that may not use the provider's key gets no drafter, so the copilot shows **AI off** and says "No AI provider is configured", the AI settings page shows **Not configured**, and every assist button disappears without a word. The provider is configured. The real cause is the workspace's plan, which only an operator or a purchase can change, and nobody in the workspace is told what to ask for. The copilot already names one plan reason, credits used up for the month, through `creditsPausedReason`, but not this one | `packages/core/src/actions/copilot.ts` (`copilot.availability`), `packages/core/src/copilot/answer.ts`, `packages/core/src/tenancy/credits.ts`, `apps/web/app/admin/ai/page.tsx` | One function in `packages/core` that says why AI is off for a workspace, checked in this order: no provider at all; the provider's key is set but this workspace's plan includes no AI credits; the month's credits are used up (today's sentence, unchanged); the workspace's egress controls let nothing reach the provider; the routed model has no price. The copilot's chip and sentence, the copilot's answer and the AI settings page all show it, with what to do: choose a plan on the Plan page, or add the workspace's own key | S | None |
| O2 | **A catalogue added after workspaces exist takes their AI away, and nobody is told.** A workspace starts on the default plan only if one is set when it is made. OKRGoal set its catalogue and Free as its default after its first workspaces existed, so every one of them has no plan and lost AI on the provider's key when the catalogue went in. The operator console can already filter to workspaces with no plan, but does not say what having none costs them | `packages/core/src/tenancy/plans.ts` (`resolveDefaultPlan`), `pnpm cloud:adopt`, `apps/web/app/operator/page.tsx` (S-45), `apps/web/app/operator/[workspaceId]/page.tsx` (S-46) | Whatever Q6 decides. Recommended: S-45 and S-46 mark a workspace with no plan, on an instance with a catalogue, as having no AI on the provider's key, and S-45 offers one audited action, "Put every workspace with no plan on the default plan". Before it runs, it lists the workspaces it would refuse because they have more people than the plan's seats | M | Design first: it changes stored tenant data. Waits on Q6 |
| O3 | **The Helm chart's erasure job fails before it starts.** `pnpm cloud:erase` loads the whole server environment, which in production refuses the development placeholder for `BETTER_AUTH_SECRET`. The chart gives the job `openokr.commonEnv`: the two database addresses, the encryption key and `NODE_ENV`, but not the auth secret. So every scheduled run stops with "BETTER_AUTH_SECRET: is still the development placeholder". OKRGoal's first run, on 10 November 2026, failed this way. Nothing is erased by mistake, but closed workspaces past their retention window are never erased at all. `deploy/helm/check.sh` checks the job's command and database address, not that the job can start. Compose is not affected, because `./openokr erase` runs in the application container with its full environment | `deploy/helm/templates/erasure-cronjob.yaml`, `deploy/helm/templates/_helpers.tpl` (`openokr.commonEnv`), `packages/core/src/bin/cloud-erase.ts` | Give the job `BETTER_AUTH_SECRET` from the Secret the web pods read it from, or have `cloud-erase.ts` check only the variables it uses. Add a check to `check.sh` that every job the chart renders gets every variable its command requires | S | Run `sh deploy/helm/check.sh` |

### 3.2 Decision

| # | Question | Options | Recommended |
|---|---|---|---|
| Q6 | What happens to a workspace with no plan on an instance that has a catalogue? | **(a)** Nothing automatic. The console says what having no plan costs, and offers O2's one action. **(b)** `pnpm cloud:adopt`, which the scheduler runs hourly, puts every workspace with no plan on the default plan by itself. **(c)** As today: the operator sets plans one at a time on S-46 | **(a).** (b) puts a seat limit on workspaces that never had one without anybody choosing it, and has to decide what to do with a workspace that already has more people than the plan allows. (c) is what left OKRGoal's workspaces without AI unnoticed |

### 3.3 What the specification gains when these are built

| Row | Pages |
|---|---|
| O1 | `docs/design/ai-credits.md` §3 and §9: what a reader is shown for each reason AI is off |
| O2 | `docs/design/ai-credits.md` §3; UIUX-PLAN §6, S-45 and S-46 |
| O3 | `docs/design/workspace-erasure.md` §7, the environment the job needs |

## 4. Suggested order

1. C1, early in the release, because a migration that refuses on bad data is best met on a test instance first.
2. O3 and O1. Both are small, need no design, and fix what a running cloud instance gets wrong today.
3. Y1 and Y2. They need no design, and they answer "who am I signed in as" and "where do I change my details".
4. The design for Y3 to Y6, then the code, one row each.
5. Q6, then O2's design and code.
6. The design for Y7 and Akmal's answers to its questions, then the code. Last, because it is the largest and the only one that cannot be undone.

## 5. Build log

Statuses: **to do**; **design written**, waiting for "design approved"; **design approved**; **done**, committed and the local tier green; **yours**, a decision or action only you can take.

| Row | Status | Note |
|---|---|---|
| C1 | to do | |
| Y1 | to do | |
| Y2 | to do | |
| Y3 | to do | |
| Y4 | to do | |
| Y5 | to do | |
| Y6 | to do | |
| Y7 | to do | Design first; questions Y7-1 to Y7-6 |
| O1 | to do | |
| O2 | to do | Design first; waits on Q6 |
| O3 | to do | |
| Q1 to Q5 | decided | 10 November 2026, section 2.3 |
| Q6 | yours | Section 3.2 |
