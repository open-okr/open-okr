# Plan: release 0.8.0

Owner: Akmal. Started 10 November 2026, the day 0.7.0 was published, against `main` at `8058c955`.

This plan grows as changes are named for 0.8.0. So far it holds nine things:

1. **Carried from 0.7.0**: the second half of a change that has to span two releases. Section 1.
2. **Your account**: a page where a person sees and changes what is theirs, and an avatar menu that says who is signed in. Section 2. Asked for by Akmal on 10 November 2026: name, email, username, password and timezone in one place, and the menu naming the person and their role. Akmal answered its five questions the same day (section 2.3). Nothing is built yet.
3. **Found running OKRGoal**: three faults found on 10 November 2026 while finding out why the copilot on OKRGoal said "AI off". Section 3. One waits on a decision (Q6).
4. **A demo instance says so**: a Demo pill on sign-in and in the top bar. Section 4. Asked for by Akmal on 10 November 2026.
5. **Which version is running, and whether a newer one exists**: the version for every member, and the update notice for a cloud's operator. Section 5. Asked for by Akmal on 10 November 2026, after upgrading OKRGoal to 0.7.0 and seeing no version on any of the three instances. Two decisions (Q7, Q8).
6. **"Still needed here" leads to the field**: each item on a phase's list opens the place where it is filled in. Section 6. Asked for by Akmal on 10 November 2026.
7. **Screen layout**: layouts that waste space or squeeze content. Section 7. The first, Phase 1's Roles and Suggested timeline, asked for by Akmal on 10 November 2026.
8. **After sign-up**: a page that says to check your email, and a welcome page when the link is opened. Section 8. Asked for by Akmal on 10 November 2026.
9. **The product tour on first sign-in**: a Start tour or Skip tour dialog, then one step at a time with the step's area lit and the rest dimmed. Section 9. Asked for by Akmal on 10 November 2026, with tour.niazmorshed.dev as the example. One decision (Q9).

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

## 4. A demo instance says so

Today the only sign that an instance is a demonstration is the persona panel on sign-in, and that panel is hidden when no persona is listed. Once somebody is signed in, nothing on any screen says the instance is a demo that is rebuilt on a schedule. `OPENOKR_DEMO=on` already marks a demo instance (`deploy/demo/compose.demo.yaml`), and today only `/api/demo-personas` reads it.

| # | Change | Size | Gate |
|---|---|---|---|
| D1 | **A Demo pill on sign-in and in the top bar whenever `OPENOKR_DEMO` is `on`.** A chip reading **Demo**, in the `info` tone, beside the heading of the sign-in card and in the top bar just after the breadcrumb, on every screen that has the top bar. It does not shrink with the breadcrumb, so it stays at phone width. Hovering or focusing it shows "This is a demonstration instance. It is rebuilt on a schedule and nothing in it is real.", and that sentence is its accessible name, so a screen reader hears it once. It reads the existing variable and nothing else: no new setting, and an instance with the flag off looks exactly as it does today. The sign-in page learns the flag from `/api/demo-personas`, whose answer gains `demo`, true or false. The shell reads `loadEnv()` on the server, and `packages/ui/src/shell/topbar.tsx` gains one slot for the chip. Y1's **Demo account** chip in the avatar menu stays, because it is about the account and this one is about the instance. The two comments that say nothing else reads the variable, in `deploy/demo/compose.demo.yaml` and `apps/web/app/api/demo-personas/route.ts`, are updated | S | None |

The specification gains it in UIUX-PLAN §3 (the top bar) and S-35 (sign-in), and `docs/install/demo.md` says what the flag now shows.

## 5. Which version is running, and whether a newer one exists

### 5.1 What exists

The version footer shipped in 0.5.0 (`docs/design/version-footer.md`). The footer band at the foot of every signed-in screen shows `vX.Y.Z` on the right, and beside it a "vX.Y.Z available" link to the GitHub release when the instance is behind. Two decisions of 2 November 2026 decide who sees it, and between them they hide it on all three OKRGoal instances:

