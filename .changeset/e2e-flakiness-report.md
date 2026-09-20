---
"openokr": patch
---

The browser suite reports its own flakiness.

Vitest has recorded every test that passed only after a retry since the
flakiness gate shipped. Playwright retries once in continuous integration and
recorded nothing, so a spec that failed and recovered was indistinguishable
from one that passed first time: a green run, no record, and nobody learns the
spec is rotting.

That is how two specs came to be failing about one run in four without anybody
noticing until the suite was run eleven times in a single day.

The end-to-end suite now writes the same report the unit shards do, with the
same identifiers, so one merge and one quarantine list cover the whole
repository. It is written locally too, because a report that exists only in
continuous integration is a report nobody can check before pushing.
