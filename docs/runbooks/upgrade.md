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
