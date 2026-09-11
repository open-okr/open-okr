# Changesets

Every change that reaches a release names its own version bump here, and
`pnpm changeset` writes the file.

## Why this directory exists

The version, the changelog and the release notes were three things somebody
wrote by hand at tag time. Written by hand, they drift: a release note is
composed from the commits somebody remembered, a changelog entry is added to
the version that happened to be open, and a bump is chosen by whoever cut the
tag. None of the three can be checked against the others.

A changeset moves the decision to the change that caused it, while the person
who made it still knows whether it breaks anything.

## Adding one

```
pnpm changeset
```

Pick the bump and write a sentence for the person reading the release notes,
not for the person reviewing the diff. "The publish gate no longer refuses a
set with a blank reviewer" is a release note. "Fix `publishGate` null check"
is a commit message.

## When a change needs none

Documentation, tests, internal refactoring and anything a customer cannot
observe. Say so explicitly:

```
pnpm changeset --empty
```

An empty changeset is a written claim that this change is invisible from
outside, which is the thing a reviewer can disagree with. **Silence is not
that claim**, which is why `pnpm check:changeset` fails a branch carrying
neither.

## Versioning

Every package moves together, as one product version. `fixed` in
`config.json` is what does that: OpenOKR ships as an instance, not as a set
of libraries somebody picks from, so a member upgrading reads one number.

PLAN.md §5.1 owns what each bump means. A major carries a change an
administrator must act on and the release notes name the action; a minor
carries features and migrations that need nothing from them; a patch carries
fixes.
