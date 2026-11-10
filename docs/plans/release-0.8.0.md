# Plan: release 0.8.0

Owner: Akmal. Started 10 November 2026, the day 0.7.0 was published, against `main` at `8058c955`.

This plan grows as changes are named for 0.8.0. So far it holds ten things:

1. **Carried from 0.7.0**: the second half of a change that has to span two releases. Section 1.
2. **Your account**: a page where a person sees and changes what is theirs, and an avatar menu that says who is signed in. Section 2. Asked for by Akmal on 10 November 2026: name, email, username, password and timezone in one place, and the menu naming the person and their role. Akmal answered its five questions the same day (section 2.3), and Y7's six (section 2.5). Nothing is built yet.
3. **Found running OKRGoal**: what deploying OKRGoal on 9 and 10 November 2026 found (H1 to H15), and three faults found while finding out why its copilot said "AI off" (O1 to O3). Section 3. The H rows were a separate draft until 10 November 2026, merged here. Q6 decided the same day.
4. **A demo instance says so**: a Demo pill on sign-in and in the top bar. Section 4. Asked for by Akmal on 10 November 2026.
5. **Which version is running, and whether a newer one exists**: the version for every member, and the update notice for a cloud's operator. Section 5. Asked for by Akmal on 10 November 2026, after upgrading OKRGoal to 0.7.0 and seeing no version on any of the three instances. Q7 and Q8 decided the same day.
6. **"Still needed here" leads to the field**: each item on a phase's list opens the place where it is filled in. Section 6. Asked for by Akmal on 10 November 2026.
7. **Screen layout**: layouts that waste space, squeeze content or hide the next step. Section 7. Phase 1's Roles and Suggested timeline, and the Work Map's Start drafting, both asked for by Akmal on 10 November 2026.
8. **After sign-up**: a page that says to check your email, and a welcome page when the link is opened. Section 8. Asked for by Akmal on 10 November 2026.
9. **The product tour on first sign-in**: a Start tour or Skip tour dialog, then one step at a time with the step's area lit and the rest dimmed, ending with Start drafting OKRs. Section 9. Asked for by Akmal on 10 November 2026, with tour.niazmorshed.dev as the example. Q9 decided the same day.
10. **Who may set up a cycle**: an Admin can create a cycle and name its sponsor and facilitator, which today only the Owner can. Section 10. Agreed by Akmal on 10 November 2026.

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
| Y7 | **Delete your own account** (Q4), from the foot of Your account. The person confirms with their password, or a fresh sign-in for an account with none, and is offered their data export first, the one already on Security. It runs the erasure an administrator's `people.erase` runs today (`packages/core/src/people/erasure.ts`) in every workspace they belong to: what they wrote stays, attributed to a placeholder, and what identifies them goes, from channel identities and tokens to passkeys, sessions and the text of messages addressed to them. Once no membership is left, the account goes too, as `eraseAccountIfAlone` already does. Refused, naming the workspace and the handover to do first, while they are the last full-access holder of any workspace (`isLastFullAccessHolder`). Refused on a demo account, whose password is published, so any visitor could delete Priya. A mail to the address says it is done. Written to each workspace's audit chain and to the instance chain. The design follows the answers in section 2.5 | L | Design first: security, access and stored user data |

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

### 2.5 What Y7's design follows

Akmal answered all six on 10 November 2026, each as recommended. The design note writes them down and still needs "design approved" before Y7's code.

| # | Question | Decided |
|---|---|---|
| Y7-1 | Straight away, or after a waiting period in which signing in again cancels it? | **After 14 days.** The account is signed out everywhere at once, signing in again within the 14 days cancels the deletion, and a mail goes to the address when it starts and the day before it runs. It guards against a mistake and against somebody who took the password deleting the account. Within the month that erasure is expected to take |
| Y7-2 | A member a directory (SCIM) manages: refused, because the directory would provision them again, or allowed? | **Refused**, with the reason: "Your organisation's directory manages this account. Ask your administrator." The directory's next sync would bring the account back |
| Y7-3 | The only member of a workspace is its last full-access holder, so Y7 refuses them. Does the workspace close with them instead, or must they close it first? | **They hand it over or close it first.** The refusal names the workspace and links to both. Deleting an account never closes a workspace as a side effect. On a self-hosted instance, which has no owner's close, the last owner hands the workspace over, or the instance's operator deals with it |
| Y7-4 | If one workspace's erasure fails partway, does the deletion resume from a ledger the way `pnpm cloud:erase` does, and what does the person see meanwhile? | **Yes, from a ledger**, resumed by the next scheduled run. The person is signed out and sees "Your account is being deleted" if they come back, and a mail says when it is done |
| Y7-5 | Goals they champion and reviews they owe pass to the placeholder. Are the workspace's administrators told, and is anything handed to their manager? | **Nothing is handed to anybody by itself.** The administrators and the person's manager get one inbox notice listing the goals, key results and reviews that now need an owner. Making somebody the owner of goals without asking is worse than asking |
| Y7-6 | Is an administrator told when a member deletes their own account, and does the inbox carry it? | **Yes, by Y7-5's notice**, so it is one message, not two. A new kind of inbox notice, approved here |

