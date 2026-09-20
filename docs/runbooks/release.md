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
package, and writes the release's section into `CHANGELOG.md`. Read what it
wrote. It is the release notes, assembled from sentences written by the people
who made the changes while they still knew whether anything broke.

Commit it, with a sign-off, and merge it to `main`.

## Tag

```
git tag v1.2.3
git push origin v1.2.3
```

Nothing publishes on a push to `main`. An image reaching a registry is always a
deliberate act, which is why the release workflow triggers only on a tag
matching `v*.*.*`.

## What the workflow does, in order

| Job | What it proves |
|---|---|
| Verify the tagged commit | Every gate a pull request faces, plus the chart checks and a full Compose boot from an empty machine. A tag is not trusted to mean the code is good |
| Build, publish and sign | Multi-architecture image to the registry, signed keyless through Sigstore, with provenance and a bill of materials attested to it |
| Verify the published signature | The signature is checked from outside the job that made it, the way a customer would. A published signature nobody checks is decoration |
| Publish the release and its bill of materials | The GitHub release, with the changelog section as its notes and an SPDX file attached. An auditor asking what was in March's release wants a file, not a digest and a reason to run cosign |
| Package the chart | The Helm chart, versioned and app-versioned to the tag, pushed to the registry |

A prerelease tag (one containing `-`) publishes without moving `latest`.

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
