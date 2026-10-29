---
"@openokr/core": patch
---

`workspace.provision` refuses every person. A member's API or agent token
could call it and create a workspace for any user, even on an instance with
registration closed; sign-up and the setup wizard create workspaces without
it. The two import table actions now check their own `full` level too, rather
than relying on the settings read that happened to come first.
