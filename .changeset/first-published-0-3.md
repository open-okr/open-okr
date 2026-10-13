---
"@openokr/web": patch
---

The first published 0.3 release.

0.3.0 was tagged and never published: its release job ran every package's
tests at once on one machine, and a timing test failed under that load. The
release job now runs them one package at a time. Everything in [0.3.0's
notes](https://github.com/open-okr/open-okr/blob/main/apps/web/CHANGELOG.md#030)
ships in this release, and upgrading from 0.2 follows the "0.2 to 0.3"
section of `docs/runbooks/upgrade.md`, data changes included.