## 3. Found running OKRGoal

OKRGoal was deployed on 9 and 10 November 2026: OpenOKR on Kubernetes (EKS), with PostgreSQL on a managed service (RDS), files on S3 and Cloudflare in front of a cloud load balancer. That was the first time the product ran with several replicas behind two proxies, on a managed database, with nothing on the host's disk. Every row in this section is a place where it did not work as shipped, or worked only because of a workaround outside the product.

They come from two drafts, merged here on 10 November 2026:

| Rows | Where they came from |
|---|---|
| H1 to H14 | Deploying OKRGoal. First drafted on branch `docs/release-0.8.0-plan` (commit `db9ac099`, never pushed) and checked against `main` at `2b221bdb`, after 0.7.0. The chart changes merged since, the `--reuse-values` fallbacks of #201, touch none of them. Merged unchanged, except H1, which S3 in section 8 now carries |
| H15 | The chart's install notes, found while upgrading OKRGoal to 0.7.0 |
| O1 to O3 | Finding out why OKRGoal's copilot said **AI off** although its key was set and worked, checked against `main` at `8058c955` |

Release 0.7.0 already fixed two of the deployment's original findings: it counts the sign-in limits in Postgres across replicas, and it no longer needs `APP_BUILD_ID` set.

### 3.1 Sign-up and the first account

These decide whether a stranger can create an account on a cloud instance at all.

| # | Problem | Where | Proposed fix | Size | Gate |
|---|---|---|---|---|---|
| H1 | **A person whose verification email failed is stuck for good.** The verification mail is sent inside the sign-up request, so when the mail server refuses it the person sees an error after their account already exists. Signing up again says the address is taken, signing in says to verify first, and nothing offers the link again. Found while SES was still in its sandbox and refused every unverified recipient | `apps/web/lib/auth.ts` (`sendVerificationEmail`), `packages/core/src/auth/auth.ts` (`emailVerification`, no `sendOnSignIn`) | **Carried by S3** (section 8): the mail goes through the outbox, so a refused mail never fails sign-up and is retried, and "send the link again" is offered | See S3 | See S3 |
| H2 | **Behind a CDN and a load balancer, every visitor shares one sign-in bucket.** `X-Forwarded-For` is trusted only when it holds one address, and a CDN followed by a load balancer always leaves a chain, so every caller resolves to `unresolved`. Cloudflare will not set `X-Real-IP` for an origin, so the second header cannot help either. Sessions record no address, and one person can use up the sign-in and sign-up limits for everybody. OKRGoal holds this off with a per-visitor rate limit at Cloudflare | `packages/core/src/auth/caller-address.ts` (`CALLER_ADDRESS_HEADERS`, no `trustedProxies`) | A setting naming the proxies in front of the instance, as address ranges, passed to Better Auth's `trustedProxies` and used by `callerAddress` the same way, so the chain is read from the right up to the first untrusted hop. Optionally a header to trust instead, such as `CF-Connecting-IP`, for an origin that only the CDN can reach. Document both for Compose, Kubernetes and a CDN | M | Design first: security |
| H3 | **`OPENOKR_REGISTRATION=invite_only` makes an instance impossible to claim.** The variable is enforced before any account exists, so the setup wizard's sign-up is refused. The form then falls through to signing in, and the person sees "Invalid email or password" for an account that was never created | `packages/core/src/workspaces/registration.ts` (`readRegistrationPolicy`), `apps/web/app/setup/account/setup-account-form.tsx` | An unclaimed instance lets the first account through whatever the variable says, because the wizard is the claim. The wizard shows a refused sign-up as itself, and never falls through to sign-in | S | Design first: `docs/design/registration-policy.md` |
| H4 | **An unclaimed cloud instance sends its first visitor to sign-in, not to setup.** The plain address redirects to `/sign-in`, which has no account to sign into, and nothing on it mentions `/setup` | The root redirect; seen with the cloud flag on and no account | While the instance is unclaimed, send the root to `/setup` with the cloud flag on, as without it | S | None |

