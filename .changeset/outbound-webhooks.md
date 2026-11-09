---
"@openokr/web": minor
---

Outbound webhooks. An administrator adds a hook with an HTTPS address and the events it should receive, and gets its signing secret once. Each event is posted to every hook waiting for it, signed the Standard Webhooks way, with the subject as the hook's owner sees it then; one the owner cannot see is withheld. Failed deliveries are retried for about a day, every attempt is logged for 30 days, and a hook whose last 50 deliveries failed turns itself off and emails whoever made it. Webhooks are on REST and the command line, never an agent's tools.
