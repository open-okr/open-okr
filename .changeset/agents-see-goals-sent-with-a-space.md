---
"@openokr/web": patch
---

The Coach and the Champion see every goal that belongs to no space.

A goal created through the API, the command line or an agent tool with a space
but a different owner is stored in no space. The agents are given sight of
spaceless goals by name, and that step checked the space the goal was sent
with instead of the one it was stored in, so these goals were never checked
or chased. They now are. Goals created on screen were not affected.