| Decision (design §1) | Effect |
|---|---|
| Only members with `full` on the workspace see a version. A version string is reconnaissance, so nobody else sees one | A member, a viewer or a guest sees no version. On a demo nobody sees one, because every persona is a member and only the demo's owner account is an administrator |
| A managed cloud shows the running version only, with no check and no notice, because the operator upgrades, not the customer | Nobody on a cloud is ever told a newer release exists, the operator included. The operator console shows no version at all |

The footer reads `apps/web/lib/version-footer.tsx` (the `full` gate and the cloud rule) and `apps/web/lib/update-check.ts` (one request a day to GitHub's public release API, carrying nothing about the instance).

### 5.2 Changes

| # | Change | Size | Gate |
|---|---|---|---|
| V1 | **Every signed-in member sees the running version** in the footer band, as `vX.Y.Z`. The "vX.Y.Z available" link stays for administrators only, because only they can act on it. Signed-out pages still show no version. The unit test that asserts a member sees none (`apps/web/test/version-footer.test.ts`, "is nothing for a member without full access") changes with it | S | Q7 |
| V2 | **A cloud's operator sees which release is newest.** The operator console's Instance screen (S-47) shows the running version and, when a newer release exists, a chip linking to the release and to the upgrade notes in `docs/runbooks/upgrade.md`. The check runs for the operator only: a customer on a cloud still sees no notice. `instance.updateCheck` and `OPENOKR_UPDATE_CHECK` keep their meaning, and on a cloud they now switch the operator's check rather than being ignored | S | Q8 |

### 5.3 Decisions

| # | Question | Options | Recommended |
|---|---|---|---|
| Q7 | Who sees the running version? | **(a)** Every signed-in member, the update link for administrators only (V1). **(b)** As today, administrators only. **(c)** Everybody, signed-out pages included | **(a).** A signed-in member already knows which product they are using, and "which version are we on" is a fair question from anyone reporting a problem. (c) gives the version to anybody scanning for instances behind a known fault, which is why it was hidden in the first place |
| Q8 | Should a cloud's operator be told a newer release exists? | **(a)** Yes, on the console's Instance screen (V2). **(b)** As today, nobody on a cloud | **(a).** The design kept the notice from customers because they cannot upgrade; the operator can, and today learns of a release only from GitHub |

### 5.4 What the specification gains when these are built

| Row | Pages |
|---|---|
| V1 | `docs/design/version-footer.md` §1 and §3; UIUX-PLAN §3, the footer band |
| V2 | `docs/design/version-footer.md` §1; UIUX-PLAN §6, S-47; TECHNICAL-PLAN §4.14, what `instance.updateCheck` switches on a cloud |

## 6. "Still needed here" leads to the field

### 6.1 What happens today

Each phase on the cycle screen (S-04 to S-08 and the phases after them) lists what the phase still needs under **Still needed here**: "No sponsor named", "Input pack item 3 is missing: KPI dashboard or baseline health metrics", "The input pack has not been distributed". The list is plain text. Nothing says where each item is filled in, and some are filled further down the same page, some on another screen, and some only by somebody else.

Why it is plain text:

| Fact | Where |
|---|---|
| Each item is a sentence and nothing more. The method package builds the list per phase as strings, and the workflow action passes them on as `missing: string[]` | `packages/method/src/workflow.ts` (`phaseZero` to `phaseSeven`), `packages/core/src/actions/cycle-workflow.ts` |
| The page prints the sentences and cannot tell which field each belongs to | `apps/web/app/cycle/page.tsx`, the `phase.missing` list |
| No card on the cycle page has an anchor to link to | `apps/web/app/cycle/input-pack.tsx`, `apps/web/app/cycle/phase-forms.tsx` and the other phase cards |
| Some items can only be filled by somebody else. On Phase 1, the Roles and planning sessions card, which names the sponsor and the facilitator, is drawn only for a member with Full on the workspace, which with the built-in roles is the Owner alone. Everybody else sees "No sponsor named" and has nowhere to go | `apps/web/app/cycle/page.tsx` (`canPublish`), `packages/core/src/access/roles.ts` |

### 6.2 Change

| # | Change | Size | Gate |
|---|---|---|---|
| F1 | **Every item under Still needed here is a link to the place that fills it.** Each item gains a stable key beside its sentence, from the method package, for every phase from 0 to 7. The workflow action returns the keys as a new field next to `missing`, which keeps its sentences unchanged for API clients. The cycle page maps each key to its destination. Clicking an item scrolls to the card, focuses the field and outlines it briefly. Where the field is on another screen, such as a goal whose draft fails a rule, the item links to that screen. **An item the reader cannot fill is not a link.** It says who can instead, for example "The workspace owner names the sponsor", so nobody is sent to a card they cannot see. The sentences, the rules behind them and METHOD.md do not change. The contract is regenerated, since the action gains a field | M | None |

Phase 1, the screen in the request, as an example:

| Item | Goes to |
|---|---|
| No sponsor named, No facilitator named | Roles and planning sessions: the Sponsor or Facilitator picker. For a reader without Full on the workspace, "The workspace owner names the sponsor" (or facilitator) instead of a link |
| Input pack item *n* is missing | Input pack: item *n*'s row |
| The input pack has not been distributed | Input pack: the Distribute button |
| No session dates are booked | Roles and planning sessions: the session dates |
| The pack reached people too late | Roles and planning sessions: the session dates, the one thing that can still change |

The other phases follow the same rule. The table of every item, its key and its destination is written as the first part of the change, under UIUX-PLAN S-04, since no design document covers the cycle workspace.

Out of scope, and made possible by the keys: the sentences come from the method package in English only, so the Malay interface shows them in English today. With a key per item, the screen could translate them.

### 6.3 What the specification gains

| Row | Pages |
|---|---|
| F1 | UIUX-PLAN §6, S-04: Still needed here is a list of links, and what an item the reader cannot fill shows; the table of item keys and destinations |

## 7. Screen layout

| # | Problem | Where | Change | Size | Gate |
|---|---|---|---|---|---|
| L1 | **Phase 1's Roles and Suggested timeline waste one card and squeeze the other.** From the medium breakpoint up the two cards sit side by side at half the width each. Roles holds two short entries, the sponsor and the facilitator, so most of its card is empty. The timeline's When column never wraps, so its longest entry, "Weeks 1 to 2 of the quarter", sets the column's width, and Activity is left two or three words to a line | `apps/web/app/cycle/input-pack.tsx`: the `grid md:grid-cols-2` around the two cards, and `whitespace-nowrap` on the When cell | **Stack them at every width**: Roles full width on top, Suggested timeline full width below. Inside Roles, on a wide screen, the sponsor and the facilitator sit side by side, so the card stays two lines tall rather than becoming a tall narrow column. The When column gets a fixed share of the table and may wrap, and Activity takes the rest. At phone width nothing changes, because the cards already stack there. Mockup 02 (`docs/mockups/src/02-cycle-workspace.html`) draws a narrow roles column beside the timeline, and is redrawn to match in the same change | S | None |

## 8. After sign-up

### 8.1 What happens today

On an instance that can send mail, a new account must confirm its email before it can sign in. Read from the code on `main` and Better Auth 1.7, not tried on a running instance:

| Step | Today | Where |
|---|---|---|
| The person presses Create account | The account is made and the verification mail is sent, but the form sends everybody to the home page whatever happened. With verification required there is no session, so they bounce to sign-in with no word about the mail | `apps/web/app/(auth)/sign-up/sign-up-form.tsx` (`router.push("/")`) |
| They try to sign in before confirming | "Confirm your email first". The only hint anywhere that a mail was sent | `apps/web/app/(auth)/sign-in/page.tsx` (`EMAIL_NOT_VERIFIED`) |
| They open the link | Better Auth confirms the address and redirects to the address sign-up gave it. Sign-up gives none, so it is the home page, then sign-in again, with no welcome and no sign that anything worked | Better Auth's `/api/auth/verify-email`; `signUp.email` is called with no `callbackURL` |
| The link has expired or is not valid | Better Auth adds `?error=TOKEN_EXPIRED` or `INVALID_TOKEN` to that same home page address, and nothing reads it. The link lasts one hour, Better Auth's default, because OpenOKR sets none | `emailVerification` in `packages/core/src/auth/auth.ts` (no `expiresIn`) |
| They want a new link | Nothing offers one. The address is taken, so signing up again is refused, and the account stays unconfirmed for good | |

On an instance that cannot send mail nothing changes: verification is not required, sign-up signs the person in, and they go straight to onboarding.

### 8.2 Changes

| # | Change | Size | Gate |
|---|---|---|---|
| S1 | **"Check your email" after sign-up**, where verification is required. Instead of the home page, the form opens a page on the same auth card: the account is created, a link has gone to the address they typed, open it to confirm, how long the link lasts, look in spam, and a way back to sign-in. The address is carried in the page's own state, never in the address bar. Where verification is not required, sign-up goes on to onboarding as today | S | None |
| S2 | **A welcome page when the link is opened.** Sign-up passes Better Auth a return address, a new signed-out page such as `/welcome`, which the proxy lets through without a session. With no error it says "Welcome to *instance name*. Your email is confirmed." with a Sign in button. An already confirmed address gets the same page, because Better Auth sends it there with no error. `TOKEN_EXPIRED` says the link has expired, and `INVALID_TOKEN` and the other errors say it is not valid. Both say what to do next, which is S3's "send a new link" once that is built. Links sent before 0.8.0 still lead to the home page | S | None |
| S3 | **Send the link again**, on the check-your-email page, on S2's expired page, and beside "Confirm your email first" on sign-in. The answer is the same whether or not the address has an account, so the form cannot be used to find out who has one, and it is rate limited per address and per network. The design also decides how long a link lasts, one hour today, and the page in S1 says whatever it decides. **This is H1 of the hosting draft** (`docs/plans/release-0.8.0.md` on branch `docs/release-0.8.0-plan`, not merged), which also sends the mail through the outbox so a failed send never fails sign-up. Whichever plan merges first carries it, and the other drops its row | M | Design first: authentication and account enumeration |

S1 and S2 need no design and can ship first. Until S3 lands, the expired page can only say to ask the workspace's administrator or the instance's support address.

### 8.3 What the specification gains

| Row | Pages |
|---|---|
| S1, S2 | UIUX-PLAN §6, S-35: the check-your-email card and the welcome page with its error states |
| S3 | TECHNICAL-PLAN §8, the resend endpoint and the link lifetime; S-35 |

## 9. The product tour on first sign-in

### 9.1 What exists

S-34 has had a first-visit tour since completeness review L-08: five stops, the Work Map, the review inbox, a check-in, the cycle strip and ⌘K. Read from the code on `main`:

| Fact | Where |
|---|---|
| **It is a card in the page, not an overlay**, by a recorded choice: "the card sits in the page's own flow and traps nothing", so nobody is held in a dialog on their first visit | `apps/web/app/first-visit-tour.tsx`, UIUX-PLAN S-34 |
| **It is drawn only on the Work Map.** Since the role homes (`docs/design/role-homes.md`) every member lands on My week, and the tour went with the map to `/map`. A member who never opens Goals, then Map, never sees it. Administrators, space coordinators and managers get the Work Map on their home, under My week and Rhythm by team, so their tour sits a screen or more down the page | `apps/web/app/work-map-screen.tsx`, `apps/web/app/(home)/page.tsx` (`runsCycle`) |
| Each stop outlines the thing it names with a CSS outline. Nothing is dimmed | `apps/web/app/globals.css` (`data-tour-stop`) |
| Finishing and ending early are one write on the member's own row, so it is never offered again, on any machine | `packages/core/src/actions/tour.ts` (`people.finishOwnTour`, `workspace_members.tour_finished_at`) |

The example, `shadcn/tour` (MIT), is a shadcn registry component. It needs `motion` and `lucide-react`, which `packages/ui` already has, and shadcn's `alert-dialog` and `button`, which the kit has on Base UI. So it can be adapted through the registry at build time with no new runtime dependency.

### 9.2 Change

| # | Change | Size | Gate |
|---|---|---|---|
| T1 | **A welcome dialog, then a spotlight tour, on the first screen after the first sign-in**, whatever that screen is, so My week gets it too. For the person who creates a workspace it comes after the onboarding setup, finished or dismissed, never on top of it. The dialog: "Welcome to *instance name*", one line on what the tour shows, **Start tour** and **Skip tour**. **Skip tour ends the tour for good**: the same `people.finishOwnTour` write as today, and Escape does the same. **Start tour** shows the steps one at a time, each with its number ("2 of 6"), Back, Next and Skip tour. The step's area is lit and everything else is dimmed and cannot be clicked until the tour ends. The step's card sits beside the area, and the area is scrolled into view first. A step whose area is not on screen, such as the cycle strip outside planning or the search box on a phone, is left out rather than pointing at nothing. Finishing the last step is the same write. **One tour, not two**: the Work Map card is removed, and a member who finished or ended the old tour is not offered the new one. **Take the tour again** in the avatar menu starts it once more, so an early Skip is never final. That entry is an addition to the request, and can be dropped. **On a demo** (`OPENOKR_DEMO=on`) a persona is shared by every visitor, so the first visitor's Skip would end it for everyone after them. There the choice is remembered in the browser rather than on the member. Accessibility: the dialog and each step are dialogs that hold focus and give it back where it was, the step number is announced, the keyboard does everything (Tab, Enter, Escape, the arrow keys for Back and Next), and with reduced motion the spotlight moves without animating | M | None. UIUX-PLAN S-34 changes with it, since it reverses L-08's card-not-overlay choice. §9's quality gates apply, and `e2e/s43b-accessibility-keyboard.spec.ts` gains the tour |

### 9.3 Decision

| # | Question | Options | Recommended |
|---|---|---|---|
| Q9 | Which steps? | **(a)** S-34's five, pointed at what the shell shows on every screen: Home, where check-ins are; Updates, what you owe; Goals, the company map; the cycle strip, while a cycle is being planned; and Search with ⌘K. Ask AI is added when the copilot can answer. **(b)** A new list, such as the shell in order from the workspace switcher down, as in the example | **(a).** S-34 already says what a new member needs to find, and every step is on every screen, so the tour never has to change page |

### 9.4 What the specification gains

| Row | Pages |
|---|---|
| T1 | UIUX-PLAN §6, S-34: the welcome dialog, the spotlight, when it is offered, Take the tour again, the demo rule; §7, the tour's focus handling; `docs/design/role-homes.md`, which says the tour moved with the map |

## 10. Suggested order

1. C1, early in the release, because a migration that refuses on bad data is best met on a test instance first.
2. O3 and O1. Both are small, need no design, and fix what a running cloud instance gets wrong today.
3. S1 and S2, then S3's design. Every new person on a cloud meets them first.
4. Q9, then T1. It is what that new person sees next.
5. Y1, Y2 and D1. They need no design, and they answer "who am I signed in as", "where do I change my details" and "is this a demo".
6. F1 and L1. No design, and both are on Phase 1, the screen every cycle starts on: F1 answers "where do I fill this in", L1 makes the page easier to read.
7. The design for Y3 to Y6, then the code, one row each.
8. Q6, then O2's design and code.
9. Q7 and Q8, then V1 and V2. Both are small once decided.
10. The design for Y7 and Akmal's answers to its questions, then the code. Last, because it is the largest and the only one that cannot be undone.

## 11. Build log

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
| D1 | to do | |
| V1 | to do | Waits on Q7 |
| V2 | to do | Waits on Q8 |
| F1 | to do | |
| L1 | to do | |
| S1 | to do | |
| S2 | to do | |
| S3 | to do | Design first; the same as the hosting draft's H1 |
| T1 | to do | Waits on Q9 |
| Q1 to Q5 | decided | 10 November 2026, section 2.3 |
| Q6 | yours | Section 3.2 |
| Q7, Q8 | yours | Section 5.3 |
| Q9 | yours | Section 9.3 |
