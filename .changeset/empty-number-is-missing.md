---
"@openokr/web": patch
---

An empty number field is refused instead of saved as zero.

A key result's baseline and target, a recorded value and a goal's weight were
read with `Number()`, which turns an empty field into 0, so a form that
reached the server empty saved a zero nobody typed: a key result "0 to 0", a
value of 0, or a weight of 0 that took the goal out of its parent's progress.
Empty now reads as missing, and each form answers with its own sentence.
