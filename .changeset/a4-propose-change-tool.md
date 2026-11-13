---
"@openokr/web": patch
---

The copilot no longer makes a separate model call to decide whether a question asks for a change. The model that chooses what to read may now prepare the change card itself, in its first round, so a question that asks for no change gets its first word sooner. A conversation opened from a page, and a provider that cannot call tools, still ask for the card first, as before.
