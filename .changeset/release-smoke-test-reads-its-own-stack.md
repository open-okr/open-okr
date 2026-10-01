---
"@openokr/web": patch
---

0.1.1 was tagged but never published either, so this is the first release of
OpenOKR you can install. Everything listed under
[0.1.1](https://github.com/open-okr/open-okr/blob/main/apps/web/CHANGELOG.md#011)
and
[0.1.0](https://github.com/open-okr/open-okr/blob/main/apps/web/CHANGELOG.md#010)
in the changelog is in it.

Before it publishes anything, the release run boots the Compose target from
nothing and checks it. That check read the logs of a stack named `openokr`,
while the release run had started its stack under another name. It found no
log and reported that migrations had not run, when they had.

`deploy/docker/smoke-test.sh` now checks whichever stack `./openokr up`
started: the one `COMPOSE_PROJECT_NAME` names when it is set, and `openokr`
otherwise. If you run the smoke test yourself under a project name of your
own, it now tests that stack rather than one that is not there.
