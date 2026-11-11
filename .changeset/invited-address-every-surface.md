---
"@openokr/core": patch
"@openokr/web": patch
---

Accepting a personal invitation now confirms your email address on every surface, not only on the join page. Accepting it through the REST API, the `okr` command line or an AI agent joined the workspace but left the address unconfirmed, although the invitation reaching that mailbox proves it just as well. The address is confirmed a moment after the acceptance, by the background relay, and the instance's audit trail records it as confirmed by invitation. A shared workspace link still confirms nothing.
