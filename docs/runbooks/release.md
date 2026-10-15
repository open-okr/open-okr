# Cutting a release

For the maintainer tagging a version, not for a reader.

Everything here is already automated except the two decisions a person has to
make: what the version number is, and whether the release is fit to publish.

## Before you tag

**The version comes from the changesets, not from you.** Every change that
reaches a release carries one, and `pnpm check:changeset` refuses a branch that
changes behaviour and names no bump. So the number is already decided by the
time you get here.

```
pnpm changeset version
```

That consumes every file in `.changeset/`, writes the new version into every
package, and writes the release's section into `apps/web/CHANGELOG.md`. Read
what it wrote. It is the release notes, assembled from sentences written by the
people who made the changes while they still knew whether anything broke.

Run it with `GITHUB_TOKEN=$(gh auth token)` in front: the changelog links each
entry to its pull request, and asks GitHub which one that was.

**Every changeset names `@openokr/web`**, the application. Changesets never
versions a monorepo's root package, so a changeset naming the root stops
`changeset version` outright, and `pnpm check:changeset` refuses one. The fixed
group in `.changeset/config.json` moves every `@openokr/*` package to the same
number, because OpenOKR ships as one instance with one version.

**Then `pnpm check:docs`.** It names every page that still pins the previous
release in an install command: the root README, the Helm README and the
Compose guide each show a real version, because a reader copies the line.
Change them to the new number in the same commit.

Commit it, with a sign-off, and merge it to `main`.

## Tag

Tag what GitHub has, not what your checkout has:

```
git fetch origin
git tag v1.2.3 origin/main
git push origin v1.2.3
```

A plain `git tag v1.2.3` tags whatever is checked out. v0.3.1 was first tagged
that way on a checkout 75 commits behind, onto a commit whose version still
said 0.2.0. The release workflow now refuses a tag whose number differs from
the version in `apps/web/package.json`, as its first step, so that mistake
costs a minute rather than a release. A prerelease such as `v1.2.3-rc.1` is
compared without its suffix.

Nothing publishes on a push to `main`. An image reaching a registry is always a
deliberate act, which is why the release workflow triggers only on a tag
matching `v*.*.*`.

## What the workflow does, in order

| Job | What it proves |
|---|---|
| Verify the tagged commit | The tag matches the commit's version. Then every gate a pull request faces, plus the chart checks and a full Compose boot from an empty machine. A tag is not trusted to mean the code is good |
| Build / Image (amd64), Image (arm64) | Each architecture built on a runner of that architecture, with provenance and a bill of materials attached, and pushed by digest with no tag. Nothing a customer pulls points at it yet |
| Join, publish and sign | Both digests joined into one image under the exact version tag, signed keyless through Sigstore, with the build provenance attested |
| Verify the published signature | The signature is checked from outside the job that made it, the way a customer would. A published signature nobody checks is decoration |
| Move the floating tags | `latest`, `1.2` and `1` moved onto the signed digest, and checked to resolve to it. Only now, so a run that fails earlier never leaves `latest` on an unsigned image |
| Publish the release and its bill of materials | The GitHub release, with the changelog section as its notes and an SPDX file attached. An auditor asking what was in March's release wants a file, not a digest and a reason to run cosign |
| Package the chart | The Helm chart, versioned and app-versioned to the tag, pushed to the registry once the signature has verified |

A prerelease tag (one containing `-`) publishes without moving `latest`, `1.2`
or `1`.

**The build is not new on release day.** CI runs the same image workflow, both
architectures and nothing pushed, on every pull request that changes the
dependencies or the build files, and `image-rehearsal.yml` runs it weekly on
`main`. If either is red, a tag will be too.

**When the workflow itself has changed since the last release**, tag a
release candidate first: `v1.2.3-rc.1` on the same commit. It runs every job
for real, publishes a GitHub prerelease and moves no floating tag, which is the
only way to exercise the joining, signing and verifying steps before a version
customers are pointed at.

## If the run fails partway

Read the failed job's log first: `gh run view <id> --log-failed`.

| Failed in | What has been published | What to do |
|---|---|---|
| Verify, or either Image job | Nothing | Fix the cause. If it is the commit, cut the next patch. If it was the runner or GitHub, `gh run rerun <id> --failed` |
| Join, publish and sign | At most the exact version tag, unsigned. No floating tag, no release page | `gh run rerun <id> --failed` joins the digests the Image jobs already pushed under the same tag again, and signs |
| Verify the published signature, or later | The signed image under its version tag | `gh run rerun <id> --failed` |

A re-run picks up where the run stopped, keeps the jobs that passed, and runs
the workflow file as it was at the tag. A fix to the workflow itself therefore
needs a new commit and a new tag.

## After the workflow is green

Three checks nobody else will do for you.

**Install it on a clean machine.** The smoke test in the workflow proves the
Compose target boots. It does not prove the documented path works, because the
documented path starts with a person reading
[the Compose quickstart](../install/compose.md) on a machine that has never had
OpenOKR on it.

```
git clone https://github.com/open-okr/open-okr
cd open-okr/deploy/docker
./openokr up
```

**Upgrade an instance from the previous release.** Migrations are forward-only
and removals span two releases, so an upgrade is where a mistake about that
shows up. Start an instance on the previous tag, put data in it, then:

```
./openokr upgrade
```

The data is still there, and nothing in the log says a migration failed.

**Install the chart.** `deploy/helm/cluster-test.sh` does this against a kind
cluster and is the fastest way to be sure.

## Announcing it

`docs/runbooks/announcement.md` is the text, and the parts that change with
every release are marked. Post it where the project's readers are, and link the
GitHub release rather than repeating the notes.

## If a release is wrong

Do not delete the tag. A published image with a signature and a transparency
log entry cannot be unpublished, and deleting the tag only removes the evidence
of what happened.

Cut the next patch instead, and say in its notes what the previous one got
wrong. If the bad release must not be installed, mark the GitHub release as a
prerelease so it stops being the one a person lands on.

## Related

- [Upgrade](upgrade.md), for the person receiving a release
- [Incident](incident.md)
- [The announcement](announcement.md)