### 3.2 Database

| # | Problem | Where | Proposed fix | Size | Gate |
|---|---|---|---|---|---|
| H5 | **With pgvector installed, migrations stop at 0031.** It turns `embeddings.embedding` into a `vector` with no dimensions and then builds an HNSW index on it, which pgvector refuses ("column does not have dimensions"). The test stack's Postgres has no pgvector, so CI only ever takes the other branch. OKRGoal runs with the extension removed, so search uses the full-text fallback | `packages/db/migrations/0031_embeddings.sql`, the `alter column ... type vector` and `create index ... using hnsw` statements | Build the index only once the column has the dimensions of the embedding model in use, or not at all until then; decide whether 0031 itself may change, since every instance with pgvector failed at it and none can have applied it. Add a CI leg on a Postgres image with pgvector, so the branch is tested | M | Design first: schema. Changing 0031 is Akmal's decision |
| H6 | **A managed Postgres's certificate cannot be checked.** The pool hands `DATABASE_URL` to node-postgres, whose current connection-string parser treats `sslmode=require` as full verification against Node's own trust store, which does not hold a cloud database's authority (RDS, for one). The chart cannot mount a bundle, so the only working choice is `sslmode=no-verify`: encrypted, unchecked | `apps/web/lib/pool.ts`, `deploy/helm/templates/deployment.yaml` | A chart value that mounts a CA bundle from a Secret or ConfigMap and points `NODE_EXTRA_CA_CERTS` at it, for the server, the migration job and every job. Document `sslmode=verify-full` with it for RDS, Cloud SQL and Azure | S | Run `sh deploy/helm/check.sh` |
| H7 | **No direct connection for what cannot sit behind a transaction pooler.** The listener for live updates, pg-boss and the session-level advisory locks taken during workspace provisioning all use `DATABASE_URL`, so PgBouncer in transaction mode breaks them. There is no read-replica routing either. Not needed until a deployment outgrows one database's connections | `apps/web/lib/realtime.ts`, `packages/adapters/src/drivers/jobs/pg-boss.ts`, `packages/core/src/workspaces/provisioning.ts` | A second connection setting for those three, defaulting to `DATABASE_URL`. Read routing is a separate, later design | L | Design first |

### 3.3 The Helm chart

O3, the erasure job, is in 3.5 with the other two found the same day.

| # | Problem | Where | Proposed fix | Size | Gate |
|---|---|---|---|---|---|
| H8 | **With `database.existingSecret` set, the migration job cannot start.** `commonEnv` reads `DATABASE_ADMIN_URL` from a Secret named `<release>-database` whenever `database.adminUrl` is set, but the chart renders that Secret only when `database.existingSecret` is empty. OKRGoal supplies a Secret of that exact name itself and sets `adminUrl` to a placeholder | `deploy/helm/templates/_helpers.tpl` (`openokr.commonEnv`), `deploy/helm/templates/secrets.yaml` | `database.existingSecretAdminKey`: read the admin address from the existing Secret under that key. Refuse at render time the combination that cannot work. Add both to `deploy/helm/check.sh` | S | Run `sh deploy/helm/check.sh` |
| H9 | **File storage on S3 needs a long-lived access key.** The schema requires both keys once a bucket is named, the driver always passes them, and the chart requires `storage.s3.existingSecret`. Workload identity (EKS Pod Identity, IRSA, an instance profile) cannot be used | `packages/config/src/env.ts`, `packages/adapters/src/drivers/storage/s3.ts`, `deploy/helm/templates/_validate.tpl` | With no key set, let the AWS SDK's default credential chain decide. Make the chart's Secret optional for S3 and document the service-account annotation | S | Run `sh deploy/helm/check.sh` |
| H10 | **Web and background work cannot scale apart, and nothing runs the data changes.** The chart has one Deployment, no autoscaler, no pre-stop pause and no termination grace period, and the relay and the scheduler stop on SIGTERM without draining. The data-change runner is not in the chart at all, so every upgrade needs somebody to run it by hand | `deploy/helm/templates/deployment.yaml`, `apps/web/lib/relay.ts`, `apps/web/lib/scheduler.ts` | A worker Deployment running the relay and the scheduler, with the web Deployment's two flags off; an optional autoscaler on the web Deployment; a pre-stop pause and a grace period; draining on SIGTERM; a post-upgrade hook that runs the data changes. Split into rows when designed | L | Design first: deployment shape |
| H15 | **The install notes warn that uploads go to an emptyDir when they go to S3.** With `storage.s3.bucket` set and persistence off, the notes said uploaded files go to an emptyDir, are lost on restart and are invisible across replicas, and told the operator to turn persistence on. With persistence on, they said the release is pinned to one replica, which a bucket lifts. `check.sh` never rendered the notes, because `helm template` skips them, so it grepped the file and passed whatever the condition around the warning said. Seen on every OKRGoal upgrade | `deploy/helm/templates/NOTES.txt`, `deploy/helm/check.sh` | The notes say the files are kept in the named bucket, and keep both volume notes for installs without one. `check.sh` renders the notes with a client-side dry run and checks both directions | S | Run `sh deploy/helm/check.sh`. **Done** on branch `fix/helm-notes-object-storage`, commit `84f85321`, not pushed |

