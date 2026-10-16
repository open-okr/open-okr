---
"@openokr/web": patch
"@openokr/core": patch
---

Moving a workspace with its archive points every id inside stored JSON at
the moved rows.

A copilot proposal waiting in the review queue named the source workspace's
goals and members, so applying it after a move found nothing; an activity's
details and a check-in's history did the same. Each such id is now rewritten,
and an id the archive does not carry is left alone.

An agent's proposal was skipped without a word, because the run that made it
does not move. It now stays behind on purpose, and the import preview says how
many: the Coach and the Champion propose again on their next run.
