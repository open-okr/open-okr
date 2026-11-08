# Upgrading, and how to go back

## Before you upgrade

Nothing. `./openokr upgrade` takes a backup itself and refuses to proceed
without one.

That refusal is the whole shape of this document. Migrations are
forward-only, so the moment one applies, the previous image is looking at a
schema it does not know. **"Run the previous tag" is not a rollback.** Starting the old image against
the new database is a second failure on top of the first.

```
cd deploy/docker
./openokr upgrade
```

The helper takes the backup, keeps the last three, pulls, and restarts.
Migrations run in the entrypoint, take an advisory lock, and are safe to
repeat and safe with more than one replica.

## If your database is backed up somewhere else

```
OPENOKR_SKIP_BACKUP=1 ./openokr upgrade
```

A variable rather than a flag, because it is a thing you decide once about a
deployment and not something to think about on each upgrade. Use it when an
external Postgres has its own backups, and not to get past a backup that
failed: a failing backup on upgrade day is the backup you were about to need.

## Going back

```
./openokr restore <the backup directory the upgrade wrote>
OPENOKR_IMAGE=<the previous tag> ./openokr up
```

In that order. The restore is the part that matters, because the schema moved
and the old image cannot read the new database.

The backup directory is self-contained and sealed with the instance's root
key: a database dump, the blob storage, a manifest and a checksum. `restore`
refuses a damaged one rather than restoring half of it.

## How far behind you can be

Any release upgrades directly to any later release in the same major, with no
stops in between. Crossing a major means stopping at the last release of the
current major first.

That direct jump is what lets old migrations retire at a major boundary.
Without it every migration ever written would have to stay runnable forever.

## What is checked, and by whom

| Check | Where | What it catches |
|---|---|---|
| `pnpm db:lint` | every commit | A migration that drops or renames a column without saying which earlier release added the replacement. On Kubernetes, pods of two releases serve together during a rollout, so a silent drop breaks every request those pods are serving |
| The upgrade matrix | nightly, and on demand | A real instance on the baseline, seeded through the product, upgraded to the current commit. Asserts the workspace is intact, the audit trail has not shrunk, and a backup exists |

The linter runs first on purpose. The matrix's own worst case is a migration
that drops a column the baseline still reads, and that is a migration the
linter should already have refused hours earlier, on the commit that wrote
it.

## Backfills never hold up a boot

Schema migrations run on start. Data changes run separately through
`pnpm db:change`, on your schedule: it runs every script not yet complete and
names what it ran, or says nothing was left. An upgrade is never held open by
a long backfill.

