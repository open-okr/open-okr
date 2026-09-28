---
"openokr": patch
---

A sent invitation no longer leaves its token and email address behind.

The queue that sends email and chat messages kept every row forever, and an
invitation's row held the raw invitation token and the invitee's address. Both
are now removed the moment the email is sent, and a daily job deletes sent and
given-up rows after 30 days. `outbox.retentionDays` (or
`OPENOKR_OUTBOX_RETENTION_DAYS`) changes the window, and 0 keeps every row.