### 3.4 Smaller things

| # | Problem | Where | Proposed fix | Size | Gate |
|---|---|---|---|---|---|
| H11 | **Live streams go quiet and get cut.** The inbox, feed and copilot streams send one heartbeat when they open. A load balancer's idle timeout (60 seconds on AWS) or a CDN's (about 100 on Cloudflare) then closes them, and every open tab reconnects about once a minute | `apps/web/app/api/inbox/live/route.ts`, `feed/live`, `copilot/live` | A heartbeat every 25 seconds on every stream | S | None |
| H12 | **`/api/status` reports the scheduler of whichever pod answers.** The heartbeat lives in that process's memory, so behind a load balancer the answer depends on the pod, and a pod with the scheduler off reports it as operational. A status page reading it can be wrong either way | `apps/web/lib/scheduler.ts`, `apps/web/app/api/status/route.ts` | Store the heartbeat in Postgres and read it from there | S | None |
| H13 | **Uploads stop at 8 MB although files may be 25 MB.** The server-action body limit is lower than the blob limit | `apps/web/next.config.ts`, `packages/core/src/blobs/validation.ts` | Make them agree, and say the real limit on the upload control | S | None |
| H14 | **The OpenTelemetry exporter cannot send an auth header,** so it cannot reach most hosted collectors without a collector of one's own in between | `packages/adapters/src/drivers/telemetry/otel.ts`, `apps/web/lib/telemetry.ts` | Honour `OTEL_EXPORTER_OTLP_HEADERS`, as the OpenTelemetry convention names it | S | None |

### 3.5 AI on a cloud with plans, and the erasure job

OKRGoal ran 0.6.0 with a plan catalogue (Free, Team and Business) and the provider's own AI key. On 10 November 2026 its copilot said **AI off** although the key was set and worked. The cause was that its workspaces had no plan, and on an instance with a catalogue a workspace with no plan may not use the provider's key (`docs/design/ai-credits.md` §3). Looking into it found the erasure job's fault too.

