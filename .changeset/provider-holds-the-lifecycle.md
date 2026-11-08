---
"@openokr/web": patch
---

On a cloud, a workspace's own administrator can no longer lift a provider's suspension, the read-only mode that follows an unpaid subscription, or a closure, whether from Admin, General or through the API. Admin, General and the banner now say who holds the workspace instead of offering a switch that would be refused. Closing through the API now asks for the workspace's address, needs a token with the destructive scope, and is no longer one of an external agent's tools. A workspace the provider suspended can only be closed by the provider, so a legal hold cannot be turned into a deletion.
