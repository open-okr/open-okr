---
"openokr": patch
---

The Slack, Microsoft Teams, WhatsApp and Telegram webhooks no longer tell a
caller which organisations are connected. A request for a Slack workspace,
Teams tenant, WhatsApp number or Telegram bot nobody connected used to get
200, and one with a bad signature 401, so anybody could list the connected
ones without holding a secret. Every refusal is now the same empty 401, never
sooner than a quarter of a second, and Meta's subscription check the same 403.
A provider pointed at this instance with no connection here will now report
failed deliveries rather than silently succeeding ones.

A Teams token is checked against Microsoft's published keys before anything
is looked up, and those keys are fetched once a day instead of on every
message.

Operators can tell the refusals apart on a new counter,
`openokr_channel_inbound_refusals_total`, labelled by provider and reason.
