---
"@openokr/web": minor
---

A stopping server drains the work in flight instead of dropping it. On SIGTERM or SIGINT the relay finishes the delivery it is sending and hands the rest of its batch back at once, with no attempt counted, rather than leaving every row claimed for two minutes; the scheduler lets a running job finish and hands it back three seconds before the bound, so another scheduler runs it at once rather than after it expires fifteen minutes later; actions in flight are waited for; then error reports and spans are flushed. `OPENOKR_SHUTDOWN_SECONDS`, 20 by default, a whole number from 1 to 300, bounds the drain, and the process writes one `shutdown: stopped after` line and exits 0. The image sets `NEXT_MANUAL_SIG_HANDLE=true` so the server, not Next, owns the signal, and the Compose `app` service waits 30 seconds before it kills the container.