| # | Problem | Where | Proposed fix | Size | Gate |
|---|---|---|---|---|---|
| O1 | **"AI off" gives the wrong reason.** A workspace that may not use the provider's key gets no drafter, so the copilot shows **AI off** and says "No AI provider is configured", the AI settings page shows **Not configured**, and every assist button disappears without a word. The provider is configured. The real cause is the workspace's plan, which only an operator or a purchase can change, and nobody in the workspace is told what to ask for. The copilot already names one plan reason, credits used up for the month, through `creditsPausedReason`, but not this one | `packages/core/src/actions/copilot.ts` (`copilot.availability`), `packages/core/src/copilot/answer.ts`, `packages/core/src/tenancy/credits.ts`, `apps/web/app/admin/ai/page.tsx` | One function in `packages/core` that says why AI is off for a workspace, checked in this order: no provider at all; the provider's key is set but this workspace's plan includes no AI credits; the month's credits are used up (today's sentence, unchanged); the workspace's egress controls let nothing reach the provider; the routed model has no price. The copilot's chip and sentence, the copilot's answer and the AI settings page all show it, with what to do: choose a plan on the Plan page, or add the workspace's own key | S | None |
| O2 | **A catalogue added after workspaces exist takes their AI away, and nobody is told.** A workspace starts on the default plan only if one is set when it is made. OKRGoal set its catalogue and Free as its default after its first workspaces existed, so every one of them has no plan and lost AI on the provider's key when the catalogue went in. The operator console can already filter to workspaces with no plan, but does not say what having none costs them | `packages/core/src/tenancy/plans.ts` (`resolveDefaultPlan`), `pnpm cloud:adopt`, `apps/web/app/operator/page.tsx` (S-45), `apps/web/app/operator/[workspaceId]/page.tsx` (S-46) | As Q6 decided: S-45 and S-46 mark a workspace with no plan, on an instance with a catalogue, as having no AI on the provider's key, and S-45 offers one audited action, "Put every workspace with no plan on the default plan". Before it runs, it lists the workspaces it would refuse because they have more people than the plan's seats | M | Design first: it changes stored tenant data |
| O3 | **The Helm chart's erasure job fails before it starts.** `pnpm cloud:erase` loads the whole server environment, which in production refuses the development placeholder for `BETTER_AUTH_SECRET`. The chart gives the job `openokr.commonEnv`: the two database addresses, the encryption key and `NODE_ENV`, but not the auth secret. So every scheduled run stops with "BETTER_AUTH_SECRET: is still the development placeholder". OKRGoal's first run, on 10 November 2026, failed this way. Nothing is erased by mistake, but closed workspaces past their retention window are never erased at all. `deploy/helm/check.sh` checks the job's command and database address, not that the job can start. Compose is not affected, because `./openokr erase` runs in the application container with its full environment | `deploy/helm/templates/erasure-cronjob.yaml`, `deploy/helm/templates/_helpers.tpl` (`openokr.commonEnv`), `packages/core/src/bin/cloud-erase.ts` | Give the job `BETTER_AUTH_SECRET` from the Secret the web pods read it from, or have `cloud-erase.ts` check only the variables it uses. Add a check to `check.sh` that every job the chart renders gets every variable its command requires | S | Run `sh deploy/helm/check.sh` |

### 3.6 Decision

Akmal decided Q6 on 10 November 2026, as recommended.

| # | Question | Decided |
|---|---|---|
| Q6 | What happens to a workspace with no plan on an instance that has a catalogue? | **Nothing automatic.** The console says what having no plan costs, and offers O2's one action. Not chosen: `pnpm cloud:adopt` putting every workspace with no plan on the default plan by itself, which would put a seat limit on workspaces that never had one without anybody choosing it; and leaving it as today, which is what left OKRGoal's workspaces without AI unnoticed |

### 3.7 What the specification gains when these are built

The H rows marked design first name their design note in the Gate column. The others:

| Row | Pages |
|---|---|
| H6, H8, H9, H15 | `deploy/helm/README.md` and `docs/install/`: the CA bundle, the admin address key, workload identity, and what the notes say about storage |
| H11, H12 | `docs/runbooks/observability.md`: the stream heartbeat and where `/api/status` reads the scheduler from |
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
| V1 | **Every signed-in member sees the running version** in the footer band, as `vX.Y.Z`. The "vX.Y.Z available" link stays for administrators only, because only they can act on it. Signed-out pages still show no version. The unit test that asserts a member sees none (`apps/web/test/version-footer.test.ts`, "is nothing for a member without full access") changes with it | S | None. Q7 decided |
| V2 | **A cloud's operator sees which release is newest.** The operator console's Instance screen (S-47) shows the running version and, when a newer release exists, a chip linking to the release and to the upgrade notes in `docs/runbooks/upgrade.md`. The check runs for the operator only: a customer on a cloud still sees no notice. `instance.updateCheck` and `OPENOKR_UPDATE_CHECK` keep their meaning, and on a cloud they now switch the operator's check rather than being ignored | S | None. Q8 decided |

### 5.3 Decisions

Akmal decided both on 10 November 2026, as recommended.

