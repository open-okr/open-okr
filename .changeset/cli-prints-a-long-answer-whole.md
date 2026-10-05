---
"@openokr/cli": patch
---

`okr` prints a long answer whole when its output goes to a pipe. It used to stop at 64 KB, so `okr goals list` on a workspace with a few hundred objectives printed half a JSON document.
