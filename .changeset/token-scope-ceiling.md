---
"@openokr/web": patch
---

A token's scopes now hold for everything a call causes. A token without the destructive scope can no longer apply an agent's or the copilot's proposal whose action is destructive, such as deleting a goal; it is refused with insufficient_scope, naming the action and the scope it needs, and the proposal stays pending. Applying from the review inbox in the browser is unchanged.
