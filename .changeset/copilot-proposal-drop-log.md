---
"@openokr/core": patch
"@openokr/agents": patch
"@openokr/web": patch
---

When the copilot drops a proposal it could not use, the server log now says why. One line per drop names the reason (`not_offered`, `no_reason`, `fields_refused`, `build_refused` or `provider_error`), the action the model named, the provider and the model, and never the person's request, the fields or the model's reply. A request the model reads as a question writes nothing. `pnpm ai:evaluate` prints the same reason beside a fixture that expected a proposal and got none.
