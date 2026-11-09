---
"@openokr/web": minor
---

Outbound webhooks. An administrator adds a hook with an HTTPS address and the events it should receive, and gets its signing secret once. Every write that records one of those events queues a signed delivery for each hook waiting for it, through the outbox. Webhooks are on REST and the command line, never an agent's tools.
