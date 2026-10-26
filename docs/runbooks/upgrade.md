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
`pnpm db:change`, on your schedule, and `status` reports what is pending. An
upgrade is never held open by a long backfill.

Run it with `OPENOKR_ENCRYPTION_KEY` in the environment. The data change that
seals identity-provider tokens stored before they were encrypted needs the
root key, and refuses to finish without it rather than report them sealed.
[Security](../admin/security.md#what-is-encrypted-at-rest) says more.

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