| # | Question | Decided |
|---|---|---|
| Q7 | Who sees the running version? | **Every signed-in member**, with the update link for administrators only (V1). Not chosen: administrators only, as today; and everybody, signed-out pages included, which gives the version to anybody scanning for instances behind a known fault |
| Q8 | Should a cloud's operator be told a newer release exists? | **Yes, on the console's Instance screen** (V2). Customers still are not, because they cannot upgrade |

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
| No sponsor named, No facilitator named | Roles and planning sessions: the Sponsor or Facilitator picker. For a reader who cannot set them, "The workspace owner names the sponsor" (or facilitator) instead of a link, or "An Owner or an Admin names the sponsor" once R1 lands |
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
| L2 | **The Work Map's empty state hides its one next step in a sentence.** With nothing in the cycle, the Work Map says "Nothing in this cycle yet" and ends "...where every rule is checked as they are written. Start drafting.", with Start drafting as an underlined link in small grey text. It is the only thing to do on the page and the easiest thing on it to miss. It is also drawn for everybody, a viewer included, who cannot draft | `apps/web/app/work-map.tsx`, the `GoalTable`'s `empty` | **Start drafting becomes a primary button** under the sentence, the kit's `buttonVariants({ variant: "primary" })` on the link, keeping its target, Phase 4 of the cycle page (`/cycle?phase=4`). The sentence stays as the explanation above it. It is drawn only for a reader who can edit goals, which the component already knows (`canEdit`). Anybody else gets the sentence alone, ending at "as they are written" | S | None |

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
| S3 | **Send the link again**, on the check-your-email page, on S2's expired page, and beside "Confirm your email first" on sign-in. The answer is the same whether or not the address has an account, so the form cannot be used to find out who has one, and it is rate limited per address and per network. The design also decides how long a link lasts, one hour today, and the page in S1 says whatever it decides. **It carries H1** (section 3.1): the verification mail goes through the outbox, so a mail server that refuses it never fails sign-up, and the send is retried | M | Design first: authentication and account enumeration |

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
| T1 | **A welcome dialog, then a spotlight tour, on the first screen after the first sign-in**, whatever that screen is, so My week gets it too. For the person who creates a workspace it comes after the onboarding setup, finished or dismissed, never on top of it. The dialog: "Welcome to *instance name*", one line on what the tour shows, **Start tour** and **Skip tour**. **Skip tour ends the tour for good**: the same `people.finishOwnTour` write as today, and Escape does the same. **Start tour** shows the steps one at a time, each with its number ("2 of 6"), Back, Next and Skip tour. The step's area is lit and everything else is dimmed and cannot be clicked until the tour ends. The step's card sits beside the area, and the area is scrolled into view first. A step whose area is not on screen, such as the cycle strip outside planning or the search box on a phone, is left out rather than pointing at nothing. **The last step ends with a Start drafting OKRs button** (Q9) that finishes the tour, with the same write, and opens the cycle page, `/cycle`. The cycle page opens on the cycle's current phase, which for a new workspace is Phase 1, Prepare: the step drafting needs first, and F1 shows what is still missing there. For somebody who cannot draft, a viewer for instance, or a guest, whom the cycle page sends to their spaces, the button reads Finish and stays on the page. **One tour, not two**: the Work Map card is removed, and a member who finished or ended the old tour is not offered the new one. **Take the tour again** in the avatar menu starts it once more, so an early Skip is never final. That entry is an addition to the request, and can be dropped. **On a demo** (`OPENOKR_DEMO=on`) a persona is shared by every visitor, so the first visitor's Skip would end it for everyone after them. There the choice is remembered in the browser rather than on the member. Accessibility: the dialog and each step are dialogs that hold focus and give it back where it was, the step number is announced, the keyboard does everything (Tab, Enter, Escape, the arrow keys for Back and Next), and with reduced motion the spotlight moves without animating | M | None. UIUX-PLAN S-34 changes with it, since it reverses L-08's card-not-overlay choice. §9's quality gates apply, and `e2e/s43b-accessibility-keyboard.spec.ts` gains the tour |

### 9.3 Decision

Akmal decided Q9 on 10 November 2026.

| # | Question | Decided |
|---|---|---|
| Q9 | Which steps? | **S-34's five, pointed at what the shell shows on every screen**: Home, where check-ins are; Updates, what you owe; Goals, the company map; the cycle strip, while a cycle is being planned; and Search with ⌘K. Ask AI is added when the copilot can answer. **The tour ends with a Start drafting OKRs button that goes to the cycle page.** Not chosen: a new list walking the shell from the workspace switcher down, as in the example |

