---
"@openokr/adapters": patch
---

The Anthropic provider moves to version 1 of Anthropic's SDK, which uses API version 2026-10-21 and sends the API key as a bearer token. That API version refuses a temperature on every model, so requests to Anthropic models no longer carry one, and the sampling a workspace sets for a tier does not apply to them. Nothing set a temperature on a request before this change, so no request behaves differently. A proxy in front of Anthropic that reads the `X-Api-Key` header now has to read `Authorization` instead.
