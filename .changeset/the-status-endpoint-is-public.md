---
"openokr": patch
---

`/api/status` answers an uptime monitor, as it was designed to.

The status endpoint was built for monitoring and meant to need no sign-in, but
it was never added to the list of addresses that do not. A monitor asking it
was sent to the sign-in page, which answers with a 200, so every monitor
reported a healthy instance whatever state it was in.