### 9.4 What the specification gains

| Row | Pages |
|---|---|
| T1 | UIUX-PLAN §6, S-34: the welcome dialog, the spotlight, when it is offered, the five steps and the closing Start drafting OKRs, Take the tour again, the demo rule; §7, the tour's focus handling; `docs/design/role-homes.md`, which says the tour moved with the map |

## 10. Who may set up a cycle

Asked on 10 November 2026: how does somebody set a cycle's sponsor? Read from the code on `main`, not tried on a running instance:

| Fact | Where |
|---|---|
| Creating a cycle (`cycles.create`) and setting its roles, planning session dates, publication deadline and levels (`cycles.update`) need **Full on the workspace** | `packages/core/src/actions/cycles.ts` |
| With the built-in roles only the **Owner** has Full on the workspace. An **Admin** has Edit there, on purpose, "the workspace context is what carries the settings and the ability to hand the workspace over, and that is the owner's". A Member and a Viewer have View | `packages/core/src/access/roles.ts` |
| So an Admin cannot name a sponsor or a facilitator, book the planning sessions or create a cycle. The Roles and planning sessions card is not drawn for them, and the server would refuse them. Whoever creates a cycle becomes its sponsor by default | `apps/web/app/cycle/page.tsx` (`canPublish`) |
| The same Full gate covers more of the cycle page: Phase 0's annual frame and annual objectives, and closing a cycle (`cycles.close`) | `apps/web/app/cycle/page.tsx` |

| # | Change | Size | Gate |
|---|---|---|---|
| R1 | **An Admin can set up a cycle.** Creating a cycle and setting its roles, planning session dates and publication deadline need **Edit** on the workspace rather than Full, so the Owner and an Admin can, and a Member, a Viewer and a guest still cannot. No new role and no new domain: Admin already holds Edit on the workspace, and a Member holds View. The Roles and planning sessions card is drawn for Edit. The design lists every other action on the cycle page that needs Full today, the annual frame, the annual objectives, closing and publishing among them, and says which move with these and which stay with the Owner. F1's "who can fill this" wording follows: "an Owner or an Admin names the sponsor" | M | Design first: access. Recommended by Claude and agreed by Akmal on 10 November 2026 |

The specification gains it in TECHNICAL-PLAN §4.1, the role matrix's note on the workspace domain, and in `docs/design/workspace-roles.md`.

## 11. Suggested order

1. C1, early in the release, because a migration that refuses on bad data is best met on a test instance first.
2. H15, already done, then O3, O1 and H4. All small, no design, and they fix what a running cloud instance gets wrong today.
3. S1 and S2, then the designs for S3 (with H1), H2 and H3. Together they decide whether a stranger can sign up and sign in on a cloud instance.
4. T1. It is what that new person sees next, and it leads them to the cycle page.
5. H8, H9 and H6, which remove the three chart workarounds OKRGoal runs with, then H11, H12, H13 and H14.
6. Y1, Y2 and D1. They need no design, and they answer "who am I signed in as", "where do I change my details" and "is this a demo".
7. F1, L1 and L2. No design. F1 and L1 are on Phase 1, the screen every cycle starts on: F1 answers "where do I fill this in", L1 makes the page easier to read. L2 makes the way there from an empty Work Map hard to miss.
8. V1 and V2. Both are small, and Q7 and Q8 are decided.
9. The designs for R1 and for Y3 to Y6, then the code, one row each.
10. O2's design and code. Q6 is decided.
11. The designs for H5, H7 and H10. H10 is split into rows once designed, and changing migration 0031 for H5 is Akmal's decision.
12. The design for Y7, which follows the answers in section 2.5, then the code. Last, because it is the largest and the only one that cannot be undone.

## 12. Build log

Statuses: **to do**; **design written**, waiting for "design approved"; **design approved**; **done**, committed and the local tier green; **yours**, a decision or action only you can take.

