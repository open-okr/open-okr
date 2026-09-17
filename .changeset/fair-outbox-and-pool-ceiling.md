---
"openokr": patch
---

One workspace's import no longer holds up everybody else's notifications.

Side effects wait in a queue that was drained oldest first. That meant an
import writing forty thousand rows put every other workspace's check-in
reminder, digest and chat message behind forty thousand jobs, and nothing was
misbehaving: the queue was simply first come, first served.

The queue is now drained a turn at a time. Each workspace's oldest waiting job
goes first, then each workspace's next, and so on. A workspace that just ran
an import still gets through all of it, it just stops being first forty
thousand times running.

**Nothing slows down on an instance with one busy workspace.** When there is
nobody to be fair to the order is exactly what it was, so a self-hosted
deployment pays nothing for a problem it does not have.

**The database connection pool has a ceiling it never had.** Every deployment
has been running on the ten connections the database library picks by
default. It is now twenty, which is the number this product measured itself
needing, and `OPENOKR_DB_POOL_MAX` changes it.
