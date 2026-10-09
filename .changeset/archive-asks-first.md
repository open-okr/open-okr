---
"@openokr/web": patch
"@openokr/core": patch
"@openokr/ui": patch
---

Archiving a cycle asks first, and an open cycle that still holds goals is
closed before it can be archived.

One click archived the current cycle with no question, and a second click
archived the next one, leaving the workspace with no cycle and an empty work
map; nothing on any screen brings an archived cycle back. The button now asks
for confirmation, and the server refuses to archive a cycle that has goals
and has not been closed on the scorecard, so its result is recorded first.
A cycle with no goals still archives straight away.