| Row | Status | Note |
|---|---|---|
| C1 | design written | Building it found that the refusal as written strands an operator who skipped data change 0034 and fails the nightly upgrade rehearsal. `docs/design/short-ids.md`, "The 0.8.0 step": options A, B, C, recommended A (the migrator runs a data change a migration names, first). Waits for C1-Q1 and "design approved" |
| Y1 | to do | |
| Y2 | to do | |
| Y3 | to do | |
| Y4 | to do | |
| Y5 | to do | |
| Y6 | to do | |
| Y7 | to do | Design first; Y7-1 to Y7-6 decided |
| H1 | carried by S3 | |
| H2 | design written | `docs/design/trusted-proxies.md`: `OPENOKR_TRUSTED_PROXIES` or `OPENOKR_CLIENT_ADDRESS_HEADER`, environment only, empty keeps today's rule. Found that `X-Real-IP`, read as a fallback, lets a caller who reaches a load balancer directly choose their own address. Q1 to Q3; waits for "design approved" |
| H3 | design written | `docs/design/registration-policy.md` §10: an unclaimed instance admits its first account whatever the policy says. H3-Q1 (a setup code) recommended for a later release. Waits for "design approved" |
| H4 | no change | Not reproducible on `main`, nor on 0.6.0: the proxy sends a signed-out visitor to `/sign-in`, and the auth layout sends sign-in to `/setup` while no account exists and setup is unfinished (`apps/web/app/(auth)/layout.tsx`, `readSetupState`). Nothing on that path reads the cloud flag, and `e2e/first-run-wizard.spec.ts` asserts it. What OKRGoal saw needs an account to exist before setup finished, which is the deliberate recovery path, and most likely came from H3's broken wizard sign-up. H3's fix covers it |
| H5 | to do | Design first: schema; changing 0031 is Akmal's decision |
| H6 | to do | |
| H7 | to do | Design first |
| H8 | to do | |
| H9 | to do | |
| H10 | to do | Design first; split into rows once designed |
| H11 | to do | |
| H12 | to do | |
| H13 | to do | |
| H14 | to do | |
| H15 | done | PR #203, merged 10 November 2026 with every CI job green |
| O1 | done | The provider chain names its step (`resolveProviderForTier`, `resolveDrafterFor`), core turns it into one sentence (`ai/off-reason.ts`) on the copilot's footer, answer and stream; Admin, AI says a plan has no credits. `docs/design/ai-credits.md` §9.1 |
| O2 | to do | Design first; Q6 decided |
| O3 | done | The erasure CronJob gets `BETTER_AUTH_SECRET` by reference; `check.sh` asserts it, and fails without the fix |
| D1 | done | `apps/web/lib/demo-pill.tsx`: an `info` chip reading Demo, focusable, the sentence in a tooltip and in hidden text. A `badge` slot on the top bar and on the auth card; `/api/demo-personas` answers `demo`. Unit tests; the suite's instance is not a demo, so no browser spec |
| V1 | to do | Q7 decided |
| V2 | to do | Q8 decided |
| F1 | to do | |
| L1 | done | Stacked at every width; the two roles side by side inside Roles from `sm`; When takes a quarter of the table and wraps. Mockup 02 redrawn. `e2e/s06-prepare-layout.spec.ts` |
| L2 | done | A primary button under the sentence, `data-testid="start-drafting"`, drawn only for `canEdit` (the same `edit` the cycle page drafts with). Unit test both readers |
| S1 | done | One commit with S2, since the sign-up form carries both. The card replaces the form when sign-up returns no session; the link's hour is now named (`EMAIL_VERIFICATION_LINK_SECONDS`) |
| S2 | done | At `/email-confirmed`, because `/welcome` is onboarding (S-34). Until S3, an expired or broken link points to the instance's support address, or to whoever runs it |
| S3 | design written | `docs/design/email-verification.md`: the mail through the outbox, Better Auth's own resend endpoint on all three surfaces, limits per address and network, a 24-hour link recommended. Found a refused mail no longer fails sign-up on Better Auth 1.7. Q1 to Q3; waits for "design approved" |
| T1 | to do | Q9 decided |
| R1 | to do | Design first: access |
| Q1 to Q5 | decided | 10 November 2026, section 2.3 |
| Y7-1 to Y7-6 | decided | 10 November 2026, section 2.5 |
| Q6 | decided | 10 November 2026, section 3.2: nothing automatic, the console's one action |
| Q7, Q8 | decided | 10 November 2026, section 5.3: the version for every member; the operator's update notice |
| Q9 | decided | 10 November 2026, section 9.3: S-34's five steps, ending with Start drafting OKRs |
