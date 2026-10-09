---
"@openokr/web": patch
"@openokr/ui": patch
---

A drafting assist that gets nothing back no longer blames the wording.

When the AI provider refused or did not answer, "Draft from an ambition" said
"Nothing was drafted from that. Try saying what changes.", which sent people
rewriting a sentence that was never the problem. The notices now say the
provider may not have answered, and the assists' notices are translated like
the rest of the screen.
