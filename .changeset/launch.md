---
"openokr": patch
---

Everything a release needs that was not already automated.

The release machinery has been complete since the signing and provenance work:
a tag verifies, builds, signs, publishes, verifies its own signature from
outside, attaches a bill of materials and packages the chart. What was missing
was the human half.

`docs/runbooks/release.md` is the maintainer's runbook: where the version
number comes from, what each job proves, and the three checks nobody else will
do afterwards. A clean-machine install, an upgrade from the previous release,
and a chart install into a cluster are the acceptance criteria for a launch and
none of them is something a tag's own workflow can check.

`docs/runbooks/announcement.md` is the text to post, marked where it changes.

`docs/runbooks/good-first-issues.md` says what makes one, and lists the ones
that are open. Tasks from the implementation plan are deliberately never
labelled that way: they have a Definition of Ready and design gates behind
some of them, and they are not an introduction to the project.

A workflow now comments on a pull request whose commits are missing their
sign-off, naming which commits and the two commands that fix it. The gate
itself is unchanged; a first-time contributor used to meet a red cross on a job
named "Licences and sign-off" and had to read the log to find out which of the
two it was.

Issue templates for bugs and features, with the security policy linked from the
chooser so a vulnerability does not arrive as a public issue.