Run it with `OPENOKR_ENCRYPTION_KEY` in the environment. The data change that
seals identity-provider tokens stored before they were encrypted needs the
root key, and refuses to finish without it rather than report them sealed.
[Security](../admin/security.md#what-is-encrypted-at-rest) says more.

## 0.5 to 0.6: one AI key for every workspace, and budgets that hold

0.6 adds six migrations, 0145 to 0150, and no data change. They add tables
for billing and AI credits, one column, and a change to the audit trail's
guard so that erasing a closed cloud workspace can delete its audit rows.
Every other route to an audit row is still refused. None of them refuses to
run, so `./openokr upgrade` is the whole upgrade, and no setting needs
choosing. An instance coming from an older release still meets the sections
below, and the one that can stop an upgrade is 0.3 to 0.4.

Look at these before you upgrade.

**A deployment AI key now serves every workspace that has none of its own.**
`OPENOKR_AI_PROVIDER` and `OPENOKR_AI_API_KEY` name one provider and key for
the whole instance. Up to 0.5 a workspace used them only after turning on
that same provider itself, so on most instances they did nothing. From 0.6,
every workspace without a provider of its own routes to them. **On a
self-hosted instance that sets them, AI turns on in every such workspace.**
A workspace with its own key keeps using its own.

| Where it would be set | How to look |
|---|---|
| Compose | `grep OPENOKR_AI_PROVIDER deploy/docker/secrets/app.env` |
| Helm | Nothing to look at. The chart had no way to pass it before 0.6, which adds `extraEnv` and `extraEnvFrom` |
| Anywhere else | The environment you start the server with |

If AI should stay off where nobody chose it, remove both variables before you
upgrade.

**AI budgets start to apply.** Up to 0.5 no AI call was recorded, so the
usage card on Admin, AI always read zero and no budget ever stopped anything.
0.6 records every call, including a copilot answer somebody stops partway.
Once a workspace's budget is used up, every AI feature in that workspace is
off until the period ends. If you set a budget earlier, look at it on Admin,
AI in each workspace before people meet it.

**A workspace that never chose its models moves to the current ones**:
Claude Haiku, Sonnet and Opus 5.5, GPT-6 Luna, GPT-6.1 Terra and Sol, and
Gemini 2.5 Flash Lite, 3.5 Flash Lite and 3.8 Flash. A workspace that chose a
model keeps it. The built-in prices now match what each provider charges
today, and cached tokens count at their cheaper rate, so usage figures move
with them.

**Only if you run a cloud with a plan catalogue** (`OPENOKR_CLOUD=true` and
plans set):

| What changes | What to do |
|---|---|
| A plan's AI allowance is now `aiCredits`. `aiMonthlyUsd` is ignored rather than refused, so the catalogue still loads | Give each plan that includes AI an `aiCredits` number. A budget `aiMonthlyUsd` wrote into a workspace earlier stays as that workspace's budget, and now applies |
| The deployment key serves a workspace only when its plan has `aiCredits` above zero. A workspace with no plan, or a plan without credits, brings its own key. Up to 0.5 such a workspace could turn on the deployment's provider and use your key with no limit | The same: set `aiCredits` on the plans that should spend your key |
| A workspace's own administrator can no longer change its plan, lift a suspension or the read-only mode that follows an unpaid subscription, or reopen a closed workspace. The one exception: an owner who closed an active workspace may reopen it until it is deleted | Change plans from the operator console |
| A personal invitation holds a seat from the moment it is sent | Nothing. An invitation past the limit is refused when sent, naming both numbers |

Everything else 0.6 adds is off or empty until you set it: billing
(`OPENOKR_BILLING_PROVIDER`), the plan a new workspace starts on
(`OPENOKR_CLOUD_DEFAULT_PLAN`), erasing closed workspaces
(`OPENOKR_CLOUD_CLOSURE_RETENTION_DAYS`, 0 by default, so nothing is erased),
and the instance's own source, terms, privacy and support links.
[Running a cloud](../install/cloud.md) says how to turn each one on.

**Compose: the helper has two new commands.** `./openokr operator` grants the
cloud operator role and `./openokr erase` erases closed workspaces past their
window. They are in the `deploy/docker/openokr` file itself, which
`./openokr upgrade` does not replace. In a clone, `git fetch --tags` and
`git checkout v0.6.0` brings them. On a server that holds only a copy of
`deploy/docker/`, copy the file across from the release.

What an API client may meet: no action was removed.

| Where | Change |
|---|---|
| `workspace.setLifecycle` | Needs a token with the destructive scope. Closing needs `confirmSlug`, the workspace's address. No longer one of an external agent's tools. Only a cloud workspace has a lifecycle |
| `workspace.changePlan` | On a cloud, refused for a workspace's own administrator. No longer one of an external agent's tools |
| `billing.summary`, `billing.startCheckout`, `billing.changePlan`, `billing.buyCredits`, `billing.openPortal`, `billing.settleEnded` | New, for a cloud with billing on |

What people in an upgraded workspace will notice:

| Area | In 0.6 |
|---|---|
| Buttons | A control that is saving shows a spinner after 200 milliseconds and cannot be pressed twice. It keeps keyboard focus while it waits |
| Language | More messages follow the chosen language: account security, the coach strip, drafting assists, capacity, space membership, the operator lifecycle and the session screens |
| AI drafting | Drafting, rewriting, check-in wording and thread summaries now work on Claude Sonnet 5.5, Opus 5.5 and Fable 5.1, where they quietly showed nothing. A model added by hand now answers too |
| Account menu | The link to the code reads "Source code". Where sign-up is open to a person, the menu can start another workspace for them. Under invitation only, the default once an instance is claimed, it cannot |
| Sign-up | Shows the terms and privacy links once the instance sets them |

## 0.4 to 0.5: who may sign up, and a check for new releases

0.5 adds no migration and no data change, so `./openokr upgrade` is the whole
upgrade. No setting needs choosing. An instance coming from an older release
still meets the sections below, and the one that can stop an upgrade is 0.3
to 0.4.

Look at these before you upgrade.

**`OPENOKR_REGISTRATION` now takes effect, and it can open your instance.**
0.4 documented this variable and never read it. 0.5 reads it when no policy
has been saved in the application. So an instance with `open` in its
configuration, which stayed closed only because the variable did nothing,
starts admitting anybody.

| Where it would be set | How to look |
|---|---|
| Helm | `helm get values <release>`, and look for `instance.registration` |
| Compose | `grep OPENOKR_REGISTRATION deploy/docker/secrets/app.env`. The Compose file does not pass it, so it is only there if somebody added it |
| Anywhere else | The environment you start the server with |

| What you have | After the upgrade |
|---|---|
| Not set, or `auto`, which is the default | No change: invitation only once the instance is claimed |
| A policy saved in the application, such as closing registration in the setup wizard | No change: a saved policy wins over the variable |
| `invite_only` | No change on a claimed instance |
| `open`, with no policy saved | **Anybody can sign up and start a workspace.** If you do not want that, change the value to `auto` before you upgrade |

Afterwards, the Registration card on Admin, General shows the policy and what
decides it, and it adds a third choice, Company email addresses. Every change
made there is written to the instance audit chain.

**The server now asks GitHub whether a newer release exists.** An
administrator sees the running version at the foot of every screen, and a
link when the instance is behind. To know that, the server asks
`api.github.com` at most once a day, or once an hour while GitHub does not
answer, and only when an administrator loads a page. No page waits for it.
The request carries nothing about the instance, and GitHub sees only the
server's address. The check is on by default, so an instance on a restricted
network should turn it off:

| Deployment | How |
|---|---|
| Any | Untick it on Admin, General |
| Compose | Add `OPENOKR_UPDATE_CHECK=off` to `deploy/docker/secrets/app.env`, then run `./openokr up` |
| Helm | Use Admin, General. The chart has no value for this variable |

A managed cloud never asks.

**A free mail provider can no longer be a trusted email domain.** Trusting
`gmail.com` offers a workspace to anybody with an address there, so 0.5 refuses
to save it. A workspace that already trusts one keeps offering itself to those
addresses, and its General settings will not save until the domain is removed.
Look at Trusted email domains on Admin, General in each workspace.

**An outbound gateway that reads `X-Api-Key`.** The Anthropic provider moves to
version 1 of Anthropic's SDK, which sends the key in the `Authorization` header.
OpenOKR always calls `api.anthropic.com`, so this only matters if a gateway
inspects that traffic and reads the old header. Change it to read
`Authorization`.

What an API client or a spreadsheet may meet: no action was removed.

| Where | Change |
|---|---|
| `practice.read`, `rhythm.read` | `section` is `4.5`, where it was `§4.5` |
| `settings.updateWorkspaceGeneral` | Refuses a free mail provider in `trustedEmailDomains` |
| Goal list exports | The column is headed `Owner`, where it was `Champion` |

What people in an upgraded workspace will notice:

| Area | In 0.5 |
|---|---|
| The word for who answers for a goal | Owner by default, where it was Champion. A workspace that renamed the term keeps its own word, and the OKR Champion agent keeps its name |
| Goals | Each objective is a card with its key results under it, and one Filter button replaces the row of filters |
| KPIs | Grid, Trees and Recovery board are redesigned and share one card |
| Work Map | A Company tab, a space picker and a cycle picker |
| Agents | The OKR Coach and the OKR Champion have faces that show a mood. Every face holds still for anyone who asks for reduced motion |
| Admin, Practice | The "Scoring" switch is gone. It never did anything, and key results are scored at the close as before |

## 0.3 to 0.4: session prose is stored as documents only

0.3 wrote each piece of session prose twice: as a document, and as its
plain text for the release before. 0.4 drops the plain text. The six
columns are the monthly review's shifts and decisions, the quarterly
review's management answers, the weekly note for leadership, and the
revalidation's two notes; the private stage notes are documents too.

**If the upgrade stops at migration 0144, nothing has been lost.** The
migration first checks that every piece of prose already has its document.
An instance that came straight from 0.2, or skipped `pnpm db:change` on 0.3,
has some that do not, and the migration refuses before it drops anything,
naming each column and how many rows wait:

```text
Migration 0144_drop_plain_prose_columns.sql failed. Nothing was applied.
Session prose is still waiting to be written as a document, so nothing was
dropped. Rows waiting: decisions.text (12) management_answers.body (4). ...
```

Run the data changes against the database, with the admin role, then start
again:

```sh
DATABASE_ADMIN_URL=... OPENOKR_ENCRYPTION_KEY=... pnpm db:change
```

What an API client meets: the six actions (`sessions.setShifts`,
`sessions.recordDecision`, `sessions.setManagementAnswer`,
`sessions.setStageNote`, `sessions.setCoordinatorNote` and
`workflow.setRevalidation`) take editor JSON only, as the 0.3 notes
announced, and refuse a string. The read actions still return the plain
text fields they always had, computed from the document.

## 0.2 to 0.3: fields that guide, and prose written with the editor

0.3 changes how fields look and what they accept. Nothing about the
practice changes, and no setting needs choosing. Its first published
release is 0.3.1: 0.3.0 was tagged and never published.

What people will notice:

| Area | In 0.2 | In 0.3 |
|---|---|---|
| Fields | Plain boxes, checked when saved | Each field says what it takes and refuses the rest before anything is sent: dates, times with their zone, numbers with their unit, people and goals picked from a list, domains, addresses, colours |
| Confidence | Shown as 0.0 to 1.0 | Shown as Admin, Practice says, "7 in 10" by default |
| Session prose | Plain text | The monthly review's shifts and decisions, the quarterly review's management answers and private stage notes, the weekly note for leadership and the revalidation's two notes are written with the editor |
| Limits | Some only in the browser | Every limit the browser shows is held on the server too |

What an API client may meet: a link's expiry over 365 days, an SSO address
that is not https (plain http on localhost aside), or an AI base URL that is
not http or https, is refused with a sentence. The session prose fields take
editor JSON and, for this release, still take the plain text they took
before.

**Run the data changes once after the upgrade.** Six of them, 0027 to 0032,
write each existing piece of session prose as a document beside its plain
text. Until they run, every screen reads the plain text as before, so nothing
is lost if they wait. The release after this one removes the plain columns,
so they must have run before then.

```sh
OPENOKR_ENCRYPTION_KEY=... pnpm db:change
```

## 0.1 to 0.2: the practice becomes yours to adapt

0.2.0 is the first release that changes how the practice behaves for an
instance already running. 0.1 enforced one way of running OKRs and refused
much of what it did not like. 0.2 ships the same method as **defaults**: a
best-practice starting point every workspace can adapt in **Admin, Practice**,
with only structural defects refused. [METHOD.md](../specification/METHOD.md)
§12 lists every setting and what it can be set to.

**Every workspace arrives on the Recommended profile.** 0.1 stored no practice
settings, so there is nothing to carry. The upgrade check asserts it.

What people in an upgraded workspace will notice:

| Area | In 0.1 | In 0.2, by default |
|---|---|---|
| Writing OKRs | Waited for the planning phases | Anybody can write an objective or a key result at any time. The phases guide and show what is missing |
| Publishing | Every gate blocked | Gates 1 and 2, the structural ones, block. Gates 3 to 5 warn. Gate 6 is off |
| Quality checks | Most refused the draft | Most coach beside the work and refuse nothing |
| Kinds | One kind of objective and of key result | Committed and aspirational objectives. Metric, maintain, milestone and baseline key results. Existing objectives are aspirational and existing key results are metrics, or maintains where their direction said so |
| Reviewer | Required on every goal | Optional |
| Changing OKRs mid-cycle | Not modelled | Additions are marked, stops and eased targets keep their reason, and the close reads them |
| Health | On track, caution or off track, as last reported | "At risk" is the label for caution. Health reads the pace of the cycle, and a check-in that disagrees with the data is flagged within a window |
| Scores | Fixed at the close | Adjustable with a reason, beside the computed score. A closed cycle keeps the rules it was graded under |
| The rhythm | One frequency for everybody | A space may choose its own frequency and mark holidays, and a member on leave has a stand-in |
| The quarterly review | 60 minutes, at the cycle's close | 90 minutes in four acts, about two weeks before the end, optionally split into a review and a retrospective. Five close decisions, and a kept objective arrives in the next cycle as a draft |
| Nudges | Named their rule | Also say the coach's line for the situation, in METHOD.md's words |

**The way back is the Governed profile.** An organisation that relied on 0.1's
refusals chooses **Governed** in Admin, Practice. It binds the phases, keeps
writing to the planning window, makes mid-cycle objectives drafts the reviewer
approves, requires a reviewer, blocks on gates 1 to 5, turns the level-skip
check on and puts the sponsor in the escalation ladders. Every setting can
still be changed one at a time afterwards.

**Run the data changes once after the upgrade.** Eleven of them carry 0.1's
settings and rows onto 0.2's: a strict Coach becomes strict mode, retired
thresholds leave the stored overrides, key results and KPIs get the kind and
target type their direction implied, and blockers move onto the check-in's
clock. Nothing is lost if they wait, and running them twice changes nothing.

```sh
OPENOKR_ENCRYPTION_KEY=... pnpm db:change
```
