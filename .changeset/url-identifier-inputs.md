---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
"@openokr/formats": patch
---

Addresses and ids are checked as they are typed, and the server checks them too.

Single sign-on's discovery, authorization, token and user info addresses
must now be whole https addresses, or plain http on localhost only, and the
screen marks one that is not before Save. Nothing checked them before, so a typo was stored and found at
somebody's sign-in. A refusal now shows on the field it is about, including
the three addresses that had nowhere to show one. The provider ID lowers
capitals as you type and marks anything that is not a lowercase letter, a
number or a hyphen.

An AI provider's base URL must be a whole http or https address, and a
custom model's id one word of at most 200 characters. A refusal on the AI
screen is now a sentence rather than a block of JSON.

A space's Slack and Teams channel ids are drawn monospace, without
spellcheck, and marked when they hold a space, the rule the server already
applied.

The audit filter's action and target type are chosen from the names this
workspace's trail holds, rather than typed. A new read action,
`audit.names`, answers them.

API clients sending `ai.updateProviderConfig` with a base URL that is not a
whole address, or `ai.addCustomModel` with a model id holding a space, now
get a refusal that says so.
